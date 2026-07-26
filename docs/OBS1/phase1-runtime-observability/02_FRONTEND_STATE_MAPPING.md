# 02 — Frontend State Mapping

> **Status:** INVESTIGATION ONLY.
> Backend state → SSE → store → component → DOM/CSS mapping for
> the agent runtime visualization on the Dashboard and Agent Task
> pages.
>
> No production code modified.

This is the renderer-facing companion to
`01_RUNTIME_STATE_TRACE.md`. It maps each visible DOM element on
the agent cards to the exact store field and the exact CSS class
that determines its appearance.

---

## 1. The two-page surface

| Page | Path | Component | File |
| ---- | ---- | --------- | ---- |
| Dashboard (overview) | `/sdlc` | `OverviewPage` | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx` |
| Agent Tasks | `/sdlc/build?sessionId=...` | `SdlcDashboard` (default export) | `frontend/src/pages/SdlcDashboard/index.tsx` |

Both pages also render `SessionRail` (left column) which uses
the same `pipelinePhases` data source.

---

## 2. End-to-end map per agent card

### 2.1 Agent Task page (`SdlcDashboard/index.tsx`)

| Visible element | DOM | Class / text | Reads | File:line |
| --------------- | --- | ------------ | ----- | --------- |
| **Card border**  | `<div ... className={borderClass}>` | `COLUMN_BORDER[ps]` (line 76-83) | `runtime.phases[agent].status` | line 312 |
| **Card badge text** | `<PhaseChip status={ps} />` | `status.replace('_', ' ')` (line 513) | same | line 324, 503-516 |
| **Card badge background** | inside `PhaseChip` | `bg-emerald-500/20`, `bg-blue-500/20`, etc. (line 504-510) | same | line 503-516 |
| **Per-task border** (inside card) | `<div className={STATUS_DOT_COLOR[task.status]}>` | `STATUS_DOT_COLOR` map (line 67-74) | `task.status` derived from `ps` | line 332-335, 181-201 |
| **Per-task icon** | `<span>{TASK_ICON[task.status]}</span>` | `TASK_ICON` map (line 44-51) | same | line 337, 181-201 |

### 2.2 Pipeline strip on Dashboard (`OverviewPage.tsx`)

| Visible element | Class / text | Reads | File:line |
| --------------- | ------------ | ----- | --------- |
| **Per-agent dot colour** | inline `bg-emerald-500/20` etc. (line 240-249) | `session.pipelinePhases[agent].status` | line 234-235 |
| **Per-agent glyph** | `PhaseStatusLabel` (line 360-368) | same | line 252 |

### 2.3 SessionRail (`SessionRail.tsx`)

| Visible element | Reads | File:line |
| --------------- | ----- | --------- |
| **Per-agent badge colour** (`PHASE_DOT_COLORS`) | `session.pipelinePhases[agent].status` | line 178-183 |
| **Progress bar width** | `completedPhases / 5 * 100` | line 141-142 |
| **Session-level status badge** | `session.status` | line 164-165 |

---

## 3. Where `runtime.phases[agent].status` actually comes from

```
Backend (live source of truth)
├── Task.executionStatus = 'running' | 'awaiting_gate' | ...    ← canonical machine
├── Task.status = 'pending' | 'processing' | 'completed' | ...  ← legacy
└── GatePending.payload.gate.role = 'po-agent' | ...             ← propagated through SSE

SSE transport (SdlcController.streamPipelineStatus)
└── session_started snapshot payload = { status, pipelinePhases, ... }
    where pipelinePhases[i] = { agent, status: Task.status, ... }
                                                                       ↑
                                          FROZEN at connect time. Never refreshed.

FE store (SessionState)
├── session.pipelinePhases = [5 entries, source = SSE snapshot]    ← only updated once
├── session.agentStates = { ARCH, PO, UX, DEV, QA }                ← NEVER updated
│                                                                     (mappers early-return
│                                                                      because env.role is null)
└── session.runtimeEvents = []                                     ← NEVER updated
                                                                      (no agent_event producer)

Selector (selectRuntimeExecution)
├── runtime.phases[i].status = pipelinePhases[i].status            ← frozen snapshot
├── runtime.currentAgent = agentStates[i].status === 'running' ? i : null  ← always null
└── runtime.currentPhaseStatus = currentAgentState?.status ?? session.status

Component (SdlcDashboard/index.tsx)
├── phaseStatusFor(agent) = runtime.phases.find(...).status
└── Border, badge, chip all read ps (one value, five agents)

DOM
└── <div className={COLUMN_BORDER[ps]}>
```

---

## 4. The five-agent card on the Agent Task page — what each status value does

`ps = phaseStatusFor(agent) = runtime.phases[agent].status` —
the only input to all the card's visual styling.

| `ps` value | Border class (line 76-83) | Chip background (line 504-510) | Chip text | Per-task border (line 67-74) | Per-task icon (line 44-51) |
| ---------- | -------------------------- | ------------------------------ | --------- | ----------------------------- | --------------------------- |
| `'pending'` | `border-outline-variant/20` (dim gray) | `bg-surface-container text-on-surface-variant/70` | `PENDING` | `border-outline-variant/10 bg-transparent` | `PlayCircle` |
| `'running'` | `border-blue-500/30` (blue) | `bg-blue-500/20 text-blue-300` | `RUNNING` | `border-blue-500/30 bg-blue-500/5` | `Loader2 animate-spin` |
| `'gate_pending'` | `border-amber-500/30` (yellow) | `bg-amber-500/20 text-amber-400` | `GATE PENDING` | `border-amber-500/30 bg-amber-500/5` | `Clock` |
| `'awaiting_review'` | `COLUMN_BORDER.pending` (no entry — falls back to dim gray) | `bg-amber-500/20 text-amber-400` | `AWAITING REVIEW` | `border-amber-500/30 bg-amber-500/5` (via `tasksForAgent` line 195) | `Clock` |
| `'completed'` | `border-emerald-500/20` (green) | `bg-emerald-500/20 text-emerald-400` | `COMPLETED` | `border-emerald-500/15 bg-emerald-500/5` | `Check` |
| `'failed'` | `border-red-500/30` (red) | `bg-red-500/20 text-red-400` | `FAILED` | `border-red-500/30 bg-red-500/5` | `AlertCircle` |
| `'skipped'` | `border-dashed border-outline-variant/20` (dashed dim) | `bg-outline-variant/30 text-on-surface-variant` | `SKIPPED` | `border-dashed border-outline-variant/10 opacity-50` | `SkipForward` |

Note: `'awaiting_review'` is NOT a key in `COLUMN_BORDER` —
`COLUMN_BORDER[ps as keyof typeof COLUMN_BORDER] ?? COLUMN_BORDER.pending`
falls back to the dim border for that value (line 306 of
index.tsx). The chip background and text still render correctly
because `PhaseChip` matches `'awaiting_review'` (line 507 of
index.tsx).

The user reports the chip IS visible for `gate_pending` (via
the chip's separate status string), but the column border never
shows yellow unless `pipelinePhases[i].status === 'gate_pending'`
exactly. This is consistent with the observation.

---

## 5. What the user actually sees during a normal session

### 5.1 Before SSE opens

`session.pipelinePhases` = `defaultPipelinePhases()` =
`[{ agent: 'ARCH', status: 'pending' }, ... × 5]` (per
`SessionState.ts:131-133`).

→ All five cards: dim gray border, PENDING chip, PlayCircle
icons.

### 5.2 On SSE connect (first `session_started`)

`SdlcController.streamPipelineStatus:367` publishes
`session_started` with `pipelinePhases` from the BE's
`getPipelineResponse`. At this moment, if no agent has run
yet, all phases are `'pending'`. If ARCH has completed and is
waiting for output_review, ARCH = `'gate_pending'` (because
`toPhaseStatus` sets status to `'gate_pending'` when
`phaseData.awaitingReview` is true — `SdlcWorkflowService.js:1257`).

→ Cards reflect the snapshot at connect time.

### 5.3 During the pipeline run

`agentDispatcher.runAgent`:
- Writes `Task.status = 'processing'` (line 312).
- Calls `taskLifecycle.transition(taskId, 'running')`
  (line 313) — this publishes `task_started` envelope with
  `role: null` and updates `Task.executionStatus = 'running'`.

The `task_started` envelope arrives at `mapTaskStarted`
(eventMappers.ts:215). `inferAgentKey(null)` returns `null`.
The mapper returns `{ lastUpdatedAt: Date.now() }` only.
`agentStates` is NOT updated. `pipelinePhases` is NOT updated.

→ The user sees NO change. The card for the running agent
stays in its previous state (typically `'pending'` if the
session was opened before any agent ran, or `'gate_pending'`
if a previous agent's review was waiting).

### 5.4 On agent completion

`_saveAgentData` (SdlcWorkflowService.js:2025-2034) writes
`Task.status = 'completed'` (LEGACY) and calls
`taskLifecycle.transitionIfPresent(taskId, 'completed')`.

The `task_completed` envelope arrives at `mapTaskCompleted`
(eventMappers.ts:229). `inferAgentKey(null)` returns `null`.
The mapper returns `{ lastUpdatedAt: Date.now() }` only.

→ The user sees NO change.

The backend's `gateBridge.requestGate` (SdlcWorkflowService.js:2071-2087)
creates an `output_review` gate. The `gate_pending` envelope
arrives at `mapGatePending` with `gate.role` populated →
`agentStates[ARCH].status = 'awaiting_review'`. The
`selectRuntimeExecution` phase-merge (line 251-255) lifts
this into `runtime.phases[ARCH].status = 'awaiting_review'`.
The card border stays dim (no entry in `COLUMN_BORDER` for
`'awaiting_review'`), but the chip reads `AWAITING REVIEW`
with an amber background.

→ This matches the user's observation: a chip appears, but the
border is dim.

### 5.5 After the user approves the output_review gate

The `gate_resolved` envelope arrives. `mapGateResolved` only
updates `pendingGates`, `gateHistory`, and `session.status`
(eventMappers.ts:132-166). It does NOT update `agentStates`
or `pipelinePhases`.

→ The user sees the gate disappear and the session status pill
change, but the agent card stays in `AWAITING REVIEW` /
dim-border state.

The next agent starts and the cycle repeats. The cards
never reflect running, completed, or failed states.

---

## 6. What WOULD update the cards (counterfactual)

If `taskLifecycle.publishLifecycle` set `role: task.type`
(instead of `role: null`), every per-agent mapper would fire:

```js
// hypothetical fix in taskLifecycleService.js:88-92
return publishEvent(
  eventType,
  { projectId: task.projectId, sessionId: task.sessionId, taskId: task.id, role: task.type },
  payload,
);
```

Then `inferAgentKey('architecture-agent')` returns `'ARCH'`,
`inferAgentKey('po-agent')` returns `'PO'`, etc. (per
`AGENT_TO_ROLE` at eventMappers.ts:26-32). The mapper would
set `agentStates[ARCH].status = 'running'` etc. — but
`agentStates` is read for `currentAgent` (line 224-231 of
workflowSelectors.ts) and `awaiting_review` merging
(line 251-255), NOT for the visible card border.

So fixing only the role field would NOT make the cards work.
The `selectRuntimeExecution` selector (line 257-264) reads
`session.pipelinePhases` for the visible phase; it merges
`awaiting_review` from `agentStates` only for that one value
(line 252). It does NOT promote `'running'` from `agentStates`
into the phases array.

In other words, the visibility chain is:
`pipelinePhases` (snapshot, frozen, never updated) → `runtime.phases[i].status` → DOM.

To make the cards work end-to-end, the mappers must ALSO update
`pipelinePhases[i].status` directly, OR the SSE producer must
re-publish the full snapshot on every state transition, OR
`selectRuntimeExecution` must be reworked to read
`agentStates[i].status` for `running`/`completed`/`failed`.

(Phase 4 will pick one.)

---

## 7. The `runtime.phases[i].status` rendering keys

The five values that ever appear as `runtime.phases[i].status`
in current source, and where each comes from:

| `status` value | Producer | Where |
| -------------- | -------- | ----- |
| `'pending'`        | `defaultPipelinePhases()` initial; `toPhaseStatus` when `phaseData` is null | `SessionState.ts:132`; `SdlcWorkflowService.js:1255` |
| `'running'`        | `toPhaseStatus` when `phaseData.status === 'running'` (i.e. `Task.status === 'running'`) | `SdlcWorkflowService.js:1256` |
| `'gate_pending'`   | `toPhaseStatus` when `phaseData.awaitingReview` is true | `SdlcWorkflowService.js:1257` |
| `'awaiting_review'`| `selectRuntimeExecution` line 252 (merges from `agentStates`) | `workflowSelectors.ts:251-255` |
| `'completed'`      | `toPhaseStatus` when `phaseData.status === 'completed'` (i.e. `Task.status === 'completed'`) | `SdlcWorkflowService.js:1256` |
| `'failed'`         | `toPhaseStatus` when `phaseData.status === 'failed'` (i.e. `Task.status === 'failed'`) | `SdlcWorkflowService.js:1256` |
| `'skipped'`        | `toPhaseStatus` when `isSkipped && !phaseData` (never triggers in current source) | `SdlcWorkflowService.js:1254` |

**Only `Task.status === 'completed'` is ever written for a
successfully-running agent.** `'running'` is written only by
the `_saveAgentData` path for the LEGACY `Task.status`
field, NOT by `agentDispatcher.runAgent` (which writes
`'processing'`). So `'running'` NEVER appears in
`pipelinePhases[i].status` for the canonical claude-code path.

This means: even if the SSE snapshot were refreshed on every
state change, the user would never see a blue border for a
running agent — the snapshot would always show `'pending'` or
`'gate_pending'` for the running phase.

---

## 8. Drift summary table

| Field | Backend writes | SSE carries | FE mapper updates | DOM updates | Visible? |
| ----- | -------------- | ----------- | ----------------- | ----------- | -------- |
| `Task.executionStatus` | yes (canonical) | via `task_started/completed/...` envelopes with `role:null` | NO (mapper early-returns) | n/a | never |
| `Task.status` | yes (8 writers, `'processing'`/`'completed'`/`'failed'`/`'cancelled'`/`'PENDING_TOOL_APPROVAL'`) | via `session_started` snapshot only | YES (snapshot, frozen) | YES (border, chip, dot, glyph) | only at connect time |
| `pipelinePhases` (BE-computed) | yes (`toPhaseStatus`) | via `session_started` snapshot only | YES (line 203 of eventMappers.ts) | YES | only at connect time |
| `pipelinePhases[agent].status` | n/a | n/a | only via `mapSessionStarted` | YES | frozen |
| `agentStates[agent].status` | n/a (BE-side) | via `gate_pending` (gate.role) | only via `mapGatePending` + `mapAgentEvent` (never) | partially (currentAgent, awaiting_review merge) | partially |
| `runtimeEvents` | n/a | via `agent_event` (no producer) | never | partial (Inspector) | never |

The user-visible runtime visualization is entirely driven by
`pipelinePhases` (a frozen snapshot), with one exception:
`'awaiting_review'` can leak in via the `agentStates` merge in
`selectRuntimeExecution` when a `gate_pending` envelope arrives.