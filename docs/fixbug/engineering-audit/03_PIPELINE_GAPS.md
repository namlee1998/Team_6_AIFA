# 03 — Pipeline Gaps (Phase 1 Audit)

> **Status:** READ-ONLY AUDIT. Every gap is an observation, not a
> proposal. **NO FIXES** are included. Items are listed in the order
> they are observable during a code walk; priority for Phase-2 is the
> role, not this document.
>
> Where evidence is not available from the source tree, the entry is
> marked **NOT VERIFIED**.

Each gap has:

- **Evidence** — file + line + concrete observation.
- **Files** — full list of files involved.
- **Functions** — functions / classes / constants involved.
- **Impact** — observable behavioural effect under documented
  conditions; not a hypothetical.

This document covers only the gaps surfaced by §1–§7 audit areas. The
freeze document `08_CURRENT_KNOWN_ISSUES.md` lists additional
observations; this audit cross-references them where they overlap but
does not re-derive them.

---

## G-1. `pipeline_completed` envelope is not persisted to `AgentEvent`

### Evidence

`backend/src/services/releaseManager.js:173-186` calls
`publishEvent('pipeline_completed', …)` but does NOT pass the returned
envelope to `AgentEvent.create`. All other canonical event types
(`task_started`, `task_completed`, `task_failed`, `task_interrupted`,
`gate_pending`, `gate_resolved`, `runtime_log`) reach the SSE writer
via a path that either:

1. `taskLifecycleService.transition` → `appendEvent` inside
   `prisma.$transaction` (taskLifecycleService.js:128-139), OR
2. `_recordGateAudit` → `AgentEvent.create` after
   `publishEvent` (SdlcWorkflowService.js:1560-1569).

`releaseManager.submitReleaseDecision` does (1) not. The
`publishEvent` call is fire-and-forget for persistence purposes.

### Files

- `backend/src/services/releaseManager.js:106-191`
- `backend/src/services/eventPublisher.js:17-28`
- `backend/src/dto/eventEnvelope.js:10-23`

### Functions

- `releaseManager.submitReleaseDecision`
- `eventPublisher.publishEvent`
- (NOT called) `models/AgentEvent.create`

### Impact

- A reconnecting SSE consumer (after `Last-Event-ID` cursor advances)
  sees live `pipeline_completed` frames but the persisted
  `AgentEvent` table does NOT have a corresponding row.
- Subsequent clients connecting later, or `getAuditTrail` callers
  reading only the `AgentEvent` table, miss the final terminal
  envelope.
- The only place a `pipeline_completed` row could appear in
  `AgentEvent` would be via a separate call site that explicitly
  persists the envelope (none exists in current source).

---

## G-2. Three declared EventTypes are never produced

### Evidence

`backend/src/dto/eventEnvelope.js:10-23` declares the canonical
discriminator union:

```
session_started | session_resumed | pipeline_completed | pipeline_failed
| task_started | task_completed | task_failed | task_interrupted
| task_resumed | gate_pending | gate_resolved | agent_event
| runtime_log
```

`grep` over the source tree (limited to live producers via
`publishEvent`) yields:

| EventType            | Producer(s)                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `session_started`    | `SdlcController.streamPipelineStatus` (controller:367)                                                     |
| `session_resumed`    | `SdlcController.streamPipelineStatus` (controller:367)                                                     |
| `pipeline_completed` | `releaseManager.submitReleaseDecision` (releaseManager.js:174)                                            |
| `task_started`       | `taskLifecycleService.publishLifecycle` (mapped from `task_queued/dispatched/started`)                     |
| `task_completed`     | `taskLifecycleService.publishLifecycle`                                                                      |
| `task_failed`        | `taskLifecycleService.publishLifecycle`                                                                      |
| `task_interrupted`   | `taskLifecycleService.publishLifecycle` (mapped from `task_cancelled/timeout`)                            |
| `gate_pending`       | `gateBridge.requestGate` (gateBridge.js:123)                                                                |
| `gate_resolved`      | `gateBridge.resolveGate` (gateBridge.js:180)                                                                |
| `runtime_log`        | `SdlcWorkflowService.resolveOutputReviewGate` (line 509); `SdlcWorkflowService._recordGateAudit` (line 1556) |
| `pipeline_failed`    | **NO PRODUCER**                                                                                              |
| `task_resumed`       | **NO PRODUCER**                                                                                              |
| `agent_event`        | **NO PRODUCER** (legacy rows may still exist on disk; the SSE replay does not synthesise envelopes for them) |

### Files

- `backend/src/dto/eventEnvelope.js`
- `frontend/src/dto/event.ts`
- `backend/src/services/eventPublisher.js`

### Functions

- `publishEvent` (no caller uses these three discriminators)

### Impact

- TypeScript contract (frontend/src/dto/event.ts) advertises
  `'pipeline_failed' | 'task_resumed' | 'agent_event'` but the
  runtime never emits them.
- The FE reducer (`eventMappers.ts`) would silently drop any
  incoming frame of these types. Currently no producer emits them, so
  the gap is dormant.
- Future producers that emit `pipeline_failed` must avoid the same
  asymmetric-persistence trap as G-1.

---

## G-3. `taskLifecycle.transition` is bypassed by direct `Task.update` writes

### Evidence

The `taskLifecycle.TRANSITIONS` matrix is enforced only inside
`taskLifecycleService.transition` (lines 95-141). The following
production services write `Task.status` directly via `Task.update`
without going through the state machine:

| Service                                           | File:Lines                          | Field written                |
| ------------------------------------------------- | ----------------------------------- | ---------------------------- |
| `agentDispatcher.runAgent`                        | `agentDispatcher.js:312-316`        | `status:'processing'`        |
| `SdlcWorkflowService._saveAgentData`              | `SdlcWorkflowService.js:2025-2034`  | `status:'completed'`          |
| `agentDispatcher.markTaskFailed`                  | `agentDispatcher.js:534-537`        | `status:'failed'`             |
| `agentDispatcher.handleTaskTimeout`               | `agentDispatcher.js:562`            | `status:'failed'`             |
| `SdlcWorkflowService.cancelTask`                  | `SdlcWorkflowService.js:1718`       | `status:'cancelled'`          |
| `taskWorkerService.sweepStale`                    | `taskWorkerService.js:160`          | `status:'failed'`             |
| `SdlcWorkflowService._resumeAgentStream` (legacy) | `SdlcWorkflowService.js:1440-1444`  | `status:'PENDING_TOOL_APPROVAL'` |
| `agentDispatcher` (legacy langchain)              | `agentDispatcher.js:441-444`        | `status:'PENDING_TOOL_APPROVAL'` |

In all these cases `Task.status` (the legacy free-form string) is
mutated, NOT `Task.executionStatus` (the canonical state-machine
field). So `TRANSITIONS` is not bypassed on `executionStatus`
specifically — but `Task.status` is allowed to take any value
including `'PENDING_TOOL_APPROVAL'`, which is not in any documented
state set.

### Files

- All files listed above.
- `backend/src/services/taskLifecycleService.js:11-21` (the
  state machine).

### Functions

- (callers listed in the table above; the state machine itself is
  `taskLifecycleService.transition`).

### Impact

- `Task.status` and `Task.executionStatus` can disagree.
- Consumers that branch on `Task.status` (e.g. UI queries) read a
  value that is not bound to `TRANSITIONS`.
- The literal string `'PENDING_TOOL_APPROVAL'` is only reachable on
  the LEGACY langchain real-agent path. The claude-code path does
  not use this status string. The mock path skips `agentDispatcher`
  entirely.

---

## G-4. `SdlcWorkflowService.recoverInterruptedGates` re-dispatch race

### Evidence

`SdlcWorkflowService.recoverInterruptedGates` (lines 1787-1798)
iterates `Task.listByExecutionStatus('awaiting_gate')` and calls
`_resumeInterruptedTask(task)` for each.

`_resumeInterruptedTask` (lines 1777-1784):

```js
async _resumeInterruptedTask(task) {
  if (task.executionStatus !== 'awaiting_gate') return false;
  const context = await this._rebuildContextForTask(task);
  this._runAgent(task, context, null).catch((err) => …);
  return true;
}
```

`this._runAgent` → `agentDispatcher.runAgent` →
`taskLifecycle.transition(taskId, 'running', …)` (line 313-316).
But the task's current `executionStatus` is already `awaiting_gate`,
and the matrix (taskLifecycleService.js:15) does NOT list
`awaiting_gate → running` as a valid transition. So the call to
`transition` throws `"Invalid task transition: awaiting_gate -> running"`.

### Files

- `backend/src/services/SdlcWorkflowService.js:1777-1784, 1787-1798`
- `backend/src/services/agentDispatcher.js:312-316`
- `backend/src/services/taskLifecycleService.js:12-21, 95-141`

### Functions

- `SdlcWorkflowService.recoverInterruptedGates`
- `SdlcWorkflowService._resumeInterruptedTask`
- `agentDispatcher.runAgent`
- `taskLifecycle.transition`

### Impact

- Every boot that has any task in `awaiting_gate` re-throws inside
  `_runAgent` and logs a generic catch. The agent run does NOT
  resume; the task stays `awaiting_gate` indefinitely.
- The gate that was meant to be re-issued is NOT re-issued.
- The user sees the same `awaiting_gate` task after each restart with
  no fresh prompt for the human.
- **NOT VERIFIED**: whether the error path is fully swallowed by
  `.catch((err) => …)` so the boot sequence completes successfully
  or whether the boot fails at `recoverInterruptedGates`.

---

## G-5. `gateBridge.resolveGate` may double-resolve under racing SSE consumers

### Evidence

`gateBridge.resolveGate` (gateBridge.js:154-194):

```js
async function resolveGate(approvalId, result = {}) {
  const rec = pending.get(approvalId);
  if (!rec) return false;
  if (rec.ready) await rec.ready.catch(() => {});
  …
  pending.delete(approvalId);
  await PendingGate.resolve(approvalId, rec.status, result);
  …
  rec.resolve(result);
  return true;
}
```

The in-memory `pending` map is consulted BEFORE the DB
`PendingGate.resolve`. Two callers racing on the same `approvalId`:

- Caller A: `pending.get` returns the record, then awaits `rec.ready`.
- Caller B: same; both proceed to `pending.delete`.
- `Map.delete` is idempotent; the second call does nothing — but
  `PendingGate.resolve` runs twice (the second `updateMany` matches
  zero rows because `where: { approvalId, status: 'pending' }` already
  failed on A).

The `rec.resolve(result)` runs for both — the awaited Promise's
resolve is idempotent (only the first call has effect because Promises
only resolve once). So the SDK side is safe. But the second
`gate_resolved` envelope is published.

### Files

- `backend/src/services/gateBridge.js:154-194`

### Functions

- `gateBridge.resolveGate`
- `eventPublisher.publishEvent('gate_resolved', …)`

### Impact

- Under racing HTTP requests for the same `approvalId` (theoretically
  possible if a FE panel retries), two `gate_resolved` envelopes
  can be published. Both have the same sequence (or distinct
  sequences — `publishEvent` always allocates a fresh sequence).
  The SSE consumer receives both, and dedup is per-`envelope.id`, not
  per-`approvalId`. The user sees two "resolved" frames for one
  click.

---

## G-6. SSE replay silently drops non-canonical `AgentEvent` rows

### Evidence

`backend/src/controllers/SdlcController.js:340-357`:

```js
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
```

For legacy rows that lack `row.envelope`, only `gate_audit`-typed
rows are mapped to `'runtime_log'`. Other legacy types
(e.g. `agent_event`, `task_started` rows from before the transport
refactor) are passed through unchanged to `buildLegacyEnvelope`,
producing a wire envelope whose `type` field is the literal
`AgentEvent.type` (e.g. `agent_event`).

But the FE `sseClient.isEnvelope` check
(`frontend/src/dto/event.ts:133-146`) only validates the envelope's
structural shape, not its `type` discriminator. So such rows ARE
forwarded, but the FE reducer (`eventMappers.ts`) drops them
silently because it has no handler for arbitrary legacy types.

Furthermore, rows that lack BOTH `envelope` AND `payload` are
silently dropped with no log line.

### Files

- `backend/src/controllers/SdlcController.js:340-357`
- `frontend/src/dto/event.ts:133-146`
- `frontend/src/store/eventMappers.ts`

### Functions

- `SdlcController.streamPipelineStatus`
- `sseClient.isEnvelope` (FE)
- `applyEnvelope` / per-type mappers (FE)

### Impact

- Old `AgentEvent` rows written before the transport refactor cannot
  be replayed to FE on reconnect. The replay appears truncated.
- Empty rows (no envelope, no payload) are dropped without a log.
  No operator-visible signal.

---

## G-7. `pendingQuestions` is project-scoped in some paths, session-scoped in others

### Evidence

`SdlcWorkflowService._requireApprovedTask` (lines 1580-1618):

```js
const scopeTaskIds = task.sessionId
  ? new Set((await Task.findBySessionId(task.sessionId)).map((t) => t.id))
  : null;
const pendingQuestion = this._getPendingQuestionGate(task.projectId, scopeTaskIds);
if (pendingQuestion) {
  throw new ApiError(409, `Pipeline is locked while ${pendingQuestion.role} waits for a human answer`, ...);
}
```

vs. `gateManager.getPendingQuestionGate` (lines 121-125):

```js
function getPendingQuestionGate(projectId, taskIds = null) {
  const gates = gateBridge.listPending({ projectId }).filter((gate) => gate.kind === 'question');
  const scoped = taskIds ? gates.filter((g) => taskIds.has(g.taskId)) : gates;
  return scoped[0] || null;
}
```

The `_requireApprovedTask` path correctly passes a session-scoped
`taskIds` filter. Other call sites in
`SdlcWorkflowService.startNextAgentIfAvailable`
(`workflowOrchestrator.js:604`) also pass a session-scoped
`taskIds`. But the FE-facing `listPendingApprovals` controller
passes ONLY `taskId` / `projectId` (controller:240-246), and the
listing is project-scoped by default.

### Files

- `backend/src/services/SdlcWorkflowService.js:1580-1618`
- `backend/src/services/gateManager.js:121-125`
- `backend/src/services/workflowOrchestrator.js:597-606`
- `backend/src/controllers/SdlcController.js:240-254`

### Functions

- `gateManager.getPendingQuestionGate`
- `SdlcWorkflowService._requireApprovedTask`
- `SdlcWorkflowService.listPendingGates`
- `SdlcController.listPendingApprovals`
- `SdlcController.listAllInterventions`

### Impact

- For a single project running concurrent sessions, a question
  pending in one session DOES block downstream agents of OTHER
  sessions on the same project IF the lock check uses
  `getPendingQuestionGate` without a session filter.
- The `_requireApprovedTask` path applies the session filter;
  `_startNextAgentIfAvailable` calls `getPendingQuestionGate` with a
  session-scoped `taskIds` (`workflowOrchestrator.js:604`); but the
  dashboard's `listAllInterventions` endpoint (controller:607-675) does
  NOT differentiate, so a user sees pending questions from sibling
  sessions in the same project.

---

## G-8. `agentOutput` field exposes a non-stable, non-trimmed structure to FE

### Evidence

`SdlcWorkflowService._saveAgentData` (line 2032):

```js
await Task.update(task.id, {
  …
  agentOutput: completedData,
  …
});
```

`completedData` is the full agent output (mock or real). It carries
runtime metadata (`summary`, `token_usage`, `observability`,
`runner`, `cli_session_id`, `cli_total_cost_usd`,
`cli_session_id`, etc.) that the wire contract (`sdlcConstants`
`OUTPUT_CONTRACTS`) does NOT mention.

The FE reads this field via `getTaskStatus` →
`controllers/SdlcController.js:444` (`agent_output:
task.agentOutput || null`).

### Files

- `backend/src/services/SdlcWorkflowService.js:2025-2034`
- `backend/src/controllers/SdlcController.js:444`
- `backend/src/agents/claudeCodeRunner.js:307-313`
- `backend/src/services/agentContract.js`

### Functions

- `_saveAgentData`
- `getTaskStatus`
- `normalizeOutput` (claude-code runner, sets the observability
  block)

### Impact

- FE reducers must handle the addition of new fields in
  `agentOutput` even when the contract hasn't changed.
- Mock path and real-agent path produce slightly different shapes
  (mock adds `feature_request`, real-claude adds `cli_*` metadata).
  Reducers that assume the mock shape break on real runs.

---

## G-9. `repoService.commitAndPushOnApprove` swallows push errors silently in some paths

### Evidence

`commitAndPushOnApprove` (repoService.js:487-566):

- Step 1 (`add` + `commit`) throws and returns with
  `result.reason = 'commit failed: …'` on error (line 530-533).
- Step 2 (`push`) is wrapped in `try { … } catch (err) { result.pushError = …; log(...); }` (line 543-564). The function returns without throwing.

However, `SdlcWorkflowService.resolveOutputReviewGate` (line 506-520)
calls `commitAndPushOnApprove` BEFORE the gate-resolved audit row is
written and BEFORE `_startNextAgentIfAvailable`. If the commit step
returns with `result.reason`, no exception is thrown to the caller
(`commitAndPushOnApprove` returns the result object). The pipeline
proceeds regardless.

### Files

- `backend/src/services/repoService.js:487-566`
- `backend/src/services/SdlcWorkflowService.js:506-520`

### Functions

- `repoService.commitAndPushOnApprove`
- `SdlcWorkflowService.resolveOutputReviewGate`

### Impact

- A failed `add` + `commit` does NOT block the pipeline. The next
  agent fires with whatever state was committed (which may be
  nothing).
- The push failure path correctly logs to `runtime_log` via
  `onLog`, but the commit-failure path is logged only via
  `onLog('auto-commit skipped…')` — no Sentry / 5xx; no visible
  signal to the FE beyond the `runtime_log` line.

---

## G-10. `_runAgent` does not persist a `task_started` envelope when the sessionId is missing

### Evidence

`Task.create` (models/Task.js:21-87):

```js
const envelope = data.sessionId
  ? await publishEvent('task_started', …)
  : null;
…
} else {
  await tx.agentEvent.create({
    data: { …, sessionId: null, sequence: 1, type: 'task_queued', … },
  });
}
```

So pre-session-bound (legacy) `Task.create` writes an AgentEvent row
with `sessionId=null` and `sequence=1`. `sequenceService.next` is
never called for this path.

### Files

- `backend/src/models/Task.js:25-83`

### Functions

- `TaskModel.create`

### Impact

- The legacy replay path (`AgentEvent.list({ sessionId })`) skips
  these rows entirely (`where: { sessionId: data.sessionId, … }`).
- `sequence: 1` is a hardcoded magic number that does NOT participate
  in the per-session sequence space and cannot be deduplicated
  against other rows.
- These rows are reachable only if `data.sessionId` is not passed at
  `Task.create`. The current SDLC orchestrator passes `sessionId`
  for every new task (orchestrator:93, 351, 446, 492, 576). The legacy
  branch is **NOT VERIFIED** to be reachable on the current
  claude-code or mock paths.

---

## G-11. `MOCK_SCENARIO_PROFILES` is a one-entry map; no fallback scenarios

### Evidence

`backend/src/services/sdlcConstants.js:447-449`:

```js
const MOCK_REVIEW_STAGES = ['po-agent', 'ux-agent', 'dev-agent'];
const DEFAULT_MOCK_SCENARIO = 'happy_path';
…
const MOCK_SCENARIO_PROFILES = {
  happy_path: { … },
};
```

The `defaultScenario` is the only entry; any non-`happy_path` value
falls through to `happy_path` (workflowHelpers.js:21-28).

### Files

- `backend/src/services/sdlcConstants.js:447-457`
- `backend/src/services/workflowHelpers.js:15-28`

### Functions

- `resolveMockScenario`
- `applyScenarioNarrative`
- `buildScenarioBrief`

### Impact

- The mock runner always produces a passing scenario. Failure-path
  testing must be done against the real runner or by direct
  injection.

---

## G-12. `arch_runtime.js` and diagnostic scripts are unreachable from `npm test`

### Evidence

- `backend/arch_runtime.js` (1638 bytes, mtime 12:18 30 Thg 6): imports
  `claudeCodeRunner.runAgent`, runs against a hand-coded feature
  request, exits.
- `backend/scripts/{cancelTimeoutSmoke,demoSmokeClaudeCode,realRunnerSmoke,resumeGateSmoke,spikeClaudeAgentSdk,sseReplaySmoke,staleWorkerSmoke}.js`:
  ad-hoc smoke scripts. None referenced in
  `backend/package.json` `scripts`.

### Files

- `backend/arch_runtime.js`
- `backend/scripts/*.js`
- `backend/package.json`

### Functions

- `arch_runtime.js` IIFE
- (none — they are top-level scripts)

### Impact

- Drift: the runner has been modified since these scripts were
  written. The runner signature has remained compatible so far, but
  the scripts are dead code from the production system's perspective.
- CI never runs them; failures there cannot block merges.

---

## G-13. Dead backend modules with no current importers

### Evidence

`grep` over the source tree for importers:

| Module                          | Files importing it                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `backend/src/utils/agentParser.js` | **NO IMPORTERS**                                                                                              |
| `backend/src/services/authService.js` | **NO IMPORTERS**                                                                                          |
| `backend/src/middleware/validation.js` | **NO IMPORTERS** (only the `validate` export)                                                              |
| `backend/src/services/QualityGateService.js` | `SdlcWorkflowService.js` only (one call site)                                                        |
| `backend/src/services/DocumentService.js` | `controllers/DocumentController.js`                                                                   |
| `backend/src/services/FolderService.js`   | `controllers/FolderController.js`                                                                     |
| `backend/src/services/ProjectService.js`  | `controllers/ProjectController.js`                                                                    |
| `backend/src/services/SessionStateService.js` | `controllers/SessionStateController.js`                                                           |
| `backend/src/services/TreeService.js`     | `controllers/TreeController.js`                                                                       |

`agentParser.js`, `authService.js`, `validation.js` are
unreachable. The other legacy services are reachable only via their
respective controllers, which are NOT on the SDLC pipeline hot path.

### Files

- `backend/src/utils/agentParser.js`
- `backend/src/services/authService.js`
- `backend/src/middleware/validation.js`

### Functions

- (entire modules)

### Impact

- No runtime impact (they are never loaded).
- They confuse static analysis and increase the attack surface
  area for unknown CVEs in dormant dependencies (mammoth, pdf-parse
  in `DocumentService.js`).

---

## G-14. SSE controller allocates a fresh sequence on every reconnect

### Evidence

`backend/src/controllers/SdlcController.js:313-378`:

```js
const cursorRaw = req.headers['last-event-id'] ?? req.query.after_sequence ?? 0;
let lastSeq = Number.isFinite(Number(cursorRaw)) ? Number(cursorRaw) : 0;
const isResume = lastSeq > 0;
…
await publishEvent(snapshotType, …);
```

`publishEvent` always calls `sequenceService.next` (eventPublisher.js:24),
which always increments. So every reconnect — even a no-op reconnect
with `Last-Event-ID` = the current HEAD — allocates a new sequence
number for the same logical `session_resumed` event.

### Files

- `backend/src/controllers/SdlcController.js:313-378`
- `backend/src/services/eventPublisher.js:17-28`
- `backend/src/services/sequence.js:42-49`

### Functions

- `SdlcController.streamPipelineStatus`
- `eventPublisher.publishEvent`
- `sequenceService.next`

### Impact

- Per-session sequence counter leaks by 1 per reconnect.
- Idempotency is per `Last-Event-ID`, so the wire consumer can
  still dedupe. The persisted `AgentEvent` table accumulates extra
  `session_resumed` rows.
- NOT VERIFIED: how fast the counter can be exhausted. The counter
  has no upper bound; Int32 max is 2^31-1 ≈ 2.1B, which would
  require ~22 reconnect-per-second over 3 years to overflow. Under
  ordinary use this is negligible.

---

## G-15. `feature_request` artifact is double-persisted

### Evidence

`SdlcWorkflowService._saveAgentData` (line 1829): `feature_request` is
in the master `artifactTypes` array. The same data is also persisted
on `Task.observability.featureRequest` at
`workflowOrchestrator.runArchitectureAgent` (line 107) and
`runPOAgent` (line 358).

### Files

- `backend/src/services/SdlcWorkflowService.js:1829`
- `backend/src/services/workflowOrchestrator.js:107, 358`

### Functions

- `workflowOrchestrator.runArchitectureAgent`
- `workflowOrchestrator.runPOAgent`
- `_saveAgentData` (artifact loop)

### Impact

- Two sources of truth for the same input string.
- A rewriter that edits one but not the other would create a
  desynchronisation.

---

## G-16. `HitlDecision.reviewerId` is always `null`

### Evidence

`SdlcWorkflowService` and `releaseManager` both create `HitlDecision`
rows with `reviewerId: user?.id || null`
(SdlcWorkflowService.js:212, 523, 391, etc.). The auth middleware
unconditionally sets `req.user.id = 'local-user-id'`
(`backend/src/middleware/authMiddleware.js:1-10`). So `reviewerId` is
set to the literal string `'local-user-id'`, NOT null.

### Files

- `backend/src/middleware/authMiddleware.js:1-10`
- `backend/src/services/SdlcWorkflowService.js:204-230, 521-527`

### Functions

- `authMiddleware`
- `submitGateDecision`
- `resolveOutputReviewGate`
- `submitReleaseDecision`

### Impact

- The audit trail always records `'local-user-id'` as the reviewer.
- No multi-user / RBAC enforcement is possible from the
  `HitlDecision` row alone.
- (Cross-reference: freeze doc I-13 records this as a known issue.)

---

## G-17. `releaseGate.canDecide` always returns `true` for the bypass build

### Evidence

`SdlcWorkflowService.js:1212-1213`:

```js
canDecide: ['owner', 'admin'].includes(membership?.role),
```

`membership` is computed at line 1132-1134:

```js
const membership = user
  ? await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer'])
  : null;
```

`MembershipService` is the inline stub declared at lines 20-31
returning `{ role: 'owner' }` for every call. So
`membership.role === 'owner'` always.

### Files

- `backend/src/services/SdlcWorkflowService.js:20-31, 1132-1134, 1212-1213`
- `backend/src/services/releaseManager.js:33-44`

### Functions

- `SdlcWorkflowService.getWorkflowStatus`
- `releaseManager.submitReleaseDecision` (separate but equivalent
  check at lines 42-44)

### Impact

- UI sees `canDecide: true` always.
- The role-based branch never narrows.

---

## G-18. `archAskEnforcer.ENFORCED_ROLES` does not cover legacy `intent-agent`

### Evidence

`backend/src/services/archAskEnforcer.js:28-35`:

```js
const ENFORCED_ROLES = new Set([
  'architecture-agent', 'po-agent', 'ux-agent',
  'dev-agent', 'qa-agent',
]);
```

`sdlcConstants.AGENT_GATES` (lines 8-15) includes both
`'architecture-agent'` and `'intent-agent'`:

```js
const AGENT_GATES = {
  'architecture-agent': 'ARCHITECTURE_GATE',
  'intent-agent': 'REQUIREMENT_GATE',
  …
};
```

### Files

- `backend/src/services/archAskEnforcer.js:28-35`
- `backend/src/services/sdlcConstants.js:8-15`

### Functions

- `archAskEnforcer.enforceAskUserQuestion`

### Impact

- If an `intent-agent` task is created (legacy code path), the
  enforcement loop returns the single-shot result and does NOT
  re-run on BLOCKER violations.
- In current source no `workflowOrchestrator.runIntentAgent` exists
  (the orchestrator only has `runArchitectureAgent` and the chain
  agents). So this gap is dormant on the current code path. NOT
  VERIFIED under all historical data.

---

## G-19. `eventsSec` deduplication set is module-level and unbounded-per-process

### Evidence

`backend/src/services/eventBus.js:21-25`:

```js
/** scopeKey (sessionId) -> Set<(envelope) => void> */
const sessionSubscribers = new Map();
/** projectId -> Set<(envelope) => void> */
const projectSubscribers = new Map();
```

There is no upper bound on subscriber count or message rate. The
in-memory `pending` map in `gateBridge.js:28` is similarly unbounded.

### Files

- `backend/src/services/eventBus.js`
- `backend/src/services/gateBridge.js:28-32`

### Functions

- `eventBus.subscribe` / `eventBus.subscribeProject`
- `gateBridge.requestGate`

### Impact

- Long-running processes accumulate listeners and pending records.
  The `_clearAll` helper exists for tests only.
- A backend running for days accumulates: every open SSE connection
  adds a subscriber; every `requestGate` adds a pending record (only
  cleaned on `resolveGate`).
- The number of records is bounded by concurrent SSE connections +
  in-flight gates, not by time. NOT VERIFIED under prolonged load.

---

## G-20. `sandbox/` (Python agents) referenced only by `agents/Dockerfile`; absent from runtime

### Evidence

`agents/Dockerfile` mentions `sandbox/` (per `02_DIRECTORY_MAP.md`
summary). No current source under `agents/src/` references it in
the `grep` audit.

### Files

- `agents/Dockerfile`
- `agents/sandbox/`

### Functions

- (none observed)

### Impact

- `sandbox/` is unused on the current execution path; its role is
  not documented in any reviewed source comment.

---

## NOT VERIFIED

The following were not fully confirmed from the source tree:

- Whether the `_resumeInterruptedTask` race in G-4 actually surfaces
  an error to `recoverInterruptedGates`'s caller or is fully swallowed
  by the `.catch` block. The catch block is at
  `SdlcWorkflowService.js:1782` and `SdlcWorkflowService.js:1794` but
  the throw is inside `_runAgent` (not `_resumeInterruptedTask`
  itself), so the catch wraps the right promise.
- Whether the SSE replay (G-6) actually drops rows in current dev
  usage. The dev DB may or may not contain legacy rows without
  envelope. (NOT VERIFIED: no DB inspection performed in this
  read-only audit.)
- Whether the dev DB contains `pipeline_completed` rows from prior
  runs (before the asymmetry was introduced).
- Whether `validation.js`, `authService.js`, and `agentParser.js`
  are reachable from any historical test setup.
- The exact count of legacy `AgentEvent` rows present in
  `backend/prisma/dev.db` at audit time.