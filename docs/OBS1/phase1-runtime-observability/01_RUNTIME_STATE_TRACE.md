# 01 — Runtime State Trace

> **Status:** INVESTIGATION ONLY.
> Producer → consumer trace of agent runtime state from the
> backend `Task.executionStatus` machine all the way through to
> the agent card badge text, border colour, and chip background
> on the Dashboard and Agent Task pages.
>
> No production code modified. No tests modified. No schema
> modified. No UI changed.

---

## 1. Backend runtime states (the canonical machine)

### 1.1 `Task.executionStatus` — the canonical state machine

**Source:** `backend/src/services/taskLifecycleService.js:11-21`

| State | Wire event (`LIFECYCLE_TO_EVENTTYPE`) | Notes |
| ----- | ------------------------------------- | ----- |
| `queued`        | `task_started` | Initial state at `Task.create` |
| `dispatched`    | `task_started` | Reserved; never produced in current code |
| `running`       | `task_started` | The agent is actively executing |
| `awaiting_gate` | `gate_pending` | A `PendingGate` row is pending for this task |
| `completed`     | `task_completed` | Terminal |
| `failed`        | `task_failed` | Terminal |
| `cancelled`     | `task_interrupted` | Terminal |
| `timeout`       | `task_interrupted` | Terminal |

Source-of-truth map: `EVENT_BY_STATUS` (`taskLifecycleService.js:23-32`).

### 1.2 `Task.status` — the legacy free-form field

**Source:** `backend/prisma/schema.prisma:67` (default `'pending'`),
`backend/src/models/Task.js:39`.

Eight call sites write this field directly via
`Task.update({ status: … })` outside `taskLifecycle.transition`.
Observed values in current source:

| Value | Producer | File:line |
| ----- | -------- | --------- |
| `'pending'`        | `Task.create` default | `Task.js:39` |
| `'processing'`     | `agentDispatcher.runAgent` | `agentDispatcher.js:312` |
| `'completed'`      | `_saveAgentData` | `SdlcWorkflowService.js:2026` |
| `'failed'`         | `markTaskFailed`, `handleTaskTimeout`, `sweepStale` | `agentDispatcher.js:535, 562`; `taskWorkerService.js:160` |
| `'cancelled'`      | `cancelTask` | `SdlcWorkflowService.js:1718` |
| `'PENDING_TOOL_APPROVAL'` | legacy langchain path | `agentDispatcher.js:442` |

This is the value `getPipelineResponse` reads at
`SdlcWorkflowService.js:1256` — it is NOT the canonical state
machine.

### 1.3 Coexisting fields on the same row

`Task` carries BOTH `status` and `executionStatus` plus
`versionStatus`. The two status fields can disagree (per
existing backlog R-029 / DR-012).

| Field | Source of truth | Governed by |
| ----- | --------------- | ----------- |
| `Task.executionStatus` | `taskLifecycle.transition` | `taskLifecycleService.TRANSITIONS` matrix |
| `Task.status`          | 8 direct writers             | None (free string) |
| `Task.versionStatus`   | `Task.commitTask`            | None (free string; default `'committed'`) |

---

## 2. Backend events that publish runtime state

### 2.1 Per-event producer/consumer/payload map

| Event type          | Producer | File:line | Payload shape | Persisted to `AgentEvent`? | FE mapper (consumer) |
| ------------------- | -------- | --------- | ------------- | -------------------------- | -------------------- |
| `task_started`      | `taskLifecycle.publishLifecycle` (mapped from `task_queued`/`dispatched`/`running`) | `taskLifecycleService.js:78-93` | `{ from, to, ...payload }` | YES (`transition` → `appendEvent`) | `mapTaskStarted` (`eventMappers.ts:215`) |
| `task_completed`    | `taskLifecycle.publishLifecycle` from `transitionIfPresent(taskId, 'completed')` | `SdlcWorkflowService.js:2041` | `{ from, to:'completed', ... }` | YES | `mapTaskCompleted` (`eventMappers.ts:229`) |
| `task_failed`       | `taskLifecycle.transition(taskId, 'failed')` | `agentDispatcher.markTaskFailed:545-548` | `{ from, to:'failed', reason, ... }` | YES | `mapTaskFailed` (`eventMappers.ts:246`) |
| `task_interrupted`  | `taskLifecycle.publishLifecycle` (mapped from `task_cancelled`/`task_timeout`) | `taskLifecycleService.js:34-45` | `{ from, to, reason }` | YES | `mapTaskInterrupted` (`eventMappers.ts:262`) |
| `task_resumed`      | **NONE PRODUCED** | (declared in union, R-002/DR-017) | n/a | n/a | `mapTaskResumed` (registered, never invoked) |
| `gate_pending`      | `gateBridge.requestGate` | `gateBridge.js:121-138` | `{ gate: { id, type, kind, taskId, projectId, role, status, payload, createdAt } }` | NO (live only) | `mapGatePending` (`eventMappers.ts:100`) |
| `gate_resolved`     | `gateBridge.resolveGate` | `gateBridge.js:180-189` | `{ gateId, taskId, decision, comment?, resolvedAt }` | NO | `mapGateResolved` (`eventMappers.ts:132`) |
| `session_started`   | `SdlcController.streamPipelineStatus` (initial snapshot) | `SdlcController.js:367` | `{ status, pipelinePhases, repoInfo, pendingGates, resumedFrom, log }` | YES (auto-persisted via `publishEvent`) | `mapSessionStarted` (`eventMappers.ts:199`) |
| `session_resumed`   | `SdlcController.streamPipelineStatus` (reconnect snapshot) | `SdlcController.js:367` | same | YES | `mapSessionResumed` (returns `{}`, no-op) |
| `pipeline_completed`| `releaseManager.submitReleaseDecision` | `releaseManager.js:173-186` | `{ qaResult }` | NO (R-001/DR-007) | `mapPipelineCompleted` (`eventMappers.ts:294`) |
| `pipeline_failed`   | **NONE PRODUCED** | n/a | n/a | n/a | `mapPipelineFailed` (registered, never invoked) |
| `agent_event`       | **NONE PRODUCED** | n/a | n/a | n/a | `mapAgentEvent` (registered, never invoked) |
| `runtime_log`       | `SdlcWorkflowService._recordGateAudit`; `SdlcWorkflowService.resolveOutputReviewGate` (auto_commit) | `SdlcWorkflowService.js:1556-1569, 509-518` | `{ level, source, message, meta }` | partial (gate-audit only) | `mapRuntimeLog` (`eventMappers.ts:192`, no-op except `lastUpdatedAt`) |

### 2.2 The `role` field — the smoking gun

`EventEnvelope.role` (per `backend/src/dto/eventEnvelope.js:34-37`
and `frontend/src/dto/event.ts:120-130`) is the per-envelope
`role` field, set by the producer's `base.role`.

For `task_started` envelopes emitted by
`taskLifecycle.publishLifecycle` (`taskLifecycleService.js:88-92`):

```js
return publishEvent(
  eventType,
  { projectId: task.projectId, sessionId: task.sessionId, taskId: task.id, role: null },
  payload,
);
```

**`role` is hardcoded to `null`.**

For `gate_pending` envelopes emitted by `gateBridge.requestGate`
(`gateBridge.js:124`):

```js
await publishEvent('gate_pending',
  { projectId, sessionId, taskId, role },
  { gate: { id: approvalId, type: gateType, kind, taskId, projectId, role, ... } },
);
```

**`role` is populated from the gate's owning role.** And the
`gate.payload.gate.role` carries it redundantly inside the
payload.

This asymmetry is the root cause of the visualization drift.

---

## 3. SSE transport

### 3.1 Controller

**File:** `backend/src/controllers/SdlcController.js:286-406`

- Headers set at lines 290-293.
- `sendEnvelope(envelope)` (lines 299-303) writes the canonical
  envelope as `id: <sequence>\ndata: <JSON>\n\n`. This is the
  only SSE write shape.
- `sendError(message, code, statusCode)` (lines 305-311) emits a
  non-envelope `data:` line that the FE `sseClient` discards.
- `eventBus.subscribeProject(projectId, sendEnvelope)` (line 335)
  is the fan-out to the SSE writer.
- Replay loop (lines 340-357) replays every persisted
  `AgentEvent.envelope` byte-for-byte; legacy rows without
  `envelope` use `buildLegacyEnvelope`.
- Snapshot envelope (lines 366-378) publishes `session_started`
  or `session_resumed` with the `initialPipeline.status` and
  `initialPipeline.pipelinePhases`.

### 3.2 FE SSE client

**File:** `frontend/src/services/sseClient.ts`

- `subscribe(url, onEnvelope, options)` (lines 27-126).
- Parses SSE frames into `data:` lines (lines 85-107).
- `isEnvelope(parsed)` (line 72) validates the canonical
  envelope shape; rejects anything else.
- Forwards each accepted envelope to `onEnvelope(parsed)`.
- Reconnect cursor handled via `Last-Event-ID` header
  (line 40).

### 3.3 Wire payload — `task_started`

Carries `{ from, to, stage, lifecycleType, ...payload }` in the
envelope's `payload` field. The `role` field is `null` (per §2.2).

### 3.4 Wire payload — `gate_pending`

Carries `{ gate: { id, type, kind, taskId, projectId, role, status:'pending', payload, createdAt } }`. The `role` field is populated.

---

## 4. FE event mapper

**File:** `frontend/src/store/eventMappers.ts`

### 4.1 Mapper registry

`mappers` (lines 322-336) is keyed on `envelope.type`. Each entry
is a `SessionPatcher = (state, env) => Partial<SessionState>`.

### 4.2 Per-event input/output

| Mapper | Input | Output (Partial<SessionState>) | Conditional early-return? |
| ------ | ----- | ------------------------------ | ------------------------- |
| `mapGatePending` | `EventEnvelope<GatePendingPayload>` | `{ pendingGates, status, agentStates, lastUpdatedAt }` | NO (always emits a patch) |
| `mapGateResolved` | `EventEnvelope<GateResolvedPayload>` | `{ pendingGates, gateHistory, status, lastUpdatedAt }` | NO |
| `mapAgentEvent` | `EventEnvelope<AgentEventPayload>` | `{ runtimeEvents, agentStates, lastUpdatedAt }` | NO (but never invoked — no producer) |
| `mapRuntimeLog` | `EventEnvelope<RuntimeLogPayload>` | `{ lastUpdatedAt }` | NO |
| `mapSessionStarted` | `EventEnvelope<SessionStartedPayload>` | `{ status, pipelinePhases, repoInfo, pendingGates, lastUpdatedAt }` | NO |
| `mapSessionResumed` | same | `{}` (no-op) | YES (no mutation on resume) |
| `mapTaskStarted` | `EventEnvelope<TaskLifecyclePayload>` | `{ agentStates: { [agentKey]: { ..., status: 'running', lastEventAt } }, lastUpdatedAt }` | **YES — line 216 if `!env.taskId`, line 219 if `!agentKey` (env.role is null)** |
| `mapTaskCompleted` | same | sets `agentStates[agentKey].status = 'completed'` | **YES — line 231 if `!agentKey`** |
| `mapTaskFailed` | same | sets `agentStates[agentKey].status = 'failed'` | **YES — line 247 if `!agentKey`** |
| `mapTaskInterrupted` | same | sets `agentStates[agentKey].status = 'skipped'` | **YES — line 263 if `!agentKey`** |
| `mapTaskResumed` | same | sets `agentStates[agentKey].status = 'running'` | **YES — line 279 if `!agentKey`** |
| `mapPipelineCompleted` | `EventEnvelope<PipelineCompletedPayload>` | `{ status, qaResult, agentStates, lastUpdatedAt }` | NO |
| `mapPipelineFailed` | `EventEnvelope<PipelineFailedPayload>` | `{ status, error, lastUpdatedAt }` | NO |

### 4.3 `inferAgentKey(role)`

`eventMappers.ts:34-37`:

```ts
function inferAgentKey(role?: string | null): AgentKey | null {
  if (!role) return null;
  return AGENT_TO_ROLE[role] ?? null;
}
```

Returns `null` for `null` or `undefined` `role`. Used at lines
218, 230, 247, 263, 279 — every task-lifecycle mapper.

### 4.4 `pipelinePhases` writes

`grep "pipelinePhases" frontend/src/store/eventMappers.ts`
returns exactly ONE write site: line 203, inside
`mapSessionStarted`. The `session_started` snapshot is the
ONLY path that updates `pipelinePhases`.

`mapSessionResumed` returns `{}` — reconnect does NOT refresh
`pipelinePhases`.

---

## 5. Store fields that hold runtime state

**File:** `frontend/src/models/SessionState.ts`

### 5.1 The two co-existing status fields on `SessionState`

```ts
// Line 84-85 — coarse scheduling (5-bucket pipeline phase map).
pipelinePhases: api.PhaseStatus[];

// Line 87-88 — fine-grained per-agent runtime state.
agentStates: Record<AgentKey, AgentState>;
```

### 5.2 `PhaseStatus` (line 71-78)

```ts
interface PhaseStatus {
  agent: 'ARCH' | 'PO' | 'UX' | 'DEV' | 'QA';
  status: 'pending' | 'running' | 'gate_pending' | 'awaiting_review' | 'completed' | 'failed' | 'skipped';
  taskId?: string;
  duration?: string;
  awaitingReview?: boolean;
  invalid?: boolean;
}
```

Initial state: `defaultPipelinePhases()` (line 131-133) returns
all 5 phases with `status: 'pending'`.

### 5.3 `AgentState` (line 48-58)

```ts
interface AgentState {
  agent: AgentKey;
  status: 'idle' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'skipped';
  currentStep: string | null;
  currentAction: string | null;
  currentFile: string | null;
  toolName: string | null;
  startedAt: number | null;
  completedAt: number | null;
  lastEventAt: number | null;
}
```

Initial state: `emptyAgentStates()` (line 113-129) sets every
agent to `status: 'idle'`.

### 5.4 Duplicates summary

`pipelinePhases[i].status` and `agentStates[agent].status` are
two parallel state views on the same conceptual "agent
runtime". The store holds both. They are NOT consistent:

| `pipelinePhases[i].status` | `agentStates[i].status` |
| -------------------------- | ------------------------ |
| updated by `mapSessionStarted` only | updated by `mapTaskStarted/completed/failed/interrupted/resumed` and `mapAgentRuntime` |
| depends on `role` of the SSE snapshot envelope (no role field — always set) | depends on `env.role` (always `null` for task envelopes, so never updates) |
| reflects BE snapshot at connect time | reflects runtime events (dormant for canonical path) |

---

## 6. Dashboard vs Agent Task page — store reads

### 6.1 Dashboard (`SdlcDashboard/index.tsx`)

`SdlcDashboard/index.tsx:203-206`:

```ts
const phaseStatusFor = (agent: AgentKey): string => {
  if (!runtime) return 'pending';
  return runtime.phases.find((p) => p.agent === agent)?.status ?? 'pending';
};
```

The `runtime.phases` comes from
`selectRuntimeExecution` (`workflowSelectors.ts:257-264`):

```ts
const phases: RuntimeAgentPhase[] = AGENT_KEYS.map((agent) => {
  const phase = session.pipelinePhases.find((p) => p.agent === agent);
  return {
    agent,
    status: phaseForAgent[agent] ?? 'pending',
    taskId: phase?.taskId,
  };
});
```

**The card border colour (line 306, `COLUMN_BORDER[ps]`) and
the badge text/chip colour (line 324, `<PhaseChip status={ps} />`)
both read `ps` = `runtime.phases[agent].status` =
`session.pipelinePhases[agent].status`.**

### 6.2 Overview (`OverviewPage.tsx`)

`OverviewPage.tsx:234-249` reads `session.pipelinePhases` directly:

```tsx
const phase = session.pipelinePhases.find((p) => p.agent === key);
const status = phase?.status ?? 'pending';
```

The pipeline strip colour (lines 240-249) and the badge label
(line 252, `<PhaseStatusLabel status={status} />`) both read
`session.pipelinePhases[key].status`.

### 6.3 SessionRail (`SessionRail.tsx`)

`SessionRail.tsx:178-179` reads `session.pipelinePhases`:

```tsx
const p = session.pipelinePhases.find((x) => x.agent === k);
const status = p?.status ?? 'pending';
```

The dot colour (line 183, `PHASE_DOT_COLORS[status]`) reads the
same value.

### 6.4 Inspector (`InspectorPanel.tsx`)

Not in scope for agent cards; renders runtime events from
`session.runtimeEvents` and gates from `session.pendingGates`.
Both fields are written only by mappers that never get invoked
in the current canonical claude-code path.

### 6.5 Drift summary

**All three pages that render per-agent status use
`pipelinePhases[i].status` as the source. None of them read
`agentStates[i].status` directly for the visible card.**
`agentStates` is consulted only by `selectRuntimeExecution` to
derive `currentAgent` (line 224-231) and to merge
`awaiting_review` into phases (line 251-255) — neither of which
fires because `agentStates` is never updated.

---

## 7. What determines the badge text

### 7.1 PhaseChip on Agent Task page

**File:** `frontend/src/pages/SdlcDashboard/index.tsx:503-516`

```tsx
function PhaseChip({ status }: { status: string }) {
  // Lines 504-510: pick a colour class.
  // Line 513: render status.replace('_', ' ') as text.
  return <span ...>{status.replace('_', ' ')}</span>;
}
```

The text is literally `status.replace('_', ' ')`. The input is
`ps = phaseStatusFor(agent) = runtime.phases[agent].status =
session.pipelinePhases[agent].status`.

So if `pipelinePhases[ARCH].status === 'pending'`, the badge
reads `"PENDING"`.

### 7.2 Pipeline strip on Dashboard

**File:** `frontend/src/pages/SdlcDashboard/OverviewPage.tsx:360-368`

```tsx
function PhaseStatusLabel({ status }: ...) {
  const label =
    status === 'completed' ? '✓' :
    status === 'running' ? '…' :
    status === 'awaiting_review' ? '!' :
    status === 'failed' ? '✗' :
    status === 'skipped' ? '⊘' : '·';
  return <span className="font-mono">{label}</span>;
}
```

The glyph is determined by `status === 'running'`. If
`pipelinePhases[agent].status === 'pending'`, the glyph is `·`.

### 7.3 SessionPill (header)

**File:** `frontend/src/pages/SdlcDashboard/index.tsx:364-385`

Reads `session.status` (the SessionState-level status, NOT the
per-agent status). Affected by `mapGatePending` (line 121-123
of eventMappers.ts) which sets it to `'awaiting_approval'` or
`'awaiting_release'` when a gate lands.

---

## 8. What determines the card colour

### 8.1 Card border on Agent Task page

**File:** `frontend/src/pages/SdlcDashboard/index.tsx:76-83`

```ts
const COLUMN_BORDER: Record<TaskItem['status'] | 'pending', string> = {
  pending:       'border-outline-variant/20',
  running:       'border-blue-500/30',
  gate_pending:  'border-amber-500/30',
  completed:     'border-emerald-500/20',
  skipped:       'border-dashed border-outline-variant/20',
  failed:        'border-red-500/30',
};
```

Line 306: `borderClass = COLUMN_BORDER[ps as keyof typeof COLUMN_BORDER] ?? COLUMN_BORDER.pending;`

**`ps = runtime.phases[agent].status = pipelinePhases[agent].status`.**

### 8.2 Per-task dot colour inside the card

**File:** `frontend/src/pages/SdlcDashboard/index.tsx:67-74`

```ts
const STATUS_DOT_COLOR: Record<TaskItem['status'], string> = {
  pending:       'border-outline-variant/10 bg-transparent',
  running:       'border-blue-500/30 bg-blue-500/5',
  gate_pending:  'border-amber-500/30 bg-amber-500/5',
  completed:     'border-emerald-500/15 bg-emerald-500/5',
  failed:        'border-red-500/30 bg-red-500/5',
  skipped:       'border-dashed border-outline-variant/10 opacity-50',
};
```

Line 335: `STATUS_DOT_COLOR[task.status]` — task status is
derived in `tasksForAgent(agent, ps)` (line 181-201) from the
same `ps`.

---

## 9. What determines the card border

Same answer as §8 — `COLUMN_BORDER[ps]` where `ps = pipelinePhases[agent].status`. The card border is the only border the user sees on the Agent Task page.

---

## 10. Why `gate_pending` renders correctly while others do not

### 10.1 The `gate_pending` envelope carries `role`

`backend/src/services/gateBridge.js:121-138`:

```js
await publishEvent('gate_pending',
  { projectId, sessionId, taskId, role },         // <-- role populated
  {
    gate: {
      id: approvalId,
      type: gateType,
      kind,
      taskId,
      projectId,
      role,                                         // <-- also in payload
      status: 'pending',
      payload,
      createdAt: eventData.createdAt,
    },
  },
);
```

The `role` is the agent role string (`'po-agent'`, `'dev-agent'`,
etc.). The FE mapper `mapGatePending`
(`eventMappers.ts:100-130`) reads `env.payload.gate.role` (NOT
`env.role`) and converts it via `inferAgentKey`:

```ts
const agentForGate = inferAgentKey(gate.role);   // <-- gate.role, not env.role
```

Then it sets `agentStates[agentForGate].status = 'awaiting_review'`
(line 112).

### 10.2 The `task_started` envelope does NOT carry `role`

`backend/src/services/taskLifecycleService.js:78-93`:

```js
async function publishLifecycle(task, type, payload) {
  // ...
  return publishEvent(
    eventType,
    { projectId: task.projectId, sessionId: task.sessionId, taskId: task.id, role: null },   // <-- role: null
    payload,
  );
}
```

The FE mapper `mapTaskStarted` (`eventMappers.ts:215-227`)
reads `env.role`:

```ts
const agentKey = inferAgentKey(env.role);   // <-- env.role is null
if (!agentKey) return { lastUpdatedAt: Date.now() };   // <-- early return; agent state NEVER updated
```

**`inferAgentKey(null)` returns `null`. The mapper returns
`{ lastUpdatedAt: Date.now() }` and never updates
`agentStates`.**

### 10.3 The mapper registry list of task events that all silently no-op

| Wire event | Mapper | Reads | Result on current source |
| ---------- | ------ | ----- | ------------------------ |
| `task_started`     | `mapTaskStarted`     | `env.role` (always `null`) | silent no-op |
| `task_completed`   | `mapTaskCompleted`   | `env.role` (always `null`) | silent no-op |
| `task_failed`      | `mapTaskFailed`      | `env.role` (always `null`) | silent no-op |
| `task_interrupted` | `mapTaskInterrupted` | `env.role` (always `null`) | silent no-op |
| `task_resumed`     | `mapTaskResumed`     | `env.role` (always `null`) | silent no-op (also: no producer) |

Every per-agent runtime state update on the canonical claude-code
path is silently dropped because `env.role` is `null`.

### 10.4 So why does the user's observation match?

The user reports:

> `gate_pending` renders correctly (yellow border, pending badge).
> Everything else (running, queued, completed, idle, failed) shows
> a dark inactive card.

The trace confirms:

- **`gate_pending` works** because the SSE snapshot's
  `pipelinePhases` is computed at connect-time from the CURRENT
  `Task.status` via `SdlcWorkflowService.getPipelineResponse`.
  When a `gate_pending` is emitted, `gateBridge.requestGate` does
  NOT call `transitionIfPresent` to `awaiting_gate` for
  `kind === 'output_review'` (line 102 of gateBridge.js). But for
  `kind !== 'output_review'`, it does, AND `Task.status` is
  eventually updated. For output_review gates, the FE mapper's
  `mapGatePending` sets the agent's `agentStates[agentKey].status
  = 'awaiting_review'` directly, which the
  `selectRuntimeExecution` phase-merge (line 251-255) lifts into
  the `phases` array. So the user sees `gate_pending` / amber.

- **Everything else does not work** because:
  1. `pipelinePhases` is only updated at `session_started` (i.e.
     once per SSE connection).
  2. `agentStates` is never updated because every task lifecycle
     mapper early-returns when `env.role` is `null`.
  3. The user only sees an update if the SSE connection closes
     and reopens with a fresh `session_started` snapshot.

  For a session that was opened before any agent ran, the
  snapshot's `pipelinePhases` is `[pending, pending, pending,
  pending, pending]` — every card is dark/inactive. The dark
  state persists until the user manually disconnects and
  reconnects (e.g. reloads the page).

---

## 11. The dead "feature_event" path that never fires

`mapAgentEvent` (`eventMappers.ts:168-190`) exists to handle
`agent_event` envelopes with sub-types
(`agent_start`, `agent_tool_call`, `agent_tool_result`,
`agent_complete`, `file_change`, `token_usage`, `error`). It
updates `agentStates[agentKey]` richly with `currentStep`,
`currentAction`, `currentFile`, `toolName`.

The `AgentEventPayload.type` is `'agent_start' | ... | 'error'`
(see `frontend/src/dto/event.ts:66-82`). But the canonical
EventType discriminator `'agent_event'` has no producer in
current source (verified by `grep "publishEvent.*'agent_event'"
backend/src` — zero matches). So `mapAgentEvent` is registered
but never invoked; the rich runtime state machinery is dead code.

This is consistent with existing backlog R-002 / DR-017.

---

## 12. Architecture duplication summary

The runtime state has FOUR duplicated concepts across the stack:

| Concept | Backend field | Backend events | FE field | Source of truth? |
| ------- | ------------- | -------------- | -------- | ---------------- |
| Canonical state machine | `Task.executionStatus` | `task_started/completed/failed/interrupted/resumed` | (none directly) | BE-only |
| Legacy free-form | `Task.status` | (none) | `pipelinePhases[i].status` | BE snapshot only |
| Coarse 5-bucket | `pipelinePhases` (computed from `Task.status`) | `session_started` | `pipelinePhases` | FE-only stale |
| Fine-grained per-agent | (none) | (none produced) | `agentStates[i]` | FE dormant |
| Runtime tool/step stream | (none) | `agent_event` (not produced) | `runtimeEvents` | FE dormant |

Only one of these is wired end-to-end for live updates:
`gate_pending` (via `gate.role` in the gate payload). Everything
else is either:
- snapshotted at connect and frozen, OR
- never written, OR
- written with `role: null` so the FE mapper early-returns.

---

## 13. Why only `gate_pending` works (root cause, single line)

`taskLifecycle.publishLifecycle` writes `role: null` on the
canonical `EventEnvelope` for every lifecycle event, while
`gateBridge.requestGate` writes `role: <agent>` and `gate.role`
in the payload. The FE's task-lifecycle mappers key on
`env.role` and early-return when it is null; the FE's
`mapGatePending` keys on `payload.gate.role` and never sees
the null. So `gate_pending` updates the FE store; nothing else
does.

---

## 14. NOT VERIFIED

- Whether `mapPipelineCompleted`'s side-effect (line 299-305 of
  eventMappers.ts) of marking all `running` agents as `completed`
  is reachable in current source — `pipeline_completed` is the
  only canonical event type that is not persisted to `AgentEvent`
  (R-001/DR-007) but it IS published live, so it does reach the
  FE.
- Whether the SSE `session_started` snapshot is published before
  or after the agent's first `task_started` envelope in normal
  operation. If the order is `session_started` then
  `task_started`, the snapshot is the seed (correct). If the
  order is reversed, the snapshot overwrites the correct
  per-agent state with the snapshot's stale phases.
  Phase 3.5 does not have evidence to resolve this; Phase 4 to
  verify.