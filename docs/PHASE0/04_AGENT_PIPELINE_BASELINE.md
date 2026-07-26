# 04 — Agent Pipeline Baseline (Frozen Baseline)

> **Status:** OBSERVATION ONLY. This is the pipeline **as implemented**
> in current `HEAD` on `namw6`. No design intent. No correctness claims.

Trace every stage from `POST /sdlc/run-architecture-agent` to
`POST /sdlc/sessions/:id/release-decision`.

```
run-architecture-agent ──► architecture-agent ──► po-agent ──► ux-agent
                                                       │
                                                       ▼
                                                  dev-agent ──► qa-agent
                                                                  │
                                                                  ▼
                                                            FINAL_RELEASE
                                                                  │
                                                                  ▼
                                                        pipeline_completed
```

There are no UX-skip and no QA-skip branches in current source. The chain
is fixed.

---

## Stage 1 — Architecture Agent (entry)

### Entry function

- HTTP: `POST /api/v1/sdlc/run-architecture-agent` (controller
  `SdlcController.runArchitectureAgent` — controller:32-65).
- Controller validates `project_id` and `feature_request.title` (400 on
  missing), then calls `repoService.validateRepoUrl(repo_url)` BEFORE any
  workspace work.
- Controller returns `{ task_id, session_id, status, type }` with 202.

### Service call chain

```
SdlcController.runArchitectureAgent
  └─ SdlcWorkflowService.runArchitectureAgent
      └─ workflowOrchestrator.runArchitectureAgent
          ├─ PipelineSession.countActive()  (rejects with 429 when >= MAX_PARALLEL_WORKFLOWS)
          ├─ PipelineSession.create()
          ├─ Task.create({ type:'architecture-agent', sessionId, versionStatus:'draft' })
          ├─ Task.update({ observability: { featureRequest } })
          ├─ repoService.cloneRepo / useLocalRepo / prepareSessionRepo
          ├─ PipelineSession.update({ repoPath, workingBranch, baseBranch })
          ├─ repoIndexService.buildRepoIndex(repoPath, { maxDepth:2 })
          ├─ scopeResolver.resolveScope({ repoIndex, featureRequest })
          └─ deps.runAgent(task, context, user?.id)  // fire-and-forget
              └─ SdlcWorkflowService._runAgent
                  └─ agentDispatcher.runAgent (selects path by EXECUTION_PATH)
```

### DB writes

- `PipelineSession.create` — `status='running'`, no repoPath yet.
- `Task.create` — `status='pending'`, `executionStatus='queued'`,
  `versionStatus='draft'`, `agentOutput=null`, `approvedOutput=null`.
- `PipelineSession.update` — `repoPath`, `workingBranch`, `baseBranch`.
- `Task.update` — `observability.featureRequest` persisted on the task row.
- The `Task.create` transaction also creates an `AgentEvent` row carrying
  the canonical envelope for `task_queued` (see
  `models/Task.js:21-87`).

### Events emitted

- `publishEvent('task_started', ..., { stage, lifecycleType:'task_queued' })`
  — allocated via `sequenceService.next(sessionId, projectId)`, persisted
  to `AgentEvent` in the same transaction as the `Task` row, and
  published to the in-process eventBus (so any active SSE consumer sees it).
- `_recordGateAudit` emits `runtime_log` envelopes for every onGate
  decision the runner takes while ARCH runs (see `_runClaudeCodePath`
  in `agentDispatcher.js:274-300`).

### Human gates

- `output_review` — created in `_saveAgentData` after ARCH's agent output
  is persisted. `gateBridge.requestGate({ role:'architecture-agent',
  kind:'output_review', payload:{ ... }})`.
- `tool` — every `Write/Edit/Bash/AskUserQuestion` from the Claude SDK is
  routed through `claudePermissionDispatcher.dispatch` →
  `gateBridge.requestGate({ kind:'tool' })` (only when
  `CLAUDE_CODE_INTERACTIVE_GATES=true`).
- `question` — `AskUserQuestion` produces
  `gateBridge.requestGate({ kind:'question' })` and pauses the SAME
  Claude execution in-place.

### Next stage trigger

- `output_review` approve → `resolveOutputReviewGate` →
  `_recordApprovedHandoff` → `_startNextAgentIfAvailable` →
  `workflowOrchestrator.startNextAgentIfAvailable(task, userId, deps)` →
  `runPOAgent` (carrying `task.sessionId` + `featureRequest`).

---

## Stage 2 — PO Agent

### Entry function

- Not directly HTTP-reachable. `POST /sdlc/run-po-agent` returns 410
  (`PO_AGENT_ENTRY_REMOVED`).
- Reached via:
  - Auto-advance from ARCH (`startNextAgentIfAvailable` →
    `runPOAgent({ sessionId: task.sessionId, featureRequest, … })`).
  - Rework from a `REQUEST_CHANGES` decision on the PO task via
    `_rerunOwningWorker`.

### Service call chain

```
workflowOrchestrator.runPOAgent
  ├─ requireApprovedTask(sourceTaskId, 'architecture-agent', user)  // throws 400/409 if missing
  ├─ requireUpstreamArtifact(sourceTask, 'po-agent')              // every REQUIRED_OUTPUT_KEYS[predecessor] must be non-empty
  ├─ PipelineSession.countActive()  // re-check parallelism cap
  ├─ PipelineSession.create() (only when sessionId is not provided)
  ├─ repoService.cloneRepo / useLocalRepo / prepareSessionRepo (only when new session)
  ├─ PipelineSession.update({ repoPath, workingBranch, baseBranch })
  ├─ AgentArtifact.findByTaskId(sourceTask.id)
  ├─ resolveStructuredArtifact(sourceArtifacts, 'project_definition') (Phase 2 plumbing)
  ├─ Task.create({ type:'po-agent', sessionId, sourceRunId, versionStatus:'draft' })
  ├─ Task.update({ observability: { repo, featureRequest } })
  └─ deps.runAgent(task, context, user?.id)
      └─ ... → agentDispatcher.runAgent
```

### DB writes

- `PipelineSession.create` + `PipelineSession.update` (when new session).
- `Task.create` (po-agent).
- `Task.update` (observability).
- `AgentEvent.create` for `task_queued`.

### Events emitted

- `task_started` (task_queued) at creation.
- `runtime_log` from onGate audit entries.

### Human gates

- `output_review` after PO's run finishes.
- `tool` / `question` from Claude SDK inside the run.

### Next stage trigger

- `output_review` approve → `resolveOutputReviewGate` →
  `startNextAgentIfAvailable` → `runUXAgent`.

---

## Stage 3 — UX Agent

### Entry function

- HTTP: `POST /sdlc/run-ux-agent` (controller
  `SdlcController.runUXAgent` — controller:97-111). Requires
  `source_task_id`.
- Auto-advance from PO.

### Service call chain

```
workflowOrchestrator.runUXAgent
  ├─ requireApprovedTask(sourceTaskId, 'po-agent', user)
  ├─ requireUpstreamArtifact(sourceTask, 'ux-agent')
  ├─ archTask = Task.findLatestBySession(sourceTask.sessionId, 'architecture-agent', completed+committed)
  ├─ Promise.all([archProjectDefinition, archArtifacts, poArtifacts])
  ├─ dedupe by contentHash
  ├─ Task.create({ type:'ux-agent', sessionId, sourceRunId })
  ├─ getRepoContext(projectId, sessionId)
  └─ deps.runAgent(task, context, user?.id)
```

### DB writes

- `Task.create` (ux-agent).
- `AgentEvent.create` for `task_queued`.

### Events emitted

- `task_started` (task_queued) at creation.
- `runtime_log` audit envelopes.

### Human gates

- `output_review` after UX finishes.
- `tool` / `question` from Claude SDK.

### Next stage trigger

- `output_review` approve → `runDEVAgent` via `startNextAgentIfAvailable`.

---

## Stage 4 — DEV Agent

### Entry function

- HTTP: `POST /sdlc/run-dev-agent` (controller
  `SdlcController.runDEVAgent` — controller:113-127). Requires
  `source_task_id`.
- Auto-advance from UX.

### Service call chain

```
workflowOrchestrator.runDEVAgent
  ├─ requireApprovedTask(sourceTaskId, 'ux-agent', user)
  ├─ requireUpstreamArtifact(sourceTask, 'dev-agent')
  ├─ poTask = Task.findLatestBySession(sourceTask.sessionId, 'po-agent', completed+committed)
  ├─ Promise.all([uxArtifacts, poArtifacts])
  ├─ Task.create({ type:'dev-agent', sessionId, sourceRunId })
  ├─ getRepoContext(...)
  └─ deps.runAgent(task, context, user?.id)
```

### DB writes

- `Task.create` (dev-agent).
- `AgentEvent.create` for `task_queued`.

### Events emitted

- `task_started` (task_queued) at creation.
- `runtime_log` audit envelopes.

### Human gates

- `output_review` after DEV finishes (always — `gateBridge.requestGate`).
- `tool` for every Write/Edit/Bash from the Claude SDK — this is the
  stage where `claudePermissionDispatcher.dispatch` is most active. Each
  tool call goes through `riskClassifier.classifyAction` →
  `auto | approval | block`.

### Next stage trigger

- `output_review` approve → `resolveOutputReviewGate` →
  `startNextAgentIfAvailable` → `runQAAgent`.

---

## Stage 5 — QA Agent

### Entry function

- HTTP: `POST /sdlc/run-qa-agent` (controller
  `SdlcController.runQAAgent` — controller:129-143). Requires
  `source_task_id`.
- Auto-advance from DEV.

### Service call chain

```
workflowOrchestrator.runQAAgent
  ├─ requireApprovedTask(sourceTaskId, 'dev-agent', user)
  ├─ requireUpstreamArtifact(sourceTask, 'qa-agent')
  ├─ sessionTasks = Task.findBySessionId(sourceTask.sessionId)
  ├─ if (gateBridge.listPending({ taskId: sourceTask.id }).length > 0) throw 409
  ├─ existingQa = sessionTasks.find(t=>qa-agent && sourceRunId===sourceTask.id && in pending/running)
  ├─ if (existingQa) return existingQa            // idempotent: never duplicate QA
  ├─ Promise.all([poTask, uxTask, archTask])
  ├─ archProjectDefinition, archArtifacts
  ├─ allArtifacts = archArtifacts ∪ poArtifacts ∪ uxArtifacts ∪ sourceTask artifacts
  ├─ Task.create({ type:'qa-agent', sessionId, sourceRunId })
  ├─ getRepoContext(...)
  └─ deps.runAgent(task, context, user?.id)
```

### DB writes

- `Task.create` (qa-agent).
- `AgentEvent.create` for `task_queued`.

### Events emitted

- `task_started` (task_queued).
- `runtime_log` audit envelopes.

### Human gates

- `output_review` after QA finishes.

### Next stage trigger

- `output_review` approve (with `qaGatePassed(task)` returning true) →
  `PipelineSession.update({ status:'awaiting_release' })` +
  `gateBridge.requestGate({ role:'release', kind:'release', payload:{...} })`
  in `resolveOutputReviewGate` (SdlcWorkflowService.js:548-578).

---

## Stage 6 — Release (FINAL_RELEASE gate)

### Entry function

- HTTP: `POST /sdlc/sessions/:session_id/release-decision` (controller
  `SdlcController.submitReleaseDecision` — controller:490-523).
- Body must include `decision_id` (idempotency key) and `decision` (or
  `action`) — the controller normalizes `action` → uppercase `decision`.
- Only `owner` / `admin` roles accepted (403 otherwise).

### Service call chain

```
SdlcController.submitReleaseDecision
  └─ SdlcWorkflowService.submitReleaseDecision
      └─ releaseManager.submitReleaseDecision
          ├─ existing? return idempotent replay
          ├─ qaTask = Task.findLatestBySession(sessionId, 'qa-agent', completed+committed)
          ├─ priorReleaseDecision? throw 409 ("already finalized")
          ├─ qaGatePassed(qaTask)? else throw 409
          ├─ evidence.open_blockers with severity ∈ RELEASE_BLOCKING_SEVERITIES? throw 409 on APPROVE
          ├─ HitlDecision.create({ gate: FINAL_GATE, decision, decisionId, action, comment, payload:{ release_status, reviewer_role, evidence } })
          ├─ if APPROVE:
          │     ├─ Promise.all([getFinalReviewPacket, getAuditTrail, getRepoContext])
          │     ├─ workflowReport.findPreviousBundle / removeGitTracked / fs.rm
          │     ├─ workflowReport.writeReleaseBundle({ projectId, session, repoContext, packet, audit, evidence, releaseDecision })
          │     ├─ git add + commit `[release][<shortId>] aifa: publish final.md + qa-report.md + audit-trail.json`
          │     ├─ git push (best-effort, GH_TOKEN if present, never blocks)
          │     ├─ PipelineSession.update({ status:'completed', outputDir })
          │     └─ publishEvent('pipeline_completed', { projectId, sessionId, taskId:qaTask.id, role:'release' }, { qaResult })
          └─ return { hitlDecision, releaseOutputs }
```

### DB writes

- `HitlDecision.create` (`gate='FINAL_GATE'`, `action='release_approve'`
  or `'release_reject'`, `decisionId` unique).
- On APPROVE: `PipelineSession.update({ status:'completed' })`.

### Events emitted

- `pipeline_completed` — single emitter, owned by `releaseManager`.

### Human gates

- None — this is the terminal stage. APPROVE → pipeline_completed;
  REJECT → recorded as `hitlDecision` (no further action; same session is
  finalised as RELEASED=REJECTED).

### Next stage trigger

- Terminal.

---

## 7. Cross-cutting: agent output persistence

`SdlcWorkflowService._saveAgentData(task, completedData, userId)`
(SdlcWorkflowService.js:1811-2107) is the single sink where agent output
becomes persisted state. It:

1. Skips when the task is already in a terminal `executionStatus`.
2. Persists `gate_evaluation` for `qa-agent` tasks
   (`QualityGateService.evaluate`).
3. Maps `recommendation` ∈ { approve → PASS, needs_changes → PASS_WITH_RISK,
   reject → FAIL }.
4. Persists each artifact type listed in the static `artifactTypes` array
   to `AgentArtifact` via `bulkUpsert`, with `contentHash`.
5. Computes `outputContentHash` over all artifact hashes.
6. Updates `Task`: `status='completed'`, `outputContentHash`, `result`,
   `observability` (merged with existing), `agentOutput=completedData`,
   `gateMode`.
7. `taskLifecycle.transitionIfPresent(taskId, 'completed', ...)` —
   publishes `task_completed` envelope and persists AgentEvent.
8. Runs `_validateGateOutput(task, completedData)` →
   `setStatusByTaskId('VALID'|'INVALID')` based on BLOCKER count.
9. Creates `output_review` gate via `gateBridge.requestGate` (always — no
   silent auto-advance).
10. Releases worker lock (`taskWorker.endRun`).

The `auto_commit` runtime_log envelope is emitted from
`resolveOutputReviewGate`'s `onLog` callback when the
`commitAndPushOnApprove` helper writes per-agent commits.

---

## 8. Cross-cutting: gate flow table

| Gate kind   | Created by                                                       | Resolved by                                                         | Resolves to                                              |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `tool`      | `claudePermissionDispatcher.handleTool`                          | `POST /sdlc/approvals/:id` → `SdlcController.resolveApproval` → `SdlcWorkflowService.resolveApproval` (tool branch) | `{ action, comment }` returned to SDK `canUseTool`       |
| `question`  | `claudePermissionDispatcher.handleQuestion`                      | same endpoint, `kind==='question'` branch                           | `{ answers }` fed back as `updatedInput.answers` to the SAME Claude execution |
| `output_review` | `SdlcWorkflowService._saveAgentData` (always when `AGENT_GATES[task.type]`) | `POST /sdlc/output-review/:id` → `resolveOutputReviewGate`          | approve → `_recordApprovedHandoff` + `_startNextAgentIfAvailable`; reject → `_handleGateRejection` (re-run same agent with feedback) |
| `release`   | `SdlcWorkflowService.resolveOutputReviewGate` after QA approve (when `qaGatePassed` and repoContext.repoPath) | `POST /sdlc/sessions/:id/release-decision` → `releaseManager.submitReleaseDecision` | APPROVE → release bundle + commit + push + `pipeline_completed`; REJECT → `HitlDecision` only |

### 8.1 Gate idle-window (in-flight pause)

- The Claude SDK can be paused mid-run while waiting for a `tool` or
  `question` gate to resolve. The `claudeCodeRunner` brackets every gate
  wait with `gateClock.enter()` / `gateClock.exit()` so the per-run
  timeout never counts human-wait time.
- On the worker side, `taskWorker.pauseBudget(taskId)` /
  `resumeBudget(taskId)` do the same so a `awaiting_gate` task doesn't
  get swept by `sweepStale`.
- A `pending` PendingGate row survives a backend restart only when the
  task is in `awaiting_gate`. After boot, `gateBridge.markOrphanedPendingInterrupted`
  flips pending gates to `interrupted` and `SdlcWorkflowService.recoverInterruptedGates`
  re-dispatches the owning task so the agent can re-prompt for a fresh
  gate.

---

## 9. Cross-cutting: structured HITL (idempotency + optimistic lock + retries)

For `output_review` (always-on) and `tool` (interactive), the structured
decision API exists at:

- `POST /sdlc/tasks/:task_id/decision` → `submitStructuredDecision`
  (SdlcController:182-217, SdlcWorkflowService:264-336)

Wire invariants:

- `decision_id` is the idempotency key. Replays return the prior decision
  with `idempotentReplay:true` and never re-process.
- `base_output_version` is the optimistic lock. Mismatch throws 409
  "Stale output version".
- `action ∈ { approve, reject, edit_approve }`.
- `edit_approve` requires either `payload.edited_output` or
  `payload.patch` (RFC 6902 JSON Patch). The new version is
  `task.outputVersion + 1` on `edit_approve`, unchanged otherwise.
- Validation is informational only — the human's decision is final.

For `tool` gates, the structured endpoint is bypassed in favour of
`resolveApproval(action, comment)`. The tool branch in
`SdlcWorkflowService.resolveApproval` does NOT go through structured
HITL — it just wakes the awaited SDK `canUseTool` Promise.

---

## 10. Stage ↔ event inventory (per stage)

| Stage             | Persisted AgentEvent types                                                            | Published event envelopes (via `eventPublisher`)                |
| ----------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Architecture      | `task_queued` (allocated envelope)                                                    | `task_started`, `gate_pending`, `gate_resolved`, `runtime_log` |
| PO                | `task_queued`                                                                          | `task_started`, `gate_pending`, `gate_resolved`, `runtime_log` |
| UX                | `task_queued`                                                                          | `task_started`, `gate_pending`, `gate_resolved`, `runtime_log` |
| DEV               | `task_queued`                                                                          | `task_started`, `gate_pending`, `gate_resolved`, `runtime_log` |
| QA                | `task_queued`                                                                          | `task_started`, `gate_pending`, `gate_resolved`, `runtime_log` |
| Release (approve) | (none directly — `HitlDecision` only)                                                  | `pipeline_completed` (single emitter)                            |
| SSE bootstrap     | (none directly — read-only replay)                                                    | `session_started` / `session_resumed`                            |

The lifecycle envelope mapping is in `taskLifecycleService.js:34-45`:
`task_queued/dispatched/started → task_started`,
`task_completed → task_completed`, `task_failed → task_failed`,
`task_cancelled/timeout → task_interrupted`, etc.

See `06_EVENT_INVENTORY.md` for the full event inventory.

---

## 11. Skipped / removed branches

- `POST /sdlc/run-po-agent` returns 410 (`PO_AGENT_ENTRY_REMOVED`).
- `POST /sdlc/upload-repo` returns 410 (`UPLOAD_REPO_REMOVED`).
- `GET /sdlc/status/:task_id` returns 410 (`STREAM_STATUS_DEPRECATED`).
- `agent_1`, `agent_2`, `agent_3` Python modules are forbidden
  (CLAUDE.md §5).
- `PO → DEV` legacy path is removed; DEV's strict predecessor is UX
  (workflowOrchestrator.js:469-472).
- PO `release_decision` field is no longer in QA's contract (Phase 3.6)
  and the corresponding normalization block was removed
  (SdlcWorkflowService.js:1918-1933).
- Synthetic "bad-case" mock scenarios are removed;
  `MOCK_SCENARIO_PROFILES.happy_path` is the only entry.
- The legacy `socketService` (socket.io) was removed entirely. The
  current transport is SSE only.