// ── Workflow Orchestrator ─────────────────────────────────────────────────────
// Creates agent tasks, builds context from upstream artifacts, and starts agent
// execution. Each function accepts a `deps` object for callbacks to the owning
// service (SdlcWorkflowService) so that stateful methods stay in the class.

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Task, AgentArtifact, PipelineSession } = require('../models');
const FeatureBacklog = require('../models/FeatureBacklog');
const gateBridge = require('./gateBridge');
const repoService = require('./repoService');
const repoIndexService = require('./repoIndexService');
const { resolveScope } = require('./scopeResolver');
const { ApiError } = require('../middleware/errorHandler');
const { NEXT_AGENT, AGENT_GATES, MAX_RETRY_PER_STEP } = require('./sdlcConstants');
const { REQUIRED_OUTPUT_KEYS, hasContent } = require('./agentContract');
const logger = require('../config/logger');

// AIFA v2.1 §3 / §15: every agent follows exactly one predecessor. The
// required output keys for each role live in agentContract.REQUIRED_OUTPUT_KEYS
// — this map is the single source of truth for both the contract check and
// the upstream-artifact guard. The key (PREDECESSOR_ROLE) is the immediate
// upstream agent; ARCH is the entry point and has no predecessor.
const PREDECESSOR_ROLE = {
  'po-agent': 'architecture-agent',
  'ux-agent': 'po-agent',
  'dev-agent': 'ux-agent',
  'qa-agent': 'dev-agent',
};

const MAX_PARALLEL_WORKFLOWS = () => Math.max(1, Number(process.env.MAX_PARALLEL_WORKFLOWS) || 4);

// Phase 2 plumbing (docs/architecture/A2A_PIPELINE_REDESIGN.md §8 Phase 2):
// Resolve a JSON-object artifact (currently only `architecture_contract`) from
// the upstream task and return it as a structured object ready for
// `buildContextFromArtifacts` extras. Returns null when the artifact is
// absent or empty, so callers can safely spread the result.
async function resolveStructuredArtifact(artifacts, artifactType, deps) {
  if (!deps || typeof deps.resolveArtifactContent !== 'function') return null;
  const row = artifacts.find((a) => a.artifactType === artifactType);
  if (!row) return null;
  const { contentJson } = await deps.resolveArtifactContent(row);
  if (contentJson && typeof contentJson === 'object' && !Array.isArray(contentJson)) {
    return contentJson;
  }
  return null;
}

// =============================================================================
// runArchitectureAgent
// =============================================================================

async function runArchitectureAgent(params, deps) {
  const { projectId, featureRequest, feedbackPrompt = '', backlogId = null, repoUrl = null, user } = params;
  if (user) {
    await deps.MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor']);
  }

  // AIFA v2.1 §4 Phase 1: validate the Repository URL BEFORE Task.create()
  // and BEFORE any workspace work. If the URL is missing or invalid we fail
  // fast with HTTP 400 — no task row is created and no workspace is touched.
  // Rework paths may legitimately pass no repoUrl (the workspace already
  // exists), so only validate when one is provided.
  if (repoUrl) {
    deps.repoService.validateRepoUrl(repoUrl);
  }

  const inputHash = deps.contentHash({ featureRequest, feedbackPrompt });

  // AIFA v2.1: create the PipelineSession BEFORE the Architecture task so
  // the response can return both identifiers in a single round-trip and
  // /pipeline/:session_id, /workflow-status and /stream/:session_id work
  // immediately. PO auto-advance reuses this session via sessionId.
  const active = await PipelineSession.countActive();
  if (active >= MAX_PARALLEL_WORKFLOWS()) {
    throw new ApiError(
      429,
      `Too many active workflows (${active}/${MAX_PARALLEL_WORKFLOWS()}). ` +
      `Try again when one finishes.`,
      'TOO_MANY_WORKFLOWS',
      'ARCH_RUNNING',
    );
  }
  const session = await PipelineSession.create({
    id: uuidv4(),
    projectId,
    title: (featureRequest?.title || '').slice(0, 200) || null,
  });

  const task = await Task.create({
    id: uuidv4(),
    projectId,
    sessionId: session.id,
    type: 'architecture-agent',
    status: 'pending',
    inputContentHash: inputHash,
    versionStatus: 'draft',
  });

  // Persist the original Feature Request on the ARCH task's observability so
  // the auto-advance path (startNextAgentIfAvailable → runPOAgent) can recover
  // it without requiring an extra DB column or new persistent artifact type.
  // PO already stores featureRequest the same way (runPOAgent below) — keep the
  // pattern uniform.
  if (featureRequest) {
    const archObservability = { featureRequest };
    await Task.update(task.id, { observability: archObservability });
  }

  if (backlogId) {
    try {
      await FeatureBacklog.linkTask(backlogId, task.id, projectId);
    } catch (error) {
      await Task.deleteById(task.id);
      throw new ApiError(409, error.message);
    }
  }

  let repoContext = null;
  if (repoUrl) {
    if (deps.repoService?.isHttpUrl(repoUrl) && deps.repoService?.cloneRepo) {
      const cloned = await deps.repoService.cloneRepo({
        projectId,
        sessionId: session.id,
        repoUrl,
      });
      repoContext = { ...cloned, repoUrl, request: featureRequest?.title || '' };
    } else if (deps.repoService?.useLocalRepo) {
      const opened = await deps.repoService.useLocalRepo({
        repoPath: repoUrl,
        projectId,
        request: featureRequest?.title || '',
      });
      repoContext = { ...opened, repoUrl: null, request: featureRequest?.title || '' };
    }
  } else if (deps.repoService?.prepareSessionRepo) {
    // Spec v3 §11: every run needs a git workspace so the per-agent commits
    // (5 agents + final.md) actually land in git. When ARCH is invoked without
    // a repoUrl this is still required — fall back to prepareSessionRepo,
    // which auto-initializes an empty repo if no canonical upload exists
    // (see repoService.prepareSessionRepo). Without this, the rest of the
    // pipeline would silently skip every commit ("workspace missing") and
    // declare RELEASED on a run that left zero git history behind.
    const prepared = await deps.repoService.prepareSessionRepo({
      projectId,
      sessionId: session.id,
      request: featureRequest?.title || '',
    });
    repoContext = { ...prepared, repoUrl: null, request: featureRequest?.title || '' };
  }

  // FIX A — persist the workspace path BEFORE runAgent starts so:
  //   1. _getRepoContext(projectId, sessionId) returns a real working tree
  //      for every downstream agent (PO/UX/DEV/QA) — without this, the
  //      agents' Write/Edit tools operate against process.cwd() instead
  //      of the cloned/opened repo.
  //   2. commitAndPushOnApprove computes the same path and finds the
  //      workspace on disk, so per-agent commits fire as Spec §7.2/§11
  //      require (was: PipelineSession.repoPath stayed NULL and 0 of 6
  //      commits ever landed).
  if (repoContext?.repoPath) {
    await PipelineSession.update(session.id, {
      repoPath: repoContext.repoPath,
      workingBranch: repoContext.workingBranch,
      baseBranch: repoContext.baseBranch,
    });
    logger.info('[SDLC] ARCH workspace persisted', {
      taskId: task.id,
      sessionId: session.id,
      repoPath: repoContext.repoPath,
      workingBranch: repoContext.workingBranch,
      baseBranch: repoContext.baseBranch,
    });
  }

  // AIFA v2.1 token-economy: the backend owns repository discovery. Build a
  // shallow directory index (no source file contents) and resolve a scope
  // (targetFolders + languageHint + confidence) BEFORE the agent starts.
  // The Architecture Agent then receives repoIndex + scopeHints as data and
  // is constrained by the prompt to only LS paths in scopeHints.targetFolders.
  let repoIndex = { root: null, entries: [], manifests: [], revision: null, maxDepth: 0, builtAt: 0 };
  if (repoContext?.repoPath) {
    try {
      repoIndex = await repoIndexService.buildRepoIndex(repoContext.repoPath, { maxDepth: 2 });
      logger.info('[SDLC] ARCH repoIndex built', {
        taskId: task.id,
        sessionId: session.id,
        entryCount: repoIndex.entries.length,
        manifestCount: (repoIndex.manifests || []).length,
        revision: repoIndex.revision,
      });
    } catch (e) {
      logger.warn('[SDLC] ARCH repoIndex build failed, falling back to empty', {
        taskId: task.id,
        error: e.message,
      });
    }
  }
  const scopeHints = resolveScope({ repoIndex, featureRequest });
  logger.info('[SDLC] ARCH scope resolved', {
    taskId: task.id,
    languageHint: scopeHints.languageHint,
    targetFolders: scopeHints.targetFolders,
    confidence: scopeHints.confidence,
    reason: scopeHints.reason,
  });

  deps.runAgent(task, {
    featureRequest,
    feedbackPrompt,
    scopeHints,
    repoIndex,
    ...(repoContext ? { repoContext } : {}),
  }, user?.id).catch((err) => console.error('[SDLC] Architecture Agent failed:', err));

  return { task, sessionId: session.id };
}

// =============================================================================
// requireUpstreamArtifact — AIFA v2.1 §3 / §15 upstream-artifact guard
// =============================================================================
// Every non-entry agent may only start when its immediate predecessor has
// produced a non-empty canonical artifact. The set of "must-have" keys for
// each role is taken from agentContract.REQUIRED_OUTPUT_KEYS (single source
// of truth), and emptiness is decided by the same hasContent() helper the
// contract uses, so the guard stays in lock-step with the I/O contract.
// DEV is strictly downstream of UX — the PO→DEV legacy path is removed.
async function requireUpstreamArtifact(sourceTask, agentType) {
  const predecessor = PREDECESSOR_ROLE[agentType];
  if (!predecessor) return; // ARCH entry — no predecessor to check

  if (!sourceTask) {
    throw new ApiError(
      400,
      `Source task is required to start ${agentType}.`,
      'UPSTREAM_ARTIFACT_MISSING',
      agentType.toUpperCase().replace('-AGENT', '_RUNNING'),
    );
  }
  if (sourceTask.type !== predecessor) {
    throw new ApiError(
      400,
      `${agentType} requires predecessor ${predecessor}, got ${sourceTask.type}.`,
      'UPSTREAM_ARTIFACT_MISSING',
      agentType.toUpperCase().replace('-AGENT', '_RUNNING'),
    );
  }

  const requiredKeys = REQUIRED_OUTPUT_KEYS[predecessor] || [];
  for (const key of requiredKeys) {
    const rows = await AgentArtifact.findByTaskIdAndType(sourceTask.id, key);
    // An artifact is "present and non-empty" when at least one persisted row
    // hasContent() — the same predicate agentContract uses to validate an
    // agent's own output. This avoids hard-coding how each artifact carries
    // its payload (contentText for strings, contentJson for structured data).
    const hasNonEmpty = rows.some((row) => {
      const payload = row.contentJson !== null && row.contentJson !== undefined
        ? row.contentJson
        : row.contentText;
      return hasContent(payload);
    });
    if (!hasNonEmpty) {
      throw new ApiError(
        400,
        `Missing upstream artifact: '${key}'. The ${predecessor} task ` +
          `${sourceTask.id} must produce a non-empty '${key}' artifact ` +
          `before ${agentType} can start.`,
        'UPSTREAM_ARTIFACT_MISSING',
        agentType.toUpperCase().replace('-AGENT', '_RUNNING'),
      );
    }
  }
}

// =============================================================================
// runPOAgent
// =============================================================================

async function runPOAgent(params, deps) {
  const {
    projectId, sourceTaskId = null, featureRequest = null, feedbackPrompt = '',
    previousDraft = null, backlogId = null,
    repoUrl = null, repoPath = null, branch = 'main', request = '',
    sessionId = null, user,
  } = params;
  const sourceTask = sourceTaskId
    ? await deps.requireApprovedTask(sourceTaskId, 'architecture-agent', user)
    : null;
  await requireUpstreamArtifact(sourceTask, 'po-agent');
  const effectiveProjectId = projectId || sourceTask?.projectId;
  if (!effectiveProjectId) throw new ApiError(400, 'projectId is required');
  if (user) {
    await deps.MembershipService.requireProjectRole(user.id, effectiveProjectId, ['owner', 'admin', 'editor']);
  }

  // Session management
  let session = sessionId ? await PipelineSession.findById(sessionId) : null;
  let repoContext = null;
  if (!session) {
    const active = await PipelineSession.countActive();
    if (active >= MAX_PARALLEL_WORKFLOWS()) {
      throw new ApiError(429, `Too many active workflows (${active}/${MAX_PARALLEL_WORKFLOWS()}). Try again when one finishes.`, 'TOO_MANY_WORKFLOWS', 'PO_RUNNING');
    }
    session = await PipelineSession.create({
      id: uuidv4(),
      projectId: effectiveProjectId,
      title: (request || featureRequest?.title || '').slice(0, 200) || null,
    });

    if (repoUrl && !repoService.isHttpUrl(repoUrl)) {
      repoPath = repoUrl;
      repoUrl = null;
    }

    if (repoUrl) {
      const cloned = await repoService.cloneRepo({ repoUrl, branch, projectId: effectiveProjectId, sessionId: session.id, request });
      const safety = await repoService.assertRepoSafe(cloned.repoPath);
      repoContext = { ...cloned, repoUrl, request, safety };
    } else if (repoPath) {
      const canonicalPath = repoService.repoPathFor(effectiveProjectId);
      const isUploadedProject = path.resolve(repoPath) === path.resolve(canonicalPath);
      const opened = isUploadedProject
        ? await repoService.prepareSessionRepo({ projectId: effectiveProjectId, sessionId: session.id, request })
        : await repoService.useLocalRepo({ repoPath, branch, projectId: effectiveProjectId, request });
      const safety = await repoService.assertRepoSafe(opened.repoPath);
      repoContext = { ...opened, repoUrl: null, request, safety };
    }

    if (repoContext) {
      await PipelineSession.update(session.id, {
        repoPath: repoContext.repoPath,
        workingBranch: repoContext.workingBranch,
        baseBranch: repoContext.baseBranch,
      });
    }
  }

  const sourceArtifacts = sourceTask ? await AgentArtifact.findByTaskId(sourceTask.id) : [];
  const inputHash = deps.contentHash({
    featureRequest,
    artifacts: sourceArtifacts.map((a) => a.contentHash),
    feedbackPrompt,
  });

  const task = await Task.create({
    id: uuidv4(),
    projectId: effectiveProjectId,
    sessionId: session.id,
    type: 'po-agent',
    status: 'pending',
    inputContentHash: inputHash,
    sourceRunId: sourceTask?.id || null,
    versionStatus: 'draft',
  });

  const poObservability = {};
  if (repoContext) poObservability.repo = repoContext;
  if (featureRequest) poObservability.featureRequest = featureRequest;
  if (Object.keys(poObservability).length) {
    await Task.update(task.id, { observability: poObservability });
  }

  if (backlogId) {
    try {
      await FeatureBacklog.linkTask(backlogId, task.id, effectiveProjectId);
    } catch (error) {
      await Task.deleteById(task.id);
      throw new ApiError(409, error.message);
    }
  }

  // Phase 2: resolve the canonical `architecture_contract` artifact (alias of
  // the former project_definition) from the ARCH task and inject it as a flat
  // object into the PO context. PO's `compactContext` whitelist
  // (claudeCodeRunner.js) carries the value into the AIFA Context as a
  // structured object — no prompt change required.
  const architectureContract = await resolveStructuredArtifact(sourceArtifacts, 'architecture_contract', deps);

  const context = await deps.buildContextFromArtifacts(sourceArtifacts, {
    feedbackPrompt,
    ...(architectureContract ? { architecture_contract: architectureContract } : {}),
    ...(previousDraft ? { previousDraft } : {}),
    ...(featureRequest ? { featureRequest } : {}),
  });

  deps.runAgent(task, context, user?.id).catch((err) => console.error('[SDLC] PO Agent failed:', err));

  return task;
}

// =============================================================================
// runUXAgent
// =============================================================================

async function runUXAgent(params, deps) {
  const { projectId, sourceTaskId, feedbackPrompt = '', previousDraft = null, user } = params;
  const sourceTask = await deps.requireApprovedTask(sourceTaskId, 'po-agent', user);
  await requireUpstreamArtifact(sourceTask, 'ux-agent');

  // B16: mirror runQAAgent — also load Architecture artifacts so UX receives
  // the canonical `architecture_contract` per the a2a_handoff envelope
  // contract (artifactManager.js:113-122). Without this UX sees only PO
  // artifacts and self-reports the missing architecture_contract.
  const archTask = await Task.findLatestBySession(
    sourceTask.sessionId,
    'architecture-agent',
    'completed',
    'committed',
  );

  const [archArchitectureContract, archArtifacts, poArtifacts] = await Promise.all([
    archTask
      ? resolveStructuredArtifact(
          await AgentArtifact.findByTaskId(archTask.id),
          'architecture_contract',
          deps,
        )
      : Promise.resolve(null),
    archTask ? AgentArtifact.findByTaskId(archTask.id) : Promise.resolve([]),
    AgentArtifact.findByTaskId(sourceTask.id),
  ]);

  // De-dupe by contentHash so the same artifact (e.g. on a retry/refresh)
  // is not listed twice; ARCH contributes first, PO never overrides.
  const seenHashes = new Set();
  const allArtifacts = [...archArtifacts, ...poArtifacts].filter((a) => {
    if (!a.contentHash || seenHashes.has(a.contentHash)) return false;
    seenHashes.add(a.contentHash);
    return true;
  });

  const inputHash = deps.contentHash({
    artifacts: allArtifacts.map((a) => a.contentHash),
    feedbackPrompt,
  });

  const task = await Task.create({
    id: uuidv4(),
    projectId: sourceTask.projectId,
    sessionId: sourceTask.sessionId,
    type: 'ux-agent',
    status: 'pending',
    inputContentHash: inputHash,
    sourceRunId: sourceTask.id,
    versionStatus: 'draft',
  });

  const repoContext = deps.getRepoContext ? await deps.getRepoContext(task.projectId, task.sessionId) : null;
  const context = await deps.buildContextFromArtifacts(allArtifacts, {
    feedbackPrompt,
    ...(archArchitectureContract ? { architecture_contract: archArchitectureContract } : {}),
    ...(repoContext ? { repoContext } : {}),
    ...(previousDraft ? { previousDraft } : {}),
  });
  deps.runAgent(task, context, user?.id).catch((err) => console.error('[SDLC] UX Agent failed:', err));

  return task;
}

// =============================================================================
// runDEVAgent
// =============================================================================

async function runDEVAgent(params, deps) {
  const { projectId, sourceTaskId, feedbackPrompt = '', previousDraft = null, user } = params;
  // AIFA v2.1 §3 / §15: DEV's predecessor is strictly UX. The PO→DEV
  // legacy path is removed; PO→UX→DEV is the only legal route.
  const sourceTask = await deps.requireApprovedTask(sourceTaskId, 'ux-agent', user);
  await requireUpstreamArtifact(sourceTask, 'dev-agent');
  const effectiveProjectId = projectId || sourceTask.projectId;

  const poTask = await Task.findLatestBySession(sourceTask.sessionId, 'po-agent', 'completed', 'committed');
  const [uxArtifacts, poArtifacts] = await Promise.all([
    AgentArtifact.findByTaskId(sourceTask.id),
    poTask ? AgentArtifact.findByTaskId(poTask.id) : Promise.resolve([]),
  ]);

  const inputHash = deps.contentHash({
    artifacts: [...uxArtifacts, ...poArtifacts].map((a) => a.contentHash),
    feedbackPrompt,
  });

  const task = await Task.create({
    id: uuidv4(),
    projectId: sourceTask.projectId,
    sessionId: sourceTask.sessionId,
    type: 'dev-agent',
    status: 'pending',
    inputContentHash: inputHash,
    sourceRunId: sourceTask.id,
    versionStatus: 'draft',
  });

  const repoContext = deps.getRepoContext ? await deps.getRepoContext(task.projectId, task.sessionId) : null;
  const context = await deps.buildContextFromArtifacts([...poArtifacts, ...uxArtifacts], {
    feedbackPrompt,
    ...(repoContext ? { repoContext } : {}),
    ...(previousDraft ? { previousDraft } : {}),
  });
  deps.runAgent(task, context, user?.id).catch((err) => console.error('[SDLC] DEV Agent failed:', err));

  return task;
}

// =============================================================================
// runQAAgent
// =============================================================================

async function runQAAgent(params, deps) {
  const { projectId, sourceTaskId, feedbackPrompt = '', previousDraft = null, user } = params;
  const sourceTask = await deps.requireApprovedTask(sourceTaskId, 'dev-agent', user);
  await requireUpstreamArtifact(sourceTask, 'qa-agent');
  const sessionTasks = await Task.findBySessionId(sourceTask.sessionId);

  if (gateBridge.listPending({ taskId: sourceTask.id }).length > 0) {
    throw new ApiError(409, 'DEV still has a pending gate; QA cannot start yet');
  }

  const existingQa = sessionTasks.find(
    (task) => task.type === 'qa-agent'
      && task.sourceRunId === sourceTask.id
      && ['pending', 'running'].includes(task.status)
  );
  if (existingQa) return existingQa;

  const [poTask, uxTask, archTask] = await Promise.all([
    Task.findLatestBySession(sourceTask.sessionId, 'po-agent', 'completed', 'committed'),
    Task.findLatestBySession(sourceTask.sessionId, 'ux-agent', 'completed', 'committed'),
    // Phase 2: also surface the ARCH (architecture-agent) task so QA can
    // reach `architecture_contract` across the whole ARCH → PO → UX → DEV → QA
    // chain (QA's chain predecessor is DEV, but the canonical A2A
    // contract originates from ARCH).
    Task.findLatestBySession(sourceTask.sessionId, 'architecture-agent', 'completed', 'committed'),
  ]);

  const [archArchitectureContract, archArtifacts] = archTask
    ? await Promise.all([
        resolveStructuredArtifact(
          await AgentArtifact.findByTaskId(archTask.id),
          'architecture_contract',
          deps,
        ),
        AgentArtifact.findByTaskId(archTask.id),
      ])
    : [null, []];

  const allArtifacts = [
    ...(archArtifacts || []),
    ...(
      await Promise.all([
        poTask ? AgentArtifact.findByTaskId(poTask.id) : Promise.resolve([]),
        uxTask ? AgentArtifact.findByTaskId(uxTask.id) : Promise.resolve([]),
        AgentArtifact.findByTaskId(sourceTask.id),
      ])
    ).flat(),
  ];

  const inputHash = deps.contentHash({
    artifacts: allArtifacts.map((a) => a.contentHash),
    feedbackPrompt,
  });

  const task = await Task.create({
    id: uuidv4(),
    projectId: sourceTask.projectId,
    sessionId: sourceTask.sessionId,
    type: 'qa-agent',
    status: 'pending',
    inputContentHash: inputHash,
    sourceRunId: sourceTask.id,
    versionStatus: 'draft',
  });

  const repoContext = deps.getRepoContext ? await deps.getRepoContext(task.projectId, task.sessionId) : null;
  const context = await deps.buildContextFromArtifacts(allArtifacts, {
    feedbackPrompt,
    ...(archArchitectureContract ? { architecture_contract: archArchitectureContract } : {}),
    ...(repoContext ? { repoContext } : {}),
    ...(previousDraft ? { previousDraft } : {}),
  });
  deps.runAgent(task, context, user?.id).catch((err) => console.error('[SDLC] QA Agent failed:', err));

  return task;
}

// =============================================================================
// startNextAgentIfAvailable — called after a task is approved/committed
// =============================================================================

async function startNextAgentIfAvailable(task, userId, deps) {
  const nextAgent = deps.nextAgentFor(task);
  if (!nextAgent) return null;
  if (task.status !== 'completed' || task.versionStatus !== 'committed') return null;

  const tasks = task.sessionId ? await Task.findBySessionId(task.sessionId) : await Task.findByProjectId(task.projectId);
  const scopeTaskIds = new Set(tasks.map((t) => t.id));
  if (deps.getPendingQuestionGate(task.projectId, scopeTaskIds)) return null;
  if (gateBridge.listPending({ taskId: task.id }).length > 0) return null;

  // AIFA v2.1 §3 / §15: auto-advance must respect the upstream-artifact
  // guard. If the just-committed predecessor did not produce a non-empty
  // canonical artifact, we refuse to launch the next agent silently.
  try {
    await requireUpstreamArtifact(task, nextAgent);
  } catch (err) {
    logger.warn('[SDLC] auto-advance blocked: upstream artifact missing', {
      taskId: task.id,
      nextAgent,
      code: err.code,
      message: err.message,
    });
    return null;
  }

  const existing = tasks.find((candidate) => candidate.type === nextAgent && candidate.sourceRunId === task.id);
  if (existing) return existing;

  // Recover the original Feature Request from the upstream task's observability
  // when auto-advancing into PO. ARCH persists `observability.featureRequest`
  // at task creation (runArchitectureAgent); PO persists the same field
  // symmetrically. Without this, runPOAgent receives featureRequest=null and
  // the PO agent's AIFA Context only contains feedbackPrompt="", which
  // historically caused PO to ask "the AIFA context provided an empty
  // feedbackPrompt" instead of producing the PRD.
  let carriedFeatureRequest = null;
  if (nextAgent === 'po-agent') {
    const sourceObservability = task.observability || {};
    if (sourceObservability.featureRequest && typeof sourceObservability.featureRequest === 'object') {
      carriedFeatureRequest = sourceObservability.featureRequest;
    }
  }

  const args = {
    projectId: task.projectId,
    sourceTaskId: task.id,
    // AIFA v2.1: when auto-advancing from ARCH to PO, pass the sessionId
    // created up-front by runArchitectureAgent so PO reuses it instead of
    // creating a duplicate PipelineSession and re-cloning the repo.
    ...(nextAgent === 'po-agent' && task.sessionId ? { sessionId: task.sessionId } : {}),
    ...(nextAgent === 'po-agent' && carriedFeatureRequest ? { featureRequest: carriedFeatureRequest } : {}),
    user: userId ? { id: userId } : null,
  };

  if (nextAgent === 'po-agent') return runPOAgent(args, deps);
  if (nextAgent === 'ux-agent') return runUXAgent(args, deps);
  if (nextAgent === 'dev-agent') return runDEVAgent(args, deps);
  if (nextAgent === 'qa-agent') return runQAAgent(args, deps);
  return null;
}

module.exports = {
  runArchitectureAgent,
  runPOAgent,
  runUXAgent,
  runDEVAgent,
  runQAAgent,
  startNextAgentIfAvailable,
  requireUpstreamArtifact,
  PREDECESSOR_ROLE,
};
