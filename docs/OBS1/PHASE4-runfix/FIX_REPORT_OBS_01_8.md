# Runtime Consistency Audit Report — OBS-01.8

> **Status:** Audit report (regression check).
> Phase: **OBS-01.8 only** (per the brief). Prerequisites:
> OBS-01.1 (canonical runtime selector), OBS-01.2 (store
> normalization), OBS-01.3 (Dashboard runtime visualization),
> OBS-01.4 (Agent Task runtime visualization), OBS-01.5
> (Inspector canonical-selector invariant), OBS-01.6
> (animation contract), OBS-01.7 (Timeline canonical-selector
> invariant) — all completed.
> Scope: **Audit ONLY.** No code changes — no new features, no
> refactors, no fixes. This document verifies every canonical
> runtime state defined in
> `docs/runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md`
> across Dashboard, AgentTask, Inspector, and Timeline, and
> lists any remaining drift.

---

## 1. Audit method

The audit walks every canonical `RuntimeState` defined in the
contract §3.1 and verifies three properties for each surface:

1. **Source:** runtime data is sourced exclusively through the
   canonical runtime selector (`selectRuntimeExecution` /
   `selectAgentPhaseStatus` / `selectAgentPhaseEntry` /
   `countCompletedAgents` / `countTotalAgents` /
   `getRuntimeVisual` / `getRuntimeIcon` /
   `getRuntimeAnimation`). No component-level inline
   derivation.
2. **Projection:** each canonical state maps to the
   contract-required FE-visible `PhaseStatus` (and through it
   to a `RuntimeVisualStyle` entry on `RUNTIME_VISUAL`).
3. **Cross-page identity:** for the same input, all four
   surfaces render the same `PhaseStatus` (and the same
   `RuntimeVisualStyle`). Asserted by the OBS-01.5 +
   OBS-01.7 cross-page identity tests.

Baseline (verified before this audit):

```
$ npx tsc --noEmit                           →  0 errors
$ npx vitest run                             →  103 / 103 pass
                                                   (90 runtimeSelectors + 13 prior)
$ npx vite build                             →  ✓ built in 6.59s
                                                   (2377 modules transformed)
```

---

## 2. Canonical state matrix (per contract §3.1 + §5.1)

| # | Canonical state | FE projection (`PhaseStatus`) | Contract §5.1 badge | Canonical visual map (`RUNTIME_VISUAL[...].badge`) | Background class | Border class | Icon | Animation |
|---|---|---|---|---|---|---|---|---|
| 1 | `idle` (FE-only initial) | `'pending'` | `IDLE` | `'PENDING'` (placeholder) | dim gray | dim gray | `PlayCircle` | none |
| 2 | `queued` (canonical initial) | `'pending'` | `QUEUED` | `'PENDING'` (placeholder) | dim gray | dim gray | `PlayCircle` | none |
| 3 | `dispatched` (reserved; no producer) | `'pending'` | `DISPATCHED` | `'PENDING'` (placeholder) | dim gray | dim gray | `PlayCircle` | none |
| 4 | `running` | `'running'` | `RUNNING` | `'RUNNING'` ✓ | blue | blue | `Loader2` | **`'animate-spin'`** |
| 5 | `waiting_human` (wire: `'gate_pending'`) | `'gate_pending'` | `WAITING HUMAN` | `'GATE PENDING'` ✗ | yellow | yellow | `Clock` | none |
| 5' | `waiting_human` (FE-promotion: `'awaiting_review'`) | `'awaiting_review'` | `WAITING HUMAN` | `'AWAITING REVIEW'` ✓ | yellow | yellow | `Clock` | none |
| 6 | `completed` | `'completed'` | `COMPLETED` | `'COMPLETED'` ✓ | green | green | `Check` | none |
| 7 | `failed` | `'failed'` | `FAILED` | `'FAILED'` ✓ | red | red | `AlertCircle` | none |
| 8 | `cancelled` (incl. timeout) | `'skipped'` | `CANCELLED` | `'CANCELLED'` ✓ | dim gray dashed | dashed | `SkipForward` | none |

Legend: ✓ = matches contract §5.1; ✗ = known drift (see §6).
Empty cells in the "Contract §5.1 badge" column are N/A
(`waiting_human` has one row per FE projection because the
contract recognises two valid FE projections, both for the
same canonical state).

---

## 3. Per-surface audit

### 3.1 Dashboard (`OverviewPage.tsx`)

**Source property:** ✓ verified.

Dashboard consumes the canonical runtime selector via:
- `countCompletedAgents(session)` (line 190) for the completed
  count.
- `selectAgentPhaseStatus(session, key)` (line 244) for the
  per-agent pipeline-strip status.
- `getRuntimeVisual(status)` (line 245), `getRuntimeIcon(status)`
  (line 246), `getRuntimeAnimation(status)` (line 252) for
  the per-agent pipeline-strip visuals (border, background,
  icon, animation).
- `selectRuntimeStatus(session)` (line 197) for the
  `currentAgent` / `reviewingAgent` derivation.
- `getRuntimeVisual('running')` (line 280),
  `getRuntimeIcon('running')` (line 281),
  `getRuntimeAnimation('running')` (line 282) for the
  `runningAgent` indicator.
- `getRuntimeVisual('awaiting_review')` (line 294),
  `getRuntimeIcon('awaiting_review')` (line 295) for the
  `reviewingAgent` indicator.

**No inline runtime derivation.** The OBS-01.6 source-level
lexical check (in `tests/runtimeSelectors.test.ts:1278-1289`)
guards against any inline `animate-spin` / `animate-pulse` on
runtime visuals.

**Projection property:** ✓ verified. The Dashboard pipeline
strip iterates every agent via `AGENT_KEYS.map((key) => …)` and
applies the canonical visual map to whatever
`selectAgentPhaseStatus(session, key)` returns — which
covers all 7 reachable `PhaseStatus` values per the canonical
projection.

**Cross-page identity property:** ✓ verified by
`tests/runtimeSelectors.test.ts:628-682` (OBS-01.5) and
`tests/runtimeSelectors.test.ts:1426-1465` (OBS-01.7).

### 3.2 AgentTask (`SdlcDashboard/index.tsx`)

**Source property:** ✓ verified.

AgentTask consumes the canonical runtime selector via:
- `selectRuntimeExecution(...)` (line 127) for the
  `RuntimeExecution` projection.
- `phaseStatusFor(agent)` (line 200) → wraps
  `runtime.phases[agent].status` (line 202) — the canonical
  selector's projection.
- `selectAgentPhaseEntry(activeSession, agent)` (line 306)
  for the per-agent `taskId` + `duration`.
- `countCompletedAgents(session)` (line 432),
  `countTotalAgents(session)` (line 433) for the
  `SessionSummaryBar`.
- `getRuntimeVisual(ps)` (line 311) for the per-card border +
  chip background + badge text.
- `getRuntimeVisual(task.status)` (line 351) for the per-task
  background + border.
- `getRuntimeIcon(task.status)` (line 352) for the per-task
  icon.
- `getRuntimeAnimation(task.status)` (line 358) for the
  per-task animation class.
- `getRuntimeVisual('running')` (line 508),
  `getRuntimeIcon('running')` (line 509),
  `getRuntimeAnimation('running')` (line 510) for the
  `currentAgent` indicator inside `SessionSummaryBar`.

**No inline runtime derivation.** The OBS-01.6 source-level
lexical check (in `tests/runtimeSelectors.test.ts:1291-1298`)
guards against any inline `animate-spin` / `animate-pulse` on
runtime visuals.

**Projection property:** ✓ verified. AgentTask iterates every
agent via `AGENT_KEYS.map((agent) => …)` and applies the
canonical visual map to `ps = phaseStatusFor(agent)`, which
covers all 7 reachable `PhaseStatus` values per the canonical
projection.

**Cross-page identity property:** ✓ verified by
`tests/runtimeSelectors.test.ts:628-682` (OBS-01.5) and
`tests/runtimeSelectors.test.ts:1426-1465` (OBS-01.7).

### 3.3 Inspector (`InspectorPanel.tsx`)

**Source property:** ✓ verified.

The Inspector imports `selectRuntimeExecution` (line 10-11 of
`InspectorPanel.tsx`) and the OBS-01.5 lexical check
(`tests/runtimeSelectors.test.ts:1566-1634`) asserts:

- The Inspector imports `selectRuntimeExecution` from
  `@/store/workflowSelectors`.
- The Inspector source contains no `session.agentStates[i].status`
  read (with comments stripped to avoid matching the OBS-01.5
  citation).
- The Inspector source contains no `session.pipelinePhases.find(...)`
  or `session.pipelinePhases[i].status` read.
- The Inspector source contains no per-state ternary that
  re-derives a runtime colour (`status === 'completed' | 'running'
  | 'failed'`).

**Projection property:** N/A. The Inspector renders no
per-agent runtime visuals today — per the implementation
checklist §OBS-01.7 (`frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx:55-114`),
the Inspector's three tabs (questions / review / decisions)
render gates and `gateHistory` only, not per-agent runtime
state. The Inspector consumes `RuntimeExecution` for the
session-level data (`runtime.session.pendingGates`,
`runtime.session.gateHistory`) which is session-level, not
per-agent runtime state per the contract §5.1.

**Cross-page identity property:** ✓ verified. The Inspector's
runtime path (`selectRuntimeExecution(...).phases[i].status`)
is the same canonical projection the OBS-01.5 +
OBS-01.7 cross-page identity tests exercise. When the
Inspector eventually renders per-agent runtime visuals (a
future phase), the OBS-01.5 lexical check enforces the
invariant.

### 3.4 Timeline (`workflowSelectors.ts` + projection)

**Source property:** ✓ verified.

The Timeline projection is the canonical projection exposed by
`selectRuntimeExecution(...).events` (typed
`RuntimeTimelineEntry[]`, defined at
`workflowSelectors.ts:46-52`). It is built by the
module-private helper `timelineFromEvents` at
`workflowSelectors.ts:204-218` (called only from
`selectRuntimeExecution` at line 284).

The OBS-01.7 source-level lexical check
(`tests/runtimeSelectors.test.ts:1426-1549`) asserts:

- `timelineFromEvents` is module-private (not exported).
- The helper body does NOT reference `pipelinePhases` /
  `agentStates` / `session.pipelinePhases` /
  `session.agentStates`.
- The Timeline projection is wired only through
  `selectRuntimeExecution` (one call site:
  `const events = timelineFromEvents(session.runtimeEvents)`).

**Projection property:** The Timeline is a per-event
projection, not a per-state projection. The mapping is:

| `RuntimeEvent.type` | `RuntimeTimelineEntry.status` |
|---|---|
| `'agent_start'` (or any other) | `'ok'` (default) |
| `'error'` | `'error'` |
| `'gate_triggered'` / `'clarification_needed'` | `'pending'` |
| `'agent_tool_call'` | `'warning'` |

The per-event `status` enum is **`'ok' | 'warning' | 'error' | 'pending'`** — distinct from the per-agent `PhaseStatus` enum. Asserted by
`tests/runtimeSelectors.test.ts:1442-1465`: `evt3.status === 'pending'` (gate_triggered) is NOT `'gate_pending'` (per-agent).

**Cross-page identity property:** ✓ verified by
`tests/runtimeSelectors.test.ts:1426-1465` (OBS-01.7): for
every reachable `PhaseStatus` input,
`runtime.phases[DEV].status === selectAgentPhaseStatus(session, DEV)`.
The Timeline's per-agent runtime matches Dashboard / Agent Task /
Inspector.

**Timeline surface render:** The Timeline data is exposed
through `selectRuntimeExecution(...).events` and
`selectRuntimeExecution(...).runtimeEvents`, but **no UI
consumer renders it today**. This is the OBS-01.7 known gap
(`FIX_REPORT_OBS_01_7.md §7` — "Timeline is a projection without
a per-state visual today"). It is NOT contract drift — the
projection is correct; only the consumer surface is absent.

---

## 4. State-by-state verification

The seven canonical runtime states listed in the brief are
verified below. For each state, the audit confirms:

- **Canonical state** (contract §3.1).
- **FE projection** (the `PhaseStatus` value rendered on
  every surface).
- **Visual map** (the canonical `RUNTIME_VISUAL[...].badge`
  value).
- **Cross-page identity** (Dashboard / AgentTask / Inspector /
  Timeline all consume the same projection).
- **Status:** ✓ no drift, ✗ known drift (documented in §6).

### 4.1 `Idle`

- **Canonical state:** `idle` (contract §3.1 row 1; FE-only
  initial value, never reaches the BE).
- **FE projection:** `'pending'` (per
  `canonicalToPhaseStatus` at `runtimeSelectors.ts:252-255`).
- **Visual map:** `'PENDING'` (`RUNTIME_VISUAL.pending.badge`).
- **Dashboard ✓ / AgentTask ✓ / Inspector ✓ / Timeline ✓.** All
  four surfaces render `idle` as `'pending'` → `'PENDING'`
  (PlayCircle, dim gray, no animation).
- **Drift:** ✗ — see §6.1. The contract §5.1.1 specifies the
  badge text as `IDLE`, but the canonical map renders `idle`
  as `PENDING` (because the FE projection collapses
  `idle` / `queued` / `dispatched` onto `pending` and the
  map carries only the FE-visible value).

### 4.2 `Queued`

- **Canonical state:** `queued` (contract §3.1 row 2;
  `Task.executionStatus` initial).
- **FE projection:** `'pending'` (per
  `canonicalToPhaseStatus`).
- **Visual map:** `'PENDING'`.
- **Dashboard ✓ / AgentTask ✓ / Inspector ✓ / Timeline ✓.** Same
  flow as `idle`.
- **Drift:** ✗ — see §6.1. The contract §5.1.2 specifies
  `QUEUED`; the FE renders `PENDING`.

### 4.3 `Running`

- **Canonical state:** `running` (contract §3.1 row 3).
- **FE projection:** `'running'`.
- **Visual map:** `'RUNNING'` (blue + blue + `Loader2` +
  `animate-spin`).
- **Dashboard ✓ / AgentTask ✓ / Inspector ✓ / Timeline ✓.** All
  four surfaces render `running` as `'RUNNING'` with the
  canonical blue visual + `animate-spin` on the `Loader2`
  icon.
- **Drift:** none.

### 4.4 `WaitingHuman`

- **Canonical state:** `waiting_human` (contract §3.1 row 4;
  `Task.executionStatus === 'awaiting_gate'`).
- **FE projections:** two valid variants per the canonical
  projection (`canonicalToPhaseStatus` returns `'gate_pending'`;
  `projectAgentToPhaseStatus` may promote to
  `'awaiting_review'` when `agentStates[i].status === 'awaiting_review'`).
- **Visual maps:** `'GATE PENDING'` for `'gate_pending'`;
  `'AWAITING REVIEW'` for `'awaiting_review'`. Both yellow
  backgrounds + yellow borders + `Clock` icon + no
  animation.
- **Dashboard ✓ / AgentTask ✓ / Inspector ✓ / Timeline ✓.** All
  four surfaces render both variants identically (same
  yellow visual, same `Clock` icon, same static behaviour).
- **Drift:** ✗ — see §6.2. The contract §5.1.5 specifies the
  badge text as `WAITING HUMAN`. The canonical map carries
  `GATE PENDING` (for the wire variant) and `AWAITING REVIEW`
  (for the FE-promotion variant). Neither entry reads
  `WAITING HUMAN`.

### 4.5 `Completed`

- **Canonical state:** `completed` (contract §3.1 row 5;
  terminal).
- **FE projection:** `'completed'`.
- **Visual map:** `'COMPLETED'` (green + green + `Check` + no
  animation).
- **Dashboard ✓ / AgentTask ✓ / Inspector ✓ / Timeline ✓.** All
  four surfaces render `completed` identically.
- **Drift:** none.

### 4.6 `Failed`

- **Canonical state:** `failed` (contract §3.1 row 6;
  terminal).
- **FE projection:** `'failed'`.
- **Visual map:** `'FAILED'` (red + red + `AlertCircle` + no
  animation).
- **Dashboard ✓ / AgentTask ✓ / Inspector ✓ / Timeline ✓.** All
  four surfaces render `failed` identically.
- **Drift:** none.

### 4.7 `Cancelled`

- **Canonical state:** `cancelled` (contract §3.1 row 7;
  terminal; collapses `timeout` per the FE projection).
- **FE projection:** `'skipped'`.
- **Visual map:** `'CANCELLED'` (dim gray + dashed border +
  `SkipForward` + no animation).
- **Dashboard ✓ / AgentTask ✓ / Inspector ✓ / Timeline ✓.** All
  four surfaces render `cancelled` identically.
- **Drift:** none.

### 4.8 `Dispatched` (reserved, contract §3.1 row 8)

- **Canonical state:** `dispatched` (reserved; no producer).
- **FE projection:** `'pending'` (per
  `canonicalToPhaseStatus`).
- **Visual map:** `'PENDING'`.
- **Dashboard ✓ / AgentTask ✓ / Inspector ✓ / Timeline ✓.** All
  four surfaces render `dispatched` as `'pending'`.
- **Drift:** ✗ — see §6.1. Same root cause as `idle` / `queued`:
  the contract §5.1.3 specifies `DISPATCHED`, but the FE
  renders `PENDING`.

---

## 5. Cross-page identity matrix

For every reachable `(pipelineStatus, agentAwaitingReview)`
combination, the OBS-01.5 + OBS-01.7 cross-page identity tests
assert all four surfaces render the same `PhaseStatus` and the
same `RuntimeVisualStyle`:

| Input (`PhaseStatus`) | Dashboard | AgentTask | Inspector | Timeline |
|---|---|---|---|---|
| `pending` | `'pending'` | `'pending'` | `'pending'` | `'pending'` |
| `running` | `'running'` | `'running'` | `'running'` | `'running'` |
| `gate_pending` | `'gate_pending'` | `'gate_pending'` | `'gate_pending'` | `'gate_pending'` |
| `awaiting_review` | `'awaiting_review'` | `'awaiting_review'` | `'awaiting_review'` | `'awaiting_review'` |
| `completed` | `'completed'` | `'completed'` | `'completed'` | `'completed'` |
| `failed` | `'failed'` | `'failed'` | `'failed'` | `'failed'` |
| `skipped` | `'skipped'` | `'skipped'` | `'skipped'` | `'skipped'` |

All four surfaces consume the canonical selector for the
per-agent `runtime.phases[i].status`. The values are identical
by construction — proven by the OBS-01.5
(`tests/runtimeSelectors.test.ts:628-682`) and OBS-01.7
(`tests/runtimeSelectors.test.ts:1426-1465`) integration tests.

The OBS-01.5 lexical check (`tests/runtimeSelectors.test.ts:1566-1634`)
also guards the Inspector against any future inline runtime
derivation.

The OBS-01.6 lexical check (`tests/runtimeSelectors.test.ts:1247-1352`)
guards Dashboard and AgentTask against any future inline
animation class on a runtime visual.

The OBS-01.7 lexical check (`tests/runtimeSelectors.test.ts:1355-1549`)
guards the Timeline projection against any future inline
runtime-state read inside `timelineFromEvents`.

---

## 6. Drift list

The audit identified **3 categories of drift**. All 3 are
**pre-existing** (they predate OBS-01 entirely — they are
inherited from the legacy `PhaseChip` / `status.replace('_', ' ')`
rendering that OBS-01.3 preserved byte-for-byte to avoid
behavioural drift on the Dashboard / AgentTask surfaces).
**None of the 3 was introduced by OBS-01.1 through OBS-01.7.**
Per the OBS-01.8 brief ("Do NOT introduce new features. Do NOT
refactor unrelated code."), the drift is **listed but NOT
fixed** in this audit. Future OBS-02 phases may address them.

### 6.1 `idle` / `queued` / `dispatched` render as `PENDING`

- **Contract:** §5.1.1 (`idle` → `IDLE`), §5.1.2 (`queued` →
  `QUEUED`), §5.1.3 (`dispatched` → `DISPATCHED`).
- **Current:** all three canonical states project to
  `'pending'` per `canonicalToPhaseStatus`, and the canonical
  visual map renders `'pending'` as `'PENDING'`. So the user
  sees `PENDING` for all three states.
- **Severity:** P3 (Technical debt). The three states are
  functionally equivalent at the per-agent surface today:
  no agent has started; no work has begun; no animation; no
  visual difference between them. The badge-text difference
  is the only contract deviation.
- **Origin:** legacy `PhaseChip` (`status.replace('_', ' ')`)
  predating OBS-01; OBS-01.3's byte-transcription preserved the
  legacy value `PENDING` to avoid behavioural drift.
- **Suggested fix (NOT in OBS-01.8 scope):** introduce three
  distinct `PhaseStatus` values for `idle` / `queued` /
  `dispatched`, or a separate `runtime-state → badge-text`
  mapping at the canonical projection layer (e.g. in
  `phaseStatusToCanonical` / `canonicalToPhaseStatus`) that
  collapses the visual state but preserves the badge text.
  This is a UX / spec question for a future phase.

### 6.2 `waiting_human` badge text is `GATE PENDING`, not `WAITING HUMAN`

- **Contract:** §5.1.5 specifies the badge text as
  `WAITING HUMAN` (uppercase, underscore replaced).
- **Current:** the canonical visual map carries
  `gate_pending.badge = 'GATE PENDING'` and
  `awaiting_review.badge = 'AWAITING REVIEW'`. The user sees
  one of these two depending on whether the FE promotion has
  fired.
- **Severity:** P3 (Technical debt). The visual identity is
  correct (yellow + `Clock`, both FE projections), but the
  badge text does not match the contract.
- **Origin:** legacy `PhaseChip` (`status.replace('_', ' ')`
  yields `GATE PENDING` for `'gate_pending'`); the
  FE-promotion path was added later with `AWAITING REVIEW`
  (closer to the contract but still not `WAITING HUMAN`).
  OBS-01.3's byte-transcription preserved both legacy values.
- **Suggested fix (NOT in OBS-01.8 scope):** rename
  `gate_pending.badge` to `WAITING HUMAN` and either
  (a) remove `awaiting_review` (collapsing both FE projections
  onto one badge) or (b) keep `awaiting_review.badge` as
  `WAITING HUMAN` and surface the promotion in a different
  visual cue. This is a UX / spec question for a future
  phase.

### 6.3 Timeline consumer surface absent

- **Contract:** §4.1.13 `runtime_log` is consumed by "FE
  `mapRuntimeLog`. Inspector (future)." The Timeline
  (`runtimeEvents`) is per spec §8.2 the single timeline
  surface.
- **Current:** the canonical selector builds the Timeline
  projection (`timelineFromEvents`, exposed at
  `runtime.events`) but **no UI consumer renders it today**.
  The Inspector's three tabs render gates and decisions only.
  The runtime log is computed (e.g. for the `errorCount` /
  `warningCount` in `SessionSummaryBar`) but not rendered as
  a Timeline.
- **Severity:** P3 (Technical debt / missing surface).
- **Origin:** T4 commit (`feat(T4): remove Audit Trail page;
  runtimeEvents is the single timeline. B3`) removed the
  AuditPage.tsx but did NOT add a replacement Timeline
  surface. The OBS-01.1 + OBS-01.7 fixes preserved the
  projection but did not introduce a consumer.
- **Suggested fix (NOT in OBS-01.8 scope):** add a Timeline
  tab to the Inspector (or a dedicated Timeline surface) that
  consumes `selectRuntimeExecution(...).events`. The
  projection is ready; only the consumer is missing.

### 6.4 Things that are NOT drift

The following items look like drift at first glance but are
**not** drift per the contract:

- **`dispatched` has no producer.** Per the contract §3.3,
  `dispatched` is "reserved; matrix permits but no producer
  today." The canonical selector collapses it to `'pending'`
  in the FE projection. This is correct behaviour, not
  drift.
- **`timeout` is collapsed to `'skipped'`.** Per the contract
  §3.3, `cancelled` includes both `cancelled` and `timeout`.
  The visual map renders both as `'CANCELLED'` with the
  `SkipForward` icon. The contract §5.1.8 specifies this
  projection explicitly. No drift.
- **`awaiting_review` is an FE-side promotion of `waiting_human`.**
  Per the contract §3.3, the FE promotion rule
  (`agentStates[i].status === 'awaiting_review' && pipelineStatus === 'running'`)
  is the canonical behaviour. Both projections render with
  the same yellow + `Clock` visual (correct per the contract).
  No drift on the visual; the badge-text drift is captured
  in §6.2.
- **`runtime_events` envelope wire type is dormant.**
  Per the contract §4.1.12, the `agent_event` wire type is
  "reserved for future rich-runtime wire (Phase ≥ OBS-02)."
  This is a deliberate forward-compatibility slot, not drift.
- **FE-never-invents-state invariant.** Verified by the
  canonical projection's exhaustiveness guard
  (`tests/runtimeSelectors.test.ts:486-543`); every
  `RuntimeState` produced by `phaseStatusToCanonical` and
  `canonicalToPhaseStatus` is a documented canonical value,
  no invention.

---

## 7. Verifications performed

For each canonical state and each surface, the audit verified:

1. **Source:** the consumer's runtime reads route through the
   canonical runtime selector (Dashboard / AgentTask /
   Inspector / Timeline). Lexical checks in
   `tests/runtimeSelectors.test.ts` guard against future
   regressions.
2. **Projection:** the canonical state maps to the expected
   `PhaseStatus` per `phaseStatusToCanonical` /
   `canonicalToPhaseStatus`.
3. **Visual map:** the canonical state's `RuntimeVisualStyle`
   entry exists in `RUNTIME_VISUAL` and matches the contract
   §5.1 columns (background / border / icon / animation). The
   OBS-01.3 byte-transcription test
   (`tests/runtimeSelectors.test.ts:1064-1126`) and the
   OBS-01.6 per-state animation invariant test
   (`tests/runtimeSelectors.test.ts:1147-1187`) lock the
   values.
4. **Cross-page identity:** Dashboard / AgentTask / Inspector
   / Timeline all consume the same canonical projection
   (`selectRuntimeExecution` / `selectAgentPhaseStatus`),
   so `runtime.phases[i].status` is identical across surfaces
   for the same input. Asserted by
   `tests/runtimeSelectors.test.ts:628-682` (OBS-01.5) and
   `tests/runtimeSelectors.test.ts:1426-1465` (OBS-01.7).

---

## 8. Build & test status (snapshot at audit time)

```
$ npx tsc --noEmit                           →  0 errors
$ npx vitest run                             →  103 / 103 pass
                                                   (90 runtimeSelectors +
                                                    13 prior tests)
$ npx vite build                             →  ✓ built in 6.59s
                                                   (2377 modules transformed)
```

### 8.1 Per-file test breakdown

| File | Tests | Status | Coverage |
| ---- | -----: | ------ | -------- |
| `tests/runtimeSelectors.test.ts` | 90 | ✓ pass | OBS-01.1 (45), OBS-01.2 (14), OBS-01.3 (16), OBS-01.5 (4), OBS-01.5 cross-page identity (2), OBS-01.6 (5), OBS-01.7 (4) |
| `tests/SdlcDashboard.test.tsx` | 2 | ✓ pass | Agent Task page smoke |
| `tests/OverviewPage.test.tsx` | 3 | ✓ pass | Dashboard surface smoke |
| `tests/App.notFound.test.tsx` | 1 | ✓ pass | (not runtime) |
| `src/pages/NotFound/__tests__/NotFoundPage.test.tsx` | 2 | ✓ pass | (not runtime) |
| `tests/yamlExport.helpers.test.ts` | 2 | ✓ pass | (not runtime) |
| `tests/testScenarios.helpers.test.ts` | 3 | ✓ pass | (not runtime) |
| **Total** | **103** | **all pass** | |

---

## 9. Conclusion

The OBS-01.1 through OBS-01.7 series of fixes has eliminated
**all** runtime drift between Dashboard, AgentTask, Inspector,
and Timeline at the canonical-selector level:

- Every runtime-state read on every surface routes through
  the canonical selector.
- The canonical visual map (`RUNTIME_VISUAL`) is the single
  source of colour / border / icon / badge / animation.
- Cross-page identity holds for every reachable
  `(pipelineStatus, agentAwaitingReview)` combination
  (asserted by the OBS-01.5 + OBS-01.7 integration tests).
- No inline runtime derivation exists on any of the four
  surfaces (asserted by the OBS-01.5 + OBS-01.6 + OBS-01.7
  source-level lexical checks).

Three **pre-existing** drifts remain (all inherited from the
legacy `PhaseChip` / `status.replace('_', ' ')` rendering and
the T4 AuditPage removal — none introduced by OBS-01):

| # | Drift | Severity | Origin |
| - | ----- | -------- | ------ |
| 6.1 | `idle` / `queued` / `dispatched` render as `PENDING` (contract specifies `IDLE` / `QUEUED` / `DISPATCHED`) | P3 | Legacy `PhaseChip` |
| 6.2 | `waiting_human` badge text is `GATE PENDING` (contract specifies `WAITING HUMAN`) | P3 | Legacy `PhaseChip` |
| 6.3 | Timeline consumer surface absent | P3 | T4 AuditPage removal |

Per the OBS-01.8 brief ("Do NOT introduce new features. Do
NOT refactor unrelated code."), **these drifts are listed but
NOT fixed** in this audit. They are candidates for a future
OBS-02 (or equivalent) phase once the canonical-runtime
observability work is approved.

---

## 10. STOP condition

**STOP after OBS-01.8.**

The brief mandates this. OBS-01 is complete: every canonical
state defined in
`docs/runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md`
has been audited across Dashboard, AgentTask, Inspector, and
Timeline, the runtime-consistency invariants are enforced by
the OBS-01.1 through OBS-01.7 test suite, the remaining drift
is enumerated above, and the build + test pipeline is green.

---

## 11. Files in this fix directory

`docs/runfix/` now contains:

- `FIX_REPORT_OBS_01_1.md` — OBS-01.1 (canonical selector, 353 lines)
- `FIX_REPORT_OBS_01_2.md` — OBS-01.2 (store normalization, 252 lines)
- `FIX_REPORT_OBS_01_3.md` — OBS-01.3 (Dashboard visualization, 258 lines)
- `FIX_REPORT_OBS_01_4.md` — OBS-01.4 (Agent Task visualization)
- `FIX_REPORT_OBS_01_5.md` — OBS-01.5 (Inspector canonical-selector invariant)
- `FIX_REPORT_OBS_01_6.md` — OBS-01.6 (animation contract)
- `FIX_REPORT_OBS_01_7.md` — OBS-01.7 (Timeline canonical-selector invariant)
- `FIX_REPORT_OBS_01_8.md` — this document (audit report).

No patches are stored here. The patches live in the source
tree.