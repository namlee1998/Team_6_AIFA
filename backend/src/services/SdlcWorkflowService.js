// Central SDLC orchestrator.
//
// Beginner reading guide:
// 1. runPO/UX/DEV/QAAgent create stage tasks and assemble upstream context.
// 2. _runAgent selects mock, Claude Agent SDK, or Python/LangChain execution.
// 3. _saveAgentData persists output and validates gate-output.v4.
// 4. _recordApprovedHandoff and _startNextAgentIfAvailable advance the chain.
// 5. getWorkflowStatus derives the user-facing phase from persisted data.
//
// Keep transport logic in SdlcController and low-level lifecycle/gate mechanics
// in taskLifecycleService, taskWorkerService, and gateBridge.

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { Task, AgentArtifact, HitlDecision, AgentEvent, PipelineSession } = require('../models');
const taskLifecycle = require('./taskLifecycleService');
const taskWorker = require('./taskWorkerService');
const FeatureBacklog = require('../models/FeatureBacklog');
const AgentService = require('./AgentService');
const MembershipService = {
  requireProjectRole: async () => ({ role: 'owner' }),
  listAccessibleProjectIds: async () => [],
  getUserProjectRole: async () => 'owner',
  createOwnerMembership: async () => { },
};
const QuotaService = {
  getOrProvisionSubscription: async () => ({ planId: 'free', creditsUsed: 0, creditsTotal: 1000000 }),
  recordUsage: async () => { },
  recordFailedUsage: async () => { },
  checkQuota: async () => true,
};
const QualityGateService = require('./QualityGateService');
const fs = require('fs/promises');
const path = require('path');
const { ApiError, ERROR_CODES } = require('../middleware/errorHandler');
const { assertOutputConforms } = require('./agentContract');
const repoService = require('./repoService');
const gateBridge = require('./gateBridge');
const { qaGatePassed } = require('./qaGate');
const { publishEvent } = require('./eventPublisher');
const claudeCodeRunner = require('../agents/claudeCodeRunner');
const codexRunner = require('../agents/codexRunner');
const claudePermissionDispatcher = require('../agents/claudePermissionDispatcher');
const workflowReport = require('./workflowReport');
const workflowQueries = require('./workflowQueries');
const { contentHash, buildTaskResult, resolveArtifactContent, formatArtifactForClient } = workflowQueries;
const artifactManager = require('./artifactManager');
const gateManager = require('./gateManager');
const workflowHelpers = require('./workflowHelpers');
const releaseManager = require('./releaseManager');
const agentDispatcher = require('./agentDispatcher');
const workflowOrchestrator = require('./workflowOrchestrator');
const {
  resolveMockScenario, applyScenarioNarrative,
  classifyFeatureRequest, firstContextValue, normalizeStructuredFeedback,
  validateStructuredFeedback, applyJsonPatch, applyMockScenario,
} = workflowHelpers;
const logger = require('../config/logger');

// ---------------------------------------------------------------------------
// sdlcConstants: single source of truth for all workflow constants
// ---------------------------------------------------------------------------
const {
  WORKSPACE_DIR, AGENT_GATES, OUTPUT_REVIEW_GATE_TYPE, CLARIFY_GATE_TYPE, NEXT_AGENT, NODE_TARGET,
  REWORK_TARGETS, GATE_MODE, DEFAULT_GATE_MODE, REVIEW_HOLDS, GATE_CONFIG,
  AUTO_APPROVE_CONFIDENCE, OUTPUT_CONTRACT_VERSION, OUTPUT_CONTRACTS,
  MAX_RETRY_PER_STEP, RETRY_REASONS, AGENT_POLICY, FINAL_GATE, RELEASE_DECISIONS,
  MOCK_REVIEW_STAGES, DEFAULT_MOCK_SCENARIO, VAGUE_REVIEW_COMMENTS,
  MOCK_SCENARIO_PROFILES,
  // OBS-01.10 R-25: extracted from inline closure so the canonical
  // executionStatus → PhaseStatus mapping is unit-testable.
  toPhaseStatus,
} = require('./sdlcConstants');

// Hot in-memory cache for onGate audit entries. New entries are also persisted
// as AgentEvent; this cache mainly supports the current process efficiently.
const GATE_AUDIT = new Map();

/**
 * Convert a clarification answer blob (either an object {question: answer, …}
 * or an array of strings) into a short feedback string the owning agent will
 * see on its re-run prompt. Used by the question gate's resolveApproval path.
 */
function formatAnswersForFeedback(answers) {
  if (!answers) return '';
  if (typeof answers === 'string') return answers;
  if (Array.isArray(answers)) {
    return answers.map((a, i) => `${i + 1}. ${typeof a === 'object' ? JSON.stringify(a) : String(a)}`).join('\n');
  }
  if (typeof answers === 'object') {
    return Object.entries(answers)
      .map(([q, a]) => `Q: ${q}\nA: ${typeof a === 'object' ? JSON.stringify(a) : String(a)}`)
      .join('\n\n');
  }
  return String(answers);
}

// Execution adapter and concurrency switches. Non-Claude execution remains the
// default for backward-compatible local environments.
const EXECUTION_PATH = () => (process.env.EXECUTION_PATH || 'langchain');
const MAX_PARALLEL_WORKFLOWS = () => Math.max(1, Number(process.env.MAX_PARALLEL_WORKFLOWS) || 4);

class SdlcWorkflowService {
  // =========================================================================
  // Run Agents
  // =========================================================================

  /**
   * Start an Architecture Agent run — generates architecture brief from raw request + repo.
   */
  async runArchitectureAgent({ projectId, featureRequest, feedbackPrompt = '', backlogId = null, repoUrl = null, user }) {
    const deps = {
      MembershipService,
      contentHash,
      repoService,
      runAgent: (t, ctx, uid) => this._runAgent(t, ctx, uid),
    };
    return workflowOrchestrator.runArchitectureAgent({ projectId, featureRequest, feedbackPrompt, backlogId, repoUrl, user }, deps);
  }

  /**
   * Start a PO Agent run — reads intent assumptions, produces PRD artifacts.
   */
  async runPOAgent({ projectId, sourceTaskId = null, featureRequest = null, feedbackPrompt = '', previousDraft = null, backlogId = null,
    repoUrl = null, repoPath = null, branch = 'main', request = '', sessionId = null,
    architectureInputPath = null, autoApproveOutputReview = false, stopAfterAgent = null, user }) {
    const deps = {
      MembershipService,
      contentHash,
      runAgent: (t, ctx, uid) => this._runAgent(t, ctx, uid),
      requireApprovedTask: (tid, type, u) => this._requireApprovedTask(tid, type, u),
      buildContextFromArtifacts: (arts, extras) => this._buildContextFromArtifacts(arts, extras),
    };
    return workflowOrchestrator.runPOAgent({
      projectId, sourceTaskId, featureRequest, feedbackPrompt, previousDraft, backlogId,
      repoUrl, repoPath, branch, request, sessionId,
      architectureInputPath, autoApproveOutputReview, stopAfterAgent, user,
    }, deps);
  }

  /**
   * Start a UX Agent run — reads approved PRD artifacts, produces UX spec.
   */
  async runUXAgent({ projectId, sourceTaskId, feedbackPrompt = '', previousDraft = null, user }) {
    const deps = {
      contentHash,
      runAgent: (t, ctx, uid) => this._runAgent(t, ctx, uid),
      requireApprovedTask: (tid, type, u) => this._requireApprovedTask(tid, type, u),
      buildContextFromArtifacts: (arts, extras) => this._buildContextFromArtifacts(arts, extras),
      getRepoContext: (pid, sid) => this._getRepoContext(pid, sid),
    };
    return workflowOrchestrator.runUXAgent({ projectId, sourceTaskId, feedbackPrompt, previousDraft, user }, deps);
  }

  /**
   * Start a DEV Agent run — reads approved UX artifacts, produces implementation plan.
   */
  async runDEVAgent({ projectId, sourceTaskId, feedbackPrompt = '', previousDraft = null, user }) {
    const deps = {
      contentHash,
      runAgent: (t, ctx, uid) => this._runAgent(t, ctx, uid),
      requireApprovedTask: (tid, type, u) => this._requireApprovedTask(tid, type, u),
      buildContextFromArtifacts: (arts, extras) => this._buildContextFromArtifacts(arts, extras),
      getRepoContext: (pid, sid) => this._getRepoContext(pid, sid),
    };
    return workflowOrchestrator.runDEVAgent({ projectId, sourceTaskId, feedbackPrompt, previousDraft, user }, deps);
  }

  /**
   * Start a QA Agent run — reads DEV artifacts + all upstream, produces test cases.
   */
  async runQAAgent({ projectId, sourceTaskId, feedbackPrompt = '', previousDraft = null, user }) {
    const deps = {
      contentHash,
      runAgent: (t, ctx, uid) => this._runAgent(t, ctx, uid),
      requireApprovedTask: (tid, type, u) => this._requireApprovedTask(tid, type, u),
      buildContextFromArtifacts: (arts, extras) => this._buildContextFromArtifacts(arts, extras),
      getRepoContext: (pid, sid) => this._getRepoContext(pid, sid),
    };
    return workflowOrchestrator.runQAAgent({ projectId, sourceTaskId, feedbackPrompt, previousDraft, user }, deps);
  }

  // =========================================================================
  // HITL Gate
  // =========================================================================

  /**
   * Human submits a gate decision: APPROVE | REJECT | REQUEST_CHANGES
   */
  async submitGateDecision({ taskId, decision, comment, user }) {
    const task = await Task.findById(taskId);
    if (!task) throw new ApiError(404, 'Task not found');
    if (user) await MembershipService.requireProjectRole(user.id, task.projectId, ['owner', 'admin', 'editor']);
    if (task.status !== 'completed') throw new ApiError(400, 'Task must be completed before gate decision');

    const gate = AGENT_GATES[task.type];
    if (!gate) throw new ApiError(400, `Task type ${task.type} has no gate`);

    if (!['APPROVE', 'REJECT', 'REQUEST_CHANGES'].includes(decision)) {
      throw new ApiError(400, 'Decision must be APPROVE | REJECT | REQUEST_CHANGES');
    }
    const gateEvaluation = this._evaluateGatePolicy(task);
    if (decision === 'APPROVE'
      && gateEvaluation.recommendation === 'HOLD'
      && task.gateMode === GATE_MODE.CONFIDENCE) {
      throw new ApiError(409, 'Low-confidence output must be sent back to the owning worker with reviewer feedback');
    }

    const hitlRecord = await HitlDecision.create({
      id: uuidv4(),
      workflowRunId: task.projectId, // use projectId as workflow scope
      taskId: task.id,
      projectId: task.projectId,
      gate,
      decision,
      comment: comment || '',
      reviewerId: user?.id || null,
    });

    if (decision === 'APPROVE') {
      await Task.commitTask(taskId);
      // See resolveOutputReviewGate for why this is required: a human approval
      // must override any validator-flagged INVALID artifact status, otherwise
      // _requireApprovedTask's hasInvalid check blocks the next agent anyway.
      await AgentArtifact.setStatusByTaskId(taskId, 'VALID');
      await this._recordApprovedHandoff(task, hitlRecord);
      const refreshed = await Task.findById(taskId);
      await this._startNextAgentIfAvailable(refreshed, user?.id);
    } else if (decision === 'REQUEST_CHANGES' && comment) {
      // Re-run the owning agent directly (no LLM routing — we already know the task type).
      this._rerunOwningWorker({ rejectedTask: task, feedbackPrompt: comment, user })
        .catch(err => console.error('[SDLC] Rework failed:', err));
    }

    return { task, hitlDecision: hitlRecord };
  }

  // =========================================================================
  // Structured HITL gate (plan section 2): real validation, gate mode, the
  // three actions, idempotency, optimistic lock, max-retry + escalation,
  // and field-level JSON Patch edits.
  // =========================================================================

  /**
   * Real gate validation (plan 2.2): the output must be structurally complete
   * and measurable before a human may approve. Returns { ok, violations }.
   */
  _validateGateOutput(task, output) {
    return gateManager.validateGateOutput(task, output);
  }

  _layerOf(ruleName) {
    return gateManager.layerOf(ruleName);
  }

  _threeLayerSummary(task, output) {
    return gateManager.threeLayerSummary(task, output);
  }

  _evaluateGatePolicy(task) {
    return gateManager.evaluateGatePolicy(task);
  }

  /**
   * Structured HITL decision with the three actions (approve / reject /
   * edit_approve), idempotency, optimistic locking, bounded retries with
   * escalation, and JSON-Patch field edits. Coexists with submitGateDecision.
   */
  async submitStructuredDecision({ taskId, decisionId, baseOutputVersion, action, payload = {}, comment = '', user }) {
    const task = await Task.findById(taskId);
    if (!task) throw new ApiError(404, 'Task not found');
    if (user) await MembershipService.requireProjectRole(user.id, task.projectId, ['owner', 'admin', 'editor']);
    if (task.status !== 'completed') throw new ApiError(400, 'Task must be completed before a gate decision');

    const gate = AGENT_GATES[task.type];
    if (!gate) throw new ApiError(400, `Task type ${task.type} has no gate`);
    if (!['approve', 'reject', 'edit_approve'].includes(action)) {
      throw new ApiError(400, 'action must be approve | reject | edit_approve');
    }
    if (!decisionId) throw new ApiError(400, 'decision_id is required (idempotency key)');

    // 1. Idempotency (plan 2.8): replay the prior result, never re-process.
    const existing = await HitlDecision.findByDecisionId(decisionId);
    if (existing) return { task, hitlDecision: existing, idempotentReplay: true };

    // 2. Optimistic lock (plan 2.8): reject stale decisions.
    if (baseOutputVersion !== undefined && baseOutputVersion !== null
      && Number(baseOutputVersion) !== Number(task.outputVersion || 0)) {
      throw new ApiError(409, `Stale output version (current ${task.outputVersion || 0}, got ${baseOutputVersion}). Reload the latest output.`);
    }

    const currentOutput = task.approvedOutput || task.agentOutput || {};
    const gateEvaluation = this._evaluateGatePolicy(task);

    if (gateEvaluation.recommendation === 'HOLD'
      && task.gateMode === GATE_MODE.CONFIDENCE
      && action !== 'reject') {
      throw new ApiError(409, 'Low-confidence output must be sent back to the owning worker with reviewer feedback');
    }

    // ----- REJECT: bounded re-run with feedback, escalate past max retry -----
    if (action === 'reject') {
      const retryReason = RETRY_REASONS.includes(payload.retry_reason) ? payload.retry_reason : 'other';
      const structuredFeedback = normalizeStructuredFeedback(payload, comment);
      validateStructuredFeedback(structuredFeedback);
      return this._handleGateRejection({ task, gate, decisionId, retryReason, structuredFeedback, comment, user });
    }

    // ----- EDIT_APPROVE: apply JSON Patch, then validate + approve -----
    let approvedOutput = currentOutput;
    let jsonPatch = null;
    if (action === 'edit_approve') {
      jsonPatch = Array.isArray(payload.patch) ? payload.patch : [];
      approvedOutput = (payload.edited_output && typeof payload.edited_output === 'object')
        ? payload.edited_output
        : applyJsonPatch(currentOutput, jsonPatch);
    }

    // ----- Gate validation is informational only — a human approving the gate
    // is the final word, same as resolveOutputReviewGate/submitGateDecision.
    // Surfaced to the reviewer via the violations list; never blocks approve.
    const validation = this._validateGateOutput(task, approvedOutput);

    // ----- Commit approved output; A2A handoff uses approved_output (plan 2.4) -----
    const newVersion = (task.outputVersion || 0) + (action === 'edit_approve' ? 1 : 0);
    await Task.update(task.id, { approvedOutput, outputVersion: newVersion, version_status: 'committed' });
    await Task.commitTask(taskId);
    await AgentArtifact.setStatusByTaskId(taskId, 'VALID');

    const record = await HitlDecision.create({
      id: uuidv4(), taskId: task.id, projectId: task.projectId, workflowRunId: task.projectId,
      gate, decision: 'APPROVE', action, decisionId,
      baseOutputVersion: task.outputVersion || 0, comment, jsonPatch,
      payload: { validation },
    });

    const refreshed = await Task.findById(taskId);
    await this._recordApprovedHandoff(refreshed, record);
    await this._startNextAgentIfAvailable(refreshed, user?.id);
    return { task: refreshed, hitlDecision: record, validation };
  }

  // =========================================================================
  // Gate resolution (T2.4) — wake a pending onGate approval, idempotently.
  // =========================================================================

  /**
   * Resolve a pending gate created by _makeOnGate / gateBridge.requestGate.
   *   type A (tool):     { action:'approve'|'reject', comment? }  (reject needs reason)
   *   type B (question): { answers }
   * 404 if the gate is not pending (also covers a double POST — no double action).
   */
  async resolveApproval({ approvalId, action, comment = '', answers = null, user }) {
    if (!gateBridge.hasPending(approvalId)) {
      const persisted = await gateBridge.findPersisted(approvalId);
      if (persisted?.status === 'interrupted') {
        throw new ApiError(409, 'This gate was interrupted by a backend restart. Re-trigger the workflow to continue.');
      }
      throw new ApiError(404, 'No pending approval with that id (already resolved or expired)');
    }
    const gate = gateBridge.getPending(approvalId);
    if (user && gate.projectId) {
      await MembershipService.requireProjectRole(user.id, gate.projectId, ['owner', 'admin', 'editor']);
    }

    if (gate.kind === 'question') {
      const result = {
        answers: answers && typeof answers === 'object'
          ? answers
          : (Array.isArray(answers) ? answers : (answers ? [answers] : [])),
      };
      // Spec §6.1 — true mid-run pause/resume.
      // gateBridge.resolveGate() resumes the SAME Claude execution in-place:
      // it transitions Task awaiting_gate → running, wakes the awaiting
      // canUseTool promise, and the SDK feeds `updatedInput.answers` back
      // to the SAME tool_use block. Same taskId, same sessionId, same
      // conversation context. We DO NOT rerun the agent, create a new
      // task, or create a new PipelineSession — that would violate spec
      // §6.1 and lose the in-flight reasoning state.
      const woke = await gateBridge.resolveGate(approvalId, result);

      try {
        const task = await Task.findById(gate.taskId);
        if (task && gate.role) {
          const formattedAnswers = formatAnswersForFeedback(result.answers);
          await HitlDecision.create({
            id: uuidv4(),
            taskId: task.id,
            projectId: task.projectId,
            workflowRunId: task.projectId,
            gate: gate.role,
            decision: 'CLARIFICATION',
            action: 'answer',
            baseOutputVersion: task.outputVersion || 0,
            comment: formattedAnswers,
            payload: { approvalId, answers: result.answers },
          });
          logger.info('clarification answer recorded — same Claude execution resumes in-place', {
            taskId: task.id,
            sessionId: task.sessionId,
            approvalId,
            role: gate.role,
          });
        }
      } catch (err) {
        logger.warn('failed to record clarification HitlDecision', {
          approvalId,
          taskId: gate.taskId,
          error: err.message,
        });
      }
      return { approvalId, resolved: woke, kind: 'question' };
    }

    // type A (tool)
    if (!['approve', 'reject'].includes(action)) {
      throw new ApiError(400, "action must be 'approve' or 'reject'");
    }
    if (action === 'reject' && (!comment || !comment.trim())) {
      throw new ApiError(400, 'A reject decision requires a reason (comment).');
    }
    const woke = await gateBridge.resolveGate(approvalId, { action, comment: comment.trim() });
    return { approvalId, resolved: woke, kind: 'tool', action };
  }

  /**
   * Shared reject handling: bounded re-run of the owning agent with feedback,
   * escalating once MAX_RETRY_PER_STEP is exceeded. Used by submitStructuredDecision
   * and resolveOutputReviewGate so both reject paths behave identically.
   */
  async _handleGateRejection({ task, gate, decisionId = uuidv4(), retryReason = 'other', structuredFeedback, comment, user }) {
    const nextRetry = (task.retryCount || 0) + 1;
    const feedback = structuredFeedback || { reason: retryReason, comment };

    if (nextRetry > MAX_RETRY_PER_STEP) {
      await Task.update(task.id, { retryCount: nextRetry, lastRetryReason: retryReason });
      const escalation = await HitlDecision.create({
        id: uuidv4(), taskId: task.id, projectId: task.projectId, workflowRunId: task.projectId,
        gate, decision: 'REJECT', action: 'escalation_required', decisionId,
        baseOutputVersion: task.outputVersion || 0, retryReason,
        comment: comment || 'Exceeded max retries — needs human resolution',
        payload: { retry_count: nextRetry, status: 'needs_human_resolution', feedback },
      });
      return { task, hitlDecision: escalation, escalated: true };
    }

    const record = await HitlDecision.create({
      id: uuidv4(), taskId: task.id, projectId: task.projectId, workflowRunId: task.projectId,
      gate, decision: 'REJECT', action: 'reject', decisionId,
      baseOutputVersion: task.outputVersion || 0, retryReason, comment,
      payload: { retry_count: nextRetry, feedback },
    });
    await Task.update(task.id, { retryCount: nextRetry, lastRetryReason: retryReason });
    const rerunTask = await this._rerunOwningWorker({
      rejectedTask: task,
      feedbackPrompt: typeof feedback === 'string' ? feedback : JSON.stringify(feedback),
      user,
    });
    await Task.update(rerunTask.id, { retryCount: nextRetry, lastRetryReason: retryReason });
    return { task, hitlDecision: record, rerunTask };
  }

  /**
   * Resolve the always-on "output review" gate created after every agent
   * finishes (see _saveAgentData). Unlike resolveApproval's question/tool
   * gates, no live agent thread is awaiting this gate's promise — the agent
   * run already ended — so approve/reject must drive the next step directly:
   * approve commits the output and starts the next agent; reject re-runs the
   * same agent with the human's reason as feedback (bounded by MAX_RETRY_PER_STEP).
   */
  async resolveOutputReviewGate({ approvalId, action, comment = '', user }) {
    if (!gateBridge.hasPending(approvalId)) {
      const persisted = await gateBridge.findPersisted(approvalId);
      if (persisted?.status === 'interrupted') {
        throw new ApiError(409, 'This gate was interrupted by a backend restart. Re-trigger the workflow to continue.');
      }
      throw new ApiError(404, 'No pending approval with that id (already resolved or expired)');
    }
    const gate = gateBridge.getPending(approvalId);
    if (gate.kind !== 'output_review') {
      throw new ApiError(400, `Gate ${approvalId} is not an output review gate`);
    }
    if (user && gate.projectId) {
      await MembershipService.requireProjectRole(user.id, gate.projectId, ['owner', 'admin', 'editor']);
    }
    if (!['approve', 'reject'].includes(action)) {
      throw new ApiError(400, "action must be 'approve' or 'reject'");
    }
    if (action === 'reject' && (!comment || !comment.trim())) {
      throw new ApiError(400, 'A reject decision requires a reason (comment).');
    }

    const task = await Task.findById(gate.taskId);
    if (!task) throw new ApiError(404, 'Task not found for this gate');
    const gateType = AGENT_GATES[task.type];

    await gateBridge.resolveGate(approvalId, { action, comment: comment.trim() });

    if (action === 'approve') {
      await Task.update(task.id, { approvedOutput: task.agentOutput, version_status: 'committed' });
      await Task.commitTask(task.id);
      // A human explicitly approved this output despite any validator-flagged
      // issues (shown in the gate payload's validationIssues) — that decision
      // overrides the INVALID artifact status, otherwise _requireApprovedTask's
      // hard `hasInvalid` check throws right after approval and the pipeline
      // can never advance past a flawed-but-approved output.
      await AgentArtifact.setStatusByTaskId(task.id, 'VALID');
      // T1 (B5/B10) — spec §7.2: Approve must drive Write→Add→Commit→Push before
      // waking the next agent. add+commit are mandatory; push is best-effort and
      // never blocks the pipeline (failures are surfaced via runtime_log).
      await repoService.commitAndPushOnApprove({
        task,
        onLog: (message, meta = {}) => {
          publishEvent('runtime_log',
            { projectId: task.projectId, sessionId: task.sessionId, taskId: task.id, role: null },
            {
              taskId: task.id,
              level: meta.level || 'info',
              source: 'auto_commit',
              message,
              meta,
            },
          );
        },
      });
      const approval = await HitlDecision.create({
        id: uuidv4(), taskId: task.id, projectId: task.projectId, workflowRunId: task.projectId,
        gate: gateType, decision: 'APPROVE', action: 'approve',
        baseOutputVersion: task.outputVersion || 0, comment: comment.trim(),
        payload: { approvalId },
      });
      const refreshed = await Task.findById(task.id);
      await this._recordApprovedHandoff(refreshed, approval);
      await this._startNextAgentIfAvailable(refreshed, user?.id);

      // §19.3 / A.1: the pipeline is NOT complete after QA approval. It is
      // only complete after the FINAL_RELEASE gate has been approved and the
      // release bundle (final.md + qa-report.md + audit-trail.json) has been
      // written, committed, and pushed to the user's repository.
      //
      // What we do here, instead:
      //   1. Build the release-evidence summary up-front so the gate payload
      //      has data to show the operator.
      //   2. Resolve repoContext now (cheap; already cached). If the user's
      //      repo was never cloned (shouldn't happen — session creation
      //      always provisions it), fail loudly instead of silently falling
      //      back to a placeholder URL.
      //   3. Mark the session as awaiting_release BEFORE creating the gate,
      //      so the FE reads the correct status via the persisted row.
      //   4. Create the FINAL_RELEASE gate. pipeline_completed is owned by
      //      releaseManager.submitReleaseDecision now (see releaseManager.js
      //      APPROVE branch), not by this path.
      if (task.type === 'qa-agent'
          && qaGatePassed(refreshed)
          && refreshed.sessionId && refreshed.projectId) {
        const evidence = await this._buildReleaseEvidenceSummary(refreshed.sessionId);
        const repoContext = await this._getRepoContext(refreshed.projectId, refreshed.sessionId);
        if (!repoContext?.repoPath) {
          throw new ApiError(500,
            'Cannot create FINAL_RELEASE gate: session has no cloned repository workspace. ' +
            'Repository must be the user-provided repo — no default/placeholder is allowed.');
        }
        await PipelineSession.update(refreshed.sessionId, { status: 'awaiting_release' });
        gateBridge.requestGate({
          taskId: refreshed.id,
          sessionId: refreshed.sessionId,
          projectId: refreshed.projectId,
          role: 'release',
          kind: 'release',
          payload: {
            summary: 'Final release decision — review the bundled evidence below. ' +
                     'Approving will generate final.md + qa-report.md + audit-trail.json, ' +
                     'remove any previously generated release artifacts in the repo, ' +
                     'commit the bundle, and push.',
            evidence,
            repoContext: {
              repoUrl: repoContext.repoUrl,
              workingBranch: repoContext.workingBranch,
              baseBranch: repoContext.baseBranch,
            },
          },
        });
      }

      return { approvalId, action, task: refreshed, hitlDecision: approval };
    }

    const result = await this._handleGateRejection({
      task,
      gate: gateType,
      retryReason: 'other',
      comment: comment.trim(),
      user,
    });
    return { approvalId, action, ...result };
  }

  /** List pending gates for a task or project (poll-friendly for SSE/UI).
   * Pass `taskIds` (a Set) to narrow a project-wide query down to one
   * session's tasks — needed once a project can run several sessions at once. */
  async listPendingGates({ taskId = null, projectId = null, taskIds = null } = {}) {
    const memory = gateBridge.listPending({ taskId, projectId });
    const interrupted = await gateBridge.listInterrupted({ taskId, projectId });
    const combined = [...memory, ...interrupted.filter((gate) => !memory.some((item) => item.approvalId === gate.approvalId))];
    return taskIds ? combined.filter((gate) => taskIds.has(gate.taskId)) : combined;
  }

  /** List and enrich all active/interrupted pending interventions across all projects. */
  /** All active/interrupted pending interventions, optionally scoped to one project
   * (the dashboard always passes the current project so sessions from other
   * projects never leak into a user's gate list). */
  async getAllInterventions(user, projectId = null) {
    const prisma = require('../config/database');

    // 1. Get all pending gates (optionally scoped to a single project)
    const gates = await this.listPendingGates(projectId ? { projectId } : {});

    // 2. Enrich each gate with Project, Task, and (for output review) the
    // agent's actual output so the frontend can render it without a refetch.
    const enriched = [];
    for (const gate of gates) {
      if (!gate.projectId) continue;

      // Fetch project to get the name
      const project = await prisma.project.findUnique({
        where: { id: gate.projectId },
      });

      const task = await Task.findById(gate.taskId);

      if (!project || !task) continue;

      // Extract raw payload
      const payloadParsed = gate.payload || {};

      // Parse questions if kind is question
      let questionsList = [];
      if (gate.kind === 'question' && Array.isArray(payloadParsed.questions)) {
        questionsList = payloadParsed.questions.map((q) =>
          typeof q === 'object' && q !== null ? q.question : String(q)
        );
      }

      // Map PendingGate to GlobalInterventionItem format
      let type = 'HITL_REVIEW';
      if (gate.kind === 'output_review') {
        type = OUTPUT_REVIEW_GATE_TYPE[task.type] || 'AGENT_OUTPUT_REVIEW';
      } else if (gate.role === 'PO' || gate.role === 'po-agent') {
        type = 'PO_CLARIFY';
      } else if (gate.role === 'DEV' || gate.role === 'dev-agent' || gate.kind === 'tool') {
        type = 'DEV_FILE_GATE';
      } else if (gate.role === 'RELEASE' || gate.role === 'qa-agent') {
        type = 'FINAL_RELEASE';
      }

      enriched.push({
        id: gate.approvalId,
        type,
        status: (gate.status || 'PENDING').toUpperCase(),
        payload: {
          path: payloadParsed.file_path || (payloadParsed.display && payloadParsed.display.filePath) || '',
          reason: payloadParsed.reason || '',
          diff: payloadParsed.diff || (payloadParsed.display && payloadParsed.display.diffPreview) || '',
          questions: questionsList,
          outputSummary: gate.kind === 'output_review' ? (payloadParsed.summary || null) : undefined,
          validationIssues: gate.kind === 'output_review' ? (payloadParsed.validationIssues || []) : undefined,
        },
        createdAt: new Date(gate.createdAt).toISOString(),
        updatedAt: new Date(gate.updatedAt || gate.createdAt).toISOString(),
        projectId: project.id,
        projectName: project.name,
        sessionId: task.sessionId || null,
        repoUrl: '',
        pipelineStatus: task.status,
        currentPhase: task.type.replace('-agent', '').toUpperCase(),
      });
    }

    return enriched;
  }

  // =========================================================================
  // Targeted Rework Logic
  // =========================================================================

  /**
   * Evaluates the feedback via Python agents and triggers the appropriate agent.
   */
  async triggerRework({ projectId, sourceTaskId, feedbackPrompt, user }) {
    console.log(`[SDLC] Triggering Rework for project ${projectId}. Feedback: "${feedbackPrompt}"`);

    const rejectedTask = await Task.findById(sourceTaskId);
    if (!rejectedTask) throw new ApiError(404, 'Source task not found');
    if (user) await MembershipService.requireProjectRole(user.id, rejectedTask.projectId, ['owner', 'admin', 'editor']);

    if (rejectedTask.type === 'architecture-agent') {
      const featureRequest = await this._getFeatureRequestFromIntentTask(rejectedTask);
      return this.runArchitectureAgent({
        projectId: rejectedTask.projectId,
        featureRequest,
        feedbackPrompt,
        user,
      });
    }
    if (rejectedTask.type === 'po-agent') {
      const featureRequest = await this._getFeatureRequestFromTask(rejectedTask);
      return this.runPOAgent({
        projectId: rejectedTask.projectId,
        featureRequest,
        feedbackPrompt,
        user,
      });
    }

    // 1. Ask python Agent Server to analyze the feedback and route it
    const targetAgent = await AgentService.routeRework(feedbackPrompt);
    console.log(`[SDLC] Agent Server routed rework to: ${targetAgent}`);

    const reworkTarget = REWORK_TARGETS[targetAgent] || REWORK_TARGETS.dev_agent;
    if (!REWORK_TARGETS[targetAgent]) {
      console.warn(`[SDLC] Unrecognized rework target: ${targetAgent}. Defaulting to DEV.`);
    }

    const upstream = await Task.findLatestByProject(
      projectId || rejectedTask.projectId,
      reworkTarget.sourceType,
      'completed',
      'committed',
    );
    if (!upstream) {
      throw new ApiError(400, `Cannot rework ${targetAgent}: no committed ${reworkTarget.sourceType} source found`);
    }

    return this[reworkTarget.run]({
      projectId: projectId || rejectedTask.projectId,
      sourceTaskId: upstream.id,
      feedbackPrompt,
      user,
    });
  }

  // =========================================================================
  // Final Review Packet
  // =========================================================================

  async getFinalReviewPacket(sessionId, user) {
    return workflowQueries.getFinalReviewPacket(sessionId, user);
  }

  // =========================================================================
  // Audit Trail
  // =========================================================================

  /** `sessionId`, when given, narrows the (otherwise project-wide) audit
   * trail to just that session's tasks/decisions — needed once a project can
   * run several sessions concurrently. */
  async getAuditTrail(projectId, user, sessionId = null) {
    if (user) {
      await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer']);
    }

    let [tasks, hitlDecisions] = await Promise.all([
      sessionId ? Task.findBySessionId(sessionId) : Task.findByProjectId(projectId),
      HitlDecision.findByProjectId(projectId),
    ]);
    if (sessionId) {
      const taskIds = new Set(tasks.map((t) => t.id));
      hitlDecisions = hitlDecisions.filter((d) => taskIds.has(d.taskId));
    }

    const sdlcTasks = tasks.filter((t) => ['architecture-agent', 'po-agent', 'ux-agent', 'dev-agent', 'qa-agent'].includes(t.type));
    const handoffArtifacts = (
      await Promise.all(sdlcTasks.map((task) => AgentArtifact.findByTaskIdAndType(task.id, 'a2a_handoff')))
    ).flat();
    const taskById = Object.fromEntries(sdlcTasks.map((t) => [t.id, t]));
    const label = (type) => (type || '').replace('-agent', '').toUpperCase();
    // version tag for an agent task, e.g. "DEV v2" (attempt = retryCount + 1)
    const vtag = (t) => `${label(t.type)} v${(t.retryCount || 0) + 1}`;

    // Map a structured HITL decision onto an explicit lifecycle state name
    // (plan TIP-002 state machine + Scenario D audit chain).
    const decisionState = (d, task) => {
      const attempt = (task?.retryCount || 0) + 1;
      if (d.action === 'auto_approve') return { state: 'AUTO_APPROVED', actor: 'ORCHESTRATOR', type: 'hitl_decision' };
      if (d.action === 'escalation_required') return { state: 'MAX_RETRY_EXCEEDED', actor: 'ORCHESTRATOR', type: 'escalation' };
      if (d.decision === 'REJECT' && d.gate !== FINAL_GATE) return { state: 'HUMAN_REJECTED', actor: 'HUMAN', type: 'hitl_decision' };
      if (d.gate === FINAL_GATE) return { state: d.decision === 'APPROVE' ? 'RELEASED' : 'RELEASE_REJECTED', actor: 'HUMAN', type: 'release_decision' };
      if (d.decision === 'APPROVE') return { state: attempt > 1 ? 'APPROVED_AFTER_RERUN' : 'HUMAN_APPROVED', actor: 'HUMAN', type: 'hitl_decision' };
      return { state: (d.action || d.decision || 'DECISION').toUpperCase(), actor: 'HUMAN', type: 'hitl_decision' };
    };

    const events = [
      ...sdlcTasks.map((t) => ({
        timestamp: t.createdAt,
        actor: t.type.toUpperCase().replace('-', '_'),
        action: `START_${label(t.type)}_AGENT`,
        taskId: t.id,
        agent: t.type,
        status: t.status,
        attempt: (t.retryCount || 0) + 1,
        outputVersion: t.outputVersion ?? 0,
        stateFrom: (t.retryCount || 0) > 0 ? 'RERUNNING' : 'PENDING',
        stateTo: 'RUNNING',
        versionTag: vtag(t),
        type: 'agent_run',
      })),
      ...sdlcTasks
        .filter((t) => t.status === 'completed')
        .map((t) => ({
          timestamp: t.updatedAt,
          actor: t.type.toUpperCase().replace('-', '_'),
          action: `OUTPUT_DRAFTED_${label(t.type)}`,
          taskId: t.id,
          agent: t.type,
          status: 'completed',
          attempt: (t.retryCount || 0) + 1,
          outputVersion: t.outputVersion ?? 0,
          stateFrom: 'RUNNING',
          stateTo: 'OUTPUT_DRAFTED',
          versionTag: vtag(t),
          type: 'agent_complete',
        })),
      ...sdlcTasks
        .filter((t) => t.status === 'failed')
        .map((t) => ({
          timestamp: t.updatedAt,
          actor: t.type.toUpperCase().replace('-', '_'),
          action: `FAILED_${label(t.type)}`,
          taskId: t.id,
          agent: t.type,
          status: 'failed',
          comment: t.error || null,
          stateTo: 'FAILED',
          severity: 'HIGH',
          versionTag: vtag(t),
          type: 'failure',
        })),
      ...hitlDecisions.map((d) => {
        const task = taskById[d.taskId];
        const mapped = decisionState(d, task);
        const blockingIssues = d.payload?.feedback?.blocking_issues || [];
        return {
          timestamp: d.createdAt,
          actor: mapped.actor,
          action: `${mapped.state}_${d.gate}`,
          taskId: d.taskId,
          agent: task?.type || null,
          gate: d.gate,
          decision: d.decision,
          comment: d.comment,
          stateTo: mapped.state,
          attempt: (task?.retryCount || 0) + 1,
          outputVersion: task?.outputVersion ?? d.baseOutputVersion ?? null,
          versionTag: task ? vtag(task) : null,
          severity: mapped.type === 'escalation' ? 'HIGH' : null,
          // T2: make the gate decision auditable — why it fired and which rule.
          reason: d.comment || null,
          ruleHit: d.retryReason
            || (d.action === 'auto_approve' ? 'confidence_and_validation_passed' : null)
            || (d.payload?.feedback?.blocking_issues?.[0]?.issue || null),
          // Structured HITL detail (plan section 3): replayable audit record.
          hitlAction: d.action || null,
          retryReason: d.retryReason || null,
          blockingIssueCount: Array.isArray(blockingIssues) ? blockingIssues.length : 0,
          jsonPatch: d.jsonPatch || null,
          baseOutputVersion: d.baseOutputVersion ?? null,
          type: mapped.type,
        };
      }),
      ...handoffArtifacts.map((artifact) => {
        const envelope = artifact.contentJson || {};
        const sourceTask = taskById[artifact.taskId];
        return {
          timestamp: artifact.createdAt,
          actor: 'ORCHESTRATOR',
          action: `HANDOFF_EMITTED_${label(envelope.from_agent)}_TO_${label(envelope.to_agent)}`,
          taskId: artifact.taskId,
          fromAgent: envelope.from_agent || null,
          toAgent: envelope.to_agent || null,
          attempt: envelope.attempt ?? ((sourceTask?.retryCount || 0) + 1),
          handoffId: envelope.handoff_id || null,
          artifactHash: envelope.output_artifact?.hash || null,
          stateFrom: 'APPROVED',
          stateTo: 'HANDOFF_EMITTED',
          versionTag: sourceTask ? vtag(sourceTask) : null,
          type: 'a2a_handoff',
        };
      }),
      // T2.3: onGate audit (auto/approval/block/question) for the claude-code path.
      ...sdlcTasks.flatMap((t) => this._getGateAudit(t.id).map((g) => ({
        timestamp: g.timestamp,
        actor: g.kind === 'GATE_AUTO' || g.kind === 'GATE_BLOCK' ? 'ORCHESTRATOR' : 'HUMAN',
        action: g.kind,
        taskId: t.id,
        agent: t.type,
        comment: g.comment || g.detail || null,
        reason: g.detail || null,
        file: g.file || null,
        category: g.category || null,
        type: 'gate_audit',
      }))),
    ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // I3: synthesize a consistent PHASE_TRANSITION chain from the existing
    // ordered events (no new table, no Workflow model). Each event already
    // carries stateFrom/stateTo; we fill any missing `from` from the previous
    // `to` so the chain is continuous. requestId stays null for now (I2 keeps
    // request correlation in logs/error responses, not in the persisted audit).
    let prevTo = 'PENDING';
    const phaseTransitions = events
      .filter((e) => e.stateTo)
      .map((e) => {
        const from = e.stateFrom || prevTo;
        prevTo = e.stateTo;
        return {
          type: 'PHASE_TRANSITION',
          from,
          to: e.stateTo,
          cause: e.action,
          at: e.timestamp,
          agent: e.agent || e.fromAgent || null,
          taskId: e.taskId || null,
          requestId: null,
        };
      });

    return { projectId, events, phaseTransitions };
  }

  // =========================================================================
  // Workflow Metrics (plan TIP-011)
  // =========================================================================

  /**
   * Compute workflow health metrics for a project from the persisted tasks and
   * HITL decisions. All values are derived (no separate metrics store), so the
   * audit trail remains the single source of truth.
   */
  async getWorkflowMetrics(projectId, user) {
    return workflowQueries.getWorkflowMetrics(projectId, user);
  }

  async submitReleaseDecision({ sessionId, decisionId, decision, comment = '', user }) {
    return releaseManager.submitReleaseDecision({
      sessionId, decisionId, decision, comment, user,
      deps: {
        getFinalReviewPacket: (sid, u) => this.getFinalReviewPacket(sid, u),
        getAuditTrail: (pid, u, sid) => this.getAuditTrail(pid, u, sid),
        getRepoContext: (pid, sid) => this._getRepoContext(pid, sid),
      },
    });
  }

  async _buildReleaseEvidenceSummary(sessionId) {
    return releaseManager.buildReleaseEvidenceSummary(sessionId);
  }

  async _rerunOwningWorker({ rejectedTask, feedbackPrompt, user }) {
    const previousArtifacts = await AgentArtifact.findByTaskId(rejectedTask.id);
    const previousDraft = previousArtifacts.length > 0 
      ? JSON.stringify(previousArtifacts.reduce((acc, a) => { acc[a.artifactType] = a.contentJson || a.contentText; return acc; }, {}))
      : undefined;

    if (rejectedTask.type === 'architecture-agent') {
      const featureRequest = await this._getFeatureRequestFromIntentTask(rejectedTask);
      return this.runArchitectureAgent({ projectId: rejectedTask.projectId, featureRequest, feedbackPrompt, user });
    }
    if (rejectedTask.type === 'po-agent') {
      const featureRequest = await this._getFeatureRequestFromTask(rejectedTask);
      // Rework stays in the rejected task's own session — must NOT create a
      // new one (that would also re-clone/copy the repo unnecessarily).
      return this.runPOAgent({ projectId: rejectedTask.projectId, sessionId: rejectedTask.sessionId, featureRequest, feedbackPrompt, previousDraft, user });
    }

    const ownerTarget = {
      'ux-agent': REWORK_TARGETS.ux_agent,
      'dev-agent': REWORK_TARGETS.dev_agent,
      'qa-agent': REWORK_TARGETS.qa_agent,
    }[rejectedTask.type];
    if (!ownerTarget) throw new ApiError(400, `Cannot rerun unsupported task type: ${rejectedTask.type}`);

    const upstream = await Task.findLatestBySession(
      rejectedTask.sessionId,
      ownerTarget.sourceType,
      'completed',
      'committed',
    );
    if (!upstream) {
      throw new ApiError(400, `Cannot rerun ${rejectedTask.type}: no committed ${ownerTarget.sourceType} source found`);
    }

    return this[ownerTarget.run]({
      projectId: rejectedTask.projectId,
      sourceTaskId: upstream.id,
      feedbackPrompt,
      previousDraft,
      user,
    });
  }

  async getProjectTasks(projectId, user) {
    return workflowQueries.getProjectTasks(projectId, user);
  }

  async getProjectHealth() {
    return workflowQueries.getProjectHealth();
  }

  async updateEnvSettings(keys) {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.resolve(process.cwd(), '.env');
    
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    const lines = envContent.split('\n');
    for (const [key, val] of Object.entries(keys)) {
      if (!val) continue; // skip empty
      const prefix = `${key}=`;
      const quotedVal = `"${val}"`;
      const idx = lines.findIndex(l => l.startsWith(prefix));
      if (idx >= 0) {
        lines[idx] = `${key}=${quotedVal}`;
      } else {
        lines.push(`${key}=${quotedVal}`);
      }
      process.env[key] = val;
    }

    fs.writeFileSync(envPath, lines.join('\n').trim() + '\n');
    return { status: 'success' };
  }

  async getProjectArtifacts(projectId, user) {
    return workflowQueries.getProjectArtifacts(projectId, user);
  }

  /** List a project's pipeline sessions (newest first) — the "4 session
   * cards" board reads this to know which sessions exist and their status. */
  async listSessions(projectId, user) {
    return workflowQueries.listSessions(projectId, user);
  }

  async getReleaseFile(sessionId, fileName, user) {
    return workflowQueries.getReleaseFile(sessionId, fileName, user);
  }

  // =========================================================================
  // Task status (SSE-compatible, reuses base WorkflowService pattern)
  // =========================================================================

  async getTaskStatus(taskId, user) {
    const task = await Task.findById(taskId);
    if (!task) return null;
    if (user) {
      await MembershipService.requireProjectRole(user.id, task.projectId, ['owner', 'admin', 'editor', 'viewer']);
    }

    const [artifacts, hitlDecision] = await Promise.all([
      AgentArtifact.findByTaskId(taskId),
      HitlDecision.findByTaskId(taskId),
    ]);

    task.artifacts = await Promise.all(artifacts.map((a) => formatArtifactForClient(a)));
    task.result = buildTaskResult(task, task.artifacts);
    task.hitlDecision = hitlDecision;
    task.gate = AGENT_GATES[task.type] || null;
    task.nextAgent = NEXT_AGENT[task.type];
    // T2/T7: surface pending onGate gates (claude-code path) for the UI/SSE.
    task.pendingGates = gateBridge.listPending({ taskId });

    // Attach Quality Gate evaluation for QA tasks
    if (task.type === 'qa-agent') {
      const gateArtifact = artifacts.find((a) => a.artifactType === 'gate_evaluation');
      if (gateArtifact) {
        const resolved = await resolveArtifactContent(gateArtifact);
        task.gateEvaluation = resolved.contentJson
          ? { ...resolved.contentJson, gateType: 'qa_quality_gate' }
          : null;
      }
      // Surface gate metadata from result
      if (task.result) {
        task.gateScore = task.result.gateScore;
        task.gateRecommendation = task.result.gateRecommendation;
        task.gateComplexity = task.result.gateComplexity;
        task.minApproversRequired = task.result.minApproversRequired;
      }
    } else if (task.status === 'completed') {
      task.gateEvaluation = this._evaluateGatePolicy(task);
    }

    return task;
  }

  async getWorkflowStatus(sessionId, user) {
    const session = await PipelineSession.findById(sessionId);
    if (!session) throw new ApiError(404, 'Session not found');
    const projectId = session.projectId;
    if (user) {
      await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer']);
    }

    const tasks = await Task.findBySessionId(sessionId);
    // Architecture agent runs before the session is created and is the entry
    // point of the pipeline. Resolve it via the chain helper (which scans
    // tasks by type) instead of relying on the PO task's sourceRunId — that
    // path returns null for the first session in a project (no PO yet), and
    // `deriveCurrentPhase` then collapses to BACKLOG even though ARCH
    // completed successfully. Same root cause as the "fresh session stuck on
    // backlog" bug observed via the SSE stream.
    const { architectureTask, poTask, uxTask, devTask, qaTask } = this._selectCurrentTaskChain(tasks);

    const taskIds = new Set(tasks.map((t) => t.id));
    const hitlDecisions = (await HitlDecision.findByProjectId(projectId)).filter((d) => taskIds.has(d.taskId));
    // T5: pick the most-recent non-final decision per task deterministically
    // (createdAt, then id). This keeps a rerun from getting stuck on an older
    // decision and makes parallel reruns derive the same phase every time.
    const isNewer = (a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      if (ta !== tb) return ta > tb;
      return String(a.id) > String(b.id);
    };
    const decisionsByTaskId = {};
    for (const d of hitlDecisions) {
      if (d.gate === FINAL_GATE) continue;
      const current = decisionsByTaskId[d.taskId];
      if (!current || isNewer(d, current)) decisionsByTaskId[d.taskId] = d;
    }
    const releaseDecision = [...hitlDecisions]
      .filter((decision) => decision.gate === FINAL_GATE)
      .sort((a, b) => (isNewer(a, b) ? 1 : -1))
      .pop() || null;
    const membership = user
      ? await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer'])
      : null;

    // T1/T6: surface which completed tasks have INVALID artifacts so the UI can
    // badge the worker card and explain why the phase did not advance.
    const phaseTasks = [architectureTask, poTask, uxTask, devTask, qaTask].filter(Boolean);
    const invalidByTaskId = {};
    await Promise.all(phaseTasks.map(async (t) => {
      if (t.status !== 'completed') { invalidByTaskId[t.id] = false; return; }
      const dbInvalid = await AgentArtifact.hasInvalid(t.id);
      // If DB says INVALID, do a live re-check: the stored status may be stale
      // (e.g. gate rules were tightened or loosened after the task completed).
      // Only keep INVALID when runtime validation also finds a BLOCKER.
      invalidByTaskId[t.id] = dbInvalid
        ? this._validateGateOutput(t, t.agentOutput || {}).violations.some((v) => v.severity === 'BLOCKER')
        : false;
    }));

    const mapPhase = (task) => {
      if (!task) return null;
      return {
        taskId: task.id,
        status: task.status,
        executionStatus: task.executionStatus || null,
        versionStatus: task.versionStatus,
        gate: AGENT_GATES[task.type],
        hitlDecision: decisionsByTaskId[task.id] || null,
        // T5: derived (no stored column) — true when the step finished but has
        // not been approved yet, so the frontend can open the review modal.
        awaitingReview: task.status === 'completed'
          && task.versionStatus !== 'committed'
          && decisionsByTaskId[task.id]?.decision !== 'APPROVE',
        // T1: the output failed role validation (blocking) — no handoff possible.
        invalid: !!invalidByTaskId[task.id],
        error: task.error || null,
        failure: task.observability?.failure || null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };
    };
    let featureRequest = null;
    if (poTask) {
      const requestArtifacts = await AgentArtifact.findByTaskIdAndType(poTask.id, 'feature_request');
      if (requestArtifacts.length > 0) {
        const resolved = await resolveArtifactContent(requestArtifacts[0]);
        featureRequest = resolved.contentJson || resolved.contentText || null;
      }
    }
    const releaseEvidence = await this._buildReleaseEvidenceSummary(sessionId);
    const pendingQuestion = this._getPendingQuestionGate(projectId, taskIds);

    return {
      projectId,
      sessionId,
      featureRequest,
      pipelineLock: pendingQuestion ? {
        locked: true,
        reason: 'question_pending',
        role: pendingQuestion.role,
        taskId: pendingQuestion.taskId,
        approvalId: pendingQuestion.approvalId,
        message: `${pendingQuestion.role} is waiting for a human answer`,
      } : { locked: false },
      phases: {
        architecture: mapPhase(architectureTask),
        po: mapPhase(poTask),
        ux: mapPhase(uxTask),
        dev: mapPhase(devTask),
        qa: mapPhase(qaTask),
      },
      releaseGate: {
        eligible: qaTask?.status === 'completed'
          && qaTask.versionStatus === 'committed'
          && (() => {
            if (qaTask.result?.gateRecommendation === 'PASS') return true;
            const tr = qaTask.agentOutput?.test_run_report || {};
            return tr.executed === true && typeof tr.failed === 'number' && tr.failed === 0 && (tr.total || 0) > 0;
          })()
          && decisionsByTaskId[qaTask.id]?.decision === 'APPROVE',
        canDecide: ['owner', 'admin'].includes(membership?.role),
        reviewerRole: membership?.role || null,
        decision: releaseDecision,
        status: {
          APPROVE: 'released',
          REJECT: 'rejected',
        }[releaseDecision?.decision] || 'pending',
        evidence: releaseEvidence,
        approvalBlocked: releaseEvidence.open_blockers.some((blocker) => GATE_CONFIG.RELEASE_BLOCKING_SEVERITIES.includes(blocker.severity)),
      },
      currentPhase: this._deriveCurrentPhase(architectureTask, poTask, uxTask, devTask, qaTask, decisionsByTaskId, releaseDecision),
    };
  }

  // =========================================================================
  // V4 Pipeline Response API
  // =========================================================================

  /**
   * Fetches the workflow status and maps it to the PipelineResponse format
   * expected by the v4 SDLC Dashboard frontend.
   */
  async getPipelineResponse(sessionId, user) {
    const legacyStatus = await this.getWorkflowStatus(sessionId, user);
    const projectId = legacyStatus.projectId;

    const tasks = await Task.findBySessionId(sessionId);
    const taskIds = new Set(tasks.map((t) => t.id));
    const { poTask, qaTask } = this._selectCurrentTaskChain(tasks);

    // Determine overall status
    let overallStatus = 'idle';
    if ((qaTask?.status === 'completed' && qaTask?.versionStatus === 'committed') || legacyStatus.releaseGate?.status === 'released') {
      overallStatus = 'qa_complete';
    } else if (legacyStatus.currentPhase !== 'draft') {
      if (legacyStatus.currentPhase.endsWith('_REVIEW')) overallStatus = 'awaiting_approval';
      else if (legacyStatus.currentPhase.endsWith('_RUNNING')) overallStatus = legacyStatus.currentPhase.toLowerCase();
      else if (legacyStatus.currentPhase === 'QA_FAILED') overallStatus = 'failed';
      else overallStatus = legacyStatus.currentPhase.toLowerCase();
    }

    // OBS-01.10 R-25: `toPhaseStatus` is now sourced from `sdlcConstants.js`.
    // The inline closure previously read `phaseData.status` (legacy
    // `Task.status`) — see contract §7 forbidden pattern "Deriving runtime
    // from `Task.status` (legacy)". The extracted helper reads
    // `phaseData.executionStatus` (canonical machine) and projects to the
    // FE-visible `PhaseStatus` via the canonical mapping table.
    const pipelinePhases = [
      toPhaseStatus('Architecture', legacyStatus.phases.architecture, false),
      toPhaseStatus('PO', legacyStatus.phases.po, false),
      toPhaseStatus('UX', legacyStatus.phases.ux, false),
      toPhaseStatus('DEV', legacyStatus.phases.dev, false),
      toPhaseStatus('QA', legacyStatus.phases.qa, false),
    ];

    const pendingRaw = await this.listPendingGates({ projectId, taskIds });
    const pendingGates = pendingRaw.map(g => ({
      id: g.approvalId,
      taskId: g.taskId,
      kind: g.kind,
      type: g.kind === 'output_review'
        ? (OUTPUT_REVIEW_GATE_TYPE[g.role] || 'AGENT_OUTPUT_REVIEW')
        : g.kind === 'release'
          ? 'FINAL_RELEASE'
          : g.kind === 'question'
            ? (CLARIFY_GATE_TYPE[g.role] || 'AGENT_CLARIFY')
            : 'HITL_REVIEW',
      role: g.role,
      status: g.status === 'interrupted' ? 'PENDING' : 'PENDING',
      payload: g.payload || {},
      createdAt: g.createdAt
    }));

    const auditTrail = await this.getAuditTrail(projectId, user, sessionId);
    const auditEvents = auditTrail?.events || [];
    const auditLog = auditEvents.map(ev => ({
      timestamp: ev.timestamp || ev.createdAt,
      actor: ev.actor || (ev.agent ? ev.agent.replace('-agent', '').toUpperCase() : 'SYSTEM'),
      action: ev.action,
      status: ev.severity === 'ERROR' || ev.type === 'failure' ? 'error' : (ev.severity === 'WARNING' ? 'warning' : 'ok')
    }));

    let qaResult = null;
    if (qaTask?.result) {
      qaResult = {
        status: qaTask.result.gateRecommendation === 'PASS' ? 'passed' : 'failed',
        coverage: qaTask.result.qa_report?.coverage || 100,
        blockers: qaTask.result.blocker_count || 0,
        warnings: 0,
        reportUrl: `/api/v1/sdlc/sessions/${sessionId}/release-files/qa-report.md`,
        commitSha: 'N/A'
      };
    }

    return {
      workflowId: sessionId,
      projectId,
      status: overallStatus,
      pipelinePhases,
      pendingGates,
      auditLog,
      qaResult,
      releaseStatus: legacyStatus.releaseGate?.status || 'pending',
      repoInfo: await this._buildSessionRepoInfo({ projectId, sessionId }),
    };
  }

  /**
   * T7 (B7) — Compose the spec §8.1 Repository / Branch / Commit SHA fields
   * by reading the session's working repo. Best-effort: returns a partial
   * object (with nulls) if the workspace isn't materialized yet.
   * repoUrl is NOT stored on PipelineSession (it's transient input) — the
   * frontend already has it on the session seed (`session.repoUrl`).
   */
  async _buildSessionRepoInfo({ projectId, sessionId } = {}) {
    const live = await repoService.getSessionRepoInfo({ projectId, sessionId }).catch(() => null);
    return {
      repoUrl: null,
      branch: live?.branch ?? null,
      commitSha: live?.commitSha ?? null,
      fileCount: live?.fileCount ?? 0,
    };
  }


  // =========================================================================
  // Internals
  // =========================================================================

  async resumeTask(taskId, approved, feedback) {
    const task = await Task.findById(taskId);

    if (!task) throw new Error('Task not found');
    if (task.status !== 'PENDING_TOOL_APPROVAL') throw new Error('Task is not awaiting tool approval');

    // Update status to running
    await Task.update(taskId, { status: 'running' });

    // We do NOT block the API response; we handle the stream in the background
    this._resumeAgentStream(task, approved, feedback).catch(err => {
      console.error(`[SDLC] Resume failed for task ${taskId}:`, err);
    });

    return { success: true, message: 'Task resumed' };
  }

  async getPendingToolApprovals(projectId) {
    const prisma = require('../config/database');
    const tasks = await prisma.task.findMany({
      where: { 
        projectId, 
        status: 'PENDING_TOOL_APPROVAL' 
      },
      select: {
        id: true,
        type: true,
        agentOutput: true,
      }
    });

    return tasks.map(t => ({
      taskId: t.id,
      agentType: t.type,
      data: t.agentOutput ? JSON.parse(t.agentOutput) : null
    }));
  }

  async _resumeAgentStream(task, approved, feedback) {
    try {
      const axios = require('axios');
      const { getAgentUrl } = require('../config/agents');
      const response = await axios.post(
        getAgentUrl('/v1/agent/resume'),
        {
          session_id: task.id,
          node_target: NODE_TARGET[task.type],
          approved,
          feedback,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          responseType: 'stream',
        }
      );

      let buffer = '';
      let completedData = null;
      let requiresActionData = null;
      let agentError = null;

      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let currentEvent = null;

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'error') {
                agentError = data.message || 'Agent error';
              } else if (currentEvent === 'completed') {
                completedData = data;
              } else if (currentEvent === 'requires_action') {
                requiresActionData = data;
              }
            } catch (_) { }
          }
        }
      });

      response.data.on('end', async () => {
        try {
          if (agentError) throw new Error(agentError);
          
          if (requiresActionData) {
            console.log(`[SDLC._resumeAgentStream] Task ${task.id} requires ANOTHER tool approval.`);
            await Task.update(task.id, {
              status: 'PENDING_TOOL_APPROVAL',
              error: null,
              agentOutput: requiresActionData
            });
            return;
          }
          
          if (!completedData) throw new Error('Agent returned no data on resume');
          
          // Assuming output conforms, save it
          await this._saveAgentData(task, completedData, null);
        } catch (err) {
          console.error(`[SDLC._resumeAgentStream] Failed for task ${task.id}:`, err);
          await this._markTaskFailed(task, err);
        }
      });
    } catch (error) {
      console.error(`[SDLC._resumeAgentStream] Request failed for task ${task.id}:`, error);
      await this._markTaskFailed(task, error);
    }
  }

  /**
   * The agent that follows a task. Per AIFA v2.1 the chain is fixed
   * ARCH → PO → UX → DEV → QA; no UX skip is permitted.
   */
  _nextAgentFor(task) {
    return workflowHelpers.nextAgentFor(task);
  }

  async getTaskEvents(taskId, { afterSequence = null, limit = 200 } = {}, user) {
    return workflowQueries.getTaskEvents(taskId, { afterSequence, limit }, user);
  }

  /**
   * Select one coherent workflow chain. A QA task from an older DEV run must
   * never appear beside the current DEV task.
   */
  _selectCurrentTaskChain(tasks = []) {
    return workflowHelpers.selectCurrentTaskChain(tasks);
  }

  _deriveCurrentPhase(architectureTask, poTask, uxTask, devTask, qaTask, decisionsByTaskId, releaseDecision = null) {
    return workflowHelpers.deriveCurrentPhase(architectureTask, poTask, uxTask, devTask, qaTask, decisionsByTaskId, releaseDecision);
  }


  /**
   * Recover the repo context (repoPath/branch/workingBranch) for a session.
   * Read from the PipelineSession row — NOT scanned project-wide — so two
   * sessions on the same project never pick up each other's working copy.
   * Falls back to the legacy PO-task-observability lookup (pre-session data /
   * the architecture-agent path that doesn't always create a session).
   */
  async _getRepoContext(projectId, sessionId = null) {
    if (sessionId) {
      const session = await PipelineSession.findById(sessionId);
      if (session?.repoPath) {
        return { repoPath: session.repoPath, workingBranch: session.workingBranch, baseBranch: session.baseBranch };
      }
      // FIX C — defensive fallback. Sessions created before this fix landed
      // (or by a code path that didn't persist repoPath) would leave
      // `_getRepoContext` returning null and the agents would lose the
      // workspace. Look at any task in this session for `observability.repo`
      // — workflowOrchestrator.runPOAgent:293-294 and runDEVAgent stash the
      // repoContext on the task itself, which survives even if the
      // PipelineSession row was created without repoPath.
      if (typeof Task.findBySessionId === 'function') {
        const sessionTasks = await Task.findBySessionId(sessionId).catch(() => []);
        for (const t of sessionTasks) {
          const repo = t.observability?.repo;
          if (repo?.repoPath) return repo;
        }
      }
    }
    const poTasks = (await Task.findByProjectId(projectId)).filter((t) => t.type === 'po-agent' && !t.sessionId);
    for (const t of poTasks) {
      const repo = t.observability?.repo;
      if (repo?.repoPath) return repo;
    }
    return null;
  }

  /**
   * T2.3 — build the onGate callback for a task/role. Same shape as the real
   * Claude Code `canUseTool`: async (toolName, input) => { behavior, ... }.
   *   - AskUserQuestion (type B): pause for a human answer, return updatedInput.
   *   - write/edit tools (type A): classify risk → auto allow | pause | deny.
   * Every branch is audited.
   */
  _makeOnGate(taskId, role, { projectId = null, sessionId = null, scope = {} } = {}) {
    return async (toolName, input = {}, options = {}) => claudePermissionDispatcher.dispatch({
      toolName,
      input,
      options,
      taskId,
      sessionId,
      projectId,
      role,
      scope,
      audit: (entry) => this._recordGateAudit(taskId, entry),
    });
  }

  /** Append an onGate audit entry (in-memory, surfaced by getAuditTrail). */
  _recordGateAudit(taskId, entry) {
    const list = GATE_AUDIT.get(taskId) || [];
    list.push({ ...entry, timestamp: new Date().toISOString() });
    GATE_AUDIT.set(taskId, list);
    Task.findById(taskId)
      .then(async (task) => {
        if (!task) return;
        // Build and publish the canonical envelope BEFORE persisting so the
        // SSE fanout happens; then persist the AgentEvent row carrying the
        // envelope for replay.
        const envelope = await publishEvent('runtime_log',
          { projectId: task.projectId, sessionId: task.sessionId, taskId, role: entry.role || null },
          { level: 'info', source: 'audit', message: 'gate_audit', meta: { ...entry, timestamp: new Date().toISOString() } },
        );
        return AgentEvent.create({
          taskId,
          projectId: task.projectId,
          sessionId: task.sessionId,
          type: 'gate_audit',
          actor: entry.role || 'orchestrator',
          payload: entry,
          envelope,
          sequence: envelope.sequence,
        });
      })
      .catch((error) => logger.warn('failed to persist gate audit event', { taskId, error: error.message }));
    logger.info('gate_audit', { taskId, kind: entry.kind, role: entry.role, file: entry.file || null });
  }

  /** Read the onGate audit entries for a task (used by getAuditTrail). */
  _getGateAudit(taskId) {
    return GATE_AUDIT.get(taskId) || [];
  }

  async _requireApprovedTask(taskId, expectedType, user) {
    const task = await Task.findById(taskId);
    if (!task) throw new ApiError(404, 'Source task not found');
    if (user) await MembershipService.requireProjectRole(user.id, task.projectId, ['owner', 'admin', 'editor']);
    // Scope the "pipeline locked on a question" check to this task's own
    // session — otherwise a clarification question pending in one concurrent
    // session would incorrectly block every other session on the project.
    const scopeTaskIds = task.sessionId
      ? new Set((await Task.findBySessionId(task.sessionId)).map((t) => t.id))
      : null;
    const pendingQuestion = this._getPendingQuestionGate(task.projectId, scopeTaskIds);
    if (pendingQuestion) {
      throw new ApiError(
        409,
        `Pipeline is locked while ${pendingQuestion.role} waits for a human answer`,
        'PIPELINE_QUESTION_PENDING',
        pendingQuestion.role,
      );
    }
    const allowedTypes = Array.isArray(expectedType) ? expectedType : [expectedType];
    if (!allowedTypes.includes(task.type)) throw new ApiError(400, `Source task must be type: ${allowedTypes.join(' | ')}`);
    if (task.status !== 'completed') throw new ApiError(400, 'Source task must be completed');
    if (task.versionStatus !== 'committed') {
      throw new ApiError(400, 'Source task must be approved (committed) before running next agent');
    }
    // T6: never hand off from an output that the role validator marked INVALID.
    if (await AgentArtifact.hasInvalid(task.id)) {
      throw new ApiError(409, `Source ${expectedType} output is INVALID — fix the blocking issues before running the downstream agent`);
    }
    if (NEXT_AGENT[task.type]) {
      const handoffs = await AgentArtifact.findByTaskIdAndType(task.id, 'a2a_handoff');
      const envelope = handoffs.find((artifact) => artifact.contentJson?.schema_version === 'a2a_handoff.v1')?.contentJson;
      if (!envelope) throw new ApiError(409, 'Approved source task is missing its A2A handoff envelope');
      if (envelope.output_artifact?.hash !== task.outputContentHash) {
        throw new ApiError(409, 'A2A handoff integrity check failed: approved output hash does not match');
      }
    }
    return task;
  }

  _getPendingQuestionGate(projectId, taskIds = null) {
    return gateManager.getPendingQuestionGate(projectId, taskIds);
  }

  async _buildContextFromArtifacts(artifacts, extras = {}) {
    return artifactManager.buildContextFromArtifacts(artifacts, extras);
  }

  async _getFeatureRequestFromIntentTask(task) {
    const deps = { AgentArtifact, resolveArtifactContent };
    return workflowHelpers.getFeatureRequestFromIntentTask(task, deps);
  }

  async _getFeatureRequestFromTask(task) {
    const deps = { AgentArtifact, resolveArtifactContent };
    return workflowHelpers.getFeatureRequestFromTask(task, deps);
  }

  async _recordApprovedHandoff(task, approval) {
    await artifactManager.recordApprovedHandoff(task, approval, {
      nextAgentFn: (t) => this._nextAgentFor(t),
      writeFileFn: (a, b, c, d) => this._writeArtifactToFile(a, b, c, d),
    });
  }

  async _writeArtifactToFile(projectId, taskId, filename, content) {
    return artifactManager.writeArtifactToFile(projectId, taskId, filename, content);
  }

  /**
   * I4: the mock implementation of the agent contract `run({task, context}) ->
   * output`. Pure builder — reads mock-data, applies the role/scenario shaping,
   * and returns the agent output WITHOUT touching the DB. Both `_runAgent`
   * (mock branch) and the agent-contract conformance suite call this, so the
   * mock is held to the same output contract a real agent will be.
   */
  async _buildMockOutput(task, context) {
    // Delegate to agentDispatcher
    const deps = {
      classifyFeatureRequestFn: (fr) => classifyFeatureRequest(fr),
      firstContextValueFn: (ctx, key) => firstContextValue(ctx, key),
    };
    return agentDispatcher.buildMockOutput(task, context, deps);
  }

  /**
   * Core runner — calls AgentService and parses SSE stream, saves artifacts.
   * @private
   */
  /**
   * T3.4 — run a role via the claude-code path. Builds the onGate callback and
   * repo target, then delegates artifact generation to the local Claude Code CLI.
   */
  async _runClaudeCodePath(task, context) {
    const deps = {
      getRepoContext: (pid, sid) => this._getRepoContext(pid, sid),
      makeOnGate: (tid, role, opts) => this._makeOnGate(tid, role, opts),
    };
    return agentDispatcher.runClaudeCodePath(task, context, deps);
  }

  async _runAgent(task, context, userId = null) {
    const deps = {
      saveAgentData: (t, d, uid) => this._saveAgentData(t, d, uid),
      markTaskFailed: (t, err) => this._markTaskFailed(t, err),
      handleTaskTimeout: (t) => this._handleTaskTimeout(t),
      getRepoContext: (pid, sid) => this._getRepoContext(pid, sid),
      makeOnGate: (tid, role, opts) => this._makeOnGate(tid, role, opts),
      buildMockOutputFn: (t, c) => this._buildMockOutput(t, c),
    };
    return agentDispatcher.runAgent(task, context, userId, deps);
  }

  async _markTaskFailed(task, error) {
    return agentDispatcher.markTaskFailed(task, error);
  }

  // Execution-time budget expired (excludes human gate waits). Move the task to a
  // `timeout` terminal state so the workflow does not hang on a runaway agent.
  async _handleTaskTimeout(task) {
    return agentDispatcher.handleTaskTimeout(task);
  }

  /**
   * Cancel a non-terminal task: unblock any pending gate, move it to `cancelled`,
   * and release the worker lock. Idempotent guard returns 409 if already terminal.
   */
  async cancelTask({ taskId, reason = 'cancelled by user', user }) {
    const task = await Task.findById(taskId);
    if (!task) throw new ApiError(404, 'Task not found');
    if (user) await MembershipService.requireProjectRole(user.id, task.projectId, ['owner', 'admin', 'editor']);
    if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.executionStatus)) {
      throw new ApiError(409, `Task already ${task.executionStatus}`, 'TASK_TERMINAL');
    }
    // Resolve any pending gate so an in-flight run unblocks instead of hanging.
    for (const gate of gateBridge.listPending({ taskId })) {
      await gateBridge.resolveGate(gate.approvalId, { action: 'reject', cancelled: true, comment: reason }).catch(() => { });
    }
    await Task.update(taskId, { status: 'cancelled', error: reason, lockedBy: null, heartbeatAt: null });
    await taskLifecycle.transitionIfPresent(taskId, 'cancelled', { actor: user ? 'human' : 'system', reason });
    await FeatureBacklog.updateStatusByTaskId(taskId, 'TODO').catch(() => { });
    await taskWorker.endRun(taskId);
    logger.info('task cancelled', { taskId, phase: task.type, reason });
    return { taskId, status: 'cancelled' };
  }

  // ── DMO-003: recover in-execution gates orphaned by a backend restart ──────
  // A task left at `awaiting_gate` lost its in-memory continuation when the
  // process died. Rather than make the user re-run the whole workflow, we
  // re-dispatch ONLY that interrupted stage (prior committed stages are kept):
  // the agent re-runs idempotently and raises a fresh gate the human can act on.

  /** Rebuild the run context for an existing task from its persisted sources. */
  async _rebuildContextForTask(task) {
    const repoContext = await this._getRepoContext(task.projectId, task.sessionId);
    const extras = repoContext ? { repoContext } : {};
    const projectId = task.projectId;

    if (task.type === 'po-agent') {
      // Prefer the feature request persisted on the task (survives an interrupt
      // before any artifact is saved); fall back to the saved artifact.
      let featureRequest = task.observability?.featureRequest || null;
      if (!featureRequest) {
        featureRequest = await this._getFeatureRequestFromIntentTask(task).catch(() => null);
      }
      return this._buildContextFromArtifacts([], { ...extras, ...(featureRequest ? { featureRequest } : {}) });
    }

    const sourceTask = task.sourceRunId ? await Task.findById(task.sourceRunId) : null;

    if (task.type === 'ux-agent') {
      const sourceArtifacts = sourceTask ? await AgentArtifact.findByTaskId(sourceTask.id) : [];
      return this._buildContextFromArtifacts(sourceArtifacts, extras);
    }
    if (task.type === 'dev-agent') {
      const fromPo = sourceTask?.type === 'po-agent';
      const poTask = fromPo ? sourceTask : await Task.findLatestByProject(projectId, 'po-agent', 'completed', 'committed');
      const uxArtifacts = fromPo || !sourceTask ? [] : await AgentArtifact.findByTaskId(sourceTask.id);
      const poArtifacts = poTask ? await AgentArtifact.findByTaskId(poTask.id) : [];
      return this._buildContextFromArtifacts([...poArtifacts, ...uxArtifacts], extras);
    }
    if (task.type === 'qa-agent') {
      const [poTask, uxTask] = await Promise.all([
        Task.findLatestByProject(projectId, 'po-agent', 'completed', 'committed'),
        Task.findLatestByProject(projectId, 'ux-agent', 'completed', 'committed'),
      ]);
      const all = (await Promise.all([
        poTask ? AgentArtifact.findByTaskId(poTask.id) : Promise.resolve([]),
        uxTask ? AgentArtifact.findByTaskId(uxTask.id) : Promise.resolve([]),
        sourceTask ? AgentArtifact.findByTaskId(sourceTask.id) : Promise.resolve([]),
      ])).flat();
      return this._buildContextFromArtifacts(all, extras);
    }
    return this._buildContextFromArtifacts([], extras);
  }

  /** Re-run a single interrupted task's stage in place. Returns true if resumed. */
  async _resumeInterruptedTask(task) {
    if (task.executionStatus !== 'awaiting_gate') return false;
    const context = await this._rebuildContextForTask(task);
    // _runAgent transitions awaiting_gate -> running and re-drives the agent.
    this._runAgent(task, context, null).catch((err) => console.error('[SDLC] resume failed:', err));
    logger.warn('re-dispatched interrupted-gate stage', { taskId: task.id, phase: task.type });
    return true;
  }

  /** Boot recovery: re-dispatch every task stuck at an interrupted gate. */
  async recoverInterruptedGates() {
    const tasks = await Task.listByExecutionStatus('awaiting_gate');
    let resumed = 0;
    for (const task of tasks) {
      try {
        if (await this._resumeInterruptedTask(task)) resumed += 1;
      } catch (err) {
        logger.warn('failed to resume interrupted task', { taskId: task.id, error: err.message });
      }
    }
    return resumed;
  }

  /**
   * Shape a deterministic mock agent output for the single demo scenario
   * (`happy_path`): every stage is high-confidence + valid so the run reaches
   * Final Release. Reviewer feedback (HITL reject → rework) is still honored so
   * the human gate stays exercised. The synthetic bad-case scenarios of the old
   * system have been removed; failure-handling can be reintroduced later.
   */
  _applyMockScenario(task, completedData, feedbackPrompt) {
    applyMockScenario(task, completedData, feedbackPrompt);
  }

  async _saveAgentData(task, completedData, userId) {
    // Watchdog may have already moved this task to a terminal status
    // (timeout/cancelled/failed) before the runner returned its output —
    // _saveAgentData is invoked synchronously after the runner resolves
    // regardless, so without this guard we'd attempt `transition(... ->
    // 'completed')` from a terminal state and throw
    // `Invalid task transition: <terminal> -> completed`. Bail out
    // cleanly: the watchdog's markTaskFailed already recorded the
    // terminal transition + audit event; nothing here can revive it.
    if (['completed', 'failed', 'cancelled', 'timeout'].includes(task.executionStatus)) {
      logger.warn('_saveAgentData skipped: task already terminal', {
        taskId: task.id, executionStatus: task.executionStatus,
      });
      return null;
    }
    // Save each artifact returned by the agent
    const artifactRows = [];
    const artifactTypes = ['feature_request', 'architecture_contract', 'clarifying_questions',
      'prd', 'user_stories', 'acceptance_criteria', 'scope', 'out_of_scope', 'mcp_activity',
      'assumptions',
      'ux_spec', 'user_flow', 'wireframe_spec', 'component_inventory', 'screens', 'html_mockup',
      'architecture_ledger_update', 'implementation_plan', 'mock_code_diff', 'changed_files',
      'patch_diff', 'patch_format', 'linked_ac_ids', 'build_result', 'sandbox_result', 'self_test_report',
      'risk_assessment', 'risk_level', 'build_report', 'patch_branch', 'patch_commit',
      'risk_classification', 'workflow_policy', 'security_notes', 'security_gate',
      'test_cases', 'qa_report', 'ac_coverage_matrix', 'pass_count', 'fail_count',
      'blocker_count', 'release_recommendation',
      'test_run_report', 'regression_risks', 'security_findings', 'release_reason',
      'coverage_summary', 'dev_evidence_ref',
      'confidence_score',
      'rework_response',
      // Quality Gate result (populated below for qa-agent tasks)
      'gate_evaluation'];

    // -------------------------------------------------------------------------
    // Quality Gate evaluation — runs after QA Agent completes
    // -------------------------------------------------------------------------
    if (task.type === 'qa-agent' && !completedData.gate_evaluation) {
      try {
        // Fetch DEV artifacts for code diff context
        const devTask = await Task.findLatestByProject(task.projectId, 'dev-agent', 'completed', 'committed').catch(() => null);
        let mockCodeDiff = '';
        let implementationPlan = '';

        if (devTask) {
          const devArtifacts = await AgentArtifact.findByTaskId(devTask.id);
          for (const art of devArtifacts) {
            if (art.artifactType === 'mock_code_diff') {
              const resolved = await resolveArtifactContent(art);
              mockCodeDiff = resolved.contentText || '';
            }
            if (art.artifactType === 'implementation_plan') {
              const resolved = await resolveArtifactContent(art);
              implementationPlan = resolved.contentText || '';
            }
          }
        }

        // Fetch PO artifacts for feature title & AC
        const poTask = await Task.findLatestByProject(task.projectId, 'po-agent', 'completed', 'committed').catch(() => null);
        let featureTitle = '';
        let featureDescription = '';
        let acceptanceCriteria = completedData.acceptance_criteria || [];

        if (poTask) {
          const poArtifacts = await AgentArtifact.findByTaskId(poTask.id);
          for (const art of poArtifacts) {
            if (art.artifactType === 'prd') {
              const resolved = await resolveArtifactContent(art);
              featureDescription = (resolved.contentText || '').slice(0, 500);
            }
            if (art.artifactType === 'acceptance_criteria') {
              const resolved = await resolveArtifactContent(art);
              if (Array.isArray(resolved.contentJson)) {
                acceptanceCriteria = resolved.contentJson;
              }
            }
          }
        }

        const gateResult = await QualityGateService.evaluate({
          featureTitle,
          featureDescription,
          acceptanceCriteria: Array.isArray(acceptanceCriteria) ? acceptanceCriteria : [],
          testCases: completedData.test_cases || [],
          acCoverageMatrix: completedData.ac_coverage_matrix || [],
          blockerCount: completedData.blocker_count || 0,
          riskLevel: completedData.risk_level || 'LOW',
          mockCodeDiff,
          implementationPlan,
          testRunReport: completedData.test_run_report || null,
        });

        completedData.gate_evaluation = gateResult;

        console.log(
          `[QualityGate] Task ${task.id}: ${gateResult.complexity.toUpperCase()} | ` +
          `Score: ${gateResult.score}/100 | Recommendation: ${gateResult.recommendation} | ` +
          `Approvers required: ${gateResult.minApproversRequired}`
        );
      } catch (gateErr) {
        console.error(`[QualityGate] Evaluation failed for task ${task.id}:`, gateErr.message);
        // Non-fatal — continue saving without gate result
      }
    }

    // -------------------------------------------------------------------------
    // QA spec compliance (AIFA v2.1 §10): QA must NOT perform release approval.
    // Phase 3.6: `release_decision` is no longer in QA's contract (Release
    // Manager owns it). The `delete` line is no longer needed and was removed;
    // we keep the gate-recommendation normalization so the persisted enum
    // matches the Final Human Decision Gate's contract.
    // -------------------------------------------------------------------------
    if (task.type === 'qa-agent') {
      const REC_MAP = { approve: 'PASS', needs_changes: 'PASS_WITH_RISK', reject: 'FAIL' };
      if (completedData.gate_evaluation?.recommendation) {
        const rec = String(completedData.gate_evaluation.recommendation).toLowerCase();
        if (REC_MAP[rec]) {
          completedData.gate_evaluation.recommendation = REC_MAP[rec];
        }
      }
    }

    for (const artType of artifactTypes) {
      if (completedData[artType] !== undefined && completedData[artType] !== null) {
        const content = completedData[artType];
        let fileRef = null;
        const ext = artType === 'html_mockup' ? 'html' : (typeof content === 'string' ? 'md' : 'json');

        if (typeof content === 'string') {
          fileRef = await this._writeArtifactToFile(task.projectId, task.id, `${artType}.${ext}`, content);
        } else {
          fileRef = await this._writeArtifactToFile(task.projectId, task.id, `${artType}.json`, content);
        }

        // Architecture stage only: mirror `architecture_contract` into the
        // cloned repo at `.aifa/architecture_contract.json` so the
        // auto-commit on approve (`repoService.commitAndPushOnApprove`) has
        // something to `git add`. Workspace artifact remains authoritative
        // for pipeline consumers. Best-effort: a missing repo workspace
        // (early failure, before clone) is logged and skipped — the
        // workspace artifact still exists.
        if (artType === 'architecture_contract' && task.sessionId) {
          try {
            const sessionRepo = await repoService.getSessionRepoInfo({
              projectId: task.projectId,
              sessionId: task.sessionId,
            }).catch(() => null);
            if (sessionRepo?.repoPath) {
              const mirrorDir = path.join(sessionRepo.repoPath, '.aifa');
              await fs.mkdir(mirrorDir, { recursive: true });
              const mirrorPath = path.join(mirrorDir, 'architecture_contract.json');
              const mirrorData = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
              await fs.writeFile(mirrorPath, mirrorData, 'utf8');
            }
          } catch (mirrorErr) {
            logger.warn('architecture_contract mirror into repo failed (non-fatal)', {
              taskId: task.id, error: mirrorErr.message,
            });
          }
        }

        artifactRows.push({
          id: uuidv4(),
          taskId: task.id,
          projectId: task.projectId,
          agentType: task.type,
          artifactType: artType,
          artifactKey: `${artType}:${task.id}`,
          title: artType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          contentText: typeof content === 'string' ? fileRef : null,
          contentJson: typeof content === 'object' ? { file_path: fileRef.slice(5) } : null,
          ordinal: artifactTypes.indexOf(artType),
          contentHash: contentHash(content),
        });
      }
    }

    // PO owns one canonical agent-io bundle. Persist its five fields normally
    // above, then mirror that same bundle as one repository artifact so the
    // approval commit has exactly one PO-owned file to stage.
    if (task.type === 'po-agent' && task.sessionId) {
      const productSpec = {
        prd: completedData.prd,
        user_stories: completedData.user_stories,
        acceptance_criteria: completedData.acceptance_criteria,
        scope: completedData.scope,
        out_of_scope: completedData.out_of_scope,
      };
      try {
        const sessionRepo = await repoService.getSessionRepoInfo({
          projectId: task.projectId,
          sessionId: task.sessionId,
        }).catch(() => null);
        if (sessionRepo?.repoPath) {
          const mirrorDir = path.join(sessionRepo.repoPath, '.aifa');
          await fs.mkdir(mirrorDir, { recursive: true });
          await fs.writeFile(
            path.join(mirrorDir, 'product-spec.json'),
            JSON.stringify(productSpec, null, 2),
            'utf8',
          );
        }
      } catch (mirrorErr) {
        logger.warn('PO product-spec mirror into repo failed (non-fatal)', {
          taskId: task.id, error: mirrorErr.message,
        });
      }
    }

    if (artifactRows.length > 0) {
      // Guard against the task being deleted between agent completion and
      // artifact persistence (project cleanup, retry racing, etc.). Without
      // this check, AgentArtifact.create throws P2003 (FK violation) and the
      // caller marks the task as failed even though the failure is purely
      // cleanup-side.
      const liveTask = await Task.findById(task.id).catch(() => null);
      if (!liveTask) {
        logger.warn('_saveAgentData: task vanished before bulkUpsert, skipping artifact persistence', {
          taskId: task.id, agentType: task.type, artifactCount: artifactRows.length,
        });
        return { artifactCount: 0, agentType: task.type, skipped: 'task_not_found' };
      }
      try {
        await AgentArtifact.bulkUpsert(artifactRows);
      } catch (err) {
        // Race: task was deleted after the guard above but before bulkUpsert
        // committed. P2003 = foreign-key violation. Log and degrade gracefully
        // so we don't double-mark the task as failed.
        if (err?.code === 'P2003') {
          logger.warn('_saveAgentData: P2003 on bulkUpsert (task deleted mid-flight), skipping', {
            taskId: task.id, agentType: task.type, error: err.message,
          });
          return { artifactCount: 0, agentType: task.type, skipped: 'task_deleted_mid_flight' };
        }
        throw err;
      }
    }

    // Build enriched result — include gate info for QA tasks
    const taskResult = {
      artifactCount: artifactRows.length,
      agentType: task.type,
      ...(completedData.summary ? { summary: completedData.summary } : {}),
    };
    if (task.type === 'qa-agent' && completedData.gate_evaluation) {
      taskResult.gateScore = completedData.gate_evaluation.score;
      taskResult.gateRecommendation = completedData.gate_evaluation.recommendation;
      taskResult.gateComplexity = completedData.gate_evaluation.complexity;
      taskResult.minApproversRequired = completedData.gate_evaluation.minApproversRequired;
    }

    const outputHash = contentHash(artifactRows.map((a) => a.contentHash));
    // Merge observability with whatever the latest persisted task already holds
    // so per-session state (e.g. featureRequest seeded by Architecture, repo
    // context set by runAgent) survives subsequent agent completions. Each
    // runner only returns its own slice (claude_result, etc.) and must not be
    // allowed to wipe the previously-stored keys.
    const liveTaskForObservability = await Task.findById(task.id).catch(() => null);
    const observability = {
      ...(liveTaskForObservability?.observability ?? {}),
      ...(completedData.observability ?? {}),
    };

    // Spec §6.1 — clarification_questions is NOT a post-mortem JSON field.
    // The runner's normalizeOutput() forces the field to [] before it reaches
    // here, so no defensive branch is needed. Human clarification happens
    // IN-FLIGHT via AskUserQuestion → claudePermissionDispatcher →
    // gateBridge.requestGate, which pauses the SAME execution and resumes it
    // in-place on resolve. There is exactly one canonical path; we no longer
    // create a question gate here, rerun the agent, or create a new task.

    const persisted = await Task.findById(task.id);
    const poAutoApprove = task.type === 'po-agent'
      && persisted?.observability?.autoApproveOutputReview === true;
    const resolvedGateMode = poAutoApprove ? GATE_MODE.AUTO_SAFE : this._resolveGateMode(task);

    await Task.update(task.id, {
      status: 'completed',
      output_content_hash: outputHash,
      result: taskResult,
      observability,
      // Structured HITL (plan 2.4): keep the raw agent output distinct from the
      // human-approved output. approvedOutput is only set on approve/edit.
      agentOutput: completedData,
      gateMode: resolvedGateMode,
    });
    // Race window: an execution-time timeout may have already moved this
    // task to a terminal executionStatus (`timeout`) while the SDK was
    // mid-flight and produced this output. Use `transitionIfPresent` so
    // the "Invalid task transition: timeout -> completed" race is logged
    // + skipped rather than crashing _saveAgentData and double-marking the
    // task as failed downstream.
    await taskLifecycle.transitionIfPresent(task.id, 'completed', {
      actor: task.type,
      payload: { outputHash },
    });
    await FeatureBacklog.updateStatusByTaskId(task.id, 'REVIEW');

    // T1: persist role-validation status onto this run's artifacts. A BLOCKER
    // means the output is structurally incomplete → mark INVALID, emit no
    // handoff, and do not advance the phase (derive stays at *_REVIEW).
    const validation = this._validateGateOutput(task, completedData);
    const blockers = validation.violations.filter((v) => v.severity === 'BLOCKER');
    await AgentArtifact.setStatusByTaskId(task.id, blockers.length ? 'INVALID' : 'VALID')
      .catch((e) => console.error('[SDLC] setStatusByTaskId failed:', e.message));

    if (blockers.length) {
      logger.warn('agent output INVALID — opening output review gate with validation issues', {
        taskId: task.id,
        phase: task.type,
        blockers: blockers.map((b) => ({
          rule: b.rule,
          detail: b.detail,
          ...(b.inspect ? { inspect: b.inspect } : {}),
        })),
      });
    }

    // Always create a human output-review gate for PO/UX/DEV/QA — the pipeline
    // never silently auto-advances. Reject re-runs the same agent with the
    // human's reason as feedback (see resolveOutputReviewGate).
    if (AGENT_GATES[task.type]) {
      const { approvalId, ready } = gateBridge.requestGate({
        taskId: task.id,
        sessionId: task.sessionId,
        projectId: task.projectId,
        role: task.type,
        kind: 'output_review',
        payload: {
          agent: task.type,
          summary: completedData.summary || null,
          artifacts: artifactRows.map((a) => a.artifactType),
          validationIssues: blockers.map((b) => ({
            rule: b.rule,
            message: b.message || b.detail || null,
            ...(b.inspect ? { inspect: b.inspect } : {}),
          })),
        },
      });
      logger.info('agent created output review gate', {
        taskId: task.id,
        agent: task.type,
        approvalId,
        invalid: blockers.length > 0,
      });
      if (poAutoApprove) {
        await ready;
        const approved = await this._autoApproveSafeOutput(task.id, userId, {
          approvalId,
          stopAfterAgent: persisted.observability?.stopAfterAgent || null,
        });
        if (!approved) {
          logger.warn('PO happy-path auto approval did not pass the existing gate policy', {
            taskId: task.id,
            approvalId,
          });
        }
      }
    }

    if (userId) {
      QuotaService.recordUsage({
        userId,
        projectId: task.projectId,
        taskId: task.id,
        agentType: task.type,
        tokenInput: completedData.token_usage?.input || 0,
        tokenOutput: completedData.token_usage?.output || 0,
      }).catch(() => { });
    }
    await taskWorker.endRun(task.id); // DMO-001: terminal (completed) — release the worker lock
  }

  // Demo board review holds: force PARK roles to STRICT_MANUAL so a staged flow
  // stops at that stage's review. Registered/cleared by demoBoardService.
  setReviewHolds(projectId, roles = []) {
    REVIEW_HOLDS.set(projectId, new Set(roles));
  }

  clearReviewHolds(projectId) {
    REVIEW_HOLDS.delete(projectId);
  }

  _resolveGateMode(task) {
    return workflowHelpers.resolveGateMode(task);
  }

  async _autoApproveSafeOutput(taskId, userId = null, { approvalId = null, stopAfterAgent = null } = {}) {
    const task = await Task.findById(taskId);
    if (!task || task.gateMode === GATE_MODE.STRICT_MANUAL) return false;

    const output = task.agentOutput || {};
    const evaluation = this._evaluateGatePolicy(task);
    if (evaluation.recommendation !== 'PASS') return false;
    const { confidence, validation } = evaluation;

    if (approvalId) {
      const pending = gateBridge.getPending(approvalId);
      if (!pending || pending.taskId !== task.id || pending.kind !== 'output_review') return false;
      await gateBridge.resolveGate(approvalId, {
        action: 'approve',
        comment: 'Auto-approved by PO happy-path demo after validation passed',
      });
    }

    await Task.update(task.id, { approvedOutput: output, version_status: 'committed' });
    await Task.commitTask(task.id);
    await AgentArtifact.setStatusByTaskId(task.id, 'VALID');
    const commitResult = await repoService.commitAndPushOnApprove({
      task,
      onLog: (message, meta = {}) => {
        publishEvent('runtime_log',
          { projectId: task.projectId, sessionId: task.sessionId, taskId: task.id, role: null },
          {
            taskId: task.id,
            level: meta.level || 'info',
            source: 'auto_commit',
            message,
            meta,
          },
        );
      },
    });
    const approval = await HitlDecision.create({
      id: uuidv4(),
      taskId: task.id,
      projectId: task.projectId,
      workflowRunId: task.projectId,
      gate: AGENT_GATES[task.type],
      decision: 'APPROVE',
      action: 'auto_approve',
      decisionId: uuidv4(),
      baseOutputVersion: task.outputVersion || 0,
      comment: `Auto-approved: confidence ${confidence.toFixed(2)}, validation passed`,
      payload: {
        approvalId,
        confidence,
        threshold: AUTO_APPROVE_CONFIDENCE,
        validation,
        commit: commitResult,
        stopAfterAgent,
      },
    });
    const refreshed = await Task.findById(task.id);
    await Task.update(task.id, {
      observability: {
        ...(refreshed.observability || {}),
        outputReviewApprovalId: approvalId,
        autoApprovalId: approval.id,
        commit: commitResult,
      },
    });
    await this._recordApprovedHandoff(refreshed, approval);
    if (stopAfterAgent !== refreshed.type) {
      try {
        await this._startNextAgentIfAvailable(refreshed, userId);
      } catch (err) {
        // A downstream startup failure must not turn an already completed and
        // committed upstream task into FAILED.
        logger.error('downstream agent failed to start after auto-approval', {
          sourceTaskId: refreshed.id,
          sourceAgent: refreshed.type,
          nextAgent: this._nextAgentFor(refreshed),
          error: err.message,
        });
      }
    }
    return true;
  }

  async _startNextAgentIfAvailable(task, userId = null) {
    const deps = {
      nextAgentFor: (t) => this._nextAgentFor(t),
      getPendingQuestionGate: (pid, tids) => this._getPendingQuestionGate(pid, tids),
      contentHash,
      runAgent: (t, ctx, uid) => this._runAgent(t, ctx, uid),
      requireApprovedTask: (tid, type, u) => this._requireApprovedTask(tid, type, u),
      buildContextFromArtifacts: (arts, extras) => this._buildContextFromArtifacts(arts, extras),
      MembershipService,
    };
    return workflowOrchestrator.startNextAgentIfAvailable(task, userId, deps);
  }
}

const sdlcWorkflowService = new SdlcWorkflowService();
// I5: expose the versioned output contracts for the drift test (read-only use).
sdlcWorkflowService.OUTPUT_CONTRACTS = OUTPUT_CONTRACTS;
sdlcWorkflowService.OUTPUT_CONTRACT_VERSION = OUTPUT_CONTRACT_VERSION;
module.exports = sdlcWorkflowService;
