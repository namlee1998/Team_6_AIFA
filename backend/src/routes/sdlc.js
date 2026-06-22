// SDLC HTTP route map.
//
// Beginner reading guide: routes only attach middleware and delegate to
// SdlcController. Follow a route into the controller, then into
// SdlcWorkflowService for business behavior.

const express = require('express');
const multer = require('multer');
const SdlcController = require('../controllers/SdlcController');
const authenticateDev = require('../middleware/authMiddleware');

const router = express.Router();

// Folder upload ("Open folder" flow): in-memory, generous limits for a repo.
const repoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 8000 },
});

// ── IntentGate ─────────────────────────────────────────────────────────────
router.post('/run-intent-agent', SdlcController.runIntentAgent.bind(SdlcController));

// ── Repo folder upload (T1.4 "Open folder") ───────────────────────────────
// POST /api/v1/sdlc/upload-repo  (multipart: files[] + paths[] + project_id)
router.post('/upload-repo', repoUpload.array('files'), SdlcController.uploadRepo.bind(SdlcController));

// ── Run Agents ────────────────────────────────────────────────────────────
router.post('/run-po-agent', SdlcController.runPOAgent.bind(SdlcController));
router.post('/run-ux-agent', SdlcController.runUXAgent.bind(SdlcController));
router.post('/run-dev-agent', SdlcController.runDEVAgent.bind(SdlcController));
router.post('/run-qa-agent', SdlcController.runQAAgent.bind(SdlcController));

// ── HITL Gate ────────────────────────────────────────────────────────────
// POST /api/v1/sdlc/tasks/:task_id/gate-decision  { decision, comment }
router.post('/tasks/:task_id/gate-decision', SdlcController.submitGateDecision.bind(SdlcController));
// Structured HITL (plan 2.3/2.8): { decision_id, base_output_version, action, payload, comment }
router.post('/tasks/:task_id/decision', SdlcController.submitStructuredDecision.bind(SdlcController));
// Cancel a running/awaiting task (DMO — timeout & cancel)
router.post('/tasks/:task_id/cancel', SdlcController.cancelTask.bind(SdlcController));

// ── Gate approvals (T2.4) — claude-code onGate pending gates ───────────────
// GET  /api/v1/sdlc/approvals?task_id=xxx   list pending gates
// POST /api/v1/sdlc/approvals/:approval_id  { action, comment } | { answers }
router.get('/approvals', SdlcController.listPendingApprovals.bind(SdlcController));
router.post('/approvals/:approval_id', SdlcController.resolveApproval.bind(SdlcController));
router.get('/interventions', SdlcController.listAllInterventions.bind(SdlcController));

// ── Output review gates — always-on approve/reject after every agent finishes ─
// POST /api/v1/sdlc/output-review/:approval_id  { action:'approve'|'reject', comment? }
router.post('/output-review/:approval_id', SdlcController.resolveOutputReviewGate.bind(SdlcController));

// ── Task Status ──────────────────────────────────────────────────────────
router.get('/tasks/:task_id', SdlcController.getTaskStatus.bind(SdlcController));
router.get('/tasks/:task_id/events', SdlcController.getTaskEvents.bind(SdlcController));
router.get('/status/:task_id', SdlcController.streamStatus.bind(SdlcController));   // SSE

// ── V4 Pipeline ──────────────────────────────────────────────────────────
router.get('/pipeline/:workflowId', SdlcController.getPipelineStatus.bind(SdlcController));
router.get('/stream/:workflowId', SdlcController.streamPipelineStatus.bind(SdlcController));

// ── Workflow-level views ──────────────────────────────────────────────────
// GET /api/v1/sdlc/workflow-status?project_id=xxx
router.get('/workflow-status', SdlcController.getWorkflowStatus.bind(SdlcController));
// ── Sessions (a project can run several feature-request pipelines at once) ─
router.get('/projects/:project_id/sessions', SdlcController.listSessions.bind(SdlcController));
router.get('/sessions/:session_id/final-review-packet', SdlcController.getFinalReviewPacket.bind(SdlcController));
router.post('/sessions/:session_id/release-decision', SdlcController.submitReleaseDecision.bind(SdlcController));
router.get('/sessions/:session_id/release-files/:file_name', SdlcController.downloadReleaseFile.bind(SdlcController));
router.get('/audit-trail/:project_id', SdlcController.getAuditTrail.bind(SdlcController));
// T7: alias — same event timeline as audit-trail, UI-friendly path.
router.get('/workflow/:id/timeline', SdlcController.getTimeline.bind(SdlcController));
router.get('/projects/:project_id/metrics', SdlcController.getWorkflowMetrics.bind(SdlcController));
router.get('/projects/:project_id/artifacts', SdlcController.getProjectArtifacts.bind(SdlcController));

router.get('/dev/projects/:project_id/artifacts', authenticateDev, SdlcController.getProjectArtifacts.bind(SdlcController));

// T9 - Get Project Health
router.get('/dev/projects/:projectId/health', authenticateDev, SdlcController.getProjectHealth.bind(SdlcController));

// Pending Tool Approvals
router.get('/dev/projects/:projectId/pending-approvals', authenticateDev, SdlcController.getPendingToolApprovals.bind(SdlcController));

// Tool Approval
router.post('/dev/tasks/:taskId/approve-tool', authenticateDev, SdlcController.approveToolCall.bind(SdlcController));

// Open file
router.post('/dev/projects/:projectId/open-file', authenticateDev, SdlcController.openFile.bind(SdlcController));

// T5 - Hitl Routes
router.post('/dev/tasks/:task_id/hitl', authenticateDev, SdlcController.submitHitlDecision.bind(SdlcController));

// ── Dev-only: demo scenario selector (MOCK_SCENARIO) ───────────────────────
router.get('/dev/mock-scenario', SdlcController.getMockScenario.bind(SdlcController));
router.get('/dev/health', SdlcController.getProjectHealth.bind(SdlcController));
router.post('/dev/settings/env', SdlcController.updateEnvSettings.bind(SdlcController));

// ── Demo Board ───────────────────────────────────────────────────────────
router.post('/demo/seed-board', SdlcController.seedDemoBoard.bind(SdlcController));
router.get('/demo/board', SdlcController.getDemoBoard.bind(SdlcController));
router.get('/demo/flow/:project_id/ux-doc', SdlcController.getDemoUxDoc.bind(SdlcController));
router.post('/demo/flow/:project_id/retry', SdlcController.retryDemoFlow.bind(SdlcController));

// ── Backlog / Kanban ──────────────────────────────────────────────────────
router.get('/projects/:project_id/backlog', SdlcController.getBacklogs.bind(SdlcController));
router.post('/projects/:project_id/backlog', SdlcController.createBacklog.bind(SdlcController));
router.patch('/backlog/:id/move', SdlcController.moveBacklog.bind(SdlcController));


module.exports = router;

