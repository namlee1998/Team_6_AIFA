// HTTP/SSE adapter for the SDLC control plane.
//
// Beginner reading guide: this class validates transport-level input and shapes
// responses. It delegates workflow decisions to SdlcWorkflowService and
// repository handling to repoService.

const SdlcWorkflowService = require('../services/SdlcWorkflowService');
const repoService = require('../services/repoService');
const { validateRepoUrl } = repoService;
const eventBus = require('../services/eventBus');
const { publishEvent } = require('../services/eventPublisher');
const { createEnvelope } = require('../dto/eventEnvelope');
const AgentEvent = require('../models/AgentEvent');
const logger = require('../config/logger');

// Legacy migration helper. ONLY used by streamPipelineStatus replay for
// AgentEvent rows that predate the transport refactor and lack a stored
// envelope column. Reconstructs a canonical envelope from the legacy
// (type, payload, sequence) row so replay stays in the same shape as live
// events. Not exported. Producers MUST go through publishEvent.
function buildLegacyEnvelope(type, base, payload, sequence) {
  return createEnvelope(type, base, payload, sequence);
}


// Demo scenarios exposed by the dev-only scenario selector endpoint.
const DEFAULT_MOCK_SCENARIO = 'happy_path';

class SdlcController {
  // ─── ArchitectureGate ──────────────────────────────────────────────────────────

  async runArchitectureAgent(req, res, next) {
    try {
      const { project_id, feature_request, feedback_prompt, backlog_id, repo_url } = req.body;
      if (!project_id) return res.status(400).json({ status: 'error', message: 'project_id is required' });
      if (!feature_request || !feature_request.title) {
        return res.status(400).json({ status: 'error', message: 'feature_request.title is required' });
      }
      // AIFA v2.1 §4 Phase 1: validate the Repository URL before any
      // workspace creation or clone work begins. validateRepoUrl throws
      // ApiError(400, ...) — let it propagate to the error middleware so
      // the response shape stays consistent with the rest of the API.
      validateRepoUrl(repo_url);

      const result = await SdlcWorkflowService.runArchitectureAgent({
        projectId: project_id,
        featureRequest: feature_request,
        feedbackPrompt: feedback_prompt || '',
        backlogId: backlog_id || null,
        repoUrl: repo_url || null,
        user: req.user,
      });

      // AIFA v2.1: return both task_id and session_id so the frontend can
      // poll /pipeline/:session_id and open /stream/:session_id immediately
      // without any bridge logic. PipelineSession is created upfront in
      // runArchitectureAgent — see workflowOrchestrator.runArchitectureAgent.
      return res.status(202).json({
        task_id: result.task.id,
        session_id: result.sessionId,
        status: result.task.status,
        type: result.task.type,
      });
    } catch (err) { next(err); }
  }

  // ─── Run Agents ──────────────────────────────────────────────────────────

  /**
   * Deterministic PO happy-path entry. Architecture remains the pipeline entry:
   * this endpoint accepts only an already-approved Architecture task and reuses
   * that task's session repository. The explicit demo controls keep the normal
   * production chain unchanged while allowing the PO stage to auto-approve and
   * stop before UX after its local repository commit.
   */
  async runPOAgent(req, res, next) {
    try {
      const { project_id, source_task_id, feature_request } = req.body;
      if (!project_id) {
        return res.status(400).json({ status: 'error', message: 'project_id is required' });
      }
      if (!source_task_id) {
        return res.status(400).json({ status: 'error', message: 'source_task_id is required' });
      }
      if (!feature_request || !feature_request.title) {
        return res.status(400).json({ status: 'error', message: 'feature_request.title is required' });
      }

      const task = await SdlcWorkflowService.runPOAgent({
        projectId: project_id,
        sourceTaskId: source_task_id,
        featureRequest: feature_request,
        request: feature_request.title,
        user: req.user,
      });

      return res.status(202).json({
        task_id: task.id,
        session_id: task.sessionId,
        status: task.status,
        type: task.type,
      });
    } catch (err) { next(err); }
  }

  /**
   * Folder upload is no longer accepted as a workflow entry. Per AIFA v2.1 §4
   * repositories are never uploaded — the Git repository is the only source of
   * project information. Workflows must be started from a Repository URL.
   */
  async uploadRepo(req, res, next) {
    return res.status(410).json({
      status: 'error',
      code: 'UPLOAD_REPO_REMOVED',
      message: 'Folder upload is no longer accepted. Per AIFA v2.1 §4 the workflow entry is a Repository URL — call POST /api/v1/sdlc/run-architecture-agent with repo_url.',
    });
  }

  async runUXAgent(req, res, next) {
    try {
      const { source_task_id, feedback_prompt } = req.body;
      if (!source_task_id) return res.status(400).json({ status: 'error', message: 'source_task_id is required' });

      const task = await SdlcWorkflowService.runUXAgent({
        projectId: req.body.project_id,
        sourceTaskId: source_task_id,
        feedbackPrompt: feedback_prompt || '',
        user: req.user,
      });

      return res.status(202).json({ task_id: task.id, status: task.status, type: task.type });
    } catch (err) { next(err); }
  }

  async runDEVAgent(req, res, next) {
    try {
      const { source_task_id, feedback_prompt } = req.body;
      if (!source_task_id) return res.status(400).json({ status: 'error', message: 'source_task_id is required' });

      const task = await SdlcWorkflowService.runDEVAgent({
        projectId: req.body.project_id,
        sourceTaskId: source_task_id,
        feedbackPrompt: feedback_prompt || '',
        user: req.user,
      });

      return res.status(202).json({ task_id: task.id, status: task.status, type: task.type });
    } catch (err) { next(err); }
  }

  async runQAAgent(req, res, next) {
    try {
      const { source_task_id, feedback_prompt } = req.body;
      if (!source_task_id) return res.status(400).json({ status: 'error', message: 'source_task_id is required' });

      const task = await SdlcWorkflowService.runQAAgent({
        projectId: req.body.project_id,
        sourceTaskId: source_task_id,
        feedbackPrompt: feedback_prompt || '',
        user: req.user,
      });

      return res.status(202).json({ task_id: task.id, status: task.status, type: task.type });
    } catch (err) { next(err); }
  }

  // ─── HITL Gate ───────────────────────────────────────────────────────────

  async submitHitlDecision(req, res, next) {
    return this.submitGateDecision(req, res, next);
  }

  async submitGateDecision(req, res, next) {
    try {
      const { task_id } = req.params;
      const { decision, comment } = req.body;

      if (!['approve', 'reject', 'request_changes'].includes(decision?.toLowerCase())) {
        return res.status(400).json({ status: 'error', message: "Invalid decision. Must be 'approve', 'reject', or 'request_changes'." });
      }

      const result = await SdlcWorkflowService.submitGateDecision({
        taskId: task_id,
        decision,
        comment,
        user: req.user,
      });

      return res.json({
        status: 'success',
        data: {
          task_id: result.task.id,
          gate: result.hitlDecision.gate,
          decision: result.hitlDecision.decision,
          comment: result.hitlDecision.comment,
          created_at: result.hitlDecision.createdAt,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Structured HITL decision (plan section 2.3 / 2.8) ────────────────────

  async submitStructuredDecision(req, res, next) {
    try {
      const { task_id } = req.params;
      const { decision_id, base_output_version, action, payload, comment } = req.body;

      if (!['approve', 'reject', 'edit_approve'].includes(action?.toLowerCase())) {
        return res.status(400).json({ status: 'error', message: "Invalid action. Must be 'approve', 'reject', or 'edit_approve'." });
      }

      const result = await SdlcWorkflowService.submitStructuredDecision({
        taskId: task_id,
        decisionId: decision_id,
        baseOutputVersion: base_output_version,
        action,
        payload: payload || {},
        comment: comment || '',
        user: req.user,
      });

      return res.json({
        status: 'success',
        data: {
          task_id: result.task.id,
          action: result.hitlDecision.action,
          decision: result.hitlDecision.decision,
          decision_id: result.hitlDecision.decisionId,
          output_version: result.task.outputVersion,
          idempotent_replay: result.idempotentReplay || false,
          escalated: result.escalated || false,
          validation: result.validation || null,
          rerun_task_id: result.rerunTask?.id || null,
          rerun_task_type: result.rerunTask?.type || null,
        },
      });
    } catch (err) { next(err); }
  }

  // ─── Gate approvals (T2.4) — resolve a pending onGate gate ────────────────

  async resolveApproval(req, res, next) {
    try {
      const { approval_id } = req.params;
      const { action, comment, answers } = req.body || {};
      
      if (action && !['approve', 'reject'].includes(action?.toLowerCase())) {
        return res.status(400).json({ status: 'error', message: "Invalid action. Must be 'approve' or 'reject'." });
      }
      const result = await SdlcWorkflowService.resolveApproval({
        approvalId: approval_id,
        action,
        comment: comment || '',
        answers: answers ?? null,
        user: req.user,
      });
      return res.json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  async listPendingApprovals(req, res, next) {
    try {
      const { task_id, project_id } = req.query;
      const gates = await SdlcWorkflowService.listPendingGates({ taskId: task_id || null, projectId: project_id || null });
      return res.json({ status: 'success', data: { pending: gates } });
    } catch (err) { next(err); }
  }

  async listAllInterventions(req, res, next) {
    try {
      const { project_id } = req.query || {};
      const interventions = await SdlcWorkflowService.getAllInterventions(req.user, project_id || null);
      return res.json({ status: 'success', data: interventions });
    } catch (err) { next(err); }
  }

  // ─── Output review gates (always-on approve/reject after every agent) ────

  async resolveOutputReviewGate(req, res, next) {
    try {
      const { approval_id } = req.params;
      const { action, comment } = req.body || {};

      if (!action || !['approve', 'reject'].includes(action?.toLowerCase())) {
        return res.status(400).json({ status: 'error', message: "Invalid action. Must be 'approve' or 'reject'." });
      }
      const result = await SdlcWorkflowService.resolveOutputReviewGate({
        approvalId: approval_id,
        action: action.toLowerCase(),
        comment: comment || '',
        user: req.user,
      });
      return res.json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  // ─── V4 Pipeline & Stream ────────────────────────────────────────────────

  async getPipelineStatus(req, res, next) {
    try {
      const { workflowId } = req.params;
      const response = await SdlcWorkflowService.getPipelineResponse(workflowId, req.user);
      return res.json({ status: 'success', data: response });
    } catch (err) { next(err); }
  }

  async streamPipelineStatus(req, res, next) {
    try {
      const sessionId = req.params.sessionId ?? req.params.workflowId;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      // Canonical transport: every frame is the canonical EventEnvelope JSON
      // forwarded verbatim from where it was published. Replay re-emits
      // row.envelope byte-for-byte; live envelopes are produced exclusively
      // by publishEvent.
      const sendEnvelope = (envelope) => {
        if (!envelope) return;
        res.write(`id: ${envelope.sequence}\n`);
        res.write(`data: ${JSON.stringify(envelope)}\n\n`);
      };

      const sendError = (message, code = null, statusCode = 500) => {
        // Transport error path — the canonical envelope requires projectId,
        // which we may not have yet (e.g. session lookup failed). Emit a
        // non-envelope `data:` line that the FE sseClient logs and discards,
        // rather than synthesizing an envelope (no manual UUID/sequence).
        res.write(`data: ${JSON.stringify({ error: { message, code, statusCode } })}\n\n`);
      };

      const cursorRaw = req.headers['last-event-id'] ?? req.query.after_sequence ?? 0;
      let lastSeq = Number.isFinite(Number(cursorRaw)) ? Number(cursorRaw) : 0;
      const isResume = lastSeq > 0;

      // Resolve the projectId for this session before subscribing so the
      // bus subscription covers the seed envelope we publish below.
      let initialPipeline;
      try {
        initialPipeline = await SdlcWorkflowService.getPipelineResponse(sessionId, req.user);
      } catch (err) {
        sendError(err.message, err.code || null, err.statusCode || 500);
        return res.end();
      }
      if (!initialPipeline || !initialPipeline.projectId) {
        sendError('Pipeline not found');
        return res.end();
      }
      const projectId = initialPipeline.projectId;

      // 1) Subscribe FIRST so the seed envelope we publish below is fanned
      //    out to this connection via the same canonical path every other
      //    live event uses.
      const unsubscribe = eventBus.subscribeProject(projectId, sendEnvelope);

      // 2) Replay any persisted envelopes for this session. row.envelope is
      //    forwarded verbatim. The legacy fallback (buildLegacyEnvelope) is
      //    reserved for rows pre-dating this transport refactor.
      try {
        const persisted = await AgentEvent.list({
          sessionId,
          afterSequence: lastSeq,
          limit: 1000,
        });
        for (const row of persisted) {
          if (row.envelope) {
            sendEnvelope(row.envelope);
          } else if (row.payload) {
            const envelope = buildLegacyEnvelope(
              row.type === 'gate_audit' ? 'runtime_log' : row.type,
              { projectId: row.projectId, sessionId, taskId: row.taskId, role: null },
              row.payload,
              row.sequence,
            );
            sendEnvelope(envelope);
          }
        }
      } catch (err) {
        logger.warn?.('streamPipelineStatus: replay failed', { sessionId, error: err.message });
      }

      // 3) Initial snapshot: session_started (or session_resumed on reconnect).
      //    Producers ALWAYS go through publishEvent — never a manual
      //    UUID/sequence/timestamp.
      const snapshotType = isResume ? 'session_resumed' : 'session_started';
      await publishEvent(
        snapshotType,
        { projectId, sessionId, taskId: null, role: null },
        {
          status: initialPipeline.status,
          pipelinePhases: initialPipeline.pipelinePhases,
          repoInfo: initialPipeline.repoInfo || null,
          pendingGates: initialPipeline.pendingGates || [],
          resumedFrom: lastSeq,
          log: isResume ? 'Resumed SDLC pipeline stream...' : 'Connected to SDLC pipeline stream...',
        },
      );

      // 4) Heartbeat only. Terminal events (pipeline_completed /
      //    pipeline_failed) are owned by SdlcWorkflowService — they are
      //    published exactly once at the state transition and fan out via
      //    the canonical publishEvent path. The SSE controller never polls
      //    for terminal states and never publishes terminal events.
      const heartbeatInterval = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15000);

      const stopAll = () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
      };

      req.on('close', () => {
        stopAll();
        res.end();
      });
    } catch (err) {
      if (res.headersSent) {
        logger.warn?.('sse stream: late error after headers sent', { error: err.message });
        try { res.end(); } catch (_) { /* ignore */ }
      } else {
        next(err);
      }
    }
  }

  // ─── Status & Data ───────────────────────────────────────────────────────

  async getTaskStatus(req, res, next) {
    try {
      const { task_id } = req.params;
      const task = await SdlcWorkflowService.getTaskStatus(task_id, req.user);
      if (!task) return res.status(404).json({ status: 'error', message: 'Task not found' });

      return res.json({
        status: 'success',
        data: {
          task_id: task.id,
          type: task.type,
          status: task.status,
          version_status: task.versionStatus,
          gate: task.gate,
          next_agent: task.nextAgent,
          result: task.result,
          error: task.error || null,
          gate_evaluation: task.gateEvaluation || null,
          artifacts: task.artifacts || [],
          hitl_decision: task.hitlDecision || null,
          pending_gates: task.pendingGates || [],
          // Structured HITL fields (plan 2.4 / 2.7 / 2.8)
          output_version: task.outputVersion ?? 0,
          retry_count: task.retryCount ?? 0,
          last_retry_reason: task.lastRetryReason || null,
          gate_mode: task.gateMode || null,
          execution_status: task.executionStatus || null,
          attempt: task.attempt ?? 0,
          max_attempts: task.maxAttempts ?? 1,
          locked_by: task.lockedBy || null,
          locked_at: task.lockedAt || null,
          heartbeat_at: task.heartbeatAt || null,
          started_at: task.startedAt || null,
          finished_at: task.finishedAt || null,
          agent_output: task.agentOutput || null,
          approved_output: task.approvedOutput || null,
          created_at: task.createdAt,
          updated_at: task.updatedAt,
        },
      });
    } catch (err) { next(err); }
  }

  async streamStatus(req, res, next) {
    // Legacy per-task SSE endpoint. The single canonical transport is
    // /stream/:sessionId (streamPipelineStatus). Per-task streams are
    // deprecated — there is exactly one transport path.
    return res.status(410).json({
      status: 'error',
      code: 'STREAM_STATUS_DEPRECATED',
      message: 'GET /sdlc/status/:task_id is deprecated. Use GET /sdlc/stream/:sessionId as the single canonical SSE transport.',
    });
  }

  async getWorkflowStatus(req, res, next) {
    try {
      const { session_id } = req.query;
      if (!session_id) return res.status(400).json({ status: 'error', message: 'session_id is required' });

      const result = await SdlcWorkflowService.getWorkflowStatus(session_id, req.user);
      return res.json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  async getFinalReviewPacket(req, res, next) {
    try {
      const { session_id } = req.params;
      const packet = await SdlcWorkflowService.getFinalReviewPacket(session_id, req.user);
      return res.json({ status: 'success', data: packet });
    } catch (err) { next(err); }
  }

  async listSessions(req, res, next) {
    try {
      const { project_id } = req.params;
      const sessions = await SdlcWorkflowService.listSessions(project_id, req.user);
      return res.json({ status: 'success', data: sessions });
    } catch (err) { next(err); }
  }

  async submitReleaseDecision(req, res, next) {
    try {
      const { session_id } = req.params;
      const { decision_id, comment } = req.body;
      // Wire-format normalization: the UI panels send lowercase `action`
      // ('approve' | 'reject') but the canonical contract owned by
      // sdlcConstants.RELEASE_DECISIONS and releaseManager is uppercase
      // `decision` ('APPROVE' | 'REJECT'). Accept either field name; map
      // to the canonical contract here so the service layer (and the
      // frozen schema) is never exposed to a UI-side casing drift.
      const rawDecision = req.body.decision ?? (typeof req.body.action === 'string'
        ? req.body.action.toUpperCase()
        : undefined);
      const result = await SdlcWorkflowService.submitReleaseDecision({
        sessionId: session_id,
        decisionId: decision_id,
        decision: rawDecision,
        comment: comment || '',
        user: req.user,
      });
      return res.json({
        status: 'success',
        data: {
          decision: result.hitlDecision.decision,
          action: result.hitlDecision.action,
          comment: result.hitlDecision.comment,
          release_status: result.hitlDecision.payload?.release_status || null,
          idempotent_replay: result.idempotentReplay || false,
          // T6.2 — multi-part release outputs (branch, commit, final.md, …).
          release_outputs: result.releaseOutputs || null,
        },
      });
    } catch (err) { next(err); }
  }

  async getAuditTrail(req, res, next) {
    try {
      const { project_id } = req.params;
      const trail = await SdlcWorkflowService.getAuditTrail(project_id, req.user);
      return res.json({ status: 'success', data: trail });
    } catch (err) { next(err); }
  }

  // T7: thin alias for the audit trail under a UI-friendly name. No new logic —
  // delegates straight to getAuditTrail (:id is the project id).
  async getTimeline(req, res, next) {
    try {
      const { id } = req.params;
      const trail = await SdlcWorkflowService.getAuditTrail(id, req.user);
      return res.json({ status: 'success', data: trail });
    } catch (err) { next(err); }
  }

  async getWorkflowMetrics(req, res, next) {
    try {
      const { project_id } = req.params;
      const metrics = await SdlcWorkflowService.getWorkflowMetrics(project_id, req.user);
      return res.json({ status: 'success', data: metrics });
    } catch (err) { next(err); }
  }

  async getProjectHealth(req, res, next) {
    try {
      const { projectId } = req.params;
      const data = await SdlcWorkflowService.getProjectHealth(projectId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getPendingToolApprovals(req, res, next) {
    try {
      const { projectId } = req.params;
      const data = await SdlcWorkflowService.getPendingToolApprovals(projectId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getProjectArtifacts(req, res, next) {
    try {
      const { project_id } = req.params;
      const data = await SdlcWorkflowService.getProjectArtifacts(project_id, req.user);
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  async approveToolCall(req, res, next) {
    try {
      const { taskId } = req.params;
      const { approved, feedback } = req.body;
      
      if (approved === undefined) {
        return res.status(400).json({ status: 'error', message: 'The "approved" boolean field is required.' });
      }

      const result = await SdlcWorkflowService.resumeTask(taskId, approved, feedback);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getTaskEvents(req, res, next) {
    try {
      const { task_id } = req.params;
      const { after_sequence, limit } = req.query;
      const events = await SdlcWorkflowService.getTaskEvents(task_id, {
        afterSequence: after_sequence,
        limit,
      }, req.user);
      return res.json({ status: 'success', data: { events } });
    } catch (err) { next(err); }
  }

  async downloadReleaseFile(req, res, next) {
    try {
      const { session_id, file_name } = req.params;
      const filePath = await SdlcWorkflowService.getReleaseFile(session_id, file_name, req.user);
      return res.download(filePath, file_name);
    } catch (err) { next(err); }
  }

  // ─── Dev-only: demo scenario selector ────────────────────────────────────
  // Lets the UI flip MOCK_SCENARIO at runtime (the mock builder reads it per
  // run). Disabled in production. Never persisted — process env only.

  getMockScenario(req, res) {
    return res.json({
      status: 'success',
      data: {
        scenario: DEFAULT_MOCK_SCENARIO,
        mockEnabled: process.env.USE_MOCK_AGENTS === 'true',
        executionPath: process.env.EXECUTION_PATH || 'langchain',
        mockClaudeCode: false,
        available: [DEFAULT_MOCK_SCENARIO],
      },
    });
  }

  // ─── Demo Board API ──────────────────────────────────────────────────────

  async seedDemoBoard(req, res, next) {
    try {
      const { reset, sourceRepoPath, mode } = req.body;
      const demoBoardService = require('../services/demoBoardService');
      const board = await demoBoardService.seedDemoBoard(reset, sourceRepoPath, mode);
      return res.json({ status: 'success', data: board });
    } catch (err) { next(err); }
  }

  async getDemoBoard(req, res, next) {
    try {
      const demoBoardService = require('../services/demoBoardService');
      const board = await demoBoardService.getDemoBoard(req.user);
      return res.json({ status: 'success', data: board });
    } catch (err) { next(err); }
  }

  async getDemoUxDoc(req, res, next) {
    try {
      const { project_id } = req.params;
      const demoBoardService = require('../services/demoBoardService');
      const doc = await demoBoardService.getDemoUxDoc(project_id, req.user);
      return res.json({ status: 'success', data: doc });
    } catch (err) { next(err); }
  }

  async retryDemoFlow(req, res, next) {
    try {
      const { project_id } = req.params;
      const demoBoardService = require('../services/demoBoardService');
      const result = await demoBoardService.retryDemoFlow(project_id, req.user);
      return res.json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  // ─── Cancel a running/awaiting task ──────────────────────────────────────

  async cancelTask(req, res, next) {
    try {
      const { task_id } = req.params;
      const result = await SdlcWorkflowService.cancelTask({
        taskId: task_id,
        reason: req.body?.reason || 'cancelled by user',
        user: req.user,
      });
      return res.json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  async getProjectHealth(req, res, next) {
    try {
      const result = await SdlcWorkflowService.getProjectHealth();
      return res.json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  async updateEnvSettings(req, res, next) {
    try {
      const { keys } = req.body;
      if (!keys || typeof keys !== 'object') {
        return res.status(400).json({ status: 'error', message: 'Invalid keys object' });
      }
      const result = await SdlcWorkflowService.updateEnvSettings(keys);
      return res.json(result);
    } catch (err) { next(err); }
  }

  // ─── Kanban Backlog ──────────────────────────────────────────────────────

  async getBacklogs(req, res, next) {
    try {
      const { project_id } = req.params;
      const FeatureBacklog = require('../models/FeatureBacklog');
      const backlogs = await FeatureBacklog.findByProjectId(project_id);
      return res.json({ status: 'success', data: backlogs });
    } catch (err) { next(err); }
  }

  async createBacklog(req, res, next) {
    try {
      const { project_id } = req.params;
      const { title, description, priority } = req.body;
      const FeatureBacklog = require('../models/FeatureBacklog');
      const record = await FeatureBacklog.create({
        project_id,
        title,
        description,
        priority: priority || 'MEDIUM',
        status: 'TODO'
      });
      return res.status(201).json({ status: 'success', data: record });
    } catch (err) { next(err); }
  }

  async moveBacklog(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const FeatureBacklog = require('../models/FeatureBacklog');
      const record = await FeatureBacklog.updateStatus(id, status);
      return res.json({ status: 'success', data: record });
    } catch (err) { next(err); }
  }

  async executeGitAction(req, res, next) {
    try {
      const { session_id } = req.params;
      const { action, agent, githubToken, commitMessage } = req.body;
      const db = require('../models');
      const repoService = require('../services/repoService');
      const axios = require('axios');

      // 1. Get session & project details
      const session = await db.PipelineSession.findById(session_id);
      if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
      const repoPath = repoService.repoPathFor(session.projectId, session_id);

      let output = '';

      // 2. Handle specific Git action
      switch (action) {
        case 'sync':
          output = await repoService.git(['pull', 'origin', 'HEAD'], repoPath).catch(e => {
            // If there's no remote yet, just ignore
            return 'No remote found to pull from or pull failed: ' + e.message;
          });
          break;

        case 'commit':
          // Set user config
          await repoService.git(['config', 'user.name', 'AIFA Agent'], repoPath).catch(() => {});
          await repoService.git(['config', 'user.email', 'bot@aifa.io'], repoPath).catch(() => {});
          
          await repoService.git(['add', '.'], repoPath);
          const msg = commitMessage || `chore: commit ${agent || 'Agent'} outputs`;
          try {
            output = await repoService.git(['commit', '-m', msg], repoPath);
          } catch (e) {
            if (e.message.includes('nothing to commit') || e.message.includes('không có gì để chuyển giao')) {
              output = 'Không có thay đổi nào mới để Commit (Working tree clean).';
            } else {
              throw e;
            }
          }
          break;

        case 'push':
          if (!githubToken) {
            return res.status(400).json({ success: false, message: 'GitHub Token is required for pushing code.' });
          }
          // We need to push. To avoid exposing token in logs, we handle it carefully.
          // Get the current remote origin URL
          let originUrl = await repoService.git(['config', '--get', 'remote.origin.url'], repoPath).catch(() => null);
          if (!originUrl) {
            return res.status(400).json({ success: false, message: 'No remote origin found. Cannot push.' });
          }
          
          originUrl = originUrl.trim();
          let authUrl = originUrl;
          if (originUrl.startsWith('https://')) {
            authUrl = originUrl.replace('https://', `https://${githubToken}@`);
          } else {
            return res.status(400).json({ success: false, message: 'Only HTTPS remotes are supported for token auth.' });
          }
          
          output = await repoService.git(['push', authUrl, 'HEAD'], repoPath);
          output = output.replace(new RegExp(githubToken, 'g'), '[HIDDEN_TOKEN]');
          break;

        case 'pr':
          if (!githubToken) {
            return res.status(400).json({ success: false, message: 'GitHub Token is required for PR creation.' });
          }
          let remoteUrl = await repoService.git(['config', '--get', 'remote.origin.url'], repoPath).catch(() => null);
          if (!remoteUrl) {
            return res.status(400).json({ success: false, message: 'No remote origin found.' });
          }
          
          // Parse owner and repo from url (e.g. https://github.com/owner/repo.git)
          const match = remoteUrl.trim().match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?$/);
          if (!match) {
            return res.status(400).json({ success: false, message: 'Only GitHub repositories are supported for PR creation right now.' });
          }
          const owner = match[1];
          const repo = match[2];
          
          const branchName = await repoService.git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
          
          // Create PR via GitHub API
          const prResponse = await axios.post(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            title: `AIFA Output for ${agent || 'Agent'}`,
            body: `Automated PR generated by AIFA SDLC Pipeline for session ${session_id}.`,
            head: branchName.trim(),
            base: 'main' // default base
          }, {
            headers: {
              'Authorization': `Bearer ${githubToken}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          }).catch(e => {
            const { ApiError } = require('../middleware/errorHandler');
            const detail = e.response?.data?.errors?.[0]?.message || e.response?.data?.message || e.message;
            throw new ApiError(400, `Failed to create PR: ${detail}`);
          });
          
          output = `Pull request created successfully! URL: ${prResponse.data.html_url}`;
          break;

        default:
          return res.status(400).json({ success: false, message: 'Invalid action.' });
      }

      res.json({ success: true, message: 'Action completed successfully.', output });
    } catch (err) { 
      // Redact token from error message if it somehow leaked
      if (req.body.githubToken) {
        err.message = err.message.replace(new RegExp(req.body.githubToken, 'g'), '[HIDDEN_TOKEN]');
      }
      next(err); 
    }
  }
}

module.exports = new SdlcController();
