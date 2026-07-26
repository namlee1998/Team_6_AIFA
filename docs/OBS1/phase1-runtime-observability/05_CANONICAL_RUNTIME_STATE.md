# 05 — Canonical Runtime State

> **Status:** DESIGN SPECIFICATION.
> Single source of truth for runtime visualization.
> This document is NOT implementation. It is the canonical spec
> that Batch OBS-01 must implement.
>
> Every state listed below is traced to its backend producer and
> the FE store / component that consumes it. Each value the spec
> introduces must already exist in the current codebase; no new
> states are invented here.
>
> Three layers of evidence back each row:
> - **Backend meaning**: the row's authoritative producer.
> - **UI meaning**: the row's CSS class, badge text, icon, and
>   animation in the current codebase.
> - **Canonical mapping table**: the one place where the canonical
>   backend state, the FE store state, the visible badge, the
>   colour, the animation, and the allowed next transitions are
>   listed side-by-side.
>
> Evidence rule: every concrete claim cites a `file:line`. Where
> evidence is missing the document explicitly writes
> "Evidence not found." — it does not infer architecture without
> proof.

---

## 1. The three runtime-state layers in this repository

The repository has THREE co-existing runtime-state fields per agent.
Each one is the "canonical" field for a different consumer. This
document makes the layers explicit so that OBS-01 has exactly one
owner per layer.

### 1.1 Layer A — the canonical backend state machine

- **Owner:** `Task.executionStatus`.
- **Schema column:** `backend/prisma/schema.prisma:84`.
- **Governed by:** `backend/src/services/taskLifecycleService.js:11-21`
  (`TRANSITIONS` matrix + `TERMINAL` set).
- **Producer:** `taskLifecycle.transition(taskId, nextStatus, …)`
  (`taskLifecycleService.js:95-141`). Every transition allocates a
  canonical `EventEnvelope` and persists an `AgentEvent` row in the
  same `prisma.$transaction`.
- **Allowed states (8):** `queued`, `dispatched`, `running`,
  `awaiting_gate`, `completed`, `failed`, `cancelled`, `timeout`.
- **Terminal set:** `{completed, failed, cancelled, timeout}`
  (`taskLifecycleService.js:11`).

### 1.2 Layer B — the legacy backend free-form field

- **Owner:** `Task.status` (default `'pending'`,
  `backend/prisma/schema.prisma:67`).
- **Governed by:** None. 8 direct writers bypass
  `taskLifecycle.transition`.
- **Observed values in current source:**
  - `'pending'` — `Task.create` default (`Task.js:39`).
  - `'processing'` — `agentDispatcher.runAgent:312` (the writer).
  - `'running'` — `SdlcWorkflowService.resumeTask:1356` (legacy
    tool-approval resume path only).
  - `'completed'` — `_saveAgentData` (SdlcWorkflowService.js:2026).
  - `'failed'` — `agentDispatcher.markTaskFailed:534-537`;
    `handleTaskTimeout:562`; `taskWorkerService.sweepStale:160`.
  - `'cancelled'` — `cancelTask` (SdlcWorkflowService.js:1718).
  - `'PENDING_TOOL_APPROVAL'` — legacy langchain path
    (`agentDispatcher.js:442`, `_resumeAgentStream:1440-1444`).
- **Touches visible UI today:** `pipelinePhases[i].status` is
  built from `Task.status` at snapshot time
  (`SdlcWorkflowService.js:1256`).

### 1.3 Layer C — the FE store fields

- **`session.pipelinePhases: api.PhaseStatus[]`** —
  `frontend/src/models/SessionState.ts:84-85`. Initialized to all-
  `'pending'` in `defaultPipelinePhases()`
  (`SessionState.ts:131-133`). Updated only by
  `mapSessionStarted` (`eventMappers.ts:199-208`) from the SSE
  `session_started` snapshot. Frozen after SSE connect.
- **`session.agentStates: Record<AgentKey, AgentState>`** —
  `SessionState.ts:87-88`. Initialized to all-`'idle'` in
  `emptyAgentStates()` (`SessionState.ts:113-129`). Updated by
  per-event mappers, all of which early-return because
  `taskLifecycle.publishLifecycle` emits `role: null`
  (see `04_REPAIR_PROPOSAL.md` for the trace).
- **`session.runtimeEvents: RuntimeEvent[]`** —
  `SessionState.ts:98-99`. Updated by `mapAgentEvent`. No
  `agent_event` envelope producer exists in current source, so
  this list stays empty.
- **`session.status: SessionStatus`** —
  `SessionState.ts:79`. Session-level status enum: `'pending' |
  'running' | 'awaiting_approval' | 'awaiting_release' | 'completed'
  | 'failed'` (`SessionState.ts:70`). Updated by `mapGatePending`,
  `mapGateResolved`, `mapSessionStarted`, `mapPipelineCompleted`,
  `mapPipelineFailed`.

### 1.4 Which layer does the visible UI read today?

- **Dashboard pipeline strip**
  (`OverviewPage.tsx:234-249`): reads
  `session.pipelinePhases[i].status` (Layer C → sourced from
  Layer B at snapshot time).
- **Dashboard per-session card**
  (`OverviewPage.tsx:184-195, 270-275`): reads
  `session.agentStates[i].status` for the `runningAgent` /
  `reviewingAgent` spinner + label. Updates would come from
  Layer C's `agentStates` writer (currently dormant).
- **Agent Task card border / badge / chip / dot / glyph**
  (`SdlcDashboard/index.tsx:306, 324, 332-345`): reads
  `runtime.phases[i].status` (Layer C → sourced from
  Layer B at snapshot time).
- **Agent Task SessionPill**
  (`SdlcDashboard/index.tsx:364-385`): reads
  `session.status` (Layer C, updated by `mapGatePending` etc.).
- **Inspector tabs** (`InspectorPanel.tsx`): reads
  `session.pendingGates` and `session.gateHistory` only. Does NOT
  render `runtimeEvents` or `agentStates`.

The current visible UI is driven entirely by Layer C, which is
sourced from Layer B (legacy) at SSE connect time. Layer A is the
canonical machine but is NOT directly visible.

---

## 2. The eight runtime states — canonical spec

This section defines each runtime state. The list is the union of
all observed values across Layer A, Layer B, and the FE-visible
`PhaseStatus.status` + `AgentState.status` enums.

### 2.1 `idle`

- **Backend meaning:** the FE store's initial value for
  `session.agentStates[i].status` (`emptyAgentStates()` at
  `SessionState.ts:113-129`); there is no BE producer.
- **Producer:** `useWorkflowStore` initial state
  (`SessionState.ts:118`).
- **Consumer:** `selectRuntimeExecution` reads it
  (`workflowSelectors.ts:247-264`); `OverviewPage.tsx:184-189`
  reads it.
- **UI meaning:** "agent has not been touched by any runtime
  event". The card border is the dim default; the chip reads
  whatever `pipelinePhases[i].status` says (typically `'pending'`).
- **Badge:** none — the visible badge text is sourced from
  `pipelinePhases[i].status`, which is `'pending'` for an idle
  agent. Evidence: `SdlcDashboard/index.tsx:503-516` (`PhaseChip`).
- **Border:** `border-outline-variant/20` (dim).
  Evidence: `SdlcDashboard/index.tsx:78` (`COLUMN_BORDER.pending`).
- **Background:** `bg-surface-container text-on-surface-variant/70`
  for the chip. Evidence: `SdlcDashboard/index.tsx:510`.
- **Glow:** none. Evidence: no glow utility applied to idle state.
- **Animation:** none. Evidence: not listed in any `animate-*`
  selector path.
- **Progress indicator:** none. Evidence: not rendered.
- **Icon:** `PlayCircle` (per-task). Evidence:
  `SdlcDashboard/index.tsx:50`.
- **Dashboard rendering:** `OverviewPage.tsx:236-249` (per-agent
  strip); falls back to default `bg-surface-container
  text-on-surface-variant/60` (line 248).
- **Agent Task rendering:** `SdlcDashboard/index.tsx:308-348`
  (per-agent card).
- **Inspector rendering:** not rendered; Inspector consumes
  `pendingGates` and `gateHistory` only.
- **Owner:** `useWorkflowStore` initial state.
- **Transition source:** state is reached ONLY at session start.
  No transition INTO idle from any other state in current source.
  Transitions OUT: any per-event mapper that sets
  `agentStates[i].status = 'running' | 'awaiting_review' | ...`.

### 2.2 `queued`

- **Backend meaning:** the canonical initial value for
  `Task.executionStatus` (schema default `'queued'` per
  `backend/prisma/schema.prisma:84`; `taskLifecycleService.js:13`).
- **Producer:** `Task.create` (`backend/src/models/Task.js:49`
  writes `executionStatus: data.executionStatus || 'queued'`).
- **Consumer:** `taskLifecycle.transition` validates against
  `TRANSITIONS.queued` (`taskLifecycleService.js:13`).
- **FE wire:** mapped to `'task_started'` envelope via
  `EVENT_BY_STATUS.queued = 'task_queued'` and
  `LIFECYCLE_TO_EVENTTYPE.task_queued = 'task_started'`
  (`taskLifecycleService.js:23-45`). The wire envelope arrives at
  `mapTaskStarted` (`eventMappers.ts:215-227`) but early-returns
  because `env.role` is null.
- **FE mapping:** no explicit value in `PhaseStatus.status`. The
  FE merges `task_started` into the visible state via the
  `running` value (when the canonical fix lands). Today
  `pipelinePhases[i].status` shows `'pending'` until the SSE
  snapshot publishes `'running'`.
- **UI meaning:** "task created, waiting to be dispatched to the
  runner".
- **Badge:** none today (the visible chip is `'pending'` until
  the snapshot re-publishes). After OBS-01, the canonical mapping
  collapses `queued` to `'pending'` in the visible chip.
- **Border:** `border-outline-variant/20` (dim).
  Evidence: `COLUMN_BORDER.pending` (`SdlcDashboard/index.tsx:77`).
- **Background:** same as idle — `bg-surface-container
  text-on-surface-variant/70`.
- **Glow:** none.
- **Animation:** none.
- **Progress indicator:** none.
- **Icon:** `PlayCircle` (per-task).
- **Dashboard rendering:** appears as `'pending'` (line 248 of
  OverviewPage.tsx falls through to the default).
- **Agent Task rendering:** appears as `'pending'`.
- **Inspector rendering:** not rendered.
- **Owner:** `Task.executionStatus` (canonical, governed by
  `taskLifecycle.transition`).
- **Transition source:** `taskLifecycle.transition(taskId,
  'running', …)` from `agentDispatcher.runAgent:313` (BE),
  `taskLifecycle.transition(taskId, 'cancelled', …)` (BE),
  `taskLifecycle.transition(taskId, 'dispatched', …)` (never
  reached in current source — see `taskLifecycleService.js:13`).

### 2.3 `dispatched`

- **Backend meaning:** a reserved intermediate state in the
  canonical matrix (`taskLifecycleService.js:13`). The matrix
  allows `queued → dispatched` and `dispatched → running |
  cancelled | timeout`.
- **Producer:** None observed in current source. The matrix
  permits the edge; no call site issues it.
- **Consumer:** `taskLifecycle.transition` validates against
  `TRANSITIONS.dispatched`.
- **FE wire:** no producer, no envelope ever carries this state.
- **UI meaning:** "task is claimed by the worker lock, not yet
  running the agent". Not currently observable in the UI.
- **Badge / Border / Background / Glow / Animation / Progress / Icon:**
  Evidence not found. The FE has no UI path that surfaces the
  `dispatched` state today.
- **Dashboard rendering:** not rendered.
- **Agent Task rendering:** not rendered.
- **Inspector rendering:** not rendered.
- **Owner:** `Task.executionStatus` (canonical, dormant in
  current source).
- **Transition source:** `taskWorker.claim`
  (`taskWorkerService.js:34-45`) — referenced by the matrix but
  not observed writing `dispatched` directly; see existing
  backlog R-029.

### 2.4 `running`

- **Backend meaning:** the canonical state meaning "agent is
  actively executing".
- **Producer (canonical):** `taskLifecycle.transition(taskId,
  'running', …)` called from `agentDispatcher.runAgent:313` —
  immediately after `Task.update(task.id, { status: 'processing' })`
  on line 312. Persists `AgentEvent` row with
  `EVENT_BY_STATUS.running = 'task_started'` (`taskLifecycleService.js:26`).
- **Producer (legacy):** `SdlcWorkflowService.resumeTask:1356`
  writes `Task.status = 'running'` directly (legacy tool-approval
  resume path).
- **Consumer (canonical):** `taskLifecycle.transition` validates
  against `TRANSITIONS.running`; `agentWorkerService` reads it.
- **FE wire:** the `task_started` envelope arrives at
  `mapTaskStarted` (`eventMappers.ts:215-227`). The mapper
  early-returns because `env.role` is null. After OBS-01 lands,
  the mapper MUST update both `agentStates[ARCH].status =
  'running'` AND `pipelinePhases[ARCH].status = 'running'`.
- **FE mapping:** the visible value is `'running'` in
  `PhaseStatus.status` (`sdlcApi.ts:73`).
- **UI meaning:** "agent is executing the prompt".
- **Badge:** `RUNNING` (uppercase). Evidence: `SdlcDashboard/index.tsx:513`
  (chip text is `status.replace('_', ' ')`, with `'running'`
  becoming `'running'`).
- **Border:** `border-blue-500/30`. Evidence:
  `SdlcDashboard/index.tsx:78` (`COLUMN_BORDER.running`).
- **Background:** `bg-blue-500/20 text-blue-300` (chip).
  Evidence: `SdlcDashboard/index.tsx:506`.
- **Glow:** none explicitly defined.
- **Animation:** `animate-spin` on the per-task icon
  (`Loader2`). Evidence: `SdlcDashboard/index.tsx:46`
  (`TASK_ICON.running`). Same on the session-level
  `SessionStatusIcon` for `running` (`OverviewPage.tsx:371`).
- **Progress indicator:** none in the current codebase. Evidence:
  no progress bar / spinner applied to the agent card.
- **Icon:** `Loader2` (per-task); `Loader2` (session-level).
- **Dashboard rendering:** `OverviewPage.tsx:240-249` (pipeline
  strip colour + glyph via `PhaseStatusLabel`); `line 263`
  (Loader2 + label `<agent> running`).
- **Agent Task rendering:** `SdlcDashboard/index.tsx:308-348`
  (card border + chip + per-task icon).
- **Inspector rendering:** not rendered.
- **Owner (canonical):** `Task.executionStatus`. After OBS-01,
  the canonical chain is: `taskLifecycle.transition` →
  `publishLifecycle` → SSE envelope with `role: task.type` →
  `mapTaskStarted` → `pipelinePhases[i].status = 'running'` +
  `agentStates[i].status = 'running'`.
- **Transition source:** `queued → running` via
  `agentDispatcher.runAgent:313`. `awaiting_gate → running` via
  `gateBridge.resolveGate:170-174`. (Both BE.)

### 2.5 `awaiting_gate`

- **Backend meaning:** "a `PendingGate` row exists for this task
  and the agent is paused waiting for a human answer".
- **Producer (canonical):** `taskLifecycle.transition(taskId,
  'awaiting_gate', …)` called from `gateBridge.requestGate:116-119`
  via `transitionIfPresent`. Bypassed for `kind === 'output_review'
  || 'release'` (gateBridge.js:102). For `kind === 'tool' ||
  'question'`, the transition fires.
- **Producer (legacy):** `Task.status` is not updated to any
  value matching `awaiting_gate`. The canonical machine is the
  sole carrier.
- **Consumer (canonical):** `taskLifecycle.transition` validates
  against `TRANSITIONS.awaiting_gate`; the matrix only allows
  `awaiting_gate → running | failed | cancelled | timeout`.
- **FE wire:** `gateBridge.requestGate:121-138` publishes
  `gate_pending` envelope. `EVENT_BY_STATUS.awaiting_gate =
  'gate_pending'` (`taskLifecycleService.js:27`). The
  `gate_pending` envelope carries `role: <agent>` (per
  `gateBridge.js:124`).
- **FE mapping:** `mapGatePending` (`eventMappers.ts:100-130`)
  reads `payload.gate.role` and sets
  `agentStates[agentKey].status = 'awaiting_review'`. The visible
  `PhaseStatus.status` value `awaiting_review` is the FE-side
  projection of `awaiting_gate`. After OBS-01 lands, both
  `pipelinePhases[i].status` and `agentStates[i].status` should
  carry the same value.
- **UI meaning:** "task is paused waiting for human input". This
  is the ONLY state that renders correctly today (per
  `04_REPAIR_PROPOSAL.md` trace).
- **Badge:** `GATE PENDING` (uppercase, with the underscore
  replaced). Evidence: `SdlcDashboard/index.tsx:513`.
- **Border:** `border-amber-500/30`. Evidence:
  `SdlcDashboard/index.tsx:79` (`COLUMN_BORDER.gate_pending`).
- **Background:** `bg-amber-500/20 text-amber-400` (chip).
  Evidence: `SdlcDashboard/index.tsx:507`.
- **Glow:** none.
- **Animation:** `animate-pulse` on the session connection dot
  (`OverviewPage.tsx:398-400`) is unrelated; the per-task icon
  is `Clock` (no animation). Evidence:
  `SdlcDashboard/index.tsx:47` (`TASK_ICON.gate_pending` =
  `<Clock size={14} className="text-amber-500" />`).
- **Progress indicator:** none.
- **Icon:** `Clock` (per-task); `Clock` (session-level for
  `awaiting_approval`/`awaiting_release`).
- **Dashboard rendering:** `OverviewPage.tsx:240-249` (pipeline
  strip colour) + `PhaseStatusLabel` glyph `!` (`line 364`).
- **Agent Task rendering:** `SdlcDashboard/index.tsx:308-348`
  (card border + chip + per-task icon).
- **Inspector rendering:** not rendered as an agent state; the
  gate itself is rendered as the `gate_pending` panel inside the
  questions / review tab.
- **Owner (canonical):** `Task.executionStatus`. After OBS-01, the
  FE also writes `pipelinePhases[i].status = 'gate_pending'` (or
  the `'awaiting_review'` variant — see §3 mapping table).
- **Transition source:** `running → awaiting_gate` via
  `gateBridge.requestGate` (BE). `awaiting_gate → running` via
  `gateBridge.resolveGate:170-174`. `awaiting_gate → failed |
  cancelled | timeout` via the matrix.

### 2.6 `completed`

- **Backend meaning:** "task finished, runner returned a result,
  and the output has been persisted".
- **Producer (canonical):** `taskLifecycle.transition(taskId,
  'completed', …)` from `SdlcWorkflowService._saveAgentData:2041-2044`
  via `transitionIfPresent`. Persists `AgentEvent` row with
  `EVENT_BY_STATUS.completed = 'task_completed'`
  (`taskLifecycleService.js:28`).
- **Producer (legacy):** `_saveAgentData` writes
  `Task.status = 'completed'` (SdlcWorkflowService.js:2026).
- **Consumer (canonical):** `taskLifecycle.transition` validates
  against `TERMINAL` (`taskLifecycleService.js:11`).
- **FE wire:** the `task_completed` envelope arrives at
  `mapTaskCompleted` (`eventMappers.ts:229-244`). Today the
  mapper early-returns because `env.role` is null. After OBS-01,
  the mapper MUST update both `agentStates[ARCH].status =
  'completed'` AND `pipelinePhases[ARCH].status = 'completed'`.
- **FE mapping:** the visible value is `'completed'` in
  `PhaseStatus.status` (`sdlcApi.ts:73`). However the current
  `getPipelineResponse` (`SdlcWorkflowService.js:1256-1264`) only
  shows `'completed'` for `Task.status === 'completed'` AND
  `versionStatus === 'committed'` (the `awaitingReview` flag).
  After OBS-01, the BE must derive `'completed'` from
  `Task.executionStatus === 'completed'` regardless of
  `versionStatus`.
- **UI meaning:** "agent finished, output saved; awaiting HITL
  approval".
- **Badge:** `COMPLETED` (uppercase). Evidence:
  `SdlcDashboard/index.tsx:513`.
- **Border:** `border-emerald-500/20`. Evidence:
  `SdlcDashboard/index.tsx:80`.
- **Background:** `bg-emerald-500/20 text-emerald-400` (chip).
  Evidence: `SdlcDashboard/index.tsx:505`.
- **Glow:** none.
- **Animation:** none.
- **Progress indicator:** none.
- **Icon:** `Check` (per-task). Evidence:
  `SdlcDashboard/index.tsx:45`.
- **Dashboard rendering:** `OverviewPage.tsx:240-249` (pipeline
  strip colour) + `PhaseStatusLabel` glyph `✓` (`line 362`).
- **Agent Task rendering:** `SdlcDashboard/index.tsx:308-348`.
- **Inspector rendering:** not rendered as an agent state. The
  completed output is rendered via `AgentOutputPanel` (which
  loads via `getSdlcTaskStatus` on click — not via the SSE
  pipeline). Evidence: `InspectorPanel.tsx:43` (`gates` only).
- **Owner (canonical):** `Task.executionStatus`. After OBS-01,
  the canonical chain updates `pipelinePhases[i].status =
  'completed'` directly via the mapper.
- **Transition source:** `running → completed` via
  `_saveAgentData` (BE). Terminal.

### 2.7 `failed`

- **Backend meaning:** "task terminated with a runner error".
- **Producer (canonical):** `taskLifecycle.transition(taskId,
  'failed', …)` called from
  `agentDispatcher.markTaskFailed:545-548` (via `transition`),
  and from `taskWorkerService.sweepStale:151-157` (via
  `transitionIfPresent`).
- **Producer (legacy):** `Task.update({ status: 'failed' })` from
  `agentDispatcher.markTaskFailed:534-537`;
  `handleTaskTimeout:562`; `taskWorkerService.sweepStale:160`.
- **Consumer (canonical):** `taskLifecycle.transition` validates
  against `TERMINAL`.
- **FE wire:** the `task_failed` envelope arrives at
  `mapTaskFailed` (`eventMappers.ts:246-260`). Today the mapper
  early-returns because `env.role` is null. After OBS-01, the
  mapper MUST update both `agentStates[ARCH].status = 'failed'`
  AND `pipelinePhases[ARCH].status = 'failed'`.
- **FE mapping:** the visible value is `'failed'` in
  `PhaseStatus.status` (`sdlcApi.ts:73`).
- **UI meaning:** "agent terminated with an error".
- **Badge:** `FAILED` (uppercase). Evidence:
  `SdlcDashboard/index.tsx:513`.
- **Border:** `border-red-500/30`. Evidence:
  `SdlcDashboard/index.tsx:82`.
- **Background:** `bg-red-500/20 text-red-400` (chip).
  Evidence: `SdlcDashboard/index.tsx:508`.
- **Glow:** none.
- **Animation:** none (per-task). Evidence:
  `SdlcDashboard/index.tsx:48` (`TASK_ICON.failed` =
  `<AlertCircle size={14} className="text-error" />`).
- **Progress indicator:** none.
- **Icon:** `AlertCircle` (per-task).
- **Dashboard rendering:** `OverviewPage.tsx:240-249` (pipeline
  strip colour) + `PhaseStatusLabel` glyph `✗` (`line 365`).
- **Agent Task rendering:** `SdlcDashboard/index.tsx:308-348`.
- **Inspector rendering:** not rendered as an agent state.
- **Owner (canonical):** `Task.executionStatus`. After OBS-01,
  the canonical chain updates `pipelinePhases[i].status =
  'failed'`.
- **Transition source:** `running → failed | awaiting_gate →
  failed | dispatched → failed | queued → failed` via the
  matrix. Terminal.

### 2.8 `cancelled`

- **Backend meaning:** "task cancelled by user".
- **Producer (canonical):** `taskLifecycle.transition(taskId,
  'cancelled', …)` called from `SdlcWorkflowService.cancelTask`
  (referenced at `SdlcWorkflowService.js:1719`).
- **Producer (legacy):** `Task.update({ status: 'cancelled' })`
  from `SdlcWorkflowService.cancelTask:1718`.
- **Consumer (canonical):** `taskLifecycle.transition` validates
  against `TERMINAL`.
- **FE wire:** the `task_interrupted` envelope arrives at
  `mapTaskInterrupted` (`eventMappers.ts:262-276`). Today the
  mapper early-returns because `env.role` is null. After OBS-01,
  the mapper MUST update both `agentStates[ARCH].status =
  'skipped'` AND `pipelinePhases[ARCH].status = 'skipped'`.
- **FE mapping:** `PhaseStatus.status` enum has no `'cancelled'`
  value; the canonical projection collapses `cancelled` to
  `'skipped'` (per existing FE enum at `sdlcApi.ts:73`).
- **UI meaning:** "task was cancelled".
- **Badge:** `SKIPPED` (uppercase). Evidence:
  `SdlcDashboard/index.tsx:513`.
- **Border:** `border-dashed border-outline-variant/20` (dashed
  dim). Evidence: `SdlcDashboard/index.tsx:81`
  (`COLUMN_BORDER.skipped`).
- **Background:** `bg-outline-variant/30 text-on-surface-variant`
  (chip). Evidence: `SdlcDashboard/index.tsx:509`.
- **Glow:** none.
- **Animation:** none.
- **Progress indicator:** none.
- **Icon:** `SkipForward` (per-task). Evidence:
  `SdlcDashboard/index.tsx:49`.
- **Dashboard rendering:** `OverviewPage.tsx:240-249` +
  `PhaseStatusLabel` glyph `⊘` (`line 366`).
- **Agent Task rendering:** `SdlcDashboard/index.tsx:308-348`.
- **Inspector rendering:** not rendered as an agent state.
- **Owner (canonical):** `Task.executionStatus`. After OBS-01,
  the canonical chain projects `cancelled` →
  `pipelinePhases[i].status = 'skipped'`.
- **Transition source:** `queued | dispatched | running |
  awaiting_gate → cancelled` via the matrix. Terminal.

### 2.9 `timeout`

- **Backend meaning:** "task terminated because the per-task
  budget was exceeded".
- **Producer (canonical):** `taskLifecycle.transition(taskId,
  'timeout', …)` called from `agentDispatcher.handleTaskTimeout`
  (referenced at `agentDispatcher.js:557-566`) and from
  `taskWorkerService.sweepStale:151-157` (the `dispatched →
  timeout` edge).
- **Producer (legacy):** `agentDispatcher.handleTaskTimeout:562`
  writes `Task.status = 'failed'` (NOT `'timeout'`). This is a
  documented drift in existing backlog R-029 / DR-012.
- **Consumer (canonical):** `taskLifecycle.transition` validates
  against `TERMINAL`.
- **FE wire:** the `task_interrupted` envelope arrives at
  `mapTaskInterrupted` (`eventMappers.ts:262-276`); the mapper
  projects `timeout` and `cancelled` both to `'skipped'`. After
  OBS-01, the mapper MUST update both `agentStates[i].status =
  'skipped'` AND `pipelinePhases[i].status = 'skipped'`.
- **FE mapping:** `PhaseStatus.status` enum has no `'timeout'`
  value; the canonical projection collapses `timeout` to
  `'skipped'`.
- **UI meaning:** "task timed out". Visually identical to
  `cancelled` (per the FE enum).
- **Badge / Border / Background / Glow / Animation / Progress / Icon:**
  same as `cancelled` (§2.8).
- **Dashboard / Agent Task / Inspector rendering:** same as
  `cancelled`.
- **Owner (canonical):** `Task.executionStatus`. After OBS-01,
  the canonical chain projects `timeout` →
  `pipelinePhases[i].status = 'skipped'`.
- **Transition source:** `dispatched | running | awaiting_gate →
  timeout` via the matrix. Terminal.

### 2.10 `PENDING_TOOL_APPROVAL`

- **Backend meaning:** a LEGACY string literal that lives only on
  `Task.status`. The canonical machine (`executionStatus`) does
  NOT include this state. The state is set by the legacy langchain
  real-agent path (`agentDispatcher.js:441-444`).
- **Producer:** `agentDispatcher.js:441-444` (legacy langchain
  path only). Not on the canonical claude-code / mock paths.
- **Consumer:** `SdlcWorkflowService.resumeTask:1353` reads it
  (`if (task.status !== 'PENDING_TOOL_APPROVAL') throw …`).
- **FE mapping:** Evidence not found. The FE enums do not
  include `'PENDING_TOOL_APPROVAL'`. After OBS-01, this state
  should be retired in favor of the canonical `awaiting_gate`.
- **Owner:** legacy `Task.status` (dormant on current paths).
- **Transition source:** Evidence not found. The legacy langchain
  path does not route through `taskLifecycle.transition`.

### 2.11 `awaiting_review` (FE-only projection)

- **Backend meaning:** None. This is a FE-only projection created
  by `mapGatePending` for output-review gates (where the
  canonical machine does NOT transition to `awaiting_gate`).
- **Producer:** `mapGatePending` (`eventMappers.ts:112`).
- **Consumer:** `selectRuntimeExecution`
  (`workflowSelectors.ts:251-255`) merges this into the
  `phaseForAgent` map.
- **UI meaning:** "agent has completed but its output is awaiting
  HITL review". Equivalent visually to `gate_pending`.
- **Badge / Border / Background / Glow / Animation / Progress / Icon:**
  same as `awaiting_gate` (§2.5).
- **Owner:** FE-only. After OBS-01, the canonical projection
  must include `'awaiting_review'` as a valid
  `pipelinePhases[i].status` value.
- **Transition source:** FE-only projection. Equivalent to
  `awaiting_gate` in the matrix.

### 2.12 Session-level statuses (for completeness)

The session-level `session.status` enum (`SessionState.ts:70`)
has SIX values. The OBS-01 spec does not redefine these; they
remain as-is for the session pill rendering.

| Value | Source / owner | UI badge |
| ----- | -------------- | -------- |
| `'pending'` | `defaultSessionState()` initial (`SessionState.ts:148`) | dim default |
| `'running'` | `mapGatePending` (no-op), `mapGateResolved` (no-op), `mapSessionStarted` | `RUNNING` (blue). Evidence: `SdlcDashboard/index.tsx:369` |
| `'awaiting_approval'` | `mapGatePending` line 122 (for non-release gate_pending) | `AWAITING APPROVAL` (amber). Evidence: `SdlcDashboard/index.tsx:417` |
| `'awaiting_release'` | `mapGatePending` line 122 (for FINAL_RELEASE / kind='release') | `AWAITING RELEASE` (amber). Evidence: `SdlcDashboard/index.tsx:416` |
| `'completed'` | `mapPipelineCompleted:297`; `mapSessionStarted:202` | `COMPLETED` (emerald). Evidence: `SdlcDashboard/index.tsx:414` |
| `'failed'` | `mapPipelineFailed:313`; `mapSessionStarted:202` | `FAILED` (red). Evidence: `SdlcDashboard/index.tsx:415` |

---

## 3. Canonical mapping table

The table below is the ONE place where the canonical backend
state, the FE store state, the visible badge text, the colour,
the animation, and the allowed next transitions are listed
side-by-side.

### 3.1 The mapping table

| # | Canonical backend state (`Task.executionStatus`) | Legacy `Task.status` value | `EventEnvelope.type` (wire) | `PhaseStatus.status` (visible) | `AgentState.status` (visible) | Badge text (uppercase) | Border colour class | Chip background class | Per-task icon | Animation | Allowed transitions OUT (canonical matrix) |
| - | ------------------------------------------------ | ------------------------ | -------------------------- | ------------------------------ | ------------------------------ | --------------------- | ------------------- | ----------------------- | ------------- | ---------- | ----------------------------------------------- |
| 1 | `queued` (canonical initial) | `'pending'` | `task_started` (from `task_queued`) | `'pending'` | `'idle'` | `PENDING` | `border-outline-variant/20` | `bg-surface-container text-on-surface-variant/70` | `PlayCircle` | none | `running` (via `agentDispatcher.runAgent:313`), `cancelled`, `dispatched` (dormant) |
| 2 | `dispatched` (dormant) | Evidence not found | none produced | falls back to `'pending'` (no key) | `'idle'` | `PENDING` | `border-outline-variant/20` (fallback) | `bg-surface-container text-on-surface-variant/70` | `PlayCircle` | none | `running`, `cancelled`, `timeout` (matrix permits) |
| 3 | `running` | `'processing'` (writer) / `'running'` (legacy resume) | `task_started` | `'running'` | `'running'` | `RUNNING` | `border-blue-500/30` | `bg-blue-500/20 text-blue-300` | `Loader2` | `animate-spin` on the icon | `awaiting_gate`, `completed`, `failed`, `cancelled`, `timeout` |
| 4 | `awaiting_gate` (canonical) | none (canonical only) | `gate_pending` | `'gate_pending'` OR `'awaiting_review'` (FE projection) | `'awaiting_review'` (FE-only) | `GATE PENDING` / `AWAITING REVIEW` | `border-amber-500/30` | `bg-amber-500/20 text-amber-400` | `Clock` | none | `running`, `failed`, `cancelled`, `timeout` |
| 5 | `completed` | `'completed'` | `task_completed` | `'completed'` (only when `versionStatus === 'committed'` today; OBS-01 fixes this) | `'completed'` | `COMPLETED` | `border-emerald-500/20` | `bg-emerald-500/20 text-emerald-400` | `Check` | none | terminal |
| 6 | `failed` | `'failed'` | `task_failed` | `'failed'` | `'failed'` | `FAILED` | `border-red-500/30` | `bg-red-500/20 text-red-400` | `AlertCircle` | none | terminal |
| 7 | `cancelled` | `'cancelled'` | `task_interrupted` | `'skipped'` (FE projection) | `'skipped'` | `SKIPPED` | `border-dashed border-outline-variant/20` | `bg-outline-variant/30 text-on-surface-variant` | `SkipForward` | none | terminal |
| 8 | `timeout` | Evidence not found (legacy writes `'failed'`) | `task_interrupted` | `'skipped'` (FE projection) | `'skipped'` | `SKIPPED` | `border-dashed border-outline-variant/20` | `bg-outline-variant/30 text-on-surface-variant` | `SkipForward` | none | terminal |
| 9 | (legacy only) `PENDING_TOOL_APPROVAL` | `'PENDING_TOOL_APPROVAL'` | none (legacy langchain) | falls back to `'pending'` (no key) | falls back to `'idle'` (no key) | `PENDING` (fallback) | `border-outline-variant/20` (fallback) | `bg-surface-container text-on-surface-variant/70` (fallback) | `PlayCircle` (fallback) | none | Evidence not found. Dormant on current paths. |

### 3.2 Why the table has rows 9 entries but the matrix has 8 states

The matrix at `taskLifecycleService.js:11-21` has 8 states. The
table adds `PENDING_TOOL_APPROVAL` as row 9 because that string
is observable in current source
(`agentDispatcher.js:441-444`). After OBS-01, the legacy
`'PENDING_TOOL_APPROVAL'` value should be retired in favor of
`awaiting_gate` (covered by existing backlog R-029 / DR-012);
the table will shrink back to 8 rows in that future spec.

### 3.3 What every column means

| Column | Producer | Consumer (visible) |
| ------ | -------- | ------------------- |
| Canonical backend state | `taskLifecycle.transition` | (Layer A — not directly visible today) |
| Legacy `Task.status` value | 8 direct writers | `SdlcWorkflowService.getPipelineResponse:1256` |
| `EventEnvelope.type` (wire) | `publishLifecycle` / `gateBridge.requestGate` | SSE controller / event mappers |
| `PhaseStatus.status` (visible) | `mapSessionStarted` (frozen) — OBS-01 adds mapper patches | `selectRuntimeExecution.phases[i]` |
| `AgentState.status` (visible) | `mapGatePending` (only today) — OBS-01 adds lifecycle mappers | `selectRuntimeExecution.currentAgent` |
| Badge text | `SdlcDashboard/index.tsx:513` | `PhaseChip` |
| Border colour class | `SdlcDashboard/index.tsx:76-83` (`COLUMN_BORDER`) | card `<div className>` |
| Chip background class | `SdlcDashboard/index.tsx:504-510` (`PhaseChip`) | chip `<span>` |
| Per-task icon | `SdlcDashboard/index.tsx:44-51` (`TASK_ICON`) | per-task `<span>` |
| Animation | `SdlcDashboard/index.tsx:44-51` (`TASK_ICON` class) | per-task `<span>` |
| Allowed transitions OUT | `taskLifecycleService.TRANSITIONS` (matrix) | not visible |

### 3.4 The single-ownership rule

For every row above, OBS-01 establishes exactly one producer
per column:

- Column 1 (canonical backend state) → `taskLifecycle.transition`.
- Column 2 (legacy `Task.status`) → frozen in current source; OBS-01
  does NOT rewrite column 2. The legacy column remains for
  backward compatibility; future backlog R-029 retires it.
- Column 3 (wire envelope type) → `eventPublisher.publishEvent`
  (single facade).
- Column 4 (`PhaseStatus.status`) → `selectRuntimeExecution.phases`
  (single projection).
- Column 5 (`AgentState.status`) → `applyEnvelope` mappers
  (single reducer family).
- Columns 6–10 (badge, border, chip, icon, animation) → the
  CSS maps at `SdlcDashboard/index.tsx:67-83, 504-516, 44-51`
  (single source).

The Dashboard and Agent Task pages MUST render using exactly
these six column outputs. After OBS-01 lands, the visual
agreement between Dashboard and Agent Task is enforced by
construction — both pages read from the same `PhaseStatus.status`
projection; no per-page override exists.

---

## 4. Evidence gaps

The following items are intentionally NOT VERIFIED in this spec
because the underlying source did not surface them during the
trace:

- **`dispatched` UI rendering:** the canonical matrix permits
  this state; no UI consumer maps it. Evidence not found.
- **`PENDING_TOOL_APPROVAL` transition source:** the legacy
  langchain path that writes this value is dormant on the
  current canonical claude-code / mock paths. No call site
  issues the corresponding transition. Evidence not found.
- **`timeout` colour mapping:** the FE enums treat `timeout`
  identically to `cancelled` (both project to `'skipped'`).
  A future redesign MAY distinguish the two (e.g. `timeout`
  → orange instead of dim-dashed). For this spec, both
  project to the same colour. Evidence not found for any
  current distinction.
- **`gated vs ungated output_review`:** for
  `kind === 'output_review'`, `gateBridge.requestGate:102`
  skips the `awaiting_gate` transition. The `task_completed`
  envelope fires immediately. The visible state should be
  `'gate_pending'` (because there's a pending output_review
  gate) rather than `'completed'`. The current
  `getPipelineResponse:1257` handles this by setting
  `awaitingReview = phaseData.awaitingReview` and projecting
  to `'gate_pending'`. After OBS-01, the FE mapper for
  `gate_pending` must also write
  `pipelinePhases[i].status = 'gate_pending'` for output-review
  gates. This is consistent with the existing `awaiting_review`
  merge in `selectRuntimeExecution`. Evidence is present in
  current source but the projection needs to be tightened.
- **Inspector agent-state rendering:** the Inspector tab
  currently does NOT render `agentStates[i].status` or
  `currentStep` / `currentAction` / `toolName`. The spec
  preserves this gap. A future enhancement may add an agent-
  state panel. Evidence not found.

---

## 5. Acceptance criteria

This spec is complete when:

1. Every row in §3 maps to exactly one visible CSS class on
   each of: Dashboard (per-agent strip), Agent Task (card
   border + chip + per-task icon), SessionPill (session-
   level badge), Inspector (gate panel).
2. The same `PhaseStatus.status` value renders the SAME badge
   text on Dashboard and Agent Task (verified by inspection
   of `SdlcDashboard/index.tsx:513` and
   `OverviewPage.tsx:240-249`).
3. The same `PhaseStatus.status` value renders the SAME colour
   on Dashboard and Agent Task (verified by
   `COLUMN_BORDER` at `SdlcDashboard/index.tsx:76-83` and the
   inline ternaries at `OverviewPage.tsx:240-249`).
4. The wire-shape change in OBS-01.1 (carry `role: task.type`)
   adds the new key without changing any existing key. Verified
   by `eventPublisher.publishEvent:25` (envelope construction
   reads `base.role ?? null`).
5. The mapper updates in OBS-01.3 (write
   `pipelinePhases[i].status` alongside `agentStates[i].status`)
   are pure additions; existing reducers continue to behave
   exactly as today. Verified by `eventMappers.ts:199-208`
   (existing `mapSessionStarted` is unchanged) and
   `eventMappers.ts:215-292` (existing mappers' early-return
   behaviour is unchanged; new branches are added).