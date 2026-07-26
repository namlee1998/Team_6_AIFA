# 05 — State Drift (Phase 2)

> **Status:** READ-ONLY. Compare actual state machines with the runtime
> observed in current source. Document implicit transitions, hidden
> transitions, multiple owners, skipped states, terminal violations.
> Evidence only.

The declared state machine lives in
`backend/src/services/taskLifecycleService.js:11-21`
(`TRANSITIONS`) and the lifecycle → wire-event mapping at
`taskLifecycleService.js:23-32, 34-45`. The runtime is observed
through every `Task.update`, `taskLifecycle.transition`,
`gateBridge.*`, and `releaseManager` call in the source tree.

---

## 1. `Task.executionStatus` (canonical machine)

### Declared

```
queued        → dispatched / running / cancelled
dispatched    → running / cancelled / timeout
running       → awaiting_gate / completed / failed / cancelled / timeout
awaiting_gate → running / failed / cancelled / timeout
{completed, failed, cancelled, timeout} → (none; terminal)
```

TERMINAL = `{completed, failed, cancelled, timeout}`.

### Implicit transitions observed

#### IT-1 — `queued → running` via direct `taskLifecycle.transition`

`_runAgent` (`agentDispatcher.runAgent:312-316`) does:

```js
await Task.update(task.id, { status: 'processing' });
await taskLifecycle.transition(task.id, 'running', { … });
```

This is the canonical entry to `running`. Implicit because the
source does not document it as a transition — the machine
silently consumes `queued → running`.

#### IT-2 — `running → completed` via `_saveAgentData`

`_saveAgentData:2041-2044` calls
`taskLifecycle.transitionIfPresent(taskId, 'completed', …)`. Implicit
because the persist path goes through `transitionIfPresent`, not
the stricter `transition`.

#### IT-3 — `dispatched → running` and `dispatched → timeout` in
sweeper

`taskWorkerService.sweepStale:151-157`:

```js
const terminal = t.executionStatus === 'dispatched' ? 'timeout' : 'failed';
try {
  await taskLifecycle.transitionIfPresent(t.id, terminal, …);
  await prisma.task.update({ … status: 'failed', … });
  …
}
```

The `transitionIfPresent` call says `dispatched → timeout` (per the
matrix); the subsequent `prisma.task.update` writes
`status: 'failed'` to the LEGACY `Task.status` field. So the
runtime observes two parallel writes per sweep.

### Hidden transitions observed

#### HT-1 — `awaiting_gate → running` is NOT in the matrix but is
attempted by `_resumeInterruptedTask`

`SdlcWorkflowService._resumeInterruptedTask:1777-1784` calls
`this._runAgent(task, context, null)`. `_runAgent` →
`agentDispatcher.runAgent` →
`taskLifecycle.transition(task.id, 'running', …)`. The current
state is `awaiting_gate`. The matrix does not allow this edge.

The matrix allowed transitions from `awaiting_gate` are:
`running`, `failed`, `cancelled`, `timeout`. So this is a **hidden
transition** that the matrix would reject.

**Evidence**:
- `backend/src/services/SdlcWorkflowService.js:1777-1784`
- `backend/src/services/agentDispatcher.js:312-316`
- `backend/src/services/taskLifecycleService.js:11-21`

**Impact**: every `awaiting_gate` task whose backend is restarted
will fail to resume. The catch block at
`SdlcWorkflowService.js:1782` swallows the error, but the agent run
never starts.

See `03_PIPELINE_GAPS.md G-4` for full analysis.

#### HT-2 — `awaiting_gate → running` from `gateBridge.resolveGate`

`gateBridge.resolveGate:170-174`:

```js
if (rec.kind !== 'output_review') {
  await taskLifecycle.transitionIfPresent(rec.taskId, 'running', {
    actor: 'human',
    payload: …,
    eventType: 'gate_resolved',
  });
}
```

This is the documented transition (the matrix includes
`awaiting_gate → running`). It is `transitionIfPresent` so an
already-terminal task is silently skipped. The check is
`rec.kind !== 'output_review'`, meaning `tool` / `question` /
`release` do this; `output_review` does not (the agent thread is
gone by the time the gate is created).

### Multiple owners observed

#### MO-1 — `Task.status` vs `Task.executionStatus`

Both fields are on the same row, but only `executionStatus` is
governed by `taskLifecycle.transition`. `Task.status` is written by:

- `agentDispatcher.runAgent:312` (`status:'processing'`)
- `SdlcWorkflowService._saveAgentData:2026` (`status:'completed'`)
- `agentDispatcher.markTaskFailed:535` (`status:'failed'`)
- `agentDispatcher.handleTaskTimeout:562` (`status:'failed'`)
- `SdlcWorkflowService.cancelTask:1718` (`status:'cancelled'`)
- `taskWorkerService.sweepStale:160` (`status:'failed'`)
- `SdlcWorkflowService._resumeAgentStream:1440` (legacy;
  `status:'PENDING_TOOL_APPROVAL'`)
- `agentDispatcher` (legacy langchain; `status:'PENDING_TOOL_APPROVAL'`)

Eight owners. None of them consult the state machine. The two
fields can disagree. The legacy string
`'PENDING_TOOL_APPROVAL'` is not in any documented state set.

See `03_PIPELINE_GAPS.md G-3` for the full list.

### Skipped states observed

#### SS-1 — `dispatched` is rarely used

The `dispatched` state is reachable in theory (matrix entry
`queued → dispatched`). In current source, the only producer is
implicit: `taskWorker.claim:34-45` uses
`executionStatus: { in: ['queued', 'dispatched', 'running'] }` but
never explicitly sets `dispatched`. The state machine silently
allows `queued → running` (the canonical entry path). So
`dispatched` is effectively a dead state in current runtime.

#### SS-2 — `Task.versionStatus` has no `draft → committed` trace

`Task.versionStatus` defaults to `'committed'` in
`schema.prisma:75`. New tasks created via `Task.create` overwrite
to `'draft'` (orchestrator:97, 353, 448, 494, 578). When a row is
created via `prisma.task.create({ … })` directly (without going
through the model wrapper), the default `'committed'` would apply.
No current call site bypasses the wrapper, so this default is
deactivated in practice. NOT VERIFIED.

### Terminal violations observed

#### TV-1 — `awaiting_gate → running` (HT-1 above)

The matrix forbids `awaiting_gate → running` (it allows only
`running / failed / cancelled / timeout`). `_resumeInterruptedTask`
attempts it. The state machine throws
`"Invalid task transition: awaiting_gate -> running"`.

#### TV-2 — `completed → running` via double approve path

`_autoApproveSafeOutput` (`SdlcWorkflowService.js:2123-2162`)
calls `Task.commitTask(task.id)` (which sets `versionStatus:
'committed'`) and `HitlDecision.create(...)`. It does NOT call
`taskLifecycle.transition`. So `executionStatus` stays at
`'completed'` (no change). `Task.status` is already
`'completed'`. **No violation observed**, but the dual-state
invariant (`status === 'completed'` AND `executionStatus ===
'completed'`) is maintained by coincidence, not by enforcement.

#### TV-3 — `releaseGate` permits no `running → completed` edge

The pipeline achieves "session completed" via
`PipelineSession.update({ status: 'completed' })`
(releaseManager.js:168), NOT via any `executionStatus` change. So
`release` is a session-level transition, not a Task transition.
The Task `executionStatus` for QA is `'completed'` after the
output-review approve. There is no `executionStatus` transition
that ties to the release decision.

---

## 2. `Task.versionStatus` (draft → committed)

### Declared

`Task.versionStatus` (schema.prisma:75) is `'committed'` by default.
`Task.create` writes `'draft'`. `Task.commitTask` (Task.js:214-220)
writes `'committed'`.

### Observed transitions

- `draft → committed` via:
  - `submitGateDecision:216` (`Task.commitTask(taskId)`)
  - `submitStructuredDecision:322` (`Task.commitTask(taskId)`)
  - `resolveOutputReviewGate:496` (`Task.commitTask(task.id)`)
  - `_autoApproveSafeOutput:2133` (`Task.commitTask(task.id)`)

### Multiple owners observed

#### MO-2 — `versionStatus` written alongside `outputVersion`

`submitStructuredDecision:320-321`:

```js
const newVersion = (task.outputVersion || 0) + (action === 'edit_approve' ? 1 : 0);
await Task.update(task.id, { approvedOutput, outputVersion: newVersion, version_status: 'committed' });
```

A single `Task.update` writes both `outputVersion` and
`version_status` (`'committed'`). Two writers, one update.

`resolveOutputReviewGate:495` writes `version_status: 'committed'`
and `approvedOutput: task.agentOutput` together.

The fields are co-written by structured HITL and output-review
approves; the legacy `submitGateDecision` path uses `Task.commitTask`
without `outputVersion`. The two paths converge on `versionStatus`
but diverge on `outputVersion`.

### Hidden transitions observed

#### HT-3 — `versionStatus` does not transition back to `'draft'` on rework

`_rerunOwningWorker` (`SdlcWorkflowService.js:953-994`) does NOT
reset `versionStatus` to `'draft'`. A rerun keeps
`versionStatus='committed'`. The downstream agent's
`requireApprovedTask:1602-1604` check passes regardless. So a
rerun does NOT change the gate between "approved" and "draft."

**Evidence**: `SdlcWorkflowService.js:953-994`.

#### HT-4 — `versionStatus` may be set to `'committed'` before the
runtime transition

The `Task.update({ version_status: 'committed', … })` in
`submitStructuredDecision:321` and `resolveOutputReviewGate:495`
runs BEFORE the next agent is dispatched. If the dispatch fails
(e.g. `requireApprovedTask` throws), the row is left at
`versionStatus='committed'` with the predecessor approved but no
successor started.

---

## 3. `PipelineSession.status`

### Declared transitions (observed)

- `running → awaiting_release` (SdlcWorkflowService.js:558).
- `awaiting_release → completed` (releaseManager.js:168).

### Skipped states observed

#### SS-3 — No `running → failed` / `running → cancelled` transition

A session whose tasks all fail or get cancelled stays at
`PipelineSession.status='running'` indefinitely. No path writes
`'failed'` or `'cancelled'` to this column.

#### SS-4 — No `awaiting_release → running` reset

A `release` REJECT does NOT reset the session to `'running'`. The
session stays at `'awaiting_release'` after a REJECT. (The
`releaseManager.submitReleaseDecision:53-57` check throws 409
on a prior REJECT, so the REJECT is also a terminal event for the
session.)

### Hidden transitions observed

#### HT-5 — `PipelineSession.status` not updated by orphan-task paths

If a `PipelineSession` is created but every Task in it is deleted
(or the workflow never starts), the session row stays `'running'`
forever. NOT VERIFIED whether `countActive`
(`PipelineSession.js:48-59`) ever decrements after a session
aborts.

---

## 4. `PendingGate.status`

### Declared transitions (observed)

- `pending → resolved` (gateBridge.js:163).
- `pending → rejected` (gateBridge.js:163).
- `pending → timed_out` (gateBridge.js:163).
- `pending → interrupted` (gateBridge.js:226-228, boot recovery).

### Hidden transitions observed

#### HT-6 — `'interrupted'` has no exit transition

After `markOrphanedPendingInterrupted`, every `pending` gate is
flipped to `'interrupted'`. No code path observes
`'interrupted'` and re-prompts or auto-resolves. The gate stays
`'interrupted'` until manually cleared.

`SdlcWorkflowService.resolveApproval:351-353` checks for
`'interrupted'` and returns 409 if the gate is in that state. So
the gate is observable as "permanently stuck."

#### HT-7 — `kind='release'` gates bypass the canonical flow

For `kind='release'` (`SdlcWorkflowService.js:559-577`):

- `gateBridge.requestGate` writes the `PendingGate` row.
- No SDK awaits the in-memory Promise.
- The user submits a decision via
  `releaseManager.submitReleaseDecision`.
- `gateBridge.resolveGate` is NOT called by
  `releaseManager.submitReleaseDecision`. Instead, the manager
  directly writes the `HitlDecision` row.

So the `PendingGate` row for `kind='release'` is created at
QA-approve time and never explicitly resolved. It is observable
on the DB as `status='pending'` forever (or `'rejected'` /
`'resolved'` only if some other code path finds it).

**NOT VERIFIED** whether `gateBridge.resolveGate` is ever called
on `kind='release'` approvalIds. Reading the source, it is not.

#### HT-8 — `gateBridge.resolveGate` race

`gateBridge.resolveGate:154-194` consults `pending.get(approvalId)`
first. Under racing callers (see `03_PIPELINE_GAPS.md G-5`), only
the first caller wins the in-memory mutation; the second caller
publishes a second `gate_resolved` envelope. The Promise's
`resolve` is idempotent, so the SDK side is safe.

---

## 5. `HitlDecision` (append-only, but value-shaped)

### Declared

Append-only. `decisionId` is unique (idempotency).

### Implicit transitions observed

#### IT-4 — Two durable records for `kind='release'` (per HT-7)

For `kind='release'`, the durable record of the decision is the
`HitlDecision` row. The `PendingGate` row remains un-resolved (per
HT-7). The two records are correlated only by `approvalId` (on
the `PendingGate` row) and `taskId` (on the `HitlDecision` row).

The `getAuditTrail` consumer
(`SdlcWorkflowService.js:833-862`) reads only `HitlDecision`. The
`PendingGate` row is invisible.

#### IT-5 — `decision='CLARIFICATION'` is novel

The question branch (`SdlcWorkflowService.js:381-396`) writes
`decision='CLARIFICATION'` / `action='answer'`. The documented
decision enum in `freeze 06_EVENT_INVENTORY.md` lists only
`APPROVE / REJECT / REQUEST_CHANGES / CLARIFICATION` (with
`CLARIFICATION` noted). Consumers
(`workflowQueries.js:187-192`) lump `decision='CLARIFICATION'` with
the rest of the rejection count, but `getAuditTrail`
(`SdlcWorkflowService.js:776-784`) does not surface a distinct
state for `decision='CLARIFICATION'`.

---

## 6. Cross-cutting observations

### Two state machines co-exist on `Task`

- `Task.executionStatus` (canonical; `taskLifecycle.transition`).
- `Task.status` (legacy; direct writers).

The freeze documents `executionStatus` as the canonical state
machine but does not address `Task.status` as a parallel field.
The two fields can disagree; neither enforces the other.

### Implicit terminal-violation recoveries

`transitionIfPresent` (taskLifecycleService.js:159-182) is the
race-tolerant variant. It catches `Invalid task transition` errors
and returns `null`. This means the state machine is enforced
optimistically — every transition attempt is best-effort and
silently skipped if the row is already in a terminal state.

This is the only safety net for HT-1 (`awaiting_gate → running` in
`_resumeInterruptedTask`). But `_runAgent` calls `transition`,
not `transitionIfPresent` (agentDispatcher.js:312-316), so the
error from HT-1 is NOT swallowed — it propagates to the catch in
`recoverInterruptedGates`.

### State-machine bypass via `prisma.task.update`

`taskWorkerService.sweepStale:160` and the legacy langchain path
(`agentDispatcher.js:441-444`) write `Task.status` via
`prisma.task.update` directly, bypassing both `taskLifecycle.transition`
and the model wrapper. The state machine cannot detect or reject
these writes.

---

## 7. NOT VERIFIED

The following could not be fully confirmed:

- Whether the `transition` failure from HT-1 is actually logged at
  Sentry. The catch at `recoverInterruptedGates:1794` calls
  `logger.warn(...)`, but whether the throw reaches that catch is
  dependent on whether `_runAgent` propagates the throw (the catch
  inside `_runAgent`'s caller chain at `agentDispatcher.runAgent`
  is unclear without a deeper walk).
- The exact behaviour of `releaseGate.canDecide` in the absence of
  the auth bypass. The bypass currently always returns `'owner'`,
  so the role-based check at
  `SdlcWorkflowService.js:1212-1213` never narrows. Whether the
  check itself is well-formed (vs. a single condition) is unverified.
- Whether `PipelineSession.status` ever transitions back to
  `'running'` after a REJECT release (no path observed; NOT
  VERIFIED exhaustively).