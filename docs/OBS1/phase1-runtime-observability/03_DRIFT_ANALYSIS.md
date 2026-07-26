# 03 — Drift Analysis

> **Status:** INVESTIGATION ONLY.
> Per-drift inventory of every place runtime state is lost or
> duplicated between the backend canonical machine and the
> frontend agent card DOM.
>
> Severity reflects user-visible impact in normal use today.

---

## D-1. `task_started` envelope carries `role: null` — every per-agent mapper is a silent no-op

### Description

`backend/src/services/taskLifecycleService.js:88-92` allocates
the canonical `task_started` (and `task_completed`, `task_failed`,
`task_interrupted`, `task_resumed`) envelope with
`role: null`. The frontend event mappers
(`mapTaskStarted`, `mapTaskCompleted`, `mapTaskFailed`,
`mapTaskInterrupted`, `mapTaskResumed`) all call
`inferAgentKey(env.role)`, which returns `null` for `null` or
`undefined` input, and the mapper returns `{ lastUpdatedAt:
Date.now() }` without updating any `agentStates` entry.

### Evidence

- `taskLifecycleService.js:88-92` (hardcoded `role: null`).
- `gateBridge.js:121-138` (`gate_pending` carries `role`).
- `eventMappers.ts:34-37` (`inferAgentKey` returns null on null).
- `eventMappers.ts:215-227` (`mapTaskStarted` early-return).
- `eventMappers.ts:229-244` (`mapTaskCompleted` early-return).
- `eventMappers.ts:246-260` (`mapTaskFailed` early-return).
- `eventMappers.ts:262-276` (`mapTaskInterrupted` early-return).
- `eventMappers.ts:278-292` (`mapTaskResumed` early-return).

### Impact

Per-agent runtime state in `session.agentStates[agent]` is never
updated via the canonical claude-code path. The Dashboard and
Agent Task pages derive `runtime.phases[i].status` from
`session.pipelinePhases`, not `session.agentStates`, so the
visible card border / chip / dot never reflects `running`,
`completed`, `failed`, or `interrupted`. The user sees a dark
inactive card for every agent except the one whose `gate_pending`
envelope arrived (which updates `agentStates[agent]` via
`gate.payload.gate.role`).

### Severity

HIGH (user-visible in normal use today; matches the symptom in
the task brief).

### Root cause

`taskLifecycle.publishLifecycle` does not propagate the task's
role (`task.type`, which is `'architecture-agent' | 'po-agent' |
'ux-agent' | 'dev-agent' | 'qa-agent'`) into the envelope's
`role` field. The two sibling lifecycle publishers do not have
this bug: `gateBridge.requestGate` passes `role` explicitly;
the SSE controller passes `role: null` for the snapshot
envelope (which is correct — the snapshot is session-level, not
agent-level).

---

## D-2. `pipelinePhases` is updated only at SSE connect

### Description

`session.pipelinePhases` is the visible per-agent status source
for the Dashboard and Agent Task pages. It is updated ONLY in
`mapSessionStarted` (`eventMappers.ts:199-208`) from the SSE
`session_started` snapshot. `mapSessionResumed` returns `{}`
(returns no patch) and does not refresh `pipelinePhases`.

### Evidence

- `eventMappers.ts:199-208` (`mapSessionStarted` writes
  `pipelinePhases`).
- `eventMappers.ts:210-213` (`mapSessionResumed` returns `{}`).
- `grep "pipelinePhases" frontend/src/store/eventMappers.ts`
  returns exactly one write site (line 203).
- `SdlcController.js:366-378` (snapshot published once per
  connect, on `session_started` or `session_resumed`).

### Impact

Once the SSE connection opens, `pipelinePhases[i].status` is
frozen at whatever `Task.status` was at that moment. Subsequent
task lifecycle transitions (running → completed → next agent
→ ...) update `Task.status` and `Task.executionStatus` on the
backend, but those changes do not flow back into the FE store
because:

- `task_started/completed/...` envelopes have `role: null`
  (see D-1).
- The `task_*` mappers don't write `pipelinePhases` even when
  they do fire.
- The SSE snapshot is not re-published after the initial seed.

The user must reload the page (which closes and reopens the
SSE connection, triggering a fresh `session_started` snapshot)
to see updated phases. This is exactly the user's reported
"stays dark" behaviour.

### Severity

HIGH (user-visible in normal use today; matches the symptom in
the task brief).

### Root cause

The SSE snapshot publisher
(`SdlcController.streamPipelineStatus`) emits exactly ONE
snapshot per connection lifetime. There is no producer of a
re-snapshot when the underlying `Task.status` changes. The
task-lifecycle mappers do not patch `pipelinePhases`.

---

## D-3. `agentStates` is the only field that is written per-event, but the visible cards don't read it

### Description

The FE store carries `session.agentStates` as the per-agent
runtime state (per `SessionState.ts:48-58`, status enum
`'idle' | 'running' | 'awaiting_review' | 'completed' |
'failed' | 'skipped'`). `selectRuntimeExecution` reads it for
`currentAgent` and for the `awaiting_review` phase-merge
(`workflowSelectors.ts:224-231, 251-255`). But the visible
card border / chip on the Agent Task page reads
`runtime.phases[i].status`, which is derived from
`pipelinePhases`, not `agentStates`.

### Evidence

- `workflowSelectors.ts:257-264` (`phases` array built from
  `session.pipelinePhases`).
- `workflowSelectors.ts:247-255` (only `awaiting_review` is
  merged from `agentStates`).
- `SdlcDashboard/index.tsx:306` (`borderClass = COLUMN_BORDER[ps]`
  where `ps = phaseStatusFor(agent) = runtime.phases[agent].status`).

### Impact

Even if D-1 is fixed (i.e. `role: task.type` is propagated), the
visible card border / chip would still NOT update, because
`runtime.phases[i].status` is sourced from `pipelinePhases`. The
`currentAgent` indicator (the spinning loader) would update,
and the `awaiting_review` chip would show — but the border
would still be dim for `running` / `completed` / `failed`.

### Severity

HIGH (compounds with D-1 and D-2).

### Root cause

The selector `selectRuntimeExecution` does not promote
`agentStates[i].status` values (`'running'`, `'completed'`,
`'failed'`, `'skipped'`) into the `phases[i].status` array.
The `'awaiting_review'` value is the only one merged, because
that's the only value the original architecture (pre-refactor)
had a wire event for (`gate_pending` → awaiting_review).

---

## D-4. `agent_event` discriminator has no producer; the rich runtime machinery is dead code

### Description

`EventType` includes `'agent_event'` (`dto/event.ts:18` and
`eventEnvelope.js:11-23`). `mapAgentEvent`
(`eventMappers.ts:168-190`) handles sub-types `agent_start`,
`agent_tool_call`, `agent_tool_result`, `agent_complete`,
`file_change`, `token_usage`, `error` and updates
`agentStates[agent]` richly with `currentStep`,
`currentAction`, `currentFile`, `toolName`,
`currentStep='tool_execution'`, etc.

`grep "publishEvent.*'agent_event'" backend/src` returns zero
matches. No current source path emits an `agent_event` envelope.

### Evidence

- `frontend/src/dto/event.ts:18` (`'agent_event'` in union).
- `backend/src/dto/eventEnvelope.js:21` (`'agent_event'` in
  union).
- `eventMappers.ts:325` (`mappers.agent_event =
  mapAgentEvent`).
- `eventMappers.ts:168-190` (`mapAgentEvent` rich handler).
- `grep -rn "publishEvent.*'agent_event'" backend/src` → no
  matches.

### Impact

`session.runtimeEvents` is never populated. The Inspector
panel (`InspectorPanel.tsx`) renders an empty runtime log.
The rich `currentStep` / `currentAction` / `toolName` /
`currentFile` fields on `AgentState` are never set.

This is consistent with existing backlog R-002 / DR-017 — but
that backlog item is currently marked as low-priority. In
combination with D-1 / D-2 / D-3, the absence of an
`agent_event` producer is the reason the Agent Card has no
fine-grained runtime view.

### Severity

MEDIUM (dormant; masked by D-1/D-2/D-3; but the rich runtime
machinery in `mapAgentEvent` is the only path that could
populate `currentStep` / `currentAction`).

### Root cause

Historical: the old Python `AgentService` SSE bridge produced
`agent_event` envelopes. The new canonical claude-code path
produces `task_started/completed/...` envelopes via
`taskLifecycle.publishLifecycle`. The discriminator was not
removed when the producer was removed.

---

## D-5. `Task.status` carries `'processing'` not `'running'`

### Description

`agentDispatcher.runAgent` writes `Task.status = 'processing'`
(`agentDispatcher.js:312`). The legacy `'running'` value is
never written to `Task.status` in current source. The pipeline
phase mapper (`SdlcWorkflowService.getPipelineResponse:1256`)
uses `phaseData.status` directly — and `phaseData.status` is
`Task.status`. So even when `getPipelineResponse` is called
fresh (e.g. via an SSE re-snapshot — which itself doesn't
happen), the running phase would never appear as `'running'`
in `pipelinePhases[i].status`; it would appear as
`'processing'`, which is NOT a key in
`PhaseStatus.status` (`'pending' | 'running' | 'gate_pending'
| 'awaiting_review' | 'completed' | 'failed' | 'skipped'`).

### Evidence

- `agentDispatcher.js:312` (`status: 'processing'`).
- `SdlcWorkflowService.js:1256` (`let status = phaseData.status`).
- `frontend/src/services/api/sdlcApi.ts:71-78`
  (`PhaseStatus.status` enum).
- `grep "status.*'running'\|status:.*'running'" backend/src`
  → only the matrix entry, no writer.

### Impact

Even if D-2 were fixed (snapshot re-published on every state
change), the running phase would render as `unknown / pending`
because `'processing'` doesn't match any key in
`COLUMN_BORDER` / `PHASE_DOT_COLORS` / `STATUS_DOT_COLOR` /
`PhaseChip`. The CSS would fall back to the dim-gray
`'pending'` style.

### Severity

MEDIUM (would surface immediately after any fix to D-2; current
behaviour is masked by D-1/D-2).

### Root cause

The legacy `Task.status` string convention does not match the
canonical `Task.executionStatus` string. The two state fields
were never aligned (this is existing backlog R-029 / DR-012).

---

## D-6. `mapSessionResumed` returns `{}` — reconnect does not refresh phases

### Description

When the SSE connection is lost and re-established (e.g. user
reloads, or the network blips), the SSE controller publishes a
`session_resumed` envelope with the same `pipelinePhases`
shape. The FE mapper (`eventMappers.ts:210-213`) returns
`{}` — no patch. The comment says "the server replays prior
events verbatim", but the server does NOT re-snapshot the
pipeline — it only replays persisted `AgentEvent` envelopes,
which do NOT carry `pipelinePhases`.

### Evidence

- `eventMappers.ts:210-213` (`mapSessionResumed` returns `{}`).
- `SdlcController.js:366-378` (`session_resumed` published on
  reconnect, but `payload.pipelinePhases` is the same shape as
  `session_started`).
- `SdlcController.js:340-357` (replay reads `AgentEvent.envelope`
  only; legacy fallback for `gate_audit` rows only).

### Impact

A reconnect does not refresh `pipelinePhases`. The user's
"reload the page" workaround also fails to update the cards in
the most common case (reconnect via SSE Last-Event-ID, not full
page reload).

### Severity

LOW-MEDIUM (depends on user behaviour; not the primary cause of
the visible symptom).

### Root cause

`mapSessionResumed` does not apply the snapshot's payload,
matching its comment that "the server replays prior events
verbatim". This assumption is incorrect because the server
does NOT re-snapshot `pipelinePhases` on replay — it only
forwards stored envelopes, and `pipelinePhases` is not stored
as an envelope payload.

---

## D-7. Four parallel state views on the same agent

### Description

The runtime state has FOUR parallel concepts:

1. `Task.executionStatus` (canonical machine; `taskLifecycleService.TRANSITIONS`).
2. `Task.status` (legacy free-form; 8 direct writers).
3. `pipelinePhases[i].status` (computed from `Task.status` at snapshot time).
4. `agentStates[i].status` (FE-only; written by mappers that mostly never fire).

Each one is consumed by a different downstream consumer, and
the four are NOT kept consistent.

### Evidence

- §1 and §5 of `01_RUNTIME_STATE_TRACE.md`.
- `SessionState.ts:71-78` and `SessionState.ts:48-58` (two
  `status` enums on different objects).
- `taskLifecycleService.js:11-21` (canonical machine on
  `executionStatus`).
- `SdlcWorkflowService.js:1256` (legacy status reads for
  `pipelinePhases`).

### Impact

No single source of truth. Each consumer picks a different
field. The architecture as documented in the freeze
(`docs/engineering-freeze/04_AGENT_PIPELINE_BASELINE.md`)
treats `Task.executionStatus` as canonical, but the visible
runtime UI reads `pipelinePhases[i].status` (sourced from
`Task.status`).

### Severity

HIGH (architectural; existing backlog R-029/DR-012 covers
`Task.status` vs `Task.executionStatus` desync; this drift
extends the issue to the FE-visible state).

### Root cause

Multiple refactors left parallel state fields in place. The
canonical state machine (`executionStatus`) was added
alongside the legacy `status` field rather than replacing it.
The FE mirror inherited the legacy shape via the SSE snapshot
contract.

---

## D-8. `gate.role` carries role; envelope `role` does not — asymmetric

### Description

`gateBridge.requestGate` writes `role` to BOTH the envelope
base (line 124) AND the `gate.payload.gate.role` field
(line 132). `taskLifecycle.publishLifecycle` writes `role:
null` to the envelope base. The FE mapper for `gate_pending`
reads `gate.payload.gate.role` (eventMappers.ts:106). The FE
mappers for task lifecycle read `env.role` (eventMappers.ts:218,
230, 247, 263, 279). The asymmetry is consistent: only the
gate envelope's payload is read; the envelope's base `role`
field is consistently `null` for all canonical envelopes
emitted via `taskLifecycle.publishLifecycle`.

### Evidence

- `gateBridge.js:121-138` (gate writes both base `role` and
  `payload.gate.role`).
- `taskLifecycleService.js:88-92` (lifecycle writes base
  `role: null`).
- `eventMappers.ts:100-130` (gate mapper reads `payload.gate.role`).
- `eventMappers.ts:215-292` (lifecycle mappers read `env.role`).

### Impact

This is the proximate root cause of D-1. The fix is
two-fold:
1. `taskLifecycle.publishLifecycle` should propagate
   `task.type` as `role`.
2. The FE mappers should be consistent — either all read
   `payload.role` (if payload is augmented) or all read
   `env.role`.

### Severity

HIGH (proximate root cause of the visible bug).

### Root cause

The gate envelope's role comes from the gate's configuration
(supplied at `requestGate` time). The lifecycle envelope's role
should come from the task's type — but
`taskLifecycle.publishLifecycle` does not pass `task.type` into
the `publishEvent` call.

---

## D-9. Phase merge lifts `awaiting_review` but not `running`/`completed`

### Description

`workflowSelectors.ts:251-255`:
```ts
for (const key of AGENT_KEYS) {
  if (session.agentStates[key].status === 'awaiting_review' && phaseForAgent[key] === 'running') {
    phaseForAgent[key] = 'awaiting_review';
  }
}
```

This is the ONLY merge from `agentStates` into `phases`. It
promotes `'awaiting_review'` only when the snapshot says
`'running'`. It does NOT promote `'running'`, `'completed'`,
`'failed'`, or `'skipped'`.

### Evidence

- `workflowSelectors.ts:247-264` (phase build).
- `workflowSelectors.ts:251-255` (the single conditional merge).

### Impact

Even if D-1 is fixed, the only `agentStates` value that would
ever flow into the visible card is `'awaiting_review'`. The
`'running'` / `'completed'` / `'failed'` / `'skipped'` values
would be silently dropped.

### Severity

HIGH (compounds with D-1; would mask a partial fix to D-1).

### Root cause

The original architecture had ONE per-event value
(`'awaiting_review'`) flowing from the gate path; the merge
code was written for that one case. The richer
`'running'`/`'completed'`/`'failed'`/`'skipped'` transitions
were never wired through.

---

## Drift summary

| ID | Description | Severity | Component | Touches existing R-N? |
| -- | ----------- | -------- | --------- | --------------------- |
| D-1 | `task_started` envelope carries `role:null` | HIGH | BE `taskLifecycleService` | R-008 (claude_result orphan); R-046 (FE actions) |
| D-2 | `pipelinePhases` updated only at SSE connect | HIGH | FE `eventMappers` | new |
| D-3 | `agentStates` not read for visible cards | HIGH | FE `workflowSelectors`, `SdlcDashboard/index.tsx` | new |
| D-4 | `agent_event` has no producer | MEDIUM | BE / FE | R-002 (orphan EventTypes) |
| D-5 | `Task.status = 'processing'` not `'running'` | MEDIUM | BE `agentDispatcher`, FE enums | R-029 (`Task.status` bypass) |
| D-6 | `mapSessionResumed` returns `{}` | LOW-MEDIUM | FE `eventMappers` | new |
| D-7 | Four parallel state views | HIGH | architecture | R-029 (`Task.status` bypass) |
| D-8 | asymmetric role propagation | HIGH | BE `taskLifecycleService` | D-1 is the specific manifestation |
| D-9 | phase merge only lifts `awaiting_review` | HIGH | FE `workflowSelectors` | D-3 is the specific manifestation |

The HIGH-severity drifts are: D-1, D-2, D-3, D-7, D-8, D-9.