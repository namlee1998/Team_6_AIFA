# 02 — State Machines (Phase 1 Audit)

> **Status:** READ-ONLY AUDIT. State transitions as currently declared
> by `taskLifecycleService.TRANSITIONS` and `EVENT_BY_STATUS`, with
> concrete observed transitions in current code and any illegal
> transitions found.
>
> Every observation is cited to file:line. **NOT VERIFIED** marks
> statements that cannot be confirmed from the source tree.

This document covers five state machines observable in the current
implementation:

1. `Task.executionStatus` (the canonical state machine)
2. `Task.status` (separate from executionStatus; lifecycle marker)
3. `Task.versionStatus` (draft → committed)
4. `PipelineSession.status` (running → awaiting_release → completed)
5. `PendingGate.status` (pending → resolved | rejected | timed_out |
   interrupted)
6. `HitlDecision` is append-only; no state machine (single insertion per
   decision).

The name **Pipeline** in the spec header refers to the
`PipelineSession` row, not a separate entity.

---

## 1. Task executionStatus (canonical state machine)

### States

Declared in
`backend/src/services/taskLifecycleService.js:11-21`:

```js
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timeout']);
const TRANSITIONS = {
  queued:        new Set(['dispatched', 'running', 'cancelled']),
  dispatched:    new Set(['running', 'cancelled', 'timeout']),
  running:       new Set(['awaiting_gate', 'completed', 'failed', 'cancelled', 'timeout']),
  awaiting_gate: new Set(['running', 'failed', 'cancelled', 'timeout']),
  completed:    new Set(),
  failed:       new Set(),
  cancelled:    new Set(),
  timeout:      new Set(),
};
```

So the canonical set is:

| State          | Notes                                                                 |
| -------------- | --------------------------------------------------------------------- |
| `queued`       | initial state at `Task.create` (default in schema.prisma:84)         |
| `dispatched`   | used by `taskWorker.claim` (taskWorkerService.js:34-45)              |
| `running`      | the agent is actively executing                                        |
| `awaiting_gate`| a `PendingGate` row is pending for this task                          |
| `completed`    | terminal (success)                                                     |
| `failed`       | terminal (runner error)                                                |
| `cancelled`    | terminal (user cancel)                                                 |
| `timeout`      | terminal (execution budget exceeded)                                   |

`TERMINAL` set is `{completed, failed, cancelled, timeout}`
(taskLifecycleService.js:11).

### Allowed transitions (matrix)

| From → to      | dispatched | running | awaiting_gate | completed | failed | cancelled | timeout |
| -------------- | :--------: | :-----: | :-----------: | :-------: | :----: | :-------: | :-----: |
| queued         |     ✓      |    ✓    |               |           |        |     ✓     |         |
| dispatched     |            |    ✓    |               |           |        |     ✓     |    ✓    |
| running        |            |         |       ✓       |     ✓     |   ✓    |     ✓     |    ✓    |
| awaiting_gate  |            |    ✓    |               |           |   ✓    |     ✓     |    ✓    |
| completed      | (none)     |         |               |           |        |           |         |
| failed         | (none)     |         |               |           |        |           |         |
| cancelled      | (none)     |         |               |           |        |           |         |
| timeout        | (none)     |         |               |           |        |           |         |

### Transition owner

`taskLifecycleService.transition` is the **only** implementation path
that enforces this matrix
(`backend/src/services/taskLifecycleService.js:95-141`). It:

1. Peeks the task before the transaction
   (line 105) — required because `sequenceService.next` (called via
   `publishEvent`) does its own prisma read, and SQLite's
   `connection_limit=1` would deadlock on a nested read.
2. Validates `current → next` via `TRANSITIONS`. Throws
   `"Invalid task transition: <current> -> <next>"` on a violation
   (line 110-112).
3. Returns `task` early if `current === next` (line 109).
4. Pre-allocates the canonical envelope via `publishLifecycle`
   (line 119-124), then updates the row in `prisma.$transaction` and
   appends the `AgentEvent` row carrying the envelope
   (line 126-139).

`taskLifecycleService.transitionIfPresent` (lines 159-182) is the
race-tolerant variant: it catches `Task not found` and
`Invalid task transition` errors and returns `null` instead of
throwing.

### Observed transitions in current code

| Transition                 | Where observed                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `queued → running`         | `agentDispatcher.runAgent` (lines 312-316) — `Task.update({ status:'processing' })` then `taskLifecycle.transition(taskId, 'running', …)` |
| `dispatched → running`     | `taskWorker.sweepStale` does NOT explicitly transition; reclaim only sets `status:'failed'` directly (taskWorkerService.js:160)        |
| `running → awaiting_gate`  | `gateBridge.requestGate` (gateBridge.js:115-120) — gated by `skipByKind` / `skipByStatus` checks                                  |
| `awaiting_gate → running` | `gateBridge.resolveGate` (gateBridge.js:170-174)                                                                                    |
| `running → completed`     | `_saveAgentData` via `taskLifecycle.transitionIfPresent` (SdlcWorkflowService.js:2041-2044)                                          |
| `awaiting_gate → running` (also) | `_resumeInterruptedTask` does NOT go through `taskLifecycle` — it directly calls `this._runAgent(task, context, null)`, which re-enters `agentDispatcher.runAgent` which transitions `queued → running` (would fail if `executionStatus` is already `awaiting_gate`) |
| `* → failed`              | `markTaskFailed` (agentDispatcher.js:534-548), `cancelTask` (SdlcWorkflowService.js:1718-1723 — only `status:'cancelled'`), `handleTaskTimeout` (line 562) |
| `running → cancelled`     | `cancelTask` writes `status:'cancelled'` directly via `Task.update` (SdlcWorkflowService.js:1718); calls `taskLifecycle.transitionIfPresent(taskId, 'cancelled', …)` (line 1719) |
| `dispatched → timeout`    | `taskWorker.sweepStale` writes `status:'failed'` directly + calls `transitionIfPresent(taskId, 'timeout', …)` (taskWorkerService.js:151-157) |
| `running → timeout`       | `handleTaskTimeout` (agentDispatcher.js:557-566)                                                                                   |

### Illegal transitions found

| Illegal transition                             | Where                                                                                            | Effect                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `awaiting_gate → running` (lost `_resumeInterruptedTask` path) | `SdlcWorkflowService._resumeInterruptedTask` calls `_runAgent` directly. `agentDispatcher.runAgent` does `Task.update({status:'processing'})` then `taskLifecycle.transition(taskId, 'running', …)`. If `executionStatus` is `awaiting_gate`, this would throw `"Invalid task transition: awaiting_gate -> running"` from the matrix, BUT the actual call is **only triggered after `_resumeInterruptedTask` confirmed `executionStatus === 'awaiting_gate'`** (line 1778). Since `agentDispatcher.runAgent` does NOT call `transitionIfPresent` (it calls `transition` directly), this path would actually throw — likely surviving only because `_saveAgentData`'s try/catch silently swallows state transitions in some paths. **NOT VERIFIED** whether this races. |
| `Task.executionStatus` column bypassed (state machine bypass) | Many services write `status:` (the legacy `Task.status` field) without using `taskLifecycle.transition`: `_saveAgentData` (line 2026: `status:'completed'` via `Task.update`), `markTaskFailed` (line 535-537), `cancelTask` (line 1718), `handleTaskTimeout` (line 562), `taskWorker.sweepStale` (line 160). The `status` field is a legacy artefact — see §2 below. |
| `_resumeAgentStream` writes `status:'PENDING_TOOL_APPROVAL'` (SdlcWorkflowService.js:1440-1444, agentDispatcher.js:441-444) | This string is **not** in `TRANSITIONS`. It is therefore observable on the row but the state machine ignores it. It only appears on the LEGACY `langchain` real-agent path (not the canonical claude-code / mock paths). |

---

## 2. Task.status (legacy field, separate from executionStatus)

`Task.status` (schema.prisma:67) is a free `String` with default
`'pending'`. It is written by many call sites and is used for the
UI-facing coarse phase label.

### Observed values

- `'pending'` — `Task.create` default.
- `'processing'` — `agentDispatcher.runAgent` line 312.
- `'completed'` — `_saveAgentData` line 2026.
- `'failed'` — `markTaskFailed` line 535, `handleTaskTimeout` line 562,
  `taskWorker.sweepStale` line 160.
- `'cancelled'` — `cancelTask` line 1718.
- `'PENDING_TOOL_APPROVAL'` — legacy langchain path
  (`_resumeAgentStream`, agentDispatcher.js:443).

### Transition owner

None enforced. Call sites write directly via `Task.update({ status: … })`.

### Observed deviations

- `Task.status` and `Task.executionStatus` are not synchronized. A row
  can show `status:'completed'` while `executionStatus` is still
  `'awaiting_gate'`, or `status:'failed'` while `executionStatus` is
  `'running'`, etc.
- The `_saveAgentData` sequence:
  - Writes `Task.update({ status:'completed', … })` (line 2025).
  - Then `taskLifecycle.transitionIfPresent(taskId, 'completed', …)`
    updates `executionStatus` (line 2041).
  - Both are written before any user-visible state is consumed. Order
    is unimportant unless another writer slips in between.

---

## 3. Task.versionStatus (draft → committed)

### States

- `'draft'` — set at every `Task.create` (orchestrator:97,353,448,494,578).
- `'committed'` — set by `Task.commitTask(taskId)` (models/Task.js:214-220).

### Transitions

- `draft → committed` via `Task.commitTask` (the only writer).
- `committed → committed` is a no-op (re-commit is idempotent in effect
  because the column simply stays `'committed'`).
- `draft → draft` is the initial state.

### Transition owner

`Task.commitTask` (models/Task.js:214-220).

### Observed writes

- Every gate-resolution or output-review approve path:
  - `submitGateDecision` (SdlcWorkflowService.js:216: `Task.commitTask(taskId)`).
  - `submitStructuredDecision` (line 322).
  - `resolveOutputReviewGate` (line 496).
  - `_autoApproveSafeOutput` (line 2133).
- `_rerunOwningWorker` does NOT reset `versionStatus` to `'draft'`. A
  rerun keeps `versionStatus='committed'` from the previous iteration
  (no source explicitly resets it; this means
  `_requireApprovedTask` continues to pass on the next agent). This
  is **NOT VERIFIED** under all paths.

### Semantic invariant in code

`_requireApprovedTask` (SdlcWorkflowService.js:1580-1618):

```js
if (task.versionStatus !== 'committed') {
  throw new ApiError(400, 'Source task must be approved (committed) before running next agent');
}
```

So the next agent only fires when `versionStatus === 'committed'`.
This invariant is enforced at the start of every `runXAgent` (via
`requireApprovedTask`).

---

## 4. PipelineSession.status

### States

Declared as a free `String` with default `'running'` (schema.prisma:48).

### Observed values in current source

| Value                 | Where written                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `'running'`           | Initial at `PipelineSession.create` (orchestrator:84-88, 304-308).                                                                       |
| `'awaiting_release'`  | After QA `output_review` approve at SdlcWorkflowService.js:558.                                                                          |
| `'completed'`         | After release APPROVE at releaseManager.js:168.                                                                                           |

### Transitions (observed)

```
running ──(QA output_review approve + qaGatePassed + repoContext.repoPath)──► awaiting_release
   │
   └──(release APPROVE)──► completed
```

### Transition owner

- `PipelineSession.update` at orchestrator:162,330.
- `PipelineSession.update({ status:'awaiting_release' })` at
  SdlcWorkflowService.js:558.
- `PipelineSession.update({ status:'completed', outputDir })` at
  releaseManager.js:168.

### Allowed transitions (inferred from writes)

| From → to              | Trigger                                                     |
| ---------------------- | ----------------------------------------------------------- |
| `running → awaiting_release` | QA `output_review` approve with QA gate PASS and session repo |
| `awaiting_release → completed` | release APPROVE                                        |
| `completed → ...`      | terminal                                                    |

### Illegal transitions / NOT VERIFIED

- There is no guard preventing a second release APPROVE attempt on a
  session that is already `completed`. `releaseManager` blocks
  double-release by checking for a prior `HitlDecision.gate ===
  FINAL_GATE` with `decision ∈ {APPROVE, REJECT}` (releaseManager.js:52-57),
  but if `HitlDecision` rows are deleted out-of-band, the
  `PipelineSession.status='completed'` row would stay.
- There is no transition `running → failed` for sessions. If a session
  has all its tasks fail or be cancelled, the session row stays
  `running` indefinitely.

---

## 5. PendingGate.status

### States

Declared as free `String` with default `'pending'` (schema.prisma:223).

### Allowed transitions

`resolveGate` (gateBridge.js:154-194) computes the new status from the
incoming `result`:

```js
rec.status = result.timedOut
  ? 'timed_out'
  : (result.action === 'reject' ? 'rejected' : 'resolved');
```

So the explicit transitions are:

| From → to              | Trigger                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pending → resolved`   | Tool approval (`action:'approve'`), question answered, output_review approve, release approve                          |
| `pending → rejected`   | Tool rejection, `cancelTask` with `action:'reject'`, output_review reject, release REJECT                               |
| `pending → timed_out`  | GATE_TIMEOUT_MS exceeded (gateBridge.requestGate timer fires)                                                            |
| `pending → interrupted` | `markOrphanedPendingInterrupted` on every backend restart                                                                |

`getPending(approvalId)` returns `false` for any non-`pending` row;
in-memory resolution removes the gate from the live `pending` map.

### Transition owner

`PendingGate.resolve` (`backend/src/models/PendingGate.js:25-33`).

### Observed writes

- `PendingGate.create` (gateBridge.js:88-89): starts at `'pending'`.
- `PendingGate.resolve` (gateBridge.js:165): writes one of the three
  transitions above (`resolved`/`rejected`/`timed_out`).
- `PendingGate.markPendingInterrupted` (gateBridge.js:226-228, called
  from `server.js:122`): writes `pending → 'interrupted'` for every
  still-pending gate at boot.

### Illegal transitions / NOT VERIFIED

- There is no `interrupted → ...` transition. After a restart, the
  interrupted row stays. Phase-1 audit does not propose fixes; the
  field is observable as a permanent interrupt marker.
- Replays: `hasPending(approvalId)` and `getPending(approvalId)`
  read the **in-memory** map, not the DB. So a gate that was
  resolved (DB) but whose in-memory record was lost (process crash)
  returns `false` to `hasPending`. `SdlcWorkflowService.resolveApproval`
  catches this with `findPersisted` (SdlcWorkflowService.js:349-353)
  and returns 409 if `status === 'interrupted'`, else 404.

---

## 6. HitlDecision (append-only audit)

`HitlDecision` has no state machine. Each decision is a single insert.
`decisionId` is the idempotency key
(`@unique(schema.prisma:208)`). Re-submission with the same
`decisionId` returns the existing row (never re-processes).

### Decisions observed in current source

| `decision` (string) | `action` (string)                | Producer                                                      |
| ------------------- | -------------------------------- | ------------------------------------------------------------- |
| `APPROVE`           | `approve`                        | `submitGateDecision` (line 215); not at scale                 |
| `APPROVE`           | `edit_approve`                   | `submitStructuredDecision` (line 325)                          |
| `APPROVE`           | `auto_approve`                   | `_autoApproveSafeOutput` (line 2134)                          |
| `APPROVE`           | `release_approve`                | `releaseManager.submitReleaseDecision` (line 76)              |
| `REJECT`            | `reject`                         | `_handleGateRejection` (line 442)                             |
| `REJECT`            | `escalation_required`            | `_handleGateRejection` (line 432)                             |
| `REJECT`            | `release_reject`                 | `releaseManager.submitReleaseDecision` (line 76)              |
| `CLARIFICATION`     | `answer`                         | `resolveApproval` question branch (line 381)                  |

### "illegal" decisions

- The schema column `action` (schema.prisma:209) is a free
  `String?`. Any string is accepted by the DB; only consumers
  (mapping logic) gate by string values. **NOT VERIFIED** exhaustively
  whether every string the consumers check is also producible; a typo
  on the production side would result in a decision row that no
  consumer recognises.

---

## Cross-cutting observations

### AgentEvent envelope persistence asymmetry

`pipeline_completed` is published (releaseManager.js:173) but never
persisted to `AgentEvent`. All other canonical `EventType` values that
go through `taskLifecycle.transition` are persisted as
`AgentEvent.envelope` in the same `prisma.$transaction` as the
`Task` update. This makes `pipeline_completed` the only canonical
event type whose wire shape and persisted row count disagree.

(See freeze document I-1 for the original observation; this audit
confirms it.)

### `PENDING_TOOL_APPROVAL` state string

The literal string `'PENDING_TOOL_APPROVAL'` is used as a Task.status
value in the legacy langchain real-agent path
(`SdlcWorkflowService.js:1440-1444`, `agentDispatcher.js:441-444`). It
is not in `TRANSITIONS` and not in any documents listing the lifecycle.
This is **NOT VERIFIED** to be reachable on the canonical claude-code
or mock paths.

### `executionStatus` and `status` desynchronisation

Many writers mutate `Task.status` directly via `Task.update({ status:
… })` without using `taskLifecycle.transition`. The state-machine
that guards `executionStatus` (`TRANSITIONS`) does not apply to
`status`. Observers that branch on `status` alone will see
inconsistent values relative to `executionStatus`.

---

## NOT VERIFIED

The following could not be confirmed from the source tree:

- Whether the `_resumeInterruptedTask` race against
  `agentDispatcher.runAgent`'s direct `transition(taskId, 'running')`
  call actually surfaces an `Invalid task transition` error in
  practice. The error is wrapped in `transitionIfPresent` only on
  some paths (`_saveAgentData` uses `transitionIfPresent`; the
  `_runAgent` path inside `agentDispatcher.runAgent` uses
  `transition`).
- The exact set of legacy `AgentEvent` rows (with `payload` only,
  no `envelope`) that exist on the dev DB. This would require
  reading `backend/prisma/dev.db` to enumerate; not done in this
  read-only audit.
- Whether the `landing` of `task_queued` for the rare
  `sessionId=null` branch (models/Task.js:67-83) writes a row that the
  current SSE replay path actually surfaces. The replay is keyed by
  `sessionId` and these rows have `sessionId: null`.