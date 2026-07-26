# 01 — Pipeline Trace (Phase 1 Audit)

> **Status:** READ-ONLY AUDIT. No fixes. No proposals.
> Every observation is backed by a file:line citation. Statements that
> cannot be confirmed from the source tree are marked **NOT VERIFIED**.
>
> Source: current `HEAD` on branch `namw6`, captured 2026-07-15.

This document traces every transition in the canonical chain:

```
Project Creation
   ↓
Architecture
   ↓
PO
   ↓
UX
   ↓
DEV
   ↓
QA
   ↓
Release
```

The chain is fixed. There are no skip paths. There are no UX-skip or
QA-skip branches in the current code.

---

## Stage 0 — Project Creation

### HTTP entry

| Method | Mount                                  | Controller / handler                          | Service                                          |
| ------ | -------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| GET    | `/api/v1/projects`                     | `ProjectController.list` (controllers/ProjectController.js:3-20) | `ProjectService.listProjects` (services/ProjectService.js) |
| POST   | `/api/v1/projects`                     | `ProjectController.create` (controllers/ProjectController.js:22-38) | `ProjectService.createProject(name, user)` |
| PATCH  | `/api/v1/projects/:id`                 | `ProjectController.rename` (controllers/ProjectController.js:40-57) | `ProjectService.renameProject(id, name, user)` |
| DELETE | `/api/v1/projects/:id`                 | `ProjectController.delete` (controllers/ProjectController.js:59-70) | `ProjectService.deleteProject(id, user)` |

Routes mount: `backend/src/routes/projects.js`.

### Database writes

- `Project.create` →
  `ProjectService.createProject` → `prisma.project.create({ data: { id,
  name, description?, createdBy: user?.id, createdAt, updatedAt } })`
  (schema.prisma:24-34).
- Membership rows are NOT created — the inline
  `MembershipService.createOwnerMembership` stub at
  `SdlcWorkflowService.js:25` is a no-op and no service ever calls a
  real one.

### Events emitted

None directly. Project creation does NOT publish an `AgentEvent` and
does NOT call `publishEvent`.

### Human gates

None.

### Notes (observation only)

- The auth middleware (`backend/src/middleware/authMiddleware.js:1-10`)
  unconditionally sets `req.user = { id: 'local-user-id', email:
  'local-user@example.com', role: 'authenticated' }`. All
  `MembershipService.*` calls succeed (stub returns `owner`).
- The `ProjectService.listProjects` / `createProject` paths are
  delegated to legacy service files (`ProjectService.js`,
  `FolderService.js`, etc.) referenced in
  `controllers/{Project,Folder,Document,Tree,SessionState}Controller.js`.
  These were NOT fully read for this audit; their content is not the
  primary path used by the pipeline.
- The Sdlc pipeline does NOT require project creation before
  `run-architecture-agent`. `runArchitectureAgent` accepts an arbitrary
  `project_id` from the request body and creates the
  `PipelineSession` itself
  (`backend/src/services/workflowOrchestrator.js:84-88`). Project rows
  are decoupled from sessions in the SDLC flow.

### Next trigger

N/A — Project Creation is a separate concern from the SDLC pipeline. The
pipeline's entry point is the next stage.

---

## Stage 1 — Architecture

### HTTP entry

| Method | Mount                                  | Controller / handler                          | Service                                          |
| ------ | -------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| POST   | `/api/v1/sdlc/run-architecture-agent`  | `SdlcController.runArchitectureAgent` (controllers/SdlcController.js:32-65) | `SdlcWorkflowService.runArchitectureAgent` → `workflowOrchestrator.runArchitectureAgent` |

### Caller / callee chain (one entry, many callees)

```
HTTP POST /api/v1/sdlc/run-architecture-agent
  └─ SdlcController.runArchitectureAgent (controllers/SdlcController.js:32)
     ├─ validate: project_id, feature_request.title required (lines 35-38)
     ├─ validate: repoService.validateRepoUrl(repo_url) (line 43)
     ├─ SdlcWorkflowService.runArchitectureAgent (line 45)
        └─ workflowOrchestrator.runArchitectureAgent
           ├─ PipelineSession.countActive() (orchestrator:74) — caps at
           │  MAX_PARALLEL_WORKFLOWS=4 (env). Throws 429 TOO_MANY_WORKFLOWS
           │  if active >= 4.
           ├─ PipelineSession.create({ id, projectId, title }) (line 84)
           ├─ Task.create({ type:'architecture-agent', sessionId,
           │  status:'pending', executionStatus:'queued', versionStatus:'draft' })
           │  (line 90) — also writes an AgentEvent row carrying the
           │  task_queued envelope (models/Task.js:21-87).
           ├─ Task.update({ observability:{ featureRequest } }) (line 107)
           ├─ FeatureBacklog.linkTask(backlogId, taskId, projectId) if
           │  backlogId present (line 112).
           ├─ repoService.cloneRepo / useLocalRepo / prepareSessionRepo
           │  (lines 119-150) — chooses path by URL shape.
           ├─ PipelineSession.update({ repoPath, workingBranch,
           │  baseBranch }) (line 161).
           ├─ repoIndexService.buildRepoIndex(repoPath, { maxDepth:2 })
           │  (line 184).
           ├─ scopeResolver.resolveScope({ repoIndex, featureRequest })
           │  (line 199).
           └─ deps.runAgent(task, context, user?.id) (line 208) —
              fire-and-forget.
              └─ SdlcWorkflowService._runAgent
                 └─ agentDispatcher.runAgent (selects path by
                    EXECUTION_PATH env: 'langchain' | 'claude-code' |
                    'codex'; mock-mode kicks in if USE_MOCK_AGENTS=true
                    or USE_MOCK_CLAUDE_CODE=true).
```

### Database writes (in order)

1. `PipelineSession.create` — `status='running'` (orchestrator:84-88).
2. `Task.create` (architecture-agent) — also creates a `task_queued`
   `AgentEvent` row with envelope JSON
   (`backend/src/models/Task.js:25-87`).
3. `Task.update` for `observability.featureRequest`
   (orchestrator:107).
4. `PipelineSession.update` for `repoPath`, `workingBranch`,
   `baseBranch` (orchestrator:162-166).
5. Later, when the runner finishes:
   `_saveAgentData` (SdlcWorkflowService.js:1811-2107) writes:
   - `AgentArtifact.bulkUpsert` rows for each `artifactType` present
     in the agent output (SdlcWorkflowService.js:1935-1977).
   - `Task.update({ status:'completed', output_content_hash,
     result, observability, agentOutput, gateMode })`
     (SdlcWorkflowService.js:2025-2034).
   - `taskLifecycle.transitionIfPresent(taskId, 'completed', …)` →
     publishes `task_completed` envelope and persists AgentEvent
     (SdlcWorkflowService.js:2041-2044).
   - `FeatureBacklog.updateStatusByTaskId(task.id, 'REVIEW')`
     (line 2045).
   - `AgentArtifact.setStatusByTaskId(taskId, 'VALID'|'INVALID')`
     based on `_validateGateOutput` BLOCKER count (line 2052).
   - `gateBridge.requestGate({ role:'architecture-agent',
     kind:'output_review', payload:{...} })` (line 2071-2087).
6. `taskWorker.endRun(task.id)` (line 2106).

### Events emitted

- `task_started` (with lifecycleType=`task_queued`) at `Task.create`
  (models/Task.js:25-66, persisted to `AgentEvent`).
- `task_completed` at `_saveAgentData` (taskLifecycleService.js:78-93,
  persisted via `transition`).
- `gate_pending` when the output_review gate is created
  (gateBridge.js:121-138). The envelope is published live; the
  `PendingGate` row is persisted separately
  (`PendingGate.create`, gateBridge.js:88-89).
- `runtime_log` audit envelopes from `_recordGateAudit`
  (SdlcWorkflowService.js:1546-1572). For the claude-code path, every
  onGate decision (`GATE_AUTO`, `GATE_BLOCK`, `GATE_QUESTION`,
  `GATE_ANSWER`, `GATE_REQUEST`, `GATE_DECISION`) emits a
  `runtime_log` envelope AND a persisted `AgentEvent.type='gate_audit'`
  row.

### Human gates

- `output_review` — created by `_saveAgentData` for every agent whose
  type is in `AGENT_GATES` (`sdlcConstants.js:8-15`).
- `tool` and `question` are emitted by `claudeCodeRunner` via
  `claudePermissionDispatcher.dispatch` when
  `CLAUDE_CODE_INTERACTIVE_GATES=true` (off by default; see
  `backend/src/agents/claudePermissionDispatcher.js:114-116, 249-271`).
  When the env flag is `false`, every tool call resolves silently
  (auto or block) and no gate is created.

### Next trigger

- `output_review` approve →
  `SdlcController.resolveOutputReviewGate` →
  `SdlcWorkflowService.resolveOutputReviewGate`
  (SdlcWorkflowService.js:466-591):
  - `Task.update({ approvedOutput, version_status:'committed' })`.
  - `Task.commitTask(task.id)` (sets `versionStatus='committed'`).
  - `AgentArtifact.setStatusByTaskId(task.id, 'VALID')`.
  - `repoService.commitAndPushOnApprove({ task, onLog })` (per-agent
    commit + best-effort push).
  - `HitlDecision.create(...)` for the approve record.
  - `_recordApprovedHandoff(task, approval)` →
    `artifactManager.recordApprovedHandoff` writes an `a2a_handoff`
    artifact (`backend/src/services/artifactManager.js:83-143`).
  - `_startNextAgentIfAvailable(task, user?.id)` →
    `workflowOrchestrator.startNextAgentIfAvailable` →
    `runPOAgent({ sessionId: task.sessionId, featureRequest, ... })`
    (workflowOrchestrator.js:597-656).
- `output_review` reject → `_handleGateRejection` re-runs the same
  agent with `feedbackPrompt` and bumps `retryCount`. Capped at
  `MAX_RETRY_PER_STEP=3`; over the cap, returns `escalation_required`
  with no rerun (SdlcWorkflowService.js:426-456).

### NOT VERIFIED

- Whether the live `task_started` envelope reaches the SSE client
  depends on whether the FE has already opened `GET
  /sdlc/stream/:sessionId` before `Task.create`. (See freeze doc I-10
  and stage-3 below; behaviour depends on FE subscription timing.)

---

## Stage 2 — PO

### HTTP entry (removed)

`POST /api/v1/sdlc/run-po-agent` returns **HTTP 410** with code
`PO_AGENT_ENTRY_REMOVED` (`controllers/SdlcController.js:76-82`).
Reached only via auto-advance from Architecture or via rework.

### Caller / callee chain

Auto-advance from Architecture:

```
workflowOrchestrator.startNextAgentIfAvailable
  └─ runPOAgent({ projectId, sourceTaskId, sessionId, featureRequest,
                 user:{ id: userId } })   (workflowOrchestrator.js:651)
     ├─ deps.requireApprovedTask(sourceTaskId, 'architecture-agent', user)
     ├─ requireUpstreamArtifact(sourceTask, 'po-agent')
     ├─ PipelineSession.countActive() (re-check cap)
     ├─ PipelineSession.create / findById (depends on sessionId arg)
     ├─ repoService.cloneRepo / useLocalRepo / prepareSessionRepo
     ├─ PipelineSession.update({ repoPath, workingBranch, baseBranch })
     ├─ AgentArtifact.findByTaskId(sourceTask.id)
     ├─ resolveStructuredArtifact(sourceArtifacts, 'project_definition')
     ├─ Task.create({ type:'po-agent', sessionId, sourceRunId,
     │  versionStatus:'draft' }) + AgentEvent task_queued
     ├─ Task.update({ observability:{ repo, featureRequest } })
     ├─ FeatureBacklog.linkTask(backlogId, task.id, effectiveProjectId)
     └─ deps.runAgent(task, context, user?.id)
        └─ ... → agentDispatcher.runAgent
```

### Database writes

1. `PipelineSession.create` (when no sessionId passed) OR
   `PipelineSession.findById` (when reused).
2. `PipelineSession.update` for repo paths (if new session).
3. `Task.create` (po-agent) with envelope-bearing AgentEvent.
4. `Task.update` for observability.
5. Same downstream writes as Stage 1: AgentArtifact, Task.update
   (completed), AgentEvent (task_completed), PendingGate
   (output_review).

### Events emitted

- `task_started` (task_queued).
- `task_completed` after runner finishes.
- `gate_pending` (output_review).
- `runtime_log` audit envelopes (claude-code path only).

### Human gates

- `output_review` after PO completes.

### Next trigger

- `output_review` approve → `startNextAgentIfAvailable` → `runUXAgent`.

---

## Stage 3 — UX

### HTTP entry

`POST /api/v1/sdlc/run-ux-agent`
(`controllers/SdlcController.js:97-111`).

Caller: FE / curl. Body requires `source_task_id`.

### Callee chain

```
workflowOrchestrator.runUXAgent (workflowOrchestrator.js:398-461)
  ├─ requireApprovedTask(sourceTaskId, 'po-agent', user)
  ├─ requireUpstreamArtifact(sourceTask, 'ux-agent')
  ├─ archTask = Task.findLatestBySession(sourceTask.sessionId,
  │   'architecture-agent', 'completed', 'committed')
  ├─ Promise.all([archProjectDefinition, archArtifacts, poArtifacts])
  ├─ dedupe by contentHash
  ├─ Task.create({ type:'ux-agent', sessionId, sourceRunId,
  │  versionStatus:'draft' }) + AgentEvent task_queued
  ├─ getRepoContext(projectId, sessionId)
  └─ deps.runAgent(task, context, user?.id)
```

### Database writes

Same shape as PO stage (Task.create + downstream pipeline).

### Events emitted

- `task_started` (task_queued), `task_completed`, `gate_pending`
  (output_review), `runtime_log` (claude-code path).

### Human gates

- `output_review` after UX completes.

### Next trigger

- `output_review` approve → `startNextAgentIfAvailable` → `runDEVAgent`.

---

## Stage 4 — DEV

### HTTP entry

`POST /api/v1/sdlc/run-dev-agent`
(`controllers/SdlcController.js:113-127`).

### Callee chain

```
workflowOrchestrator.runDEVAgent (workflowOrchestrator.js:467-510)
  ├─ requireApprovedTask(sourceTaskId, 'ux-agent', user)
  ├─ requireUpstreamArtifact(sourceTask, 'dev-agent')
  ├─ poTask = Task.findLatestBySession(sourceTask.sessionId, 'po-agent',
  │   'completed', 'committed')
  ├─ Promise.all([uxArtifacts, poArtifacts])
  ├─ Task.create({ type:'dev-agent', sessionId, sourceRunId,
  │  versionStatus:'draft' }) + AgentEvent task_queued
  ├─ getRepoContext(...)
  └─ deps.runAgent(task, context, user?.id)
```

### Database writes

Same shape.

### Events emitted

- `task_started` (task_queued), `task_completed`, `gate_pending`
  (output_review), `runtime_log` (claude-code path).

### Human gates

- `output_review` after DEV completes.
- `tool` gates are the primary user-visible surface here: when
  `CLAUDE_CODE_INTERACTIVE_GATES=true`, every Write/Edit/Bash from the
  Claude SDK is classified by
  `services/riskClassifier.classifyAction` (auto / approval / block)
  and the `approval` tier triggers `gateBridge.requestGate(kind='tool')`.
- `question` gate from `AskUserQuestion`.

### Next trigger

- `output_review` approve → `startNextAgentIfAvailable` → `runQAAgent`.

---

## Stage 5 — QA

### HTTP entry

`POST /api/v1/sdlc/run-qa-agent`
(`controllers/SdlcController.js:129-143`).

### Callee chain

```
workflowOrchestrator.runQAAgent (workflowOrchestrator.js:516-591)
  ├─ requireApprovedTask(sourceTaskId, 'dev-agent', user)
  ├─ requireUpstreamArtifact(sourceTask, 'qa-agent')
  ├─ sessionTasks = Task.findBySessionId(sourceTask.sessionId)
  ├─ if (gateBridge.listPending({ taskId: sourceTask.id }).length > 0)
  │   throw 409
  ├─ existingQa = sessionTasks.find(t=>qa-agent && sourceRunId===
  │   sourceTask.id && in pending/running)
  ├─ if (existingQa) return existingQa   // idempotent
  ├─ Promise.all([poTask, uxTask, archTask])
  ├─ archProjectDefinition, archArtifacts
  ├─ allArtifacts = archArtifacts ∪ poArtifacts ∪ uxArtifacts ∪
  │   sourceTask artifacts
  ├─ Task.create({ type:'qa-agent', sessionId, sourceRunId,
  │  versionStatus:'draft' }) + AgentEvent task_queued
  ├─ getRepoContext(...)
  └─ deps.runAgent(task, context, user?.id)
```

### Database writes

Same shape, plus `qa-agent`-specific extras:

- Inside `_saveAgentData` (`SdlcWorkflowService.js:1849-1916`),
  `QualityGateService.evaluate(...)` runs and produces
  `gate_evaluation`. Result is stored on `Task.result` and
  `AgentArtifact.type='gate_evaluation'`.

### Events emitted

- `task_started` (task_queued), `task_completed`, `gate_pending`
  (output_review), `runtime_log` (claude-code path).

### Human gates

- `output_review` after QA completes.

### Next trigger

`output_review` approve triggers a special branch
(`SdlcWorkflowService.js:548-578`):

```
if (task.type === 'qa-agent'
    && qaGatePassed(refreshed)
    && refreshed.sessionId && refreshed.projectId) {
  const evidence = await this._buildReleaseEvidenceSummary(refreshed.sessionId);
  const repoContext = await this._getRepoContext(refreshed.projectId, refreshed.sessionId);
  if (!repoContext?.repoPath) throw 500 'Cannot create FINAL_RELEASE gate: session has no cloned repository workspace...';
  await PipelineSession.update(refreshed.sessionId, { status:'awaiting_release' });
  gateBridge.requestGate({
    taskId, sessionId, projectId, role:'release', kind:'release',
    payload:{ summary, evidence, repoContext:{...} },
  });
}
```

`qaGatePassed` (`services/qaGate.js:11-22`):

- `task.result?.gateRecommendation === 'PASS'`, OR
- `task.agentOutput.test_run_report` reports `executed:true`,
  `failed===0`, `total>0`.

`output_review` reject → `_handleGateRejection` re-runs QA with
feedback (capped at `MAX_RETRY_PER_STEP=3`).

---

## Stage 6 — Release (FINAL_RELEASE gate)

### HTTP entry

`POST /api/v1/sdlc/sessions/:session_id/release-decision`
(`controllers/SdlcController.js:490-523`).

Body requires `decision_id` (idempotency) and `decision` (or
`action`). Only `owner` / `admin` accepted (403 otherwise).

### Callee chain

```
SdlcController.submitReleaseDecision
  └─ SdlcWorkflowService.submitReleaseDecision
     └─ releaseManager.submitReleaseDecision (services/releaseManager.js:21-194)
        ├─ existing? return idempotent replay
        ├─ qaTask = Task.findLatestBySession(sessionId, 'qa-agent',
        │   'completed', 'committed')
        ├─ priorReleaseDecision? throw 409
        ├─ qaGatePassed(qaTask)? else throw 409
        ├─ evidence.open_blockers with severity ∈
        │   RELEASE_BLOCKING_SEVERITIES? throw 409 on APPROVE
        ├─ HitlDecision.create({ gate:FINAL_GATE, decision,
        │  decisionId, action, comment, payload:{ release_status,
        │  reviewer_role, evidence }})
        ├─ if APPROVE:
        │  ├─ Promise.all([getFinalReviewPacket, getAuditTrail,
        │  │   getRepoContext])
        │  ├─ workflowReport.findPreviousBundle / removeGitTracked /
        │  │   fs.rm
        │  ├─ workflowReport.writeReleaseBundle({ projectId,
        │  │   session, repoContext, packet, audit, evidence,
        │  │   releaseDecision })
        │  ├─ git add + commit '[release][<shortId>] aifa: publish
        │  │   final.md + qa-report.md + audit-trail.json'
        │  ├─ git push (best-effort, GH_TOKEN if present)
        │  ├─ PipelineSession.update({ status:'completed', outputDir })
        │  └─ publishEvent('pipeline_completed', ...)
        └─ return { hitlDecision, releaseOutputs }
```

### Database writes

1. `HitlDecision.create` (FINAL_GATE row, unique `decisionId`).
2. On APPROVE only:
   - `PipelineSession.update({ status:'completed', outputDir })`.

### Events emitted

- `pipeline_completed` (releaseManager.js:173-186). **Live only** —
  this call site does NOT pass the returned envelope to
  `AgentEvent.create`. See `02_STATE_MACHINE.md` for the asymmetric
  persistence path.

### Human gates

None — terminal stage. APPROVE / REJECT only.

### Next trigger

Terminal.

---

## Cross-cutting: agent output persistence

`_saveAgentData` (SdlcWorkflowService.js:1811-2107) is the single sink
where agent output becomes persisted state. It performs, in order:

1. Skip if task already in a terminal `executionStatus`
   (line 1820).
2. For `qa-agent` only, run `QualityGateService.evaluate` and store
   `gate_evaluation` (line 1849-1916).
3. Map `gate_evaluation.recommendation` ∈ { approve→PASS,
   needs_changes→PASS_WITH_RISK, reject→FAIL } for QA (line 1925-1933).
4. Persist each `artifactType` from a master `artifactTypes` array
   (line 1828-1844) to `AgentArtifact.bulkUpsert` with `contentHash`
   (line 1935-1961).
5. Compute `outputContentHash` (line 2005).
6. `Task.update` with `status:'completed'`, `outputContentHash`,
   `result`, `observability` (merged with existing), `agentOutput`,
   `gateMode` (line 2025-2034).
7. `taskLifecycle.transitionIfPresent(taskId, 'completed', …)` →
   publishes `task_completed` envelope + persists AgentEvent.
8. `FeatureBacklog.updateStatusByTaskId(task.id, 'REVIEW')`.
9. `_validateGateOutput(task, completedData)` →
   `AgentArtifact.setStatusByTaskId('VALID'|'INVALID')` based on
   BLOCKER count (line 2050-2053).
10. `gateBridge.requestGate({ kind:'output_review' })` (line 2071-2087).
11. `taskWorker.endRun(task.id)` (line 2106).

The `auto_commit` runtime_log envelope is emitted from
`resolveOutputReviewGate`'s `onLog` callback when
`commitAndPushOnApprove` writes per-agent commits.

---

## Cross-cutting: gate resolution flow

| Gate kind        | Created by                                                       | Resolved by                                                                                                                                              | Returns to                                                |
| ---------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `tool`           | `claudePermissionDispatcher.handleTool` (claudePermissionDispatcher.js:190-247) | `POST /sdlc/approvals/:id` → `SdlcWorkflowService.resolveApproval` tool branch (SdlcWorkflowService.js:411-419)                                | `{ action, comment }` to SDK `canUseTool`                 |
| `question`       | `claudePermissionDispatcher.handleQuestion` (lines 158-188)       | same endpoint, `kind==='question'` branch (SdlcWorkflowService.js:361-408)                                                                              | `{ answers }` as `updatedInput.answers` to SAME Claude execution |
| `output_review`  | `_saveAgentData` (SdlcWorkflowService.js:2071)                    | `POST /sdlc/output-review/:id` → `resolveOutputReviewGate` (SdlcWorkflowService.js:466-591)                                                              | approve: commit output + advance pipeline; reject: re-run with feedback |
| `release`        | `resolveOutputReviewGate` after QA approve (SdlcWorkflowService.js:559-577) | `POST /sdlc/sessions/:id/release-decision` → `releaseManager.submitReleaseDecision` (services/releaseManager.js:21-194)                                | APPROVE: release bundle + commit + push + `pipeline_completed`; REJECT: `HitlDecision` only |

### Idle-window handling

- The Claude SDK can be paused mid-run while waiting for a `tool` or
  `question` gate. `claudeCodeRunner.runAgent` brackets every gate
  wait with `gateClock.enter()` / `gateClock.exit()` so the per-run
  timeout never counts human-wait time
  (`backend/src/agents/claudeCodeRunner.js:566-569`).
- `taskWorkerService.pauseBudget(taskId)` /
  `resumeBudget(taskId)` (taskWorkerService.js:116-126) do the same on
  the worker side so an `awaiting_gate` task is not swept by
  `sweepStale`.
- A `pending` `PendingGate` row survives a backend restart only when
  the task is in `awaiting_gate`. After boot,
  `gateBridge.markOrphanedPendingInterrupted`
  (services/gateBridge.js:226-228) flips all pending gates to
  `interrupted` and `SdlcWorkflowService.recoverInterruptedGates`
  (SdlcWorkflowService.js:1787-1798) re-dispatches every
  `awaiting_gate` task so the agent can re-prompt for a fresh gate.

---

## Cross-cutting: structured HITL

The structured decision API
(`POST /sdlc/tasks/:task_id/decision` →
`SdlcWorkflowService.submitStructuredDecision`,
SdlcWorkflowService.js:264-336) is the alternative to the legacy
`gate-decision` endpoint. It enforces:

- `decision_id` (idempotency). Replays return
  `{ idempotentReplay: true }` and never re-process.
- `base_output_version` (optimistic lock). Mismatch throws 409.
- `action ∈ { approve, reject, edit_approve }`.
- `edit_approve` requires either `payload.edited_output` or
  `payload.patch` (RFC 6902 JSON Patch). The new version is
  `task.outputVersion + 1` on `edit_approve`, unchanged otherwise.

Validation is informational only — the human's decision is final.

The `tool` gate does NOT route through structured HITL; it calls
`resolveApproval` directly (SdlcWorkflowService.js:411-419).
