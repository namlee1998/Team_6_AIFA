# 03 — Runtime Entrypoints (Frozen Baseline)

> **Status:** OBSERVATION ONLY. Every entrypoint that exists in the
> current source tree, with caller and immediate callee. No analysis of
> correctness.

Conventions:
- **Caller** — the system / actor / function that invokes the entry.
- **Immediate callee** — the next function in the call chain.
- **Purpose** — what the entry exists for (observable, not interpreted).

Every HTTP route is also covered in `05_HTTP_ENDPOINT_INVENTORY.md`; this
document focuses on the **call chain** rather than the route table.

---

## 1. Process entrypoints

### 1.1 `backend/src/server.js` — Node.js HTTP/SSE server

| Property      | Value                                                     |
| ------------- | --------------------------------------------------------- |
| **Entry**     | `if (require.main === module) startServer()`              |
| **Caller**    | `npm run dev` / `node src/server.js` / Docker entrypoint  |
| **Immediate callee** | mounts CORS, JSON parser, request-context, `/api/v1` router, static `/ux-previews` & `/uploads`, error handler; then `startServer()` |
| **Purpose**   | Boot the Express server, verify Prisma connection, run recovery (`gateBridge.markOrphanedPendingInterrupted` → `taskWorker.sweepStale` → `taskWorker.startSweeper` → `SdlcWorkflowService.recoverInterruptedGates`), start `batchJobs` |

### 1.2 `agents/main.py` — Python FastAPI service

| Property      | Value                                                                |
| ------------- | -------------------------------------------------------------------- |
| **Entry**     | `uvicorn main:app` / `python main.py`                               |
| **Caller**    | `agents/Dockerfile` / `docker-compose.yml` / `npm run dev` for agents|
| **Immediate callee** | FastAPI `app`; backend's `AgentService` posts here (`/v1/agent/run`, `/v1/agent/resume`, `/v1/agent/route-rework`) |
| **Purpose**   | Run role agents in-process via LangChain, stream SSE to the backend  |

> The Python service is **not** required when `EXECUTION_PATH=claude-code`
> or `USE_MOCK_AGENTS=true`. The backend talks to it only via
> `services/AgentService.js`.

### 1.3 `frontend/src/main.tsx` — React SPA

| Property      | Value                              |
| ------------- | ---------------------------------- |
| **Entry**     | `index.html` → `main.tsx` → `<App />` |
| **Caller**    | Browser                            |
| **Immediate callee** | `App.tsx` (Router)            |
| **Purpose**   | Mount React + Router; redirect everything to `/sdlc` |

---

## 2. HTTP route entrypoints

All HTTP entrypoints are mounted at `/api/v1` in
`backend/src/server.js:108-109`. Each route binds to a
`controllers/*.js` method via `routes/*.js`.

| Method | Route                                                         | Controller / handler                                  |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------- |
| GET    | `/health`                                                     | inline `(req,res) => res.json({status:'ok'})` (server.js:96-98) |
| POST   | `/api/v1/sdlc/run-architecture-agent`                         | `SdlcController.runArchitectureAgent` (routes/sdlc.js:21) |
| POST   | `/api/v1/sdlc/upload-repo`                                    | `SdlcController.uploadRepo` — **410 removed** (routes/sdlc.js:25, controller:89-95) |
| POST   | `/api/v1/sdlc/run-po-agent`                                   | `SdlcController.runPOAgent` — **410 removed** (routes/sdlc.js:28, controller:76-82) |
| POST   | `/api/v1/sdlc/run-ux-agent`                                   | `SdlcController.runUXAgent` (routes/sdlc.js:29)      |
| POST   | `/api/v1/sdlc/run-dev-agent`                                  | `SdlcController.runDEVAgent` (routes/sdlc.js:30)     |
| POST   | `/api/v1/sdlc/run-qa-agent`                                   | `SdlcController.runQAAgent` (routes/sdlc.js:31)      |
| POST   | `/api/v1/sdlc/tasks/:task_id/gate-decision`                    | `SdlcController.submitGateDecision` (routes/sdlc.js:35) |
| POST   | `/api/v1/sdlc/tasks/:task_id/decision`                        | `SdlcController.submitStructuredDecision` (routes/sdlc.js:37) |
| POST   | `/api/v1/sdlc/tasks/:task_id/cancel`                          | `SdlcController.cancelTask` (routes/sdlc.js:39)      |
| POST   | `/api/v1/sdlc/session/:session_id/git-action`                 | `SdlcController.executeGitAction` (routes/sdlc.js:42) |
| GET    | `/api/v1/sdlc/approvals?task_id=...`                          | `SdlcController.listPendingApprovals` (routes/sdlc.js:47) |
| POST   | `/api/v1/sdlc/approvals/:approval_id`                         | `SdlcController.resolveApproval` (routes/sdlc.js:48) |
| GET    | `/api/v1/sdlc/interventions`                                  | `SdlcController.listAllInterventions` (routes/sdlc.js:49) |
| POST   | `/api/v1/sdlc/output-review/:approval_id`                     | `SdlcController.resolveOutputReviewGate` (routes/sdlc.js:53) |
| GET    | `/api/v1/sdlc/tasks/:task_id`                                 | `SdlcController.getTaskStatus` (routes/sdlc.js:56)   |
| GET    | `/api/v1/sdlc/tasks/:task_id/events`                          | `SdlcController.getTaskEvents` (routes/sdlc.js:57)   |
| GET    | `/api/v1/sdlc/status/:task_id`                                | `SdlcController.streamStatus` — **410 deprecated** (routes/sdlc.js:58, controller:453-462) |
| GET    | `/api/v1/sdlc/pipeline/:workflowId`                           | `SdlcController.getPipelineStatus` (routes/sdlc.js:61) |
| GET    | `/api/v1/sdlc/stream/:sessionId`                              | `SdlcController.streamPipelineStatus` (SSE — routes/sdlc.js:63) |
| GET    | `/api/v1/sdlc/workflow-status?project_id=...`                 | `SdlcController.getWorkflowStatus` (routes/sdlc.js:67) |
| GET    | `/api/v1/sdlc/projects/:project_id/sessions`                  | `SdlcController.listSessions` (routes/sdlc.js:69)    |
| GET    | `/api/v1/sdlc/sessions/:session_id/final-review-packet`       | `SdlcController.getFinalReviewPacket` (routes/sdlc.js:70) |
| POST   | `/api/v1/sdlc/sessions/:session_id/release-decision`          | `SdlcController.submitReleaseDecision` (routes/sdlc.js:71) |
| GET    | `/api/v1/sdlc/sessions/:session_id/release-files/:file_name`  | `SdlcController.downloadReleaseFile` (routes/sdlc.js:72) |
| GET    | `/api/v1/sdlc/audit-trail/:project_id`                        | `SdlcController.getAuditTrail` (routes/sdlc.js:73)   |
| GET    | `/api/v1/sdlc/workflow/:id/timeline`                          | `SdlcController.getTimeline` (routes/sdlc.js:75)     |
| GET    | `/api/v1/sdlc/projects/:project_id/metrics`                   | `SdlcController.getWorkflowMetrics` (routes/sdlc.js:76) |
| GET    | `/api/v1/sdlc/projects/:project_id/artifacts`                 | `SdlcController.getProjectArtifacts` (routes/sdlc.js:77) |
| GET    | `/api/v1/sdlc/dev/projects/:project_id/artifacts`             | `SdlcController.getProjectArtifacts` (routes/sdlc.js:79) |
| GET    | `/api/v1/sdlc/dev/projects/:projectId/health`                 | `SdlcController.getProjectHealth` (routes/sdlc.js:82) |
| GET    | `/api/v1/sdlc/dev/projects/:projectId/pending-approvals`      | `SdlcController.getPendingToolApprovals` (routes/sdlc.js:85) |
| POST   | `/api/v1/sdlc/dev/tasks/:taskId/approve-tool`                 | `SdlcController.approveToolCall` (routes/sdlc.js:88) |
| POST   | `/api/v1/sdlc/dev/tasks/:task_id/hitl`                        | `SdlcController.submitHitlDecision` (routes/sdlc.js:91) |
| GET    | `/api/v1/sdlc/dev/mock-scenario`                              | `SdlcController.getMockScenario` (routes/sdlc.js:94) |
| GET    | `/api/v1/sdlc/dev/health`                                     | `SdlcController.getProjectHealth` (routes/sdlc.js:95) |
| POST   | `/api/v1/sdlc/dev/settings/env`                               | `SdlcController.updateEnvSettings` (routes/sdlc.js:96) |
| POST   | `/api/v1/sdlc/demo/seed-board`                                | `SdlcController.seedDemoBoard` (routes/sdlc.js:99)   |
| GET    | `/api/v1/sdlc/demo/board`                                     | `SdlcController.getDemoBoard` (routes/sdlc.js:100)   |
| GET    | `/api/v1/sdlc/demo/flow/:project_id/ux-doc`                    | `SdlcController.getDemoUxDoc` (routes/sdlc.js:101)   |
| POST   | `/api/v1/sdlc/demo/flow/:project_id/retry`                    | `SdlcController.retryDemoFlow` (routes/sdlc.js:102)  |
| GET    | `/api/v1/sdlc/projects/:project_id/backlog`                   | `SdlcController.getBacklogs` (routes/sdlc.js:105)    |
| POST   | `/api/v1/sdlc/projects/:project_id/backlog`                   | `SdlcController.createBacklog` (routes/sdlc.js:106)  |
| PATCH  | `/api/v1/sdlc/backlog/:id/move`                               | `SdlcController.moveBacklog` (routes/sdlc.js:107)    |
| GET    | `/api/v1/projects`                                            | `ProjectController.list` (routes/projects.js:6)      |
| POST   | `/api/v1/projects`                                            | `ProjectController.create`                           |
| PATCH  | `/api/v1/projects/:id`                                        | `ProjectController.rename`                           |
| DELETE | `/api/v1/projects/:id`                                        | `ProjectController.delete`                           |
| GET    | `/api/v1/documents`                                           | `DocumentController.list`                            |
| POST   | `/api/v1/documents/upload`                                    | `DocumentController.upload` (multer `upload.single('file')`) |
| PATCH  | `/api/v1/documents/:id/move`                                  | `DocumentController.move`                            |
| PATCH  | `/api/v1/documents/:id`                                       | `DocumentController.rename`                          |
| GET    | `/api/v1/documents/:id/preview`                               | `DocumentController.getPreviewUrl`                   |
| GET    | `/api/v1/documents/:id/download`                              | `DocumentController.download`                        |
| GET    | `/api/v1/documents/:id/content`                               | `DocumentController.getContent`                      |
| GET    | `/api/v1/documents/:id`                                       | `DocumentController.getById`                         |
| DELETE | `/api/v1/documents/:id`                                       | `DocumentController.delete`                          |
| GET    | `/api/v1/folders`                                             | `FolderController.list`                              |
| POST   | `/api/v1/folders`                                             | `FolderController.create`                            |
| PATCH  | `/api/v1/folders/:id/move`                                    | `FolderController.move`                              |
| PATCH  | `/api/v1/folders/:id`                                         | `FolderController.rename`                            |
| DELETE | `/api/v1/folders/:id`                                         | `FolderController.delete`                            |
| GET    | `/api/v1/tree`                                                | `TreeController.getTree`                             |
| GET    | `/api/v1/sessions/:page`                                      | `SessionStateController.getState`                    |
| POST   | `/api/v1/sessions/:page`                                      | `SessionStateController.saveState`                   |
| DELETE | `/api/v1/sessions/:page`                                      | `SessionStateController.deleteState`                 |

### 2.1 SSE transport (canonical)

| Route                       | Controller                       | Wire shape                            |
| --------------------------- | -------------------------------- | ------------------------------------- |
| `GET /api/v1/sdlc/stream/:sessionId` | `SdlcController.streamPipelineStatus` (controller:286-406) | `text/event-stream`; canonical EventEnvelope JSON; SSE `id:` = envelope.sequence |

Steps on each request:
1. Subscribe `eventBus.subscribeProject(projectId, sendEnvelope)` so live
   envelopes fan out.
2. Replay `AgentEvent.list({ sessionId, afterSequence })` from
   `lastSeq = req.headers['last-event-id'] ?? req.query.after_sequence ?? 0`.
3. Publish `session_started` (or `session_resumed` on reconnect) via
   `publishEvent`.
4. 15-second `: heartbeat\n\n` keep-alive.
5. On `req.on('close')`, unsubscribe and end.

Terminal events (`pipeline_completed` / `pipeline_failed`) are owned by
the workflow code (`SdlcWorkflowService` / `releaseManager`); the SSE
controller never publishes them.

---

## 3. Server-side background work

| Interval / trigger               | Caller (file)                                       | Work performed                                                   |
| -------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `setInterval(sweep, STALE_MS=60s)` | `taskWorkerService.startSweeper` (taskWorkerService.js:171-175) | `taskWorker.sweepStale()` reclaims tasks with expired heartbeat |
| `GATE_TIMEOUT_MS=600s`           | `gateBridge.requestGate` (gateBridge.js:32-66)      | Auto-reject gate on timeout; idempotent                           |
| `TOOL_PERMISSION_TIMEOUT_MS`     | `claudePermissionDispatcher.handleTool`              | Reject tool gate on timeout                                       |
| `CLARIFYING_QUESTION_TIMEOUT_MS` | `claudePermissionDispatcher.handleQuestion`          | Auto-answer clarifying question on timeout                        |
| Boot                             | `server.js:122-136`                                 | `markOrphanedPendingInterrupted` → `taskWorker.sweepStale` → `taskWorker.startSweeper` → `SdlcWorkflowService.recoverInterruptedGates` |
| Boot                             | `batchJob.startBatchJobs` (jobs/batchJob.js:1-5)     | Logs "Batch jobs disabled in local-first single-user mode." — no-op |
| `AGENT_POLICY[task.type].timeout_seconds` | `agentDispatcher.runAgent` (line ~319)        | `taskWorker.beginRun({ budgetMs, onTimeout })`; fires `handleTaskTimeout` |
| Claude Code runner               | `claudeCodeRunner.runAgent` (claudeCodeRunner.js)    | `gateClock.enter/exit` brackets human-gate waits so the per-run timeout never fires during a paused gate |
| SDK transient errors             | `claudeCodeRunner.runAgent` retry loop              | Catches transient socket / 5xx errors and retries the run         |

---

## 4. Agent dispatch entrypoints

| Entry point                        | Source                                                | Caller                                                              | Callee                                                            | Purpose                                              |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `EXECUTION_PATH=claude-code`       | `agentDispatcher.runAgent` (line ~355)                | `SdlcWorkflowService._runAgent` → `agentDispatcher.runAgent`        | `agentDispatcher.runClaudeCodePath` → `claudeCodeRunner.runAgent` | Local Claude Agent SDK adapter                       |
| `EXECUTION_PATH=codex`             | `agentDispatcher.runAgent` (line ~330)                | same                                                                | `agents/codexRunner.runAgent`                                     | Codex CLI adapter                                    |
| `EXECUTION_PATH=langchain` + `USE_MOCK_AGENTS=true` | `agentDispatcher.runAgent` (line ~383)  | same                                                                | `agentDispatcher.buildMockOutput` (reads `mock-data/<role>/`)     | Deterministic mock from `mock-data/`                 |
| `EXECUTION_PATH=langchain` (default) | `agentDispatcher.runAgent` (line ~400)              | same                                                                | `AgentService.runAgent` → `axios.post('/v1/agent/run')` (Python)  | Real LangChain run via Python agents service         |
| `USE_MOCK_CLAUDE_CODE=true`        | `claudeCodeRunner.runAgent` (claudeCodeRunner.js:514) | direct (when `EXECUTION_PATH=claude-code` and mock enabled)         | `agentDispatcher.buildMockOutput`                                 | Short-circuits the SDK with mock output              |
| `archAskEnforcer.enforceAskUserQuestion` | `archAskEnforcer.js`                          | `agentDispatcher.runClaudeCodePath`                                  | re-runs `runOnce` with feedback block when BLOCKER remains        | AskUserQuestion enforcement loop (5 roles)           |

---

## 5. Event-bus entrypoints

| Caller                                                    | Function called               | Description                                                            |
| --------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `gateBridge.requestGate`                                  | `eventPublisher.publishEvent('gate_pending', ...)` | New pending gate → SSE consumers receive `gate_pending` envelope |
| `gateBridge.resolveGate`                                  | `eventPublisher.publishEvent('gate_resolved', ...)`| Gate decision → SSE consumers receive `gate_resolved` envelope    |
| `releaseManager.submitReleaseDecision` (APPROVE branch)    | `eventPublisher.publishEvent('pipeline_completed', ...)` | Terminal success event — single emitter |
| `taskLifecycleService.transition` / `record`              | `eventPublisher.publishEvent` (via `publishLifecycle`) | State-machine transition → envelope persisted + published |
| `SdlcWorkflowService._recordGateAudit` (onGate audit)      | `eventPublisher.publishEvent('runtime_log', ...)`   | Gate audit trail entry                                                  |
| `SdlcController.streamPipelineStatus` (SSE bootstrap)     | `eventPublisher.publishEvent('session_started' / 'session_resumed', ...)` | SSE snapshot envelope |
| `SdlcWorkflowService._saveAgentData` (`auto_commit` log)  | `eventPublisher.publishEvent('runtime_log', ...)`   | Per-agent commit log                                                    |

### 5.1 Subscribers

| Subscriber                                      | Subscription path                       | Action                       |
| ----------------------------------------------- | --------------------------------------- | ---------------------------- |
| `SdlcController.streamPipelineStatus` (SSE)    | `eventBus.subscribeProject(projectId)`  | Forward envelope over SSE    |
| (legacy) `SdlcWorkflowService` helpers          | `eventBus.subscribe(sessionId)`         | Test / older code paths      |

---

## 6. Tool-dispatcher entrypoints

| Entry                                    | File                                                     | Purpose                                                          |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `claudePermissionDispatcher.dispatch`     | `agents/claudePermissionDispatcher.js:249-271`            | SDK `canUseTool` callback. Branches on `CLAUDE_CODE_INTERACTIVE_GATES`: non-interactive (`auto`/`deny`), `AskUserQuestion` → question gate, write/edit/bash → tool gate |
| `claudePermissionDispatcher.handleNonInteractive` | `claudePermissionDispatcher.js:118-146`            | `CLAUDE_CODE_INTERACTIVE_GATES!=true` path: auto-answer questions, audit GATE_AUTO/GATE_BLOCK |
| `claudePermissionDispatcher.handleQuestion`     | `claudePermissionDispatcher.js:158-188`            | `kind='question'` pause/resume via `gateBridge.requestGate`     |
| `claudePermissionDispatcher.handleTool`          | `claudePermissionDispatcher.js:190-247`            | Risk-classified tool approval via `gateBridge.requestGate`     |
| `claudePermissionDispatcher.classifyReadOnly`    | `claudePermissionDispatcher.js:41-51`             | Read-only tool → auto/block based on path safety                |
| `riskClassifier.classifyAction`                 | `services/riskClassifier.js:49-113`                | Maps tool + input → `auto` / `approval` / `block`               |

---

## 7. Workflow orchestrator entrypoints

| Function                            | Caller                                                | Callee                                                            |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `SdlcWorkflowService.runArchitectureAgent` | `SdlcController.runArchitectureAgent`        | `workflowOrchestrator.runArchitectureAgent`                       |
| `SdlcWorkflowService.runPOAgent`    | `SdlcController.runPOAgent` (410) or auto-advance from ARCH | `workflowOrchestrator.runPOAgent`                            |
| `SdlcWorkflowService.runUXAgent`    | `SdlcController.runUXAgent` or auto-advance from PO   | `workflowOrchestrator.runUXAgent`                                 |
| `SdlcWorkflowService.runDEVAgent`   | `SdlcController.runDEVAgent` or auto-advance from UX  | `workflowOrchestrator.runDEVAgent`                                |
| `SdlcWorkflowService.runQAAgent`    | `SdlcController.runQAAgent` or auto-advance from DEV  | `workflowOrchestrator.runQAAgent`                                 |
| `SdlcWorkflowService._startNextAgentIfAvailable` | `_recordApprovedHandoff` (after approve) | `workflowOrchestrator.startNextAgentIfAvailable`               |
| `SdlcWorkflowService._runAgent`     | `workflowOrchestrator.run*Agent`                      | `agentDispatcher.runAgent` (selects mock/codex/claude-code/langchain) |

---

## 8. CLI / scripts at repo root

| Script                                            | Description                                              |
| ------------------------------------------------- | -------------------------------------------------------- |
| `q-all-ux-truncation.js`                          | One-off diagnostic for UX mockup truncation (NOT wired)  |
| `q-find-tasks.js`                                 | One-off diagnostic for task state                        |
| `q-stop-reason-correlation.js`                    | One-off diagnostic for Claude stop reasons               |
| `q-ux-evidence.js` / `q-ux-rerun-evidence.js`     | One-off UX evidence diagnostic                           |
| `backend/arch_runtime.js`                         | Legacy entry point (see 08_CURRENT_KNOWN_ISSUES)         |
| `backend/scripts/*`                               | Legacy scripts                                           |

None of these are wired into `npm run dev` / `npm run test`.

---

## 9. Frontend actions entrypoints

Every user action goes through one of these:

| Action                                              | Store method                                            | HTTP call                                   |
| --------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| Start pipeline                                      | `useWorkflowStore.startPipeline(projectId, repoUrl, request)` | `sdlcApi.startPipeline` (POST `/run-architecture-agent`) |
| Resolve gate                                        | `useWorkflowStore.resolveGate` / `resolveOutputReviewGate` / `resolveClarification` / `resolveToolGate` | `sdlcApi.resolveGate` / `resolveOutputReviewGate` / `resolveApproval` |
| Submit release decision                             | `useWorkflowStore.releaseDecision` (mints `decisionId = crypto.randomUUID()`) | `sdlcApi.releaseDecision`                  |
| Cleanup / reset                                     | `useWorkflowStore.cleanupSession` / `resetAll`          | (no HTTP — pure SSE teardown)               |
| Subscribe to SSE                                    | `useWorkflowStore._subscribeSession(sessionId)`         | `sseClient.subscribe` on `/sdlc/stream/:sessionId` |
| Apply envelope                                      | `useWorkflowStore._applySseEvent(sessionId, envelope)`  | (no HTTP — reducer)                         |

The store comment is explicit: HTTP commands MUST NOT mutate local state
on success; the SSE stream is the authoritative source.

---

## 10. Boot-time event ordering (current code)

`server.js:116-153`:

```
startServer()
  ├─ connectPrismaWithTimeout() (5s race)
  ├─ gateBridge.markOrphanedPendingInterrupted()
  ├─ taskWorker.sweepStale({ reason: 'orphaned by backend restart' })
  ├─ taskWorker.startSweeper()
  ├─ SdlcWorkflowService.recoverInterruptedGates()
  ├─ app.listen(PORT)         // [if NODE_ENV=test, force 127.0.0.1]
  └─ startBatchJobs()         // no-op
```

`process.on('unhandledRejection')` and `process.on('uncaughtException')`
behave differently in production (log + Sentry + `process.exit(1)`)
vs. development (log + Sentry + continue).