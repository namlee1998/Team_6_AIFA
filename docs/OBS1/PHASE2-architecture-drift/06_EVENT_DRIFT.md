# 06 — Event Drift (Phase 2)

> **Status:** READ-ONLY. Audit event-driven behavior. For every event,
> identify the producer, consumer, payload, ordering, replay, and
> fan-out. Identify duplicate producers, missing consumers, unused
> events, multiple payload shapes.
>
> Baseline: `docs/engineering-freeze/06_EVENT_INVENTORY.md` and
> `docs/engineering-audit/02_STATE_MACHINE.md`.

The single canonical envelope DTO is `EventEnvelope`
(`backend/src/dto/eventEnvelope.js:34-45`). The single producer
facade is `eventPublisher.publishEvent`
(`backend/src/services/eventPublisher.js:17-28`). The single in-
process bus is `eventBus` (`backend/src/services/eventBus.js`).

---

## 1. Event-by-event audit

### 1.1 `session_started` / `session_resumed`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | `SdlcController.streamPipelineStatus:367`                                                                                                  |
| Consumer      | SSE writer → FE `sseClient.subscribe` → `applyEnvelope`                                                                                    |
| Payload       | `{ status, pipelinePhases, repoInfo, pendingGates, resumedFrom, log }`                                                                       |
| Ordering      | Always published AFTER `Last-Event-ID` cursor resolution and after replay (line 366).                                                       |
| Replay        | The envelope is live only; replay reads `AgentEvent` rows via `AgentEvent.list`. The bootstrap envelope is NOT replayed on a fresh reconnect that passes through the controller. |
| Fan-out       | Single consumer (the SSE client). `eventBus.subscribeProject` is the only subscriber.                                                |
| Drift         | DR-018: every reconnect allocates a fresh sequence (sequenceService.next is unconditional). The "resumed" envelope is logically identical to the previous one when nothing has changed. |

**Evidence**:
- `backend/src/controllers/SdlcController.js:313-378`
- `backend/src/services/eventPublisher.js:17-28`
- `backend/src/services/sequence.js:42-49`

---

### 1.2 `pipeline_completed`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | `releaseManager.submitReleaseDecision:173-186`                                                                                                |
| Consumer      | SSE writer → FE `sseClient.subscribe` → `applyEnvelope`. NO `AgentEvent.create` follow-up.                                                |
| Payload       | `{ qaResult: { status:'passed', coverage, blockers, warnings, reportUrl, commitSha:'see session.repoInfo' } }`                              |
| Ordering      | Emitted AFTER `PipelineSession.update({ status:'completed' })` and AFTER `git push` (best-effort).                                       |
| Replay        | NEVER persisted to `AgentEvent`. Reconnect consumers miss the terminal event.                                                              |
| Fan-out       | Single consumer (the SSE client).                                                                                                          |
| Drift         | DR-007 + DR-016: live-only envelope. The only canonical EventType whose wire shape is not persisted to the AgentEvent table.                |

**Evidence**:
- `backend/src/services/releaseManager.js:170-186`
- `backend/src/services/eventPublisher.js:17-28` (returns envelope;
  caller responsible for persistence).
- `backend/src/models/AgentEvent.js:21-41` (not called here).
- `backend/src/services/taskLifecycleService.js:95-141` (the
  pattern every other producer uses; not called here).
- `backend/src/controllers/SdlcController.js:340-357` (replay does
  not see this envelope).

---

### 1.3 `pipeline_failed`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | **NONE** — declared in the discriminator union (`dto/eventEnvelope.js:12`) but never produced.                                              |
| Consumer      | N/A                                                                                                                                            |
| Payload       | (defined in `pipeline.d.ts` mirror — `frontend/src/dto/event.ts:118`)                                                                       |
| Ordering      | N/A                                                                                                                                            |
| Replay        | N/A                                                                                                                                            |
| Fan-out       | N/A                                                                                                                                            |
| Drift         | DR-017: orphan discriminated union member.                                                                                                  |

**Evidence**:
- `backend/src/dto/eventEnvelope.js:10-23`
- `frontend/src/dto/event.ts:6-19`
- `grep -rn 'pipeline_failed' backend/src` returns no `publishEvent`
  call site.

---

### 1.4 `task_started`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | `taskLifecycleService.publishLifecycle:78-93`, called from `Task.create` (models/Task.js:25-87) and from `taskLifecycle.transition`/`record` (lines 95-141, 143-156). |
| Consumer      | SSE writer → FE. Also persisted as `AgentEvent.envelope` in `prisma.$transaction` (line 128-139).                                          |
| Payload       | `{ from, to, [reason], ...payload }` (lifecycle transition shape).                                                                            |
| Ordering      | Single-shot per transition. Multiple producers: `Task.create` (task_queued), `taskLifecycle.transition` (dispatched/running/completed/failed/cancelled/timeout). |
| Replay        | Persisted as `AgentEvent.envelope`. SSE replay forwards verbatim.                                                                              |
| Fan-out       | Single consumer (SSE). Multiple producer sites.                                                                                            |
| Drift         | None at the producer side. Multiple producer sites are intentional (one per lifecycle edge).                                              |

**Evidence**:
- `backend/src/services/taskLifecycleService.js:78-93, 95-141, 143-156`
- `backend/src/models/Task.js:21-87`

---

### 1.5 `task_completed`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | `taskLifecycleService.transitionIfPresent(taskId, 'completed', …)` from `_saveAgentData` (`SdlcWorkflowService.js:2041-2044`).                  |
| Consumer      | SSE writer → FE. Persisted as `AgentEvent.envelope`.                                                                                       |
| Payload       | `{ from, to:'completed', outputHash, ... }`                                                                                                  |
| Ordering      | Emitted AFTER `Task.update({ status:'completed', … })` (line 2025-2034).                                                                  |
| Replay        | Persisted.                                                                                                                                  |
| Fan-out       | Single consumer (SSE).                                                                                                                     |
| Drift         | None.                                                                                                                                        |

---

### 1.6 `task_failed`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | `taskLifecycleService.transition(taskId, 'failed', …)` from `agentDispatcher.markTaskFailed:545-548` and `taskWorkerService.sweepStale:151-157`. |
| Consumer      | SSE writer → FE. Persisted.                                                                                                                  |
| Payload       | `{ from, to:'failed', reason, code, recoverable, subtype, numTurns, stopReason, exitCode, ... }`                                              |
| Ordering      | After `Task.update({ status:'failed' })`.                                                                                                   |
| Replay        | Persisted.                                                                                                                                  |
| Fan-out       | Single consumer.                                                                                                                            |
| Drift         | None.                                                                                                                                        |

---

### 1.7 `task_interrupted`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | `taskLifecycleService.transition` mapped from `task_cancelled` and `task_timeout` (`taskLifecycleService.js:34-45`).                        |
| Consumer      | SSE writer → FE. Persisted.                                                                                                                  |
| Payload       | `{ from, to, [reason] }`                                                                                                                      |
| Ordering      | After `Task.update({ status:'cancelled' \| 'failed (timeout)' })`.                                                                           |
| Replay        | Persisted.                                                                                                                                  |
| Fan-out       | Single consumer.                                                                                                                            |
| Drift         | None.                                                                                                                                        |

---

### 1.8 `task_resumed`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | **NONE** — declared in the discriminator union but never produced.                                                                            |
| Consumer      | N/A                                                                                                                                            |
| Payload       | (defined in TS mirror).                                                                                                                      |
| Ordering      | N/A                                                                                                                                            |
| Replay        | N/A                                                                                                                                            |
| Fan-out       | N/A                                                                                                                                            |
| Drift         | DR-017: orphan discriminated union member.                                                                                                  |

**Evidence**:
- `backend/src/dto/eventEnvelope.js:17`
- `grep -rn 'task_resumed' backend/src` returns no `publishEvent`
  call site. The semantics that would have been carried by this type
  are served indirectly by `gate_resolved` + the `running`
  transition.

---

### 1.9 `gate_pending`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | `gateBridge.requestGate:121-138`.                                                                                                            |
| Consumer      | SSE writer → FE `applyEnvelope` (`eventMappers.ts` `mapGatePending`).                                                                        |
| Payload       | `{ gate: { id, type, kind, taskId, projectId, role, status:'pending', payload, createdAt } }`                                                |
| Ordering      | Always AFTER the in-memory Promise is set up and AFTER `PendingGate.create`.                                                              |
| Replay        | The envelope is live only; replay reads `PendingGate` rows via `listInterrupted` etc. but does NOT synthesise envelopes for them.        |
| Fan-out       | Single consumer (SSE).                                                                                                                      |
| Drift         | None at producer. Replay does NOT surface historical `PendingGate` rows directly; SSE consumers must rely on the in-memory state for any reconnect that crosses a process restart. |

---

### 1.10 `gate_resolved`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | `gateBridge.resolveGate:180-189`.                                                                                                            |
| Consumer      | SSE writer → FE `applyEnvelope`.                                                                                                             |
| Payload       | `{ gateId, taskId, decision, comment?, resolvedAt }`                                                                                          |
| Ordering      | AFTER `Task.findById` and AFTER `PendingGate.resolve`.                                                                                       |
| Replay        | Live only. NOT persisted.                                                                                                                    |
| Fan-out       | Single consumer.                                                                                                                            |
| Drift         | None at the producer side. Replay omits historical gate_resolved envelopes — same caveat as `gate_pending`.                              |

---

### 1.11 `runtime_log`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | `SdlcWorkflowService._recordGateAudit:1556-1569` (with persisted `AgentEvent.type='gate_audit'` row). `SdlcWorkflowService.resolveOutputReviewGate:509-518` (auto_commit log, NOT persisted to `AgentEvent`). |
| Consumer      | SSE writer → FE.                                                                                                                            |
| Payload       | `{ taskId?, level:'info'\|'warning'\|'error', source, message, meta? }`                                                                       |
| Ordering      | One per gate audit event; one per per-agent commit.                                                                                          |
| Replay        | `_recordGateAudit`'s envelope IS persisted (`AgentEvent.envelope` JSON, type=`'gate_audit'`). `resolveOutputReviewGate`'s auto_commit logs are NOT persisted. |
| Fan-out       | Single consumer.                                                                                                                            |
| Drift         | DR-007 sibling: `runtime_log` from auto_commit path is live only; from gate-audit path is persisted. This is consistent with §2's pattern that `pipeline_completed` is the canonical terminal envelope — but here the rationale is different (gate audit SHOULD be persisted; commit log MAY not need to be). The two producers emit the same type but with different persistence guarantees. |

---

### 1.12 `agent_event`

| Aspect        | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer      | **NONE** — declared but never produced.                                                                                                       |
| Consumer      | N/A                                                                                                                                            |
| Payload       | (defined in TS mirror).                                                                                                                      |
| Ordering      | N/A                                                                                                                                            |
| Replay        | Legacy rows from prior iterations may exist on the DB. The SSE replay does NOT synthesise envelopes for them (only `gate_audit`-typed rows get the legacy fallback). |
| Fan-out       | N/A                                                                                                                                            |
| Drift         | DR-017 + DR-019: orphan discriminated union member AND legacy rows cannot be replayed.                                                       |

---

## 2. Duplicate producers

### DP-1 — `runtime_log` produced by two paths with different persistence guarantees

- `SdlcWorkflowService._recordGateAudit` (lines 1556-1569) — emits
  `runtime_log` AND persists `AgentEvent.type='gate_audit'`. Envelope
  JSON is stored on `AgentEvent.envelope`.
- `SdlcWorkflowService.resolveOutputReviewGate` (lines 509-518) —
  emits `runtime_log` via the auto_commit `onLog` callback. The
  envelope is NOT persisted.

Two producers emit the same canonical type with different
persistence semantics. The FE cannot distinguish which producer
emitted a given `runtime_log` from the wire alone.

### DP-2 — `task_started` produced by two callers per Task

Every Task's lifecycle emits `task_started` twice:

1. At `Task.create` (`models/Task.js:25-66`) with
   `lifecycleType='task_queued'`.
2. At `agentDispatcher.runAgent:312-316` with `to='running'`.

Both are persisted. Both are sent over SSE. The FE reducer must
deduplicate by `envelope.id` (already does, see
`useWorkflowStore.ts:60-72`).

**Evidence**:
- `backend/src/models/Task.js:25-66`
- `backend/src/services/agentDispatcher.js:312-316`

---

## 3. Missing consumers

### MC-1 — `runtime_log` audit envelope has no FE consumer beyond SSE write

The FE reducer receives `runtime_log` envelopes but the only
visible consumer is the SSE writer. No reducer in
`frontend/src/store/eventMappers.ts` maps `runtime_log` into the
session state. So the runtime log is rendered nowhere in the UI
(visible only in the SSE stream itself).

**NOT VERIFIED**: whether the FE has a debug viewer for raw SSE
frames.

### MC-2 — `task_resumed` has no producer (see DR-017)

Already documented.

### MC-3 — `pipeline_failed` has no producer (see DR-017)

Already documented.

### MC-4 — `agent_event` has no producer (see DR-017)

Already documented.

---

## 4. Unused events

### UE-1 — `agent_event` (already DR-017)

### UE-2 — `pipeline_failed` (already DR-017)

### UE-3 — `task_resumed` (already DR-017)

### UE-4 — `_recordGateAudit` writes a `runtime_log` envelope that is
audited in the audit trail but does not appear in the timeline
table

The `_recordGateAudit` envelope is persisted as
`AgentEvent.type='gate_audit'`. `getAuditTrail`
(`SdlcWorkflowService.js:885-896`) projects these rows to the
`gate_audit` event kind in the audit trail. So it IS used. (Not
truly unused; just orphaned from the main timeline.)

---

## 5. Multiple payload shapes

### MP-1 — `runtime_log` payload shape varies

`_recordGateAudit` payload: `{ level, source, message, meta }`
with `source='audit'` (SdlcWorkflowService.js:1556-1569).

`resolveOutputReviewGate` payload (auto_commit): `{ taskId, level,
source, message, meta }` with `source='auto_commit'` (line 509-518).

Two shapes, both `runtime_log`. The `meta` field shape differs per
producer.

### MP-2 — `gate_pending.payload` is role-specific

`tool` gate: `{ file_path, diff, reason, command, filePath,
diffPreview, prompt, … }` (claudePermissionDispatcher.js:69-92).

`question` gate: `{ questions, rawInput, prompt, actions }`
(claudePermissionDispatcher.js:53-67).

`output_review` gate: `{ agent, summary, artifacts, validationIssues }`
(SdlcWorkflowService.js:2071-2087).

`release` gate: `{ summary, evidence, repoContext:{ repoUrl,
workingBranch, baseBranch } }` (SdlcWorkflowService.js:559-577).

Four different payload shapes for the same `gate_pending` type. The
FE reducer (`eventMappers.ts`) dispatches per `gate.type` (which
encodes the kind). NOT a drift per se — documented in
`toGateType.js` — but the on-the-wire `gate_pending` envelope's
`payload` field has no single contract.

### MP-3 — `pipeline_completed.qaResult.commitSha` is a placeholder

`releaseManager.js:178-184` writes
`commitSha: 'see session.repoInfo'` (a string literal). The
`commitSha` field exists in the type but always points to the
session-level `repoInfo` field, not the actual release commit.

---

## 6. Fan-out

Single fan-out point: `eventBus.publish(envelope)`
(`backend/src/services/eventBus.js:68-96`).

### Subscription topology

- `sessionSubscribers: Map<sessionId, Set<listener>>` — older
  per-session subscribers. NOT used by the canonical SSE path.
- `projectSubscribers: Map<projectId, Set<listener>>` — the SSE
  writer subscribes here per session
  (`SdlcController.streamPipelineStatus:335`).

`eventBus.subscribeProject` is the only live subscriber in current
source.

### Drift in fan-out

No additional drift. The bus is in-process only; no external pub/sub
or queue.

---

## 7. Ordering guarantees

The Phase-0/Phase-1 baseline states:

> The per-session monotonic sequence space is the canonical ordering
> metadata (`spec §13.4`).

`eventPublisher.publishEvent:24` calls
`sequenceService.next(sessionId, projectId)`. The sequence is
allocated before the envelope is constructed (line 24-26).

### Drift in ordering

#### O-1 — Sequence allocation is non-transactional with `Task.create`

`Task.create` (`models/Task.js:25-87`) does the following order:

1. `publishEvent` — allocates sequence, publishes envelope (lines
   26-31).
2. `prisma.$transaction` — creates `Task` and `AgentEvent`
   (lines 32-83).

If the transaction rolls back (e.g. `P2003` FK violation from a
missing session), the sequence is consumed but no row is written.
The next `Task.create` will use the next sequence, leaving a gap
in `AgentEvent.sequence` for the session.

**Evidence**:
- `backend/src/models/Task.js:21-87`
- `backend/src/services/eventPublisher.js:17-28`
- `backend/src/services/sequence.js:42-49`

#### O-2 — `session_resumed` snapshot increments the counter on every
reconnect (DR-018)

Already documented.

---

## 8. Replay guarantees

The Phase-0/Phase-1 baseline states:

> Every canonical envelope MUST have a persisted `AgentEvent` row
> such that SSE reconnect can replay it.

### Drift in replay

#### R-1 — `pipeline_completed` is never replayed (DR-007, DR-016)

Already documented.

#### R-2 — `gate_pending` / `gate_resolved` are never replayed

These are live-only. Reconnect consumers will miss any
`gate_pending` that was published and resolved while they were
disconnected. The `PendingGate` DB row preserves the fact that a
gate existed, but the SSE writer does NOT synthesise a
`gate_pending` envelope for it on reconnect.

**Evidence**:
- `backend/src/controllers/SdlcController.js:340-357` (replay loop
  reads `AgentEvent` only).
- `backend/src/services/gateBridge.js:51-83, 154-194`
  (no `AgentEvent.create` for gate_pending/gate_resolved).

#### R-3 — Legacy rows without `envelope` are partially rebuilt
(DR-019)

Already documented.

---

## 9. NOT VERIFIED

- Whether the FE has a debug viewer for raw `runtime_log` frames.
  No source path reviewed.
- Whether legacy `agent_event` rows exist in the dev DB.
- Whether `lastSeenEnvelopeId` dedup in
  `frontend/src/store/useWorkflowStore.ts:60-72` correctly handles
  the legacy-frame path (legacy frames have envelopes synthesised
  by `buildLegacyEnvelope` with a fresh UUID, so dedup by
  `envelope.id` would treat them as new frames).
- Whether the FE store actually deduplicates DP-2's duplicate
  `task_started` envelopes on the wire. (The store dedups by
  `envelope.id`, which is unique per `publishEvent` call, so
  duplicates are NOT deduped; the FE receives both.)