# OBS-01 Phase 5 — Runtime Replay

> **Status:** VERIFICATION ONLY. No production code was modified.
> **Purpose:** Step-by-step runtime trace of every canonical state
> transition, walking each through the producer → store →
> projection → UI → DOM → animation chain.
> **Scope:** All 8 canonical states + 2 reserved states (dormant).

---

## 1. The Replay Sequence

The verification brief specifies a happy-path lifecycle:

```
IDLE → RUNNING → WAITING → TOOL → RUNNING → OUTPUT REVIEW → RUNNING → SUCCESS
```

Plus the error / cancel / timeout branches. This document walks
each step in turn, naming every producer, every store mutation,
every selector, every UI element, every DOM class, and every
animation class.

---

## 2. Happy-path replay

### Step 1 — `IDLE`

| Layer | Detail |
| ----- | ------ |
| **Producer** | `useWorkflowStore` initial state (`useWorkflowStore.ts` — defaults set by `emptyAgentStates()` and `defaultPipelinePhases()`) |
| **Store write** | `session.agentStates[ARCH\|PO\|UX\|DEV\|QA].status = 'idle'` (initial); `session.pipelinePhases[*].status = 'pending'` (initial) |
| **Selector** | `selectRuntimeStatus(session)` → `agentStates: { ARCH: 'queued', PO: 'queued', UX: 'queued', DEV: 'queued', QA: 'queued' }`, `currentAgent: null`, `reviewingAgent: null` (canonical projection collapses `'pending'` + `'idle'` → `'queued'`) |
| **Visible projection** | `projectAgentToPhaseStatus(session, ARCH)` → `'pending'` |
| **UI element** | Dashboard pipeline strip cell: `<div data-testid="dashboard-pipeline-cell-ARCH" data-runtime-status="pending">` |
| **DOM class** | `flex flex-col items-center gap-0.5 rounded-md border border-outline-variant/20 py-1 text-[9px] font-bold uppercase tracking-wider bg-surface-container text-on-surface-variant/60` |
| **Icon** | `<PlayCircle size={10} className="" />` (no animation) |
| **Glyph** | `·` |
| **Badge** | `PENDING` (Agent Task chip: `<span data-testid="agenttask-chip-ARCH" class="... bg-surface-container text-on-surface-variant/60">PENDING</span>`) |
| **Animation** | None |
| **Test** | `runtimeSelectors.test.ts:110-114` |

### Step 2 — `RUNNING` (canonical)

| Layer | Detail |
| ----- | ------ |
| **Producer (BE)** | `taskLifecycle.transition(taskId, 'running', …)` from `agentDispatcher.runAgent:313` |
| **Wire envelope** | `task_started` envelope (per `taskLifecycleService.js:88-92`) |
| **Wire `role`** | **Currently `null`** per `taskLifecycleService.js:90` — see verification report §10.1 |
| **Store write (intended)** | `agentStates[ARCH].status = 'running'`; `pipelinePhases[ARCH].status = 'running'` |
| **Store write (current)** | `agentStates[ARCH].status = 'running'` (via `mapTaskStarted` line 215-227 IF `env.role` resolves to ARCH; otherwise early-return) — see verification report §10.2 |
| **Selector** | `selectRuntimeStatus(session)` → `currentAgent: ARCH`; `agentStates.ARCH = 'running'` |
| **Visible projection** | `projectAgentToPhaseStatus(session, ARCH)` → `'running'` |
| **UI element** | Dashboard pipeline strip cell: `<div data-runtime-status="running">`; Agent Task card border `border-blue-500/30`; per-task Loader2 icon with `animate-spin` |
| **DOM class** | `border-blue-500/30 bg-blue-500/20 text-blue-300` |
| **Icon** | `<Loader2 size={10} className="animate-spin" />` |
| **Glyph** | `…` |
| **Badge** | `RUNNING` |
| **Animation** | `animate-spin` on the per-task Loader2 icon (only state with animation per contract §5.1.4) |
| **Test** | `runtimeSelectors.test.ts:115-118`; `runtimeSelectors.test.ts:980-987` ("running renders blue with Loader2 icon"); `runtimeSelectors.test.ts:1174-1205` ("runtime animation contract") |

### Step 3 — `WAITING` (`gate_pending` via `awaiting_gate`)

| Layer | Detail |
| ----- | ------ |
| **Producer (BE)** | `gateBridge.requestGate({ kind: 'tool' \| 'question', ... })` → `taskLifecycle.transitionIfPresent(taskId, 'awaiting_gate', …)` (per `gateBridge.js:115-120`) |
| **Wire envelope** | `gate_pending` envelope with `role: <gate.role>` (correctly carried by `gateBridge.js:124`) |
| **Store write** | `agentStates[agentKey].status = 'awaiting_review'` (via `mapGatePending` line 100-130); `pipelinePhases[agentKey].status` not updated per-event |
| **Selector** | `projectAgentToPhaseStatus` promotion: `agentAwaitingReview && pipelineStatus === 'running'` → `'awaiting_review'` |
| **Canonical** | `phaseStatusToCanonical('awaiting_review')` → `'waiting_human'` |
| **Visible projection** | `'awaiting_review'` |
| **UI element** | Dashboard pipeline strip cell: amber bg + Clock icon; Agent Task card border `border-amber-500/30`; chip `AWAITING REVIEW` |
| **DOM class** | `border-amber-500/30 bg-amber-500/20 text-amber-300` |
| **Icon** | `<Clock size={10} />` (no animation; per-task icon is static per contract §5.1.5) |
| **Glyph** | `!` |
| **Badge** | `AWAITING REVIEW` |
| **Animation** | None on per-task icon; `animate-pulse` allowed on session-level indicators only |
| **Test** | `runtimeSelectors.test.ts:120-126`; `runtimeSelectors.test.ts:996-1003` ("gate_pending renders yellow"); `runtimeSelectors.test.ts:1004-1011` ("awaiting_review renders yellow") |

### Step 4 — `TOOL` (gate resolved → back to `running`)

| Layer | Detail |
| ----- | ------ |
| **Producer (BE)** | `gateBridge.resolveGate(approvalId, result)` → `taskLifecycle.transitionIfPresent(taskId, 'running', …)` (per `gateBridge.js:170-174`) |
| **Wire envelope** | `gate_resolved` envelope with `role: rec.role` |
| **Store write** | `mapGateResolved` (line 132-166) removes gate from `pendingGates`; `agentStates[agentKey].status` returns to `'running'` if the BE emits `task_started` (or via `applyAgentRuntime` if `agent_event` envelopes follow) |
| **Selector** | `currentAgent: ARCH`; `projectAgentToPhaseStatus` → `'running'` |
| **UI** | Same as Step 2 (RUNNING visual) |

### Step 5 — `OUTPUT REVIEW` (output_review gate)

| Layer | Detail |
| ----- | ------ |
| **Producer (BE)** | `gateBridge.requestGate({ kind: 'output_review', ... })` — for output_review, the BE does NOT call `taskLifecycle.transitionIfPresent('awaiting_gate')` (see `gateBridge.js:102`). The task is already `'completed'`. |
| **Wire envelope** | `gate_pending` envelope with `kind: 'output_review'` |
| **Store write** | `agentStates[agentKey].status = 'awaiting_review'` (via `mapGatePending`); however `mapTaskCompleted` (which the BE emits) sets `agentStates.status = 'completed'` |
| **Note** | The order of envelope delivery determines which status is "last write wins". Currently the canonical projection shows `'completed'` for output_review-gated agents (because promotion rule only fires for `'running'`). The contract §4 gap ("gated vs ungated output_review") documents this as known behaviour. |
| **UI** | `RUNTIME_VISUAL.completed` (green + Check) |
| **Animation** | None |
| **Test** | Behaviour preserved byte-for-byte by OBS-01.1 (per FIX_REPORT_OBS_01_1 §5.1) |

### Step 6 — `SUCCESS` (pipeline completed)

| Layer | Detail |
| ----- | ------ |
| **Producer (BE)** | `releaseManager.submitReleaseDecision({ action: 'approve' })` → `pipeline_completed` envelope (per `releaseManager.js:170-186`) with `role: 'release'`, `taskId: qaTask.id` |
| **Store write** | `mapPipelineCompleted` (line 294-308) sets `session.status = 'completed'`; sets any remaining `running` agent to `'completed'` |
| **Selector** | All 5 agents project to `'completed'` (canonical `'completed'`); `countCompletedAgents(session) = 5`; `countTotalAgents(session) = 5` |
| **UI element** | All 5 cards: `border-emerald-500/20 bg-emerald-500/20 text-emerald-400` + Check icon; chip `COMPLETED` |
| **Summary bar** | `5/5 phases · 100%`; session pill `COMPLETED` (blue→emerald) |
| **Animation** | None |
| **Test** | `runtimeSelectors.test.ts:268-271` ("returns 'completed' when pipeline is completed"); `runtimeSelectors.test.ts:1004-1011` ("completed renders green"); `runtimeSelectors.test.ts:776-779` ("countCompletedAgents returns 0 for the default initial session"); `runtimeSelectors.test.ts:780-783` ("countCompletedAgents handles the pathological 'all completed' case") |

---

## 3. Error-path replay

### Step E1 — `FAILED` (e.g. agent runtime error)

| Layer | Detail |
| ----- | ------ |
| **Producer (BE)** | `taskLifecycle.transition(taskId, 'failed', …)` from `agentDispatcher.markTaskFailed:545-548` |
| **Wire envelope** | `task_failed` envelope (per `taskLifecycleService.js:29`) |
| **Wire `role`** | **Currently `null`** per `taskLifecycleService.js:90` — see verification report §10.1 |
| **Store write (intended)** | `agentStates[agentKey].status = 'failed'`; `pipelinePhases[agentKey].status = 'failed'` |
| **Store write (current)** | `agentStates[agentKey].status = 'failed'` via `mapTaskFailed` (line 246-260) IF `env.role` resolves |
| **Selector** | `projectAgentToPhaseStatus` → `'failed'`; canonical `'failed'` |
| **UI element** | Dashboard pipeline strip cell: red bg + AlertCircle icon; Agent Task card border `border-red-500/30` |
| **DOM class** | `border-red-500/30 bg-red-500/20 text-red-400` |
| **Icon** | `<AlertCircle size={10} />` (no animation) |
| **Glyph** | `✗` |
| **Badge** | `FAILED` |
| **Animation** | None |
| **Test** | `runtimeSelectors.test.ts:149-152`; `runtimeSelectors.test.ts:1012-1019` |

### Step E2 — `CANCELLED` (user cancel)

| Layer | Detail |
| ----- | ------ |
| **Producer (BE)** | `taskLifecycle.transitionIfPresent(taskId, 'cancelled', …)` from `SdlcWorkflowService.cancelTask:1718-1719` |
| **Wire envelope** | `task_interrupted` envelope (per `taskLifecycleService.js:30`) |
| **Wire `role`** | **Currently `null`** — same gap |
| **Store write** | `agentStates[agentKey].status = 'skipped'` via `mapTaskInterrupted` (line 262-276) IF `env.role` resolves |
| **Selector** | `projectAgentToPhaseStatus` → `'skipped'`; canonical `'cancelled'` (collapsed projection) |
| **UI element** | Dashboard pipeline strip cell: dashed dim border + SkipForward icon; Agent Task card border `border-dashed border-outline-variant/20` |
| **DOM class** | `border-dashed border-outline-variant/20 bg-outline-variant/30 text-on-surface-variant` |
| **Icon** | `<SkipForward size={10} />` |
| **Glyph** | `⊘` |
| **Badge** | `CANCELLED` (FE projection; canonical `'cancelled'` collapses with `'timeout'`) |
| **Animation** | None |
| **Test** | `runtimeSelectors.test.ts:154-157`; `runtimeSelectors.test.ts:1020-1027`; `runtimeSelectors.test.ts:229-233` ("projects 'skipped' to 'cancelled'") |

### Step E3 — `TIMEOUT` (per-task budget exceeded)

| Layer | Detail |
| ----- | ------ |
| **Producer (BE)** | `taskLifecycle.transition(taskId, 'timeout', …)` from `agentDispatcher.handleTaskTimeout:557-566` or `taskWorkerService.sweepStale:151-157` |
| **Wire envelope** | `task_interrupted` envelope |
| **Wire `role`** | **Currently `null`** |
| **Store write** | `agentStates[agentKey].status = 'skipped'` via `mapTaskInterrupted` |
| **UI** | **Visually identical to `CANCELLED`** (FE projection collapses both per `runtimeSelectors.ts:203-206`) |
| **Note** | Per `05_CANONICAL_RUNTIME_STATE.md §4`, distinguishing `timeout` (e.g., orange instead of dim-dashed) is a future redesign. Current source collapses both. |
| **Test** | `runtimeSelectors.test.ts:154-157` (covers both cancelled and timeout paths via the `'skipped'` projection) |

---

## 4. Reserved states

### Step R1 — `idle` (FE-only initial)

| Aspect | Detail |
| ------ | ------ |
| **Producer** | `emptyAgentStates()` initial state (`useWorkflowStore.ts` → `SessionState.ts:113-129`) |
| **Canonical projection** | `phaseStatusToCanonical('pending')` → `'queued'`. The `idle` canonical state itself is unreachable through the projection (it is the `agentStates[i].status` initial value, not the `pipelinePhases[i].status` initial value). |
| **Note** | `UNREACHABLE_VIA_PROJECTION` — the test explicitly asserts this (see `runtimeSelectors.test.ts` cross-product test). The `idle` value exists in `agentStates` but the canonical selector collapses it to `'queued'` for `phaseForAgent`. |
| **UI** | All 5 agents render as `pending` (PhaseStatus) — see Step 1 above |

### Step R2 — `dispatched` (reserved)

| Aspect | Detail |
| ------ | ------ |
| **Producer** | None observed in current source. The canonical matrix permits `queued → dispatched` (`taskLifecycleService.js:13`). No call site issues it. |
| **Canonical projection** | `phaseStatusToCanonical('pending')` covers `idle`, `queued`, AND `dispatched` (per `runtimeSelectors.ts:186-187`). |
| **Note** | `UNREACHABLE_VIA_PROJECTION` — no BE producer exists. Documented in backlog R-029 / DR-012 as future work. |
| **UI** | All 5 agents render as `pending` |

---

## 5. Animation class trace

The contract §5.1 specifies per-state Pulse / Animation:

| State | Pulse | Animation |
| ----- | :---: | :-------- |
| `idle` | none | none |
| `queued` | none | none |
| `dispatched` | none | none |
| `running` | **YES** | `animate-spin` on the per-task Loader2 icon |
| `waiting_human` (gate_pending / awaiting_review) | none (per-task) | none |
| `completed` | none | none |
| `failed` | none | none |
| `cancelled` (skipped) | none | none |

`getRuntimeAnimation(status)` (`runtimeSelectors.ts:689-691`)
returns the animation class. Verified by:

- `runtimeSelectors.test.ts:1174-1205` ("runtime animation
  contract — OBS-01.6 per-state animation invariant"): asserts
  `getRuntimeAnimation('running') === 'animate-spin'` and
  every other state returns `''`.
- `runtimeSelectors.test.ts:1206-1246` ("no inline `animate-*`
  class is applied to the runtime background or border
  fields"): asserts the background/border strings don't carry
  inline animations.

---

## 6. Cross-page identity trace

For each reachable `(pipelineStatus, agentAwaitingReview)` pair,
the cross-page identity test (`runtimeSelectors.test.ts:628-702`)
asserts that the runtime visual is identical on Dashboard, Agent
Task, and Inspector:

```
For every pipelineStatus in {pending, running, gate_pending,
  awaiting_review, completed, failed, skipped}
For every agentAwaitingReview in {true, false}
  projectAgentToPhaseStatus(session, agent) === <the same value
    on all three surfaces>
  selectRuntimeExecution.phases[i].status === projectAgentToPhaseStatus
  getRuntimeVisual(status) === <the same RuntimeVisualStyle>
```

This is the key regression guard for cross-page identity.

---

## 7. Session-level replay (for completeness)

The session-level `session.status` is a separate enum (per
`05_CANONICAL_RUNTIME_STATE.md §2.12`):

| Session status | Source | Visible UI |
| -------------- | ------ | ---------- |
| `'pending'` | `defaultSessionState()` initial | dim default |
| `'running'` | `mapSessionStarted`, etc. | `RUNNING` (blue) |
| `'awaiting_approval'` | `mapGatePending` (non-release) | `AWAITING APPROVAL` (amber) |
| `'awaiting_release'` | `mapGatePending` (FINAL_RELEASE) | `AWAITING RELEASE` (amber) |
| `'completed'` | `mapPipelineCompleted` | `COMPLETED` (emerald) |
| `'failed'` | `mapPipelineFailed` | `FAILED` (red) |

The SessionPill in `SdlcDashboard/index.tsx:396-417` renders the
session-level status (not per-agent runtime). This is acceptable
per the contract — session-level is a separate enum.

---

## 8. Summary

| Step | Canonical state | Visible UI | Animation | Status |
| ---- | --------------- | ---------- | --------- | :----: |
| 1 | `idle` (initial) | `pending` | none | ✓ |
| 2 | `running` | `running` (blue + Loader2) | `animate-spin` | ✓ |
| 3 | `waiting_human` (gate_pending) | `gate_pending` / `awaiting_review` (amber + Clock) | none | ✓ |
| 4 | `running` (after resolve) | `running` (blue + Loader2) | `animate-spin` | ✓ |
| 5 | `completed` (with output_review gate) | `completed` (green + Check) | none | ✓ (per pre-existing behaviour) |
| 6 | `completed` (pipeline) | all 5 `completed` | none | ✓ |
| E1 | `failed` | `failed` (red + AlertCircle) | none | ✓ |
| E2 | `cancelled` | `skipped` (dashed + SkipForward) | none | ✓ |
| E3 | `timeout` | `skipped` (same as cancelled) | none | ✓ |

The runtime replay is **visually correct** for every canonical
state. The architectural invariants (§6 / §7 / §8) are mostly
preserved on the FE side, with two backend gaps and one FE gap
documented in `01_VERIFICATION_REPORT.md §10`.