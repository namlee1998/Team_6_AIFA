// Phase 2 plumbing — docs/architecture/A2A_PIPELINE_REDESIGN.md §8 Phase 2.
// Verifies that `project_definition` (the canonical A2A contract) flows
// end-to-end through the pipeline without breaking backward compatibility:
//   1. artifactManager.buildContextFromArtifacts unwraps JSON-object
//      artifacts to flat objects (currently only `project_definition`).
//   2. claudeCodeRunner.compactContext whitelists `project_definition` for
//      PO/UX/DEV/QA so the structured object survives into the AIFA
//      Context block.
//   3. recordApprovedHandoff envelope lists `project_definition` in
//      `required_downstream_inputs` for every downstream edge.
//
// Phase 2 deliberately does NOT change prompts, validators, output schemas
// or release flow — those moves land in Phase 3.

jest.mock('uuid', () => ({ v4: jest.fn(() => 'pd-plumb-uuid') }));

const path = require('path');
const fs = require('fs/promises');
const artifactManager = require('../../src/services/artifactManager');
const claudeCodeRunner = require('../../src/agents/claudeCodeRunner');
const workflowQueries = require('../../src/services/workflowQueries');
const AgentArtifact = require('../../src/models/AgentArtifact');

// Tiny in-memory stand-in for the AgentArtifact row. The artifact row is
// already shaped by AgentArtifact._map (contentJson is parsed). The helper
// `resolveArtifactContent` (workflowQueries) reads `contentJson.file_path`
// from disk when the payload is large — we mimic that path so the unit
// under test never has to know.
function makeArtifactRow({ artifactType, contentText = null, contentJson = null }) {
  return {
    id: `row-${artifactType}`,
    taskId: 'task-1',
    projectId: 'proj-1',
    agentType: 'architecture-agent',
    artifactType,
    artifactKey: `${artifactType}:task-1`,
    title: artifactType,
    contentText,
    contentJson,
    ordinal: 0,
    contentHash: 'hash',
  };
}

describe('Phase 2 plumbing — project_definition flows through the pipeline', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. buildContextFromArtifacts: JSON-object artifacts pass through as
  //    structured objects. Strings keep the historical [{key,title,content}]
  //    wrapper for backward compatibility with downstream prompts.
  // ---------------------------------------------------------------------------
  describe('buildContextFromArtifacts', () => {
    test('JSON-object artifact (project_definition) is unwrapped to a flat object', async () => {
      const pd = {
        project_type: { value: 'web_app', source: 'user', status: 'confirmed' },
        language: { value: 'TypeScript', source: 'user', status: 'confirmed' },
        runtime: { value: 'Node.js 20', source: 'user', status: 'confirmed' },
      };
      const rows = [makeArtifactRow({ artifactType: 'project_definition', contentJson: pd })];

      const context = await artifactManager.buildContextFromArtifacts(rows, {});

      expect(context.project_definition).toEqual(pd);
      // Critical: NOT the legacy wrapper shape.
      expect(Array.isArray(context.project_definition)).toBe(false);
    });

    test('string artifact keeps the historical [{key,title,content}] wrapper', async () => {
      const rows = [makeArtifactRow({ artifactType: 'architecture_brief', contentText: 'A short brief' })];

      const context = await artifactManager.buildContextFromArtifacts(rows, {});

      expect(Array.isArray(context.architecture_brief)).toBe(true);
      expect(context.architecture_brief).toHaveLength(1);
      expect(context.architecture_brief[0].content).toBe('A short brief');
    });

    test('JSON-array artifact (e.g. user_stories) keeps the wrapper — only objects unwrap', async () => {
      const stories = [
        { id: 'US-1', role: 'user', want: 'login', so_that: 'access', acceptance_criteria: [] },
      ];
      const rows = [makeArtifactRow({ artifactType: 'user_stories', contentJson: stories })];

      const context = await artifactManager.buildContextFromArtifacts(rows, {});

      // Arrays are NOT unwrapped — they keep the wrapper to remain
      // backward-compatible with existing prompts.
      expect(Array.isArray(context.user_stories)).toBe(true);
      expect(context.user_stories[0].content).toEqual(stories);
    });

    test('extras pre-seeded project_definition is overridden by the authoritative artifact', async () => {
      const pd = { language: { value: 'Go', source: 'user', status: 'confirmed' } };
      const rows = [makeArtifactRow({ artifactType: 'project_definition', contentJson: pd })];

      const context = await artifactManager.buildContextFromArtifacts(rows, {
        project_definition: { language: { value: 'stale', source: 'agent', status: 'assumed' } },
      });

      expect(context.project_definition).toEqual(pd);
    });

    test('absent project_definition leaves the key undefined (does not synthesize one)', async () => {
      const rows = [makeArtifactRow({ artifactType: 'prd', contentText: '# PRD body' })];

      const context = await artifactManager.buildContextFromArtifacts(rows, {});

      expect(context.project_definition).toBeUndefined();
      // String artifact unchanged.
      expect(context.prd).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. claudeCodeRunner.compactContext: project_definition is whitelisted
  //    for PO/UX/DEV/QA so the structured object survives into the AIFA
  //    Context block.
  // ---------------------------------------------------------------------------
  describe('compactContext — project_definition whitelist', () => {
    const pd = {
      project_type: { value: 'web_app', source: 'user', status: 'confirmed' },
      language: { value: 'TypeScript', source: 'user', status: 'confirmed' },
    };

    test.each(['po-agent', 'ux-agent', 'dev-agent', 'qa-agent'])(
      '%s retains project_definition when present in context',
      (role) => {
        const compact = claudeCodeRunner._internal.compactContext(role, {
          project_definition: pd,
          unrelated_key: 'should not appear',
        });
        expect(compact.project_definition).toEqual(pd);
        expect(compact.unrelated_key).toBeUndefined();
      },
    );

    test('po-agent also keeps architecture_brief for one phase (legacy compat)', () => {
      const compact = claudeCodeRunner._internal.compactContext('po-agent', {
        project_definition: pd,
        architecture_brief: 'legacy brief',
      });
      expect(compact.architecture_brief).toBe('legacy brief');
    });

    test('dev-agent also keeps architecture_brief for one phase (legacy compat)', () => {
      const compact = claudeCodeRunner._internal.compactContext('dev-agent', {
        project_definition: pd,
        architecture_brief: 'legacy brief',
      });
      expect(compact.architecture_brief).toBe('legacy brief');
    });

    test('compactContext is idempotent — absent keys stay absent', () => {
      const compact = claudeCodeRunner._internal.compactContext('qa-agent', {
        acceptance_criteria: ['AC-1', 'AC-2'],
      });
      expect(compact.project_definition).toBeUndefined();
      expect(compact.acceptance_criteria).toEqual(['AC-1', 'AC-2']);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. recordApprovedHandoff: every downstream edge lists project_definition
  //    in `required_downstream_inputs`. This is the on-the-wire contract that
  //    auditors and downstream services can rely on.
  // ---------------------------------------------------------------------------
  describe('recordApprovedHandoff — required_downstream_inputs includes project_definition', () => {
    function capturedEnvelope(task, nextAgent) {
      return {
        handoff_id: 'h-1',
        schema_version: 'a2a_handoff.v1',
        project_id: task.projectId,
        from_agent: task.type,
        to_agent: nextAgent,
        source_task_id: task.id,
        target_task_id: null,
        attempt: 1,
        input_artifacts: [],
        output_artifact: { task_id: task.id, hash: 'h' },
        approval: { approval_id: 'a-1', type: 'approve', confidence: null, validation_result_id: 'v' },
        contract: {
          required_downstream_inputs: [],
        },
        integrity: { artifact_hash: 'h', created_at: '2026-07-10T00:00:00Z' },
        created_at: '2026-07-10T00:00:00Z',
      };
    }

    let bulkUpsertSpy;
    let captured;
    beforeEach(() => {
      jest.spyOn(AgentArtifact, 'findByTaskId').mockResolvedValue([]);
      bulkUpsertSpy = jest.spyOn(AgentArtifact, 'bulkUpsert').mockImplementation(async (rows) => {
        captured = rows[0]?.contentJson;
        return rows;
      });
    });

    test.each([
      ['architecture-agent', 'po-agent'],
      ['po-agent', 'ux-agent'],
      ['ux-agent', 'dev-agent'],
      ['dev-agent', 'qa-agent'],
      // Legacy PO → DEV edge is still listed in the contract map for backward compat.
      ['po-agent', 'dev-agent'],
    ])('%s → %s lists project_definition in required_downstream_inputs', async (fromAgent, toAgent) => {
      const task = { id: 't-1', projectId: 'p-1', type: fromAgent, retryCount: 0 };
      const nextAgentFn = jest.fn(() => toAgent);
      const writeFileFn = jest.fn(async () => 'FILE:/tmp/x');

      await artifactManager.recordApprovedHandoff(task, { id: 'a-1', action: 'approve' }, {
        nextAgentFn,
        writeFileFn,
      });

      expect(bulkUpsertSpy).toHaveBeenCalledTimes(1);
      expect(captured.from_agent).toBe(fromAgent);
      expect(captured.to_agent).toBe(toAgent);
      expect(captured.contract.required_downstream_inputs).toContain('project_definition');
    });

    test('no-op when there is no next agent (terminal task)', async () => {
      const task = { id: 't-1', projectId: 'p-1', type: 'qa-agent', retryCount: 0 };
      await artifactManager.recordApprovedHandoff(task, { id: 'a-1', action: 'approve' }, {
        nextAgentFn: () => null,
        writeFileFn: jest.fn(),
      });
      expect(bulkUpsertSpy).not.toHaveBeenCalled();
    });
  });
});