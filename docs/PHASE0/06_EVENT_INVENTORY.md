# 06 — Event Inventory (Frozen Baseline)

> **Status:** OBSERVATION ONLY. Every event the server publishes, with
> the producer(s), payload shape, consumers, and current usage. No
> analysis of correctness.

The system uses a **single canonical event envelope** (`backend/src/dto/eventEnvelope.js`).
There is exactly **one event bus** (`backend/src/services/eventBus.js`).
Producers MUST go through `eventPublisher.publishEvent`
(`backend/src/services/eventPublisher.js`), which is the only path that
allocates a sequence and constructs the envelope.

```ts
// Canonical envelope — JS version in backend/src/dto/eventEnvelope.js:
//   TS mirror in frontend/src/dto/event.ts.
type EventEnvelope<P = unknown> = {
  id: string;             // UUIDv4 (allocated by eventPublisher)
  sequence: number;      // per-session monotonic; SSE `id:`
  type: EventType;
  timestamp: string;     // ISO8601
  projectId: string;
  sessionId: string;
  taskId: string | null;
  role: string | null;
  payload: P;
};

type EventType =
  | 'session_started'
  | 'session_resumed'
  | 'pipeline_completed'
  | 'pipeline_failed'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_interrupted'
  | 'task_resumed'
  | 'gate_pending'
  | 'gate_resolved'
  | 'agent_event'
  | 'runtime_log';
```

Per-session sequence: `backend/src/services/sequence.js`. The
`AgentEvent` DB row carries `sequence` and a `@@unique([sessionId, sequence])`
constraint enforces the per-session monotonic invariant at the
persistence layer (`schema.prisma:121`).

---

## Event types (canonical discriminators)

### 1. `session_started` / `session_resumed`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | `SdlcController.streamPipelineStatus` (controller:286-406)                            |
| **When**      | On every (re)connect to `GET /sdlc/stream/:sessionId`. `session_started` on first open, `session_resumed` when `Last-Event-ID`/`after_sequence` > 0 |
| **Payload**   | `{ status, pipelinePhases, repoInfo, pendingGates, resumedFrom, log }`                  |
| **Consumers** | SSE stream → `SdlcController.streamPipelineStatus`'s `sendEnvelope` (no other consumer) |
| **Persisted** | No. Bootstrap-only envelope.                                                          |

### 2. `pipeline_completed`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | `releaseManager.submitReleaseDecision` (releaseManager.js:173-186)                     |
| **When**      | Exactly once, on `APPROVE`. The release bundle is committed and pushed (push is best-effort); session is set to `completed` |
| **Payload**   | `{ qaResult: { status:'passed', coverage, blockers, warnings, reportUrl, commitSha } }` |
| **Consumers** | SSE stream → `applyEnvelope` → `eventMappers`                                          |
| **Persisted** | Optional. Not currently published via `publishEvent`'s `AgentEvent` persistence path (the SSE writer seeds the snapshot through `publishEvent`, which DOES persist — see "Envelope path" below) |

#### Envelope path for `pipeline_completed`

`publishEvent('pipeline_completed', { projectId, sessionId, taskId, role:'release' }, payload)`
(`eventPublisher.js:17-28`):
1. `sequenceService.next(sessionId, projectId)` → next sequence.
2. `createEnvelope(...)` constructs the envelope.
3. `eventBus.publish(envelope)` → in-process subscribers (SSE).
4. Returns the envelope. The boot sequence `_saveAgentData` → no; only
   `releaseManager` emits this. The `taskLifecycleService.record` /
   `transition` paths persist envelopes to `AgentEvent` when they call
   `publishEvent` from inside their own `prisma.$transaction`
   (`taskLifecycleService.js:88-93`).
   For `pipeline_completed`, no `AgentEvent` row is currently written by
   `releaseManager` — verification:
   `releaseManager.submitReleaseDecision` calls `publishEvent` for the
   SSE emission but does NOT pass the returned envelope to
   `AgentEvent.create`. Result: live SSE consumers see the frame, but
   the persisted `AgentEvent` table does NOT carry a row with
   `type='pipeline_completed'` (it carries rows with `type='task_started'`,
   `type='task_completed'`, etc., via `taskLifecycle.transition`).
   This is observable as a divergence between wire format and
   replay-restored history — see `08_CURRENT_KNOWN_ISSUES.md`.

### 3. `pipeline_failed`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | Defined in the discriminator list, but **NOT emitted anywhere in current source** (`eventEnvelope.js:10-23`; `eventPublisher.publishEvent` is the only caller for the envelope, and no service call references this type). |
| **Consumers** | Would be `applyEnvelope` / SSE; not exercised in current source                      |
| **Persisted** | n/a — never produced                                                                   |

### 4. `task_started`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | `taskLifecycleService.publishLifecycle` (taskLifecycleService.js:78-93)                |
| **When**      | Any task state transition into `{queued, dispatched, running}` (mapped from `EVENT_BY_STATUS`). Also emitted at `Task.create` for the initial `task_queued` row (`models/Task.js:21-87`) |
| **Payload**   | lifecycle transition: `{ from, to, [reason], ...payload }`                              |
| **Consumers** | SSE stream                                                                              |
| **Persisted** | Yes — envelope JSON is stored on the `AgentEvent.envelope` column                      |

### 5. `task_completed`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | `taskLifecycleService.transition` (taskLifecycleService.js:95-141)                     |
| **When**      | `Task.update({ status:'completed' })` is followed by `taskLifecycle.transitionIfPresent(taskId, 'completed', ...)` (SdlcWorkflowService.js:2041-2044) |
| **Payload**   | `{ from, to:'completed', outputHash, ... }`                                            |
| **Consumers** | SSE stream                                                                              |
| **Persisted** | Yes                                                                                     |

### 6. `task_failed`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | `taskLifecycleService.transition`                                                      |
| **When**      | `agentDispatcher.markTaskFailed` (or `handleTaskTimeout`) calls `taskLifecycle.transition(taskId, 'failed', ...)` (agentDispatcher.js:545-548) |
| **Payload**   | `{ from, to:'failed', reason, code, recoverable, subtype, numTurns, stopReason, exitCode, ... }` |
| **Consumers** | SSE stream                                                                              |
| **Persisted** | Yes                                                                                     |

### 7. `task_interrupted`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | `taskLifecycleService.transition`                                                      |
| **When**      | `cancelled` or `timeout` transitions (`EVENT_BY_STATUS.cancelled/timeout → task_cancelled/task_timeout`, mapped to `task_interrupted` per `LIFECYCLE_TO_EVENTTYPE`, taskLifecycleService.js:34-45) |
| **Payload**   | `{ from, to, [reason], ... }`                                                          |
| **Consumers** | SSE stream                                                                              |
| **Persisted** | Yes                                                                                     |

### 8. `task_resumed`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | Defined in the discriminator list (`eventEnvelope.js:17`), but no `publishEvent('task_resumed', ...)` call exists in current source. Reserved for explicit "resumed" semantics, not the lifecycle-mapped `task_interrupted` |
| **Consumers** | SSE stream (would-be)                                                                   |
| **Persisted** | n/a                                                                                    |

### 9. `gate_pending`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | `gateBridge.requestGate` (gateBridge.js:121-138)                                       |
| **When**      | Every new gate (tool, question, output_review, release) before the SDK Promise is awaited |
| **Payload**   | `{ gate: { id, type:<GateType>, kind, taskId, projectId, role, status:'pending', payload, createdAt } }` |
| **Consumers** | SSE stream → `eventMappers.mapGatePending` → `SessionState.pendingGates` (frontend/src/store/eventMappers.ts) |
| **Persisted** | No — not directly. The pending gate itself is persisted to `PendingGate` (gateBridge.js:88-89 calls `PendingGate.create`). The envelope is published live only |

### 10. `gate_resolved`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | `gateBridge.resolveGate` (gateBridge.js:176-190)                                       |
| **When**      | On every successful gate wake-up. Carries the decision across the wire                |
| **Payload**   | `{ gateId, taskId, decision:'approve'|'reject'|'answer'|'timeout', comment?, resolvedAt }` |
| **Consumers** | SSE stream                                                                              |
| **Persisted** | No — `PendingGate.resolve` updates the `PendingGate` row; envelope is not persisted to `AgentEvent` here |

### 11. `agent_event`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | Defined in the discriminator list (`eventEnvelope.js:21`), but **not emitted by `publishEvent` in current code**. Older `agent_event` rows (pre-transport-refactor) are still readable; `streamPipelineStatus` does not currently map them to envelopes (its legacy fallback does rebuild envelopes for `gate_audit`-prefixed legacy rows, otherwise forwards `row.envelope` verbatim) |
| **Consumers** | SSE stream                                                                              |
| **Persisted** | n/a (rows exist but new envelopes are no longer published under this type)             |

### 12. `runtime_log`

| Field         | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| **Producer**  | Multiple: `SdlcWorkflowService._recordGateAudit`, `SdlcWorkflowService.resolveOutputReviewGate` (auto_commit log), `taskLifecycleService.record` |
| **When**      | onGate audit entries, per-agent commit logs, generic structured log entries             |
| **Payload**   | `{ taskId?, level:'info'|'warning'|'error', source, message, meta? }`                  |
| **Consumers** | SSE stream                                                                              |
| **Persisted** | When the producer is `_recordGateAudit` (`SdlcWorkflowService.js:1546-1572`), the envelope IS persisted as `AgentEvent.type='gate_audit'`. For `_saveAgentData`-side and other lifecycle `record` paths, see the publisher pattern |

---

## Lifecycle audit types persisted to `AgentEvent.type`

The `AgentEvent` DB column `type` is the lifecycle audit key. From
`taskLifecycleService.EVENT_BY_STATUS` and the onGate audit emitters:

| Lifecycle `type`     | Persisted by                                                   | Maps to wire EventType |
| -------------------- | -------------------------------------------------------------- | ----------------------- |
| `task_queued`        | `Task.create`                                                 | `task_started`          |
| `task_dispatched`    | `taskLifecycleService.transition`                              | `task_started`          |
| `task_started`       | `taskLifecycleService.transition`                              | `task_started`          |
| `task_completed`     | `_saveAgentData` via `transitionIfPresent`                     | `task_completed`        |
| `task_failed`        | `markTaskFailed` / `handleTaskTimeout`                         | `task_failed`           |
| `task_cancelled`     | `cancelTask`                                                  | `task_interrupted`      |
| `task_timeout`       | `handleTaskTimeout` (with `eventType` override)                | `task_interrupted`      |
| `gate_pending`       | (referenced, but actual lifecycle writes happen via `requestGate`/`publishEvent`) | `gate_pending` |
| `gate_resolved`      | `gateBridge.resolveGate` (uses `eventType` on lifecycle transition) | `gate_resolved`    |
| `gate_audit`         | `_recordGateAudit` (audit entry only; envelope `runtime_log`) | `runtime_log`           |

---

## Per-type payload mapping

### gate_pending

```js
{
  gate: {
    id: approvalId,
    type: toGateType(role, kind),    // string from services/toGateType.js
    kind,                              // 'tool' | 'question' | 'output_review' | 'release'
    taskId, projectId, role,
    status: 'pending',
    payload,                           // role-specific
    createdAt: ISO8601,
  },
}
```

`toGateType` mappings (services/toGateType.js):
- `kind='release'` → `'FINAL_RELEASE'`
- `kind='tool'`:
  - `role='dev-agent'` → `'DEV_FILE_GATE'`
  - otherwise → `'HITL_REVIEW'`
- `kind='output_review'`:
  - `'po-agent' → 'PO_OUTPUT_REVIEW'`,
    `'ux-agent' → 'UX_OUTPUT_REVIEW'`,
    `'dev-agent' → 'DEV_OUTPUT_REVIEW'`,
    `'qa-agent' → 'QA_OUTPUT_REVIEW'`,
    otherwise → `'AGENT_OUTPUT_REVIEW'`
- `kind='question'`:
  - `'po-agent' → 'PO_CLARIFY'`,
    `'ux-agent' → 'UX_CLARIFY'`,
    `'dev-agent' → 'DEV_CLARIFY'`,
    `'qa-agent' → 'QA_CLARIFY'`,
    otherwise → `'AGENT_CLARIFY'`

### gate_resolved

```js
{
  gateId, taskId,
  decision: 'approve' | 'reject' | 'answer' | 'timeout',
  comment?,
  resolvedAt: ISO8601,
}
```

The `decision` derivation is in `gateBridge.resolveGate` (gateBridge.js:176-179):
```js
result?.action === 'reject' ? 'reject'
  : (result?.answers ? 'answer'
    : (result?.timedOut ? 'timeout' : 'approve'));
```

### runtime_log

```js
{
  taskId?,
  level: 'info' | 'warning' | 'error',
  source,         // 'audit' | 'auto_commit' | …
  message,        // human-readable
  meta?,          // structured payload
}
```

For `_recordGateAudit` (SdlcWorkflowService.js:1546-1572), `meta` carries
the onGate `entry` shape (`kind`, `role`, `toolName`, `file`,
`category`, `comment`, `answers`, `…`).

For `auto_commit` (SdlcWorkflowService.js:506-519), `source='auto_commit'`
and `meta` carries structured git output info.

---

## Producers summary

| Producer (file:line)                                            | Event type(s) emitted                       |
| --------------------------------------------------------------- | ------------------------------------------- |
| `Task.create` — `backend/src/models/Task.js:21-87`              | `task_started` (via `publishEvent`, wrapped in `AgentEvent.envelope`) |
| `taskLifecycleService.transition` — `backend/src/services/taskLifecycleService.js:95-141` | `task_started` / `task_completed` / `task_failed` / `task_interrupted` |
| `taskLifecycleService.record`                                   | same                                        |
| `agentDispatcher.markTaskFailed`                                | `task_failed`                               |
| `agentDispatcher.handleTaskTimeout`                             | `task_interrupted` (kind `task_timeout`)    |
| `SdlcWorkflowService.cancelTask` (via `taskLifecycle.transitionIfPresent`) | `task_interrupted` (kind `task_cancelled`) |
| `gateBridge.requestGate`                                         | `gate_pending` (live only; `PendingGate` row also persisted) |
| `gateBridge.resolveGate`                                         | `gate_resolved` (live only; `PendingGate.resolve` updates the row) |
| `SdlcWorkflowService._recordGateAudit`                           | `runtime_log` + persisted `AgentEvent.type='gate_audit'` |
| `SdlcWorkflowService.resolveOutputReviewGate` (auto_commit log) | `runtime_log`                                |
| `releaseManager.submitReleaseDecision` (APPROVE)                | `pipeline_completed` (live; not persisted to `AgentEvent` — see 08_CURRENT_KNOWN_ISSUES) |
| `SdlcController.streamPipelineStatus` (SSE bootstrap)           | `session_started` / `session_resumed`       |

---

## Consumers (subscribers)

| Subscriber                                                       | Subscription API                                    | Receives                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| SSE writer `SdlcController.streamPipelineStatus`                 | `eventBus.subscribeProject(projectId, sendEnvelope)` | Live envelopes with the resolved `projectId`  |
| (legacy) per-session subscribers                                 | `eventBus.subscribe(sessionId, listener)`            | Legacy / test consumers                        |

There is no third-party consumer in current source. The in-process
eventBus is the only transport; SSE clients receive what the SSE writer
re-emits.

---

## SSE replay vs live (single source split)

`SdlcController.streamPipelineStatus` (controller:286-406) is the
boundary where **replay** meets **live**:

1. Compute `lastSeq` from `Last-Event-ID` header or `?after_sequence`.
2. Resolve `projectId` from `getPipelineResponse`.
3. Subscribe `eventBus.subscribeProject(projectId, sendEnvelope)`.
4. Replay `AgentEvent.list({ sessionId, afterSequence: lastSeq, limit:1000 })`:
   - If `row.envelope` exists → forward verbatim.
   - Else if `row.payload` exists (legacy rows) → rebuild an envelope
     via `buildLegacyEnvelope` (controller:21-23) with type
     `row.type === 'gate_audit' ? 'runtime_log' : row.type`.
   - Else → skip.
5. Publish `session_started` or `session_resumed` via `publishEvent`.
6. Start 15-second heartbeat.
7. On `req.on('close')` → tear down.

Replay ALWAYS comes from `AgentEvent.envelope` (the persisted canonical
copy) when present — only legacy rows without an envelope fall back to
the legacy helper.

---

## What is NOT emitted (notable absences)

- `pipeline_failed` is in the type union but no service publishes it.
- `task_resumed` is in the type union but no service publishes it
  under that name. The "task resumes after gate" semantics lives in
  `gate_resolved` envelopes + the `taskLifecycle` `running` transition.
- `agent_event` is in the type union but no service publishes it
  currently. Older rows with `type='agent_event'` exist on pre-refactor
  `AgentEvent` rows; the SSE replay does not synthesise envelopes for
  them today (legacy fallback handles only `gate_audit`-typed rows).
- No third-party bus (Kafka / NATS / Redis pub/sub). All in-process.
- No Prometheus / OpenTelemetry exporter. Sentry handles
  exceptions only.

---

## Redis / queue

None. No Redis. No external queue. The system is in-process only.