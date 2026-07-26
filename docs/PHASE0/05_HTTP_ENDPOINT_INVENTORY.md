# 05 — HTTP Endpoint Inventory (Frozen Baseline)

> **Status:** OBSERVATION ONLY. Routes are listed verbatim from
> `backend/src/routes/*.js` and `backend/src/controllers/SdlcController.js`.
> No analysis. No commentary on correctness.

For every route:
- **Mount path** — full URL after `/api/v1`.
- **Method**
- **Controller method / service entry**
- **Service(s) it calls**
- **Observable response**

Routes are grouped by mount path (`/api/v1/...`). All routes are
authenticated via the local-dummy `authMiddleware` (CLAUDE.md §4 says
"Auth Bypassed: All auth, quota, admin, and membership controls are
deleted").

---

## 1. `/health` (unmounted)

| Property        | Value                                                       |
| --------------- | ----------------------------------------------------------- |
| **Method**      | GET                                                         |
| **Handler**     | inline in `server.js:96-98`                                |
| **Service**     | none                                                        |
| **Response**    | `{ status:'ok', timestamp:<ISO8601> }`                      |

---

## 2. `/api/v1/sdlc/*` — SDLC control plane

All routes from `backend/src/routes/sdlc.js`.

### 2.1 Architecture & repo upload

| Method | Mount path                                  | Controller / handler                              | Service(s)                                                                                  | Response                                                   |
| ------ | ------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| POST   | `/sdlc/run-architecture-agent`              | `SdlcController.runArchitectureAgent`              | `repoService.validateRepoUrl`, `SdlcWorkflowService.runArchitectureAgent` → `workflowOrchestrator.runArchitectureAgent` | 202 `{ task_id, session_id, status, type }` |
| POST   | `/sdlc/upload-repo`                         | `SdlcController.uploadRepo` (hardcoded 410)        | none                                                                                         | 410 `{ status:'error', code:'UPLOAD_REPO_REMOVED', message }` |

### 2.2 Run agents

| Method | Mount path                | Controller / handler                  | Service                                                  | Response                                |
| ------ | ------------------------- | ------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| POST   | `/sdlc/run-po-agent`      | `SdlcController.runPOAgent` (410)     | none                                                     | 410 `PO_AGENT_ENTRY_REMOVED`            |
| POST   | `/sdlc/run-ux-agent`      | `SdlcController.runUXAgent`           | `SdlcWorkflowService.runUXAgent` → `workflowOrchestrator.runUXAgent` | 202 `{ task_id, status, type }`         |
| POST   | `/sdlc/run-dev-agent`     | `SdlcController.runDEVAgent`          | `SdlcWorkflowService.runDEVAgent` → `workflowOrchestrator.runDEVAgent` | 202 `{ task_id, status, type }`         |
| POST   | `/sdlc/run-qa-agent`      | `SdlcController.runQAAgent`           | `SdlcWorkflowService.runQAAgent` → `workflowOrchestrator.runQAAgent` | 202 `{ task_id, status, type }`         |

### 2.3 HITL Gate (per-task)

| Method | Mount path                                          | Controller / handler                              | Service                                                                                                  | Response                                                                              |
| ------ | --------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| POST   | `/sdlc/tasks/:task_id/gate-decision`                | `submitGateDecision`                              | `SdlcWorkflowService.submitGateDecision`                                                                  | `{ status:'success', data:{ task_id, gate, decision, comment, created_at } }`        |
| POST   | `/sdlc/tasks/:task_id/decision`                     | `submitStructuredDecision`                        | `SdlcWorkflowService.submitStructuredDecision`                                                            | `{ status:'success', data:{ task_id, action, decision, decision_id, output_version, idempotent_replay, escalated, validation, rerun_task_id?, rerun_task_type? } }` |
| POST   | `/sdlc/tasks/:task_id/cancel`                       | `cancelTask`                                      | `SdlcWorkflowService.cancelTask`                                                                          | `{ status:'success', data:{ taskId, status:'cancelled' } }`                         |

### 2.4 Git actions (legacy)

| Method | Mount path                                          | Controller / handler                              | Service                                                                                                  | Response                                                                              |
| ------ | --------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| POST   | `/sdlc/session/:session_id/git-action`              | `executeGitAction`                                | `repoService.git` directly + GitHub REST API                                                              | `{ success:true, message, output }`                                                   |

Accepted `action`: `sync`, `commit`, `push`, `pr`.

### 2.5 Gate approvals (onGate)

| Method | Mount path                                  | Controller / handler                              | Service                                                                                              | Response                                                            |
| ------ | ------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/sdlc/approvals?task_id=...&project_id=...` | `listPendingApprovals`                           | `SdlcWorkflowService.listPendingGates`                                                              | `{ status:'success', data:{ pending: [...] } }`                     |
| POST   | `/sdlc/approvals/:approval_id`              | `resolveApproval`                                | `SdlcWorkflowService.resolveApproval`                                                               | `{ status:'success', data: { approvalId, resolved, kind, action? } }` |
| GET    | `/sdlc/interventions?project_id=...`         | `listAllInterventions`                           | `SdlcWorkflowService.getAllInterventions`                                                            | `{ status:'success', data: [ ... ] }`                                |

### 2.6 Output review gates

| Method | Mount path                                          | Controller / handler                              | Service                                                                                  | Response                                                                              |
| ------ | --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| POST   | `/sdlc/output-review/:approval_id`                 | `resolveOutputReviewGate`                         | `SdlcWorkflowService.resolveOutputReviewGate`                                            | `{ status:'success', data: { approvalId, action, task, hitlDecision, [idempotentReplay?], [rerunTask?] } }` |

### 2.7 Task status (read)

| Method | Mount path                                  | Controller / handler                              | Service                                                                                  | Response                                                                              |
| ------ | ------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/sdlc/tasks/:task_id`                       | `getTaskStatus`                                   | `SdlcWorkflowService.getTaskStatus`                                                     | `{ status:'success', data: <task envelope> }` (includes `artifacts`, `gate_evaluation`, `pending_gates`, `agent_output`, `approved_output`, `output_version`, `retry_count`, `gate_mode`, …) |
| GET    | `/sdlc/tasks/:task_id/events`                | `getTaskEvents`                                   | `SdlcWorkflowService.getTaskEvents` → `workflowQueries.getTaskEvents`                  | `{ status:'success', data:{ events: [...] } }`                                          |
| GET    | `/sdlc/status/:task_id`                      | `streamStatus` (410)                              | none                                                                                     | 410 `STREAM_STATUS_DEPRECATED`                                                          |
| GET    | `/sdlc/pipeline/:workflowId`                 | `getPipelineStatus`                               | `SdlcWorkflowService.getPipelineResponse`                                                | `{ status:'success', data: <PipelineResponse> }` (workflowId, projectId, status, pipelinePhases, pendingGates, auditLog, qaResult, releaseStatus, repoInfo) |
| GET    | `/sdlc/stream/:sessionId` (SSE)              | `streamPipelineStatus`                            | `SdlcWorkflowService.getPipelineResponse` (snapshot) + `AgentEvent.list` (replay) + `eventBus.subscribeProject` (live) + `publishEvent('session_started' / 'session_resumed')` | `text/event-stream`; every frame is `id: <seq>\ndata: <EventEnvelope>\n\n`; heartbeat `: heartbeat\n\n` every 15s |

### 2.8 Workflow-level reads

| Method | Mount path                                          | Controller / handler                              | Service                                                                                  | Response                                                                              |
| ------ | --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/sdlc/workflow-status?session_id=...`              | `getWorkflowStatus`                               | `SdlcWorkflowService.getWorkflowStatus`                                                  | `{ status:'success', data: <legacy workflow status> }` (projectId, sessionId, featureRequest, pipelineLock, phases, releaseGate, currentPhase) |
| GET    | `/sdlc/projects/:project_id/sessions`               | `listSessions`                                    | `SdlcWorkflowService.listSessions` → `workflowQueries.listSessions`                      | `{ status:'success', data: [ ...sessions ] }`                                          |
| GET    | `/sdlc/sessions/:session_id/final-review-packet`    | `getFinalReviewPacket`                            | `SdlcWorkflowService.getFinalReviewPacket` → `workflowQueries.getFinalReviewPacket`     | `{ status:'success', data: <packet> }`                                                 |
| POST   | `/sdlc/sessions/:session_id/release-decision`       | `submitReleaseDecision`                           | `SdlcWorkflowService.submitReleaseDecision` → `releaseManager.submitReleaseDecision`    | `{ status:'success', data: { decision, action, comment, release_status, idempotent_replay?, release_outputs? } }` |
| GET    | `/sdlc/sessions/:session_id/release-files/:file_name` | `downloadReleaseFile`                           | `SdlcWorkflowService.getReleaseFile` → `workflowQueries.getReleaseFile`                  | file stream + `Content-Disposition`                                                    |
| GET    | `/sdlc/audit-trail/:project_id`                     | `getAuditTrail`                                   | `SdlcWorkflowService.getAuditTrail`                                                     | `{ status:'success', data: <audit> }` (events[], phaseTransitions[])                   |
| GET    | `/sdlc/workflow/:id/timeline`                       | `getTimeline` (alias of getAuditTrail)             | same                                                                                     | same                                                                                  |
| GET    | `/sdlc/projects/:project_id/metrics`                | `getWorkflowMetrics`                              | `SdlcWorkflowService.getWorkflowMetrics` → `workflowQueries.getWorkflowMetrics`        | `{ status:'success', data: <metrics> }`                                                |
| GET    | `/sdlc/projects/:project_id/artifacts`              | `getProjectArtifacts`                             | `SdlcWorkflowService.getProjectArtifacts` → `workflowQueries.getProjectArtifacts`      | shaped payload                                                                       |
| GET    | `/sdlc/dev/projects/:project_id/artifacts`          | same                                              | same                                                                                     | same                                                                                  |
| GET    | `/sdlc/dev/projects/:projectId/health`              | `getProjectHealth`                                | `SdlcWorkflowService.getProjectHealth` → `workflowQueries.getProjectHealth`             | `{ success:true, data: <health> }`                                                    |
| GET    | `/sdlc/dev/projects/:projectId/pending-approvals`   | `getPendingToolApprovals`                         | `SdlcWorkflowService.getPendingToolApprovals`                                            | `{ success:true, data: [ ...tasks with PENDING_TOOL_APPROVAL status ] }`            |
| POST   | `/sdlc/dev/tasks/:taskId/approve-tool`              | `approveToolCall`                                 | `SdlcWorkflowService.resumeTask(taskId, approved, feedback)` → `_resumeAgentStream`     | `{ success:true, message:'Task resumed' }`                                            |
| POST   | `/sdlc/dev/tasks/:task_id/hitl`                     | `submitHitlDecision` (alias of submitGateDecision) | same                                                                                     | same                                                                                  |

### 2.9 Dev-only

| Method | Mount path                                  | Controller / handler         | Service                                                                              | Response                                                              |
| ------ | ------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET    | `/sdlc/dev/mock-scenario`                   | `getMockScenario`            | none (reads `process.env`)                                                          | `{ status:'success', data:{ scenario:'happy_path', mockEnabled, executionPath, available:['happy_path'] } }` |
| GET    | `/sdlc/dev/health`                          | `getProjectHealth`           | same as `/sdlc/dev/projects/:projectId/health`                                       | same                                                                  |
| POST   | `/sdlc/dev/settings/env`                    | `updateEnvSettings`          | `SdlcWorkflowService.updateEnvSettings` (writes to `.env` + `process.env`)          | `{ status:'success' }`                                                |

### 2.10 Demo board

| Method | Mount path                                          | Controller / handler         | Service                                                                              | Response                                                              |
| ------ | --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| POST   | `/sdlc/demo/seed-board`                             | `seedDemoBoard`              | `demoBoardService.seedDemoBoard`                                                     | `{ status:'success', data: <board> }`                                 |
| GET    | `/sdlc/demo/board`                                  | `getDemoBoard`               | `demoBoardService.getDemoBoard`                                                      | `{ status:'success', data: <board> }`                                 |
| GET    | `/sdlc/demo/flow/:project_id/ux-doc`                | `getDemoUxDoc`               | `demoBoardService.getDemoUxDoc`                                                      | shaped payload                                                        |
| POST   | `/sdlc/demo/flow/:project_id/retry`                 | `retryDemoFlow`              | `demoBoardService.retryDemoFlow`                                                     | shaped payload                                                        |

### 2.11 Kanban backlog

| Method | Mount path                                          | Controller / handler         | Service                                                                              | Response                                                              |
| ------ | --------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET    | `/sdlc/projects/:project_id/backlog`                | `getBacklogs`                | `FeatureBacklog.findByProjectId`                                                    | `{ status:'success', data: [...] }`                                   |
| POST   | `/sdlc/projects/:project_id/backlog`                | `createBacklog`              | `FeatureBacklog.create`                                                             | 201 `{ status:'success', data: <row> }`                              |
| PATCH  | `/sdlc/backlog/:id/move`                            | `moveBacklog`                | `FeatureBacklog.updateStatus`                                                       | `{ status:'success', data: <row> }`                                  |

---

## 3. `/api/v1/projects/*` — Project CRUD

Mount: `backend/src/routes/projects.js`. Auth: `authMiddleware`.

| Method | Mount          | Controller            | Service                              | Response        |
| ------ | -------------- | --------------------- | ------------------------------------ | --------------- |
| GET    | `/projects`    | `ProjectController.list`   | `ProjectService.list`         | `[ ...projects ]` |
| POST   | `/projects`    | `ProjectController.create` | `ProjectService.create`        | single project row |
| PATCH  | `/projects/:id`| `ProjectController.rename` | `ProjectService.rename`       | single project row |
| DELETE | `/projects/:id`| `ProjectController.delete` | `ProjectService.delete`       | success         |

---

## 4. `/api/v1/documents/*`

Mount: `backend/src/routes/documents.js`. Auth: `authMiddleware`.

| Method | Mount                              | Controller                | Service                                          | Response      |
| ------ | ---------------------------------- | ------------------------- | ------------------------------------------------ | ------------- |
| GET    | `/documents`                       | `list`                    | `DocumentService.list`                            | list         |
| POST   | `/documents/upload`                | `upload` (multer)         | `DocumentService.upload`                          | document row  |
| PATCH  | `/documents/:id/move`              | `move`                    | `DocumentService.move`                            | updated row   |
| PATCH  | `/documents/:id`                   | `rename`                  | `DocumentService.rename`                          | updated row   |
| GET    | `/documents/:id/preview`           | `getPreviewUrl`           | `DocumentService.getPreviewUrl`                   | `{ url }`     |
| GET    | `/documents/:id/download`          | `download`                | `DocumentService.download`                        | file stream   |
| GET    | `/documents/:id/content`           | `getContent`              | `DocumentService.getContent`                      | file content  |
| GET    | `/documents/:id`                   | `getById`                 | `DocumentService.getById`                         | single row    |
| DELETE | `/documents/:id`                   | `delete`                  | `DocumentService.delete`                          | success       |

---

## 5. `/api/v1/folders/*`

Mount: `backend/src/routes/folders.js`. Auth: `authMiddleware`.

| Method | Mount              | Controller                | Service                              | Response        |
| ------ | ------------------ | ------------------------- | ------------------------------------ | --------------- |
| GET    | `/folders`         | `FolderController.list`   | `FolderService.list`                 | list            |
| POST   | `/folders`         | `FolderController.create` | `FolderService.create`               | single folder row|
| PATCH  | `/folders/:id/move`| `FolderController.move`   | `FolderService.move`                 | updated row     |
| PATCH  | `/folders/:id`     | `FolderController.rename` | `FolderService.rename`               | updated row     |
| DELETE | `/folders/:id`     | `FolderController.delete` | `FolderService.delete`               | success         |

---

## 6. `/api/v1/tree`

Mount: `backend/src/routes/tree.js`. Auth: `authMiddleware`.

| Method | Mount     | Controller          | Service                  | Response        |
| ------ | --------- | ------------------- | ------------------------ | --------------- |
| GET    | `/tree`   | `TreeController.getTree` | `TreeService.getTree` | tree nodes      |

---

## 7. `/api/v1/sessions/*`

Mount: `backend/src/routes/sessions.js`. Auth: `authMiddleware`.
Persists frontend `SessionState`.

| Method | Mount                       | Controller                       | Service                                       | Response        |
| ------ | --------------------------- | -------------------------------- | --------------------------------------------- | --------------- |
| GET    | `/sessions/:page`           | `SessionStateController.getState` | `SessionStateService.getState`               | `SessionState`  |
| POST   | `/sessions/:page`           | `SessionStateController.saveState`| `SessionStateService.saveState`              | stored          |
| DELETE | `/sessions/:page`           | `SessionStateController.deleteState` | `SessionStateService.deleteState`         | success         |

---

## 8. Static / non-API

- `GET /ux-previews/*` — static SVGs from `public/ux-previews/` with
  `Cache-Control: no-store` (server.js:101-103).
- `GET /uploads/*` — static files from `backend/uploads/`
  (server.js:106).
- `/api/v1/*` fallback → `notFoundHandler` returns
  `{ status:'error', message:'Route <METHOD> <URL> not found' }` 404.
- All thrown errors → `errorHandler` returns
  `{ status, code, message, phase, requestId }`.

---

## 9. Out-of-band visibility

The deprecated per-task SSE route `/sdlc/status/:task_id` is the only
explicit 410 in `sdlc.js`. The store/HTTP layer on the frontend still
exposes helpers for it (see `frontend/src/services/api/sdlcLegacy.ts`)
but the server rejects it.

The legacy `socketService.js` is fully removed — `git status` notes the
file is deleted (`D backend/src/services/socketService.js`), and no SSE
or websocket reaches `socket.io`.

---

## 10. Auth bypass

Every API route under `/api/v1/...` passes through `authMiddleware`
(routes/index.js:8-18). The middleware unconditionally sets
`req.user = { id:'local-user-id', email:'local-user@example.com', role:'authenticated' }`
and `req.accessToken='local-dummy-token'`.

`MembershipService` calls in service code resolve to a local stub:
```js
const MembershipService = {
  requireProjectRole: async () => ({ role: 'owner' }),
  listAccessibleProjectIds: async () => [],
  getUserProjectRole: async () => 'owner',
  createOwnerMembership: async () => { },
};
```
This stub is declared inline in `SdlcWorkflowService.js:20-31` and in
`releaseManager.js:33-38`. Even when an authorisation path exists, it
always grants owner/editor.

---

## 11. Removed/deprecated endpoints (HTTP 410)

| Path                              | Code                       | Source                                                    |
| --------------------------------- | -------------------------- | --------------------------------------------------------- |
| `POST /sdlc/upload-repo`          | `UPLOAD_REPO_REMOVED`      | `SdlcController.uploadRepo` (controller:89-95)            |
| `POST /sdlc/run-po-agent`         | `PO_AGENT_ENTRY_REMOVED`   | `SdlcController.runPOAgent` (controller:76-82)            |
| `GET /sdlc/status/:task_id`       | `STREAM_STATUS_DEPRECATED` | `SdlcController.streamStatus` (controller:453-462)        |