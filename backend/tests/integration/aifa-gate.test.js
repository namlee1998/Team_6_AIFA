// AIFA PHASE 8 (T8.2) — unit coverage for the new claude-code path building
// blocks that do NOT need the DB: risk classifier tiers, gate bridge
// idempotency + watchdog, repo safety helpers, PO route classification, and
// the three-layer validation summary.

// uuid v14 is ESM-only; mock it with a unique counter so each id stays distinct.
jest.mock('uuid', () => { let n = 0; return { v4: () => `uuid-${++n}` }; });

const riskClassifier = require('../../src/services/riskClassifier');
const gateBridge = require('../../src/services/gateBridge');
const eventBus = require('../../src/services/eventBus');
const repoService = require('../../src/services/repoService');

beforeAll(() => { process.env.MOCK_SCENARIO = 'happy_path'; });
afterAll(() => { delete process.env.MOCK_SCENARIO; });
afterEach(() => { gateBridge._clearAll(); eventBus._clearAll(); });

describe('T2.1 — riskClassifier tiers', () => {
  const cases = [
    ['Write', { file_path: 'tests/auth.test.js' }, 'auto'],
    ['Write', { file_path: 'docs/readme.md' }, 'auto'],
    ['Write', { file_path: 'src/feature/new.js', is_new: true }, 'auto'],
    ['Write', { file_path: 'src/auth/google.js' }, 'approval'],
    ['Write', { file_path: 'config/settings.js' }, 'approval'],
    ['Write', { file_path: 'prisma/migrations/x.sql' }, 'approval'],
    ['Write', { file_path: 'package.json' }, 'approval'],
    ['Delete', { file_path: 'src/old.js' }, 'approval'],
    ['Write', { file_path: '../outside.js' }, 'block'],
    ['Edit', { file_path: '.env' }, 'block'],
  ];
  test.each(cases)('%s %o → %s', (tool, input, tier) => {
    expect(riskClassifier.classifyAction(tool, input, { featurePaths: ['src/', 'tests/', 'docs/'] }).tier).toBe(tier);
  });

  test('git push to main is blocked', () => {
    expect(riskClassifier.classifyAction('Bash', { command: 'git push origin main' }, {}).tier).toBe('block');
  });
});

describe('T2.2 — gateBridge idempotency + watchdog', () => {
  test('requestGate suspends, resolveGate wakes exactly once', async () => {
    const { approvalId, promise, ready } = gateBridge.requestGate({ taskId: 't', role: 'dev-agent', kind: 'tool', payload: {} });
    await ready;
    expect(gateBridge.hasPending(approvalId)).toBe(true);
    await expect(gateBridge.resolveGate(approvalId, { action: 'approve' })).resolves.toBe(true);
    // second resolve is a no-op (no double action)
    await expect(gateBridge.resolveGate(approvalId, { action: 'approve' })).resolves.toBe(false);
    expect(gateBridge.hasPending(approvalId)).toBe(false);
    await expect(promise).resolves.toEqual({ action: 'approve' });
  });

  test('watchdog auto-rejects an unanswered gate', async () => {
    const { promise } = gateBridge.requestGate({ taskId: 't', role: 'dev-agent', kind: 'tool', payload: {}, timeoutMs: 50 });
    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(result.action).toBe('reject');
  });

  test('listPending filters by task', () => {
    gateBridge.requestGate({ taskId: 'a', role: 'po-agent', kind: 'question', payload: {} });
    gateBridge.requestGate({ taskId: 'b', role: 'dev-agent', kind: 'tool', payload: {} });
    expect(gateBridge.listPending({ taskId: 'a' })).toHaveLength(1);
    expect(gateBridge.listPending({})).toHaveLength(2);
  });

  test('gate_pending is pushed directly to session subscribers after persistence', async () => {
    const events = [];
    const unsubscribe = eventBus.subscribe('sess-live', (envelope) => events.push({ envelope }));
    const { ready } = gateBridge.requestGate({ sessionId: 'sess-live', projectId: 'proj-live', taskId: 'task-live', role: 'dev-agent', kind: 'tool', payload: { file_path: 'src/a.js' } });
    await ready;
    unsubscribe();

    expect(events).toHaveLength(1);
    const env = events[0].envelope;
    expect(env.type).toBe('gate_pending');
    expect(env.payload.gate).toMatchObject({
      taskId: 'task-live',
      role: 'dev-agent',
      kind: 'tool',
      status: 'pending',
    });
  });

  test('pipeline lock only detects human question gates', () => {
    const svc = require('../../src/services/SdlcWorkflowService');
    gateBridge.requestGate({ taskId: 'tool', projectId: 'p', role: 'dev-agent', kind: 'tool', payload: {} });
    expect(svc._getPendingQuestionGate('p')).toBeNull();

    gateBridge.requestGate({ taskId: 'question', projectId: 'p', role: 'po-agent', kind: 'question', payload: {} });
    expect(svc._getPendingQuestionGate('p')).toMatchObject({
      taskId: 'question',
      role: 'po-agent',
      kind: 'question',
    });
  });
});

describe('T1.3 — repo safety helpers', () => {
  test('secret-like paths are blocked from reads', () => {
    expect(repoService.isBlockedPath('.env')).toBe(true);
    expect(repoService.isBlockedPath('config/id_rsa')).toBe(true);
    expect(repoService.isBlockedPath('certs/server.pem')).toBe(true);
    expect(repoService.isBlockedPath('src/index.js')).toBe(false);
  });
  test('path traversal stays out of the repo', () => {
    expect(repoService.isWithinRepo('/repo', 'src/a.js')).toBe(true);
    expect(repoService.isWithinRepo('/repo', '../../etc/passwd')).toBe(false);
  });
  test('slugify produces a branch-safe slug', () => {
    expect(repoService.slugify('Add Google Login!')).toBe('add-google-login');
  });
});

describe('T4.1 / T5.1 — route classification + three-layer validation', () => {
  const svc = require('../../src/services/SdlcWorkflowService');

  test('po next-agent honours the route', () => {
    expect(svc._nextAgentFor({ type: 'po-agent', observability: { route: { has_ui: true } } })).toBe('ux-agent');
    expect(svc._nextAgentFor({ type: 'po-agent', observability: { route: { has_ui: false } } })).toBe('dev-agent');
  });

  test('workflow status never pairs a stale QA task with the current DEV task', () => {
    const tasks = [
      { id: 'dev-new', type: 'dev-agent', sourceRunId: 'ux-new' },
      { id: 'qa-old', type: 'qa-agent', sourceRunId: 'dev-old' },
      { id: 'ux-new', type: 'ux-agent', sourceRunId: 'po-new' },
      { id: 'dev-old', type: 'dev-agent', sourceRunId: 'ux-old' },
      { id: 'po-new', type: 'po-agent' },
    ];

    expect(svc._selectCurrentTaskChain(tasks)).toMatchObject({
      poTask: { id: 'po-new' },
      uxTask: { id: 'ux-new' },
      devTask: { id: 'dev-new' },
      qaTask: null,
    });

    tasks.unshift({ id: 'qa-new', type: 'qa-agent', sourceRunId: 'dev-new' });
    expect(svc._selectCurrentTaskChain(tasks).qaTask).toMatchObject({ id: 'qa-new' });
  });

  test('completed QA waits for human review before final release', () => {
    const po = { id: 'po', type: 'po-agent', status: 'completed' };
    const ux = { id: 'ux', type: 'ux-agent', status: 'completed' };
    const dev = { id: 'dev', type: 'dev-agent', status: 'completed' };
    const qa = { id: 'qa', type: 'qa-agent', status: 'completed' };
    const approvedUpstream = {
      po: { decision: 'APPROVE' },
      ux: { decision: 'APPROVE' },
      dev: { decision: 'APPROVE' },
    };

    expect(svc._deriveCurrentPhase(po, ux, dev, qa, approvedUpstream)).toBe('QA_REVIEW');
  });

  test('layer 2 catches non-testable AC as a BLOCKER', () => {
    const summary = svc._threeLayerSummary({ type: 'po-agent' }, { prd: 'x', acceptance_criteria: ['a', 'b'] });
    expect(summary.semantic.ok).toBe(false);
    expect(summary.semantic.violations.map((v) => v.rule)).toContain('ac_testable');
  });

  test('a complete PO output passes all three layers', async () => {
    const out = await svc._buildMockOutput({ id: 't', type: 'po-agent' }, { featureRequest: { title: 'Add Google login', description: 'OAuth 2.0 sign-in' } });
    const summary = svc._threeLayerSummary({ type: 'po-agent' }, out);
    expect(summary.ok).toBe(true);
  });
});

// §19.8 verification step 2 + step 5 — FINAL_RELEASE re-architecture:
// pipeline_completed must NOT fire at QA approval; the FINAL_RELEASE gate
// must be created; awaiting_release must be persisted; the release path
// must NEVER invoke an agent runner.
describe('§19.8 — FINAL_RELEASE re-architecture', () => {
  let svc;
  let eventPublisher;
  let gateBridge;
  let Task;
  let PipelineSession;
  let HitlDecision;
  let AgentArtifact;
  let agentRunnerSpies;

  beforeEach(() => {
    jest.resetModules();

    // Spy on agent runners — they MUST NOT be called during FINAL_RELEASE.
    // We stub the agentDispatcher + SdlcWorkflowService.run* methods; the
    // fake dispatch is a no-op so any unintended invocation is detectable.
    agentRunnerSpies = {
      runArchitectureAgent: jest.fn(async () => null),
      runPOAgent: jest.fn(async () => null),
      runUXAgent: jest.fn(async () => null),
      runDEVAgent: jest.fn(async () => null),
      runQAAgent: jest.fn(async () => null),
    };

    jest.doMock('../../src/services/agentDispatcher', () => agentRunnerSpies);

    // Stub eventPublisher.publishEvent so we can assert on what fires.
    eventPublisher = require('../../src/services/eventPublisher');
    jest.spyOn(eventPublisher, 'publishEvent').mockResolvedValue(undefined);

    // Stub models the resolveOutputReviewGate path touches.
    const qaTask = {
      id: 'qa-1',
      type: 'qa-agent',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      status: 'completed',
      agentOutput: { qa_report: { coverage: 92 }, blocker_count: 0 },
      approvedOutput: { qa_report: { coverage: 92 } },
      result: { gateRecommendation: 'PASS' },
      outputVersion: 1,
      observability: {},
    };

    Task = {
      findById: jest.fn(async (id) => (id === qaTask.id ? qaTask : null)),
      update: jest.fn(async () => qaTask),
      commitTask: jest.fn(async () => undefined),
    };
    jest.doMock('../../src/models/Task', () => Task);

    PipelineSession = {
      findById: jest.fn(async (id) => (id === 'sess-1'
        ? { id: 'sess-1', projectId: 'proj-1', status: 'running', repoPath: '/tmp/repo' }
        : null)),
      update: jest.fn(async () => undefined),
    };
    jest.doMock('../../src/models/PipelineSession', () => PipelineSession);

    HitlDecision = {
      create: jest.fn(async (row) => ({ id: row.id || 'hitl-x', ...row })),
    };
    jest.doMock('../../src/models/HitlDecision', () => HitlDecision);

    AgentArtifact = {
      setStatusByTaskId: jest.fn(async () => undefined),
    };
    jest.doMock('../../src/models/AgentArtifact', () => AgentArtifact);

    // Stub PendingGate so gateBridge.requestGate/resolveGate can persist
    // without a real DB.
    jest.doMock('../../src/models/PendingGate', () => ({
      create: jest.fn(async () => undefined),
      resolve: jest.fn(async () => undefined),
      findById: jest.fn(async () => null),
      markPendingInterrupted: jest.fn(async () => 0),
      listInterrupted: jest.fn(async () => []),
    }));

    // Stub taskLifecycle to a no-op so resolveOutputReviewGate doesn't try
    // to move tasks through real lifecycle states.
    jest.doMock('../../src/services/taskLifecycleService', () => ({
      transitionIfPresent: jest.fn(async () => undefined),
    }));

    // Stub the repo helpers the QA-approve path touches; none of them should
    // do real work.
    jest.doMock('../../src/services/repoService', () => ({
      commitAndPushOnApprove: jest.fn(async () => ({ committed: true, pushed: false, pushError: null })),
      repoPathFor: jest.fn(() => '/tmp/repo'),
      git: jest.fn(async () => ''),
    }));

    // Stub workflowReport helpers — _buildReleaseEvidenceSummary needs to
    // return a deterministic evidence object.
    jest.doMock('../../src/services/workflowReport', () => ({
      writeReleaseBundle: jest.fn(async () => ({ outputs: [], outputDir: '/tmp/bundle' })),
      findPreviousBundle: jest.fn(async () => null),
      removeGitTracked: jest.fn(async () => undefined),
      buildFinalMarkdown: jest.fn(() => ''),
    }));

    // Internal helpers that should be called during the QA-approve path.
    svc = require('../../src/services/SdlcWorkflowService');
    jest.spyOn(svc, '_recordApprovedHandoff').mockResolvedValue(undefined);
    jest.spyOn(svc, '_startNextAgentIfAvailable').mockResolvedValue(undefined);
    jest.spyOn(svc, '_buildReleaseEvidenceSummary').mockResolvedValue({
      feature: 'login',
      risk: null,
      versions: {},
      build_result: null,
      security_gate: null,
      qa_gate: 'PASS',
      coverage_percentage: 92,
      open_blockers: [],
    });
    jest.spyOn(svc, '_getRepoContext').mockResolvedValue({
      repoPath: '/tmp/repo',
      repoUrl: 'https://github.com/team6/user-repo',
      workingBranch: 'aifa/test',
      baseBranch: 'main',
    });

    gateBridge = require('../../src/services/gateBridge');
    // Reset gateBridge internal state for each test.
    gateBridge._clearAll();

    // Pre-register an output_review gate so resolveOutputReviewGate's
    // `hasPending` check passes. Capture the real approvalId so each test
    // resolves the same pending record. We also stub the underlying
    // PendingGate model to avoid any DB writes.
    const created = gateBridge.requestGate({
      taskId: 'qa-1',
      sessionId: 'sess-1',
      projectId: 'proj-1',
      role: 'qa-agent',
      kind: 'output_review',
      payload: {},
    });
    registeredApprovalId = created.approvalId;
    userCounter = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('../../src/services/agentDispatcher');
    jest.dontMock('../../src/services/repoService');
    jest.dontMock('../../src/services/workflowReport');
    jest.dontMock('../../src/models/Task');
    jest.dontMock('../../src/models/PipelineSession');
    jest.dontMock('../../src/models/HitlDecision');
    jest.dontMock('../../src/models/AgentArtifact');
  });

  let registeredApprovalId;
  let userCounter;

  function resolveApprovalAs(userNum, overrides = {}) {
    return svc.resolveOutputReviewGate(
      { approvalId: registeredApprovalId, action: 'approve', comment: 'ok', ...overrides },
      { id: `user-${userNum}` },
    );
  }

  test('QA approval does NOT emit pipeline_completed (moved to FINAL_RELEASE)', async () => {
    await resolveApprovalAs(1);
    const calls = eventPublisher.publishEvent.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('pipeline_completed');
  });

  test('QA approval marks the session awaiting_release', async () => {
    await resolveApprovalAs(2);
    expect(PipelineSession.update).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ status: 'awaiting_release' }),
    );
  });

  test('QA approval creates a FINAL_RELEASE gate with role=release, kind=release', async () => {
    await resolveApprovalAs(3);
    const releaseGate = gateBridge.listPending({ projectId: 'proj-1' })
      .find((g) => g.kind === 'release');
    expect(releaseGate).toBeDefined();
    expect(releaseGate.role).toBe('release');
    expect(releaseGate.payload).toHaveProperty('evidence');
    expect(releaseGate.payload.repoContext.repoUrl).not.toBe('https://github.com/octocat/Hello-World');
    expect(releaseGate.payload.repoContext.repoUrl).toBe('https://github.com/team6/user-repo');
  });

  test('QA approval throws 500 if session has no cloned repository workspace', async () => {
    svc._getRepoContext.mockResolvedValueOnce(null);
    await expect(resolveApprovalAs(4)).rejects.toMatchObject({ statusCode: 500 });
  });

  test('FINAL_RELEASE path is non-executing — no agent runner is invoked', async () => {
    await resolveApprovalAs(5);
    for (const [, spy] of Object.entries(agentRunnerSpies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  // Bug 3 — the gate-creation branch must also fire when QA's
  // gate_evaluation was not populated but the agent's test_run_report shows
  // a clean run. This mirrors releaseManager.qaGatePassed's fallback path.
  test('QA approval with no gateRecommendation but passing test_run_report creates FINAL_RELEASE gate', async () => {
    const TaskMod = require('../../src/models/Task');
    TaskMod.findById.mockImplementation(async (id) => (id === 'qa-1' ? {
      id: 'qa-1',
      type: 'qa-agent',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      status: 'completed',
      agentOutput: {
        qa_report: { coverage: 92 },
        blocker_count: 0,
        test_run_report: { executed: true, total: 5, passed: 5, failed: 0, logs: 'ok' },
      },
      approvedOutput: { qa_report: { coverage: 92 } },
      // No gateRecommendation populated — the regression case from the live run.
      result: {},
      outputVersion: 1,
      observability: {},
    } : null));

    await resolveApprovalAs(6);

    expect(PipelineSession.update).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ status: 'awaiting_release' }),
    );
    const releaseGate = gateBridge.listPending({ projectId: 'proj-1' })
      .find((g) => g.kind === 'release');
    expect(releaseGate).toBeDefined();
    expect(releaseGate.role).toBe('release');
  });

  test('QA approval with FAIL gateRecommendation and failing test_run_report does NOT create FINAL_RELEASE', async () => {
    const TaskMod = require('../../src/models/Task');
    TaskMod.findById.mockImplementation(async (id) => (id === 'qa-1' ? {
      id: 'qa-1',
      type: 'qa-agent',
      projectId: 'proj-1',
      sessionId: 'sess-1',
      status: 'completed',
      agentOutput: {
        qa_report: { coverage: 50 },
        blocker_count: 2,
        test_run_report: { executed: true, total: 5, passed: 3, failed: 2, logs: 'ok' },
      },
      approvedOutput: { qa_report: { coverage: 50 } },
      result: { gateRecommendation: 'FAIL' },
      outputVersion: 1,
      observability: {},
    } : null));

    await resolveApprovalAs(7);

    // session should not flip to awaiting_release
    const updateCalls = PipelineSession.update.mock.calls;
    const awaiting = updateCalls.find(([, payload]) => payload?.status === 'awaiting_release');
    expect(awaiting).toBeUndefined();

    // no release gate should be created
    const releaseGate = gateBridge.listPending({ projectId: 'proj-1' })
      .find((g) => g.kind === 'release');
    expect(releaseGate).toBeUndefined();
  });
});
