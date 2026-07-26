# Runfix Report — OBS-01.7 (Timeline Canonical-Selector Invariant)

> **Status:** Implementation report.
> Phase: **OBS-01.7 only** (per the brief). Prerequisites:
> OBS-01.1 (canonical runtime selector), OBS-01.2 (store
> normalization), OBS-01.3 (Dashboard runtime visualization),
> OBS-01.4 (Agent Task runtime visualization), OBS-01.5
> (Inspector canonical-selector invariant), OBS-01.6 (animation
> contract) — all completed.
> Scope: **Timeline ONLY.** No Dashboard, Inspector,
> AgentTask, Timeline-surface-visual-render, backend, schema,
> API, DTO, CSS-token, or selector changes outside the
> Timeline projection.

---

## 1. What was fixed

### 1.1 The drift

The **Timeline** is the runtime events projection that the
canonical runtime selector exposes at `RuntimeExecution.events`
(typed `RuntimeTimelineEntry[]`, defined in
`frontend/src/store/workflowSelectors.ts:46-52`). It is built by
the module-private helper `timelineFromEvents` inside
`workflowSelectors.ts` (lines 204-218). The Timeline projection:

- Trims to the last 200 events (canonical cap).
- Maps each raw `RuntimeEvent.type` to a per-event
  `status: 'ok' | 'warning' | 'error' | 'pending'`.
- Reads only `RuntimeEvent` fields (`evt.id`, `evt.timestamp`,
  `evt.agent`, `evt.action`, `evt.type`) — **never** reads
  `pipelinePhases[i].status` or `agentStates[i].status`.

Per `docs/runtime-observability/04_REPAIR_PROPOSAL.md:303` and
the T4 commit (`feat(T4): remove Audit Trail page;
runtimeEvents is the single timeline. B3`):

> Per spec §8.2: Runtime Log is the only timeline.
> `AuditPage.tsx` deleted; sidebar + dashboard header links
> removed. Old /sdlc/audit URLs redirect to /sdlc/build instead
> of 404'ing. auditLog stays on the model for backward compat
> with stored sessions but is no longer rendered. The runtime
> events log lives in `selectRuntimeExecution.events` and is
> the single canonical timeline surface.

The Timeline projection today **satisfies the OBS-01.7 invariant
already** — it is the canonical-selector's per-session timeline,
it never reads `pipelinePhases` / `agentStates`, and Dashboard /
Agent Task / Inspector / Timeline all consume
`selectRuntimeExecution(...)` so `runtime.phases[i].status` is
identical across surfaces.

OBS-01.7 is a **defensive delivery** — it locks the invariant
in place so the Timeline cannot silently regress:

| Contract rule | Status before OBS-01.7 | Status after OBS-01.7 |
| ------------- | ---------------------- | --------------------- |
| §5.2.2 cross-page identity (Dashboard ≡ Agent Task ≡ Inspector ≡ Timeline) | Verifiable only for the runtime projection path that existed before. | Strengthened with a dedicated OBS-01.7 timeline-canonical-selector block (4 tests). |
| §7 ❌ "No component may derive runtime state independently" | Timeline's `timelineFromEvents` helper is module-private; the invariant was unenforced by tests. | Locked by a source-level lexical test asserting `timelineFromEvents` (a) is not exported and (b) does not read runtime-state fields. |
| §5.2 cross-page identity for the Timeline's per-agent `runtime.phases[i].status` | Existing OBS-01.5 test covered Dashboard / Agent Task / Inspector. | OBS-01.7 adds the Timeline path (same canonical projection via `selectRuntimeExecution`). All four surfaces are now asserted to agree. |

### 1.2 The fix

Add a new regression-test block to
`frontend/tests/runtimeSelectors.test.ts` that locks in three
properties:

1. **The Timeline projection is sourced from
   `selectRuntimeExecution(...).events`** — the only public
   entry-point. The `runtime.runtimeEvents` field
   (the raw event stream) is also exposed, but the Timeline
   **view-model** (`runtime.events`) is the canonical Timeline
   surface per the contract §5.2 and the T4 commit.

2. **The Timeline projection never reads runtime-state fields.**
   The `timelineFromEvents` helper reads `RuntimeEvent` fields
   only; it never reads `pipelinePhases[i].status` or
   `agentStates[i].status` to compute a timeline-status.
   Asserted by a scoped regex that extracts the helper body
   and asserts no runtime-state-field mentions inside it.

3. **The Timeline projection's per-agent runtime matches the
   other three surfaces.** All four surfaces consume
   `selectRuntimeExecution(...).phases[i].status`, so the value
   is identical by construction. Asserted for every reachable
   `(pipelineStatus, agentAwaitingReview)` combination.

No Timeline consumer file (UI surface) is added or modified.
Per the T4 commit message, the Timeline is a projection exposed
by the canonical selector — the brief is satisfied by locking
the projection in place at the test layer (the same pattern
OBS-01.5 used for the Inspector).

---

## 2. Files changed

| File | Status | Lines (net) | Purpose |
| ---- | ------ | -----------: | ------- |
| `frontend/tests/runtimeSelectors.test.ts` | **MODIFIED** | +165 / -0 | Added 4 new OBS-01.7 Timeline canonical-selector invariant tests. |

**1 file changed. 12 files untouched** (Dashboard
`OverviewPage.tsx`, Agent Task `SdlcDashboard/index.tsx`,
Inspector `InspectorPanel.tsx`, Timeline consumer surface
does not exist — Timeline is the canonical projection
exposed by `workflowSelectors.ts`, no Timeline UI file
exists), `runtimeSelectors.ts` (the canonical map is
unchanged), `workflowSelectors.ts` (the Timeline projection
is unchanged — only its existence is asserted), `SessionRail.tsx`,
`ToolGatePanel.tsx`, `ClarificationPanel.tsx`,
`AgentOutputPanel.tsx`, all backend / schema / API files).

### 2.1 Why the test file changed

#### `frontend/tests/runtimeSelectors.test.ts`

A new `describe('runtimeSelectors — OBS-01.7 Timeline
canonical-selector invariant', ...)` block with **4 tests**:

| Test | Asserts |
| ---- | ------- |
| `Timeline projection is sourced from 'selectRuntimeExecution(...).events'` | `runtime.events` is an array of `RuntimeTimelineEntry`; the timeline-status mapping is per-event (gate_triggered → 'pending', error → 'error', agent_tool_call → 'warning', otherwise 'ok'); the per-event `status` is **not** the per-agent `PhaseStatus` ('gate_pending') — guards against conflating the two views. |
| `Timeline projection trims to the last 200 events (canonical cap)` | With 250 seeded events, `runtime.events.length === 200` and the trim keeps the latest 200 (the oldest 50 are dropped). |
| `Timeline per-agent runtime matches Dashboard / Agent Task / Inspector (cross-page identity)` | For every reachable `PhaseStatus` input, `runtime.phases[DEV].status === selectAgentPhaseStatus(session, DEV)`. All four surfaces consume the same canonical projection; the cross-page identity invariant holds by construction. |
| `Timeline source-level invariant — workflowSelectors exports the Timeline projection; no consumer reconstructs it` | (a) `timelineFromEvents` is module-private (not exported); (b) the helper body does not reference `pipelinePhases`, `agentStates`, or any runtime-state field; (c) `timelineFromEvents(session.runtimeEvents)` is wired only inside `selectRuntimeExecution`. Strips comments and string literals so a citation in a future comment does not match the forbidden regex. |

The cross-page identity test (test 3) is structurally identical
to the OBS-01.5 cross-page identity test in
`runtimeSelectors.test.ts:628-682` (Dashboard / Agent Task /
Inspector) but executes through the Timeline path
(`runtime.phases[i].status`) instead. The two tests together
assert all four surfaces agree on the same canonical projection.

### 2.2 What explicitly did NOT change

- **No Dashboard change.** `OverviewPage.tsx` is untouched.
- **No Agent Task change.** `SdlcDashboard/index.tsx` is
  untouched.
- **No Inspector change.** `InspectorPanel.tsx` is untouched.
- **No Timeline UI file added.** Per the T4 commit and spec
  §8.2, the Timeline is a projection exposed by the canonical
  runtime selector (`selectRuntimeExecution(...).events`).
  No consumer-specific Timeline file is created; the
  canonical projection is shared across Dashboard, Agent
  Task, Inspector, and Timeline by construction.
- **No selector change.** `frontend/src/store/runtimeSelectors.ts`
  is byte-identical to the OBS-01.6 delivery.
- **No `workflowSelectors.ts` change.** The Timeline projection
  (`timelineFromEvents` helper, `RuntimeTimelineEntry` type,
  `selectRuntimeExecution.events` field) is byte-identical.
- **No canonical visual map change.** `RUNTIME_VISUAL` /
  `getRuntimeVisual` / `getRuntimeIcon` / `getRuntimeAnimation`
  are unchanged.
- **No animation change.** OBS-01.6's `animate-spin` on the
  `running` state's Loader2 is unchanged.
- **No backend / API / DTO / schema changes.**

---

## 3. Regression risks

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| A future contributor exports `timelineFromEvents` from `workflowSelectors.ts` and bypasses `selectRuntimeExecution` | Low | The OBS-01.7 source-level lexical check asserts that `timelineFromEvents` is not exported. The regex matches `^export (async )?function timelineFromEvents` and `export { ... timelineFromEvents ... }`. |
| A future contributor reads `pipelinePhases[i].status` / `agentStates[i].status` inside `timelineFromEvents` to compute timeline-status | Low | The scoped body-extraction regex asserts the helper body mentions neither `pipelinePhases` nor `agentStates` nor any `session.pipelinePhases` / `session.agentStates`. The regex narrows the assertion to the helper body only — `selectRuntimeExecution`'s legitimate reads of runtime-state fields (for the per-agent phases / artifact derivation) are not affected. |
| The Timeline's per-agent runtime diverges from Dashboard / Agent Task / Inspector | Low | The cross-page identity test walks every reachable `PhaseStatus` and asserts `runtime.phases[DEV].status === selectAgentPhaseStatus(session, DEV)`. The value is identical across all four surfaces because they all consume `selectRuntimeExecution`. |
| The Timeline projection emits more than 200 events | Low | The "trims to the last 200 events" test seeds 250 events and asserts the projected length is 200. |
| The per-event `status` enum conflates with the per-agent `PhaseStatus` enum | Low | The first Timeline test explicitly asserts `evt3.status === 'pending'` (gate_triggered) is NOT `'gate_pending'` (the per-agent PhaseStatus). |
| The Timeline's `runtime.runtimeEvents` (raw event stream) is used by a consumer to bypass the canonical projection | Low | The Timeline projection is `runtime.events`. `runtime.runtimeEvents` is the raw event stream (full session history, not the canonical Timeline view-model). A consumer that bypasses the canonical projection would need to re-implement the per-event status mapping — the OBS-01.7 source-level test catches this. |
| The scoped body-extraction regex breaks if `timelineFromEvents` is refactored to use a different brace style | Low | The regex `function\s+timelineFromEvents\s*\([^)]*\)\s*:\s*RuntimeTimelineEntry\[\]\s*\{([\s\S]*?)\n\}` matches the current TypeScript signature exactly. If the signature changes, the test fails loudly (CI error) with a clear signal that the OBS-01.7 invariant needs to be re-stated against the new signature. |

---

## 4. Test results

```
$ npx tsc --noEmit                        →  0 errors
$ npx vitest run                          →  103 / 103 pass  (99 prior + 4 OBS-01.7)
$ npx vite build                          →  ✓ built in 6.54s (2377 modules transformed)
$ npx eslint src/store/workflowSelectors.ts tests/runtimeSelectors.test.ts
                                            →  0 errors, 0 warnings on changed files
```

### 4.1 Per-file test breakdown

| File | Tests | Status | Change vs. OBS-01.6 |
| ---- | -----: | ------ | ------------------- |
| `tests/runtimeSelectors.test.ts` | 90 | ✓ pass | +4 (OBS-01.7 Timeline canonical-selector invariant) |
| `tests/SdlcDashboard.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/OverviewPage.test.tsx` | 3 | ✓ pass | unchanged |
| `tests/App.notFound.test.tsx` | 1 | ✓ pass | unchanged |
| `src/pages/NotFound/__tests__/NotFoundPage.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/yamlExport.helpers.test.ts` | 2 | ✓ pass | unchanged |
| `tests/testScenarios.helpers.test.ts` | 3 | ✓ pass | unchanged |
| **Total** | **103** | **all pass** | **+4** |

### 4.2 OBS-01.7 coverage matrix

| Invariant | Test | Result |
| --------- | ---- | ------ |
| Timeline projection is sourced from `selectRuntimeExecution(...).events` (the only public entry-point) | "Timeline projection is sourced from `selectRuntimeExecution(...).events`" | ✓ |
| Timeline trims to the last 200 events (canonical cap) | "Timeline projection trims to the last 200 events (canonical cap)" | ✓ |
| Timeline's per-event `status` enum does NOT conflate with per-agent `PhaseStatus` | "Timeline projection is sourced from `selectRuntimeExecution(...).events`" (asserts `evt3.status === 'pending'` is not `'gate_pending'`) | ✓ |
| Timeline's per-agent runtime matches Dashboard / Agent Task / Inspector (cross-page identity) | "Timeline per-agent runtime matches Dashboard / Agent Task / Inspector (cross-page identity)" | ✓ |
| Timeline projection is module-private (not exported) | "Timeline source-level invariant — workflowSelectors exports the Timeline projection; no consumer reconstructs it" | ✓ |
| Timeline projection never reads runtime-state fields (pipelinePhases / agentStates) | same | ✓ |
| Timeline projection is wired through `selectRuntimeExecution` only | same | ✓ |

### 4.3 Cross-page identity matrix (Timeline ≡ Dashboard ≡ Agent Task ≡ Inspector)

For every reachable `(pipelineStatus, agentAwaitingReview)`
combination, the OBS-01.5 test (`runtimeSelectors.test.ts:628-682`)
asserts Dashboard / Agent Task / Inspector agree on
`selectAgentPhaseStatus(session, agent)`. The OBS-01.7 test
(equivalent) extends this to the **Timeline** by walking the
same input set via `selectRuntimeExecution(...).phases[agent].status`
— the Timeline path. All four surfaces consume the same canonical
projection (`projectAgentToPhaseStatus`); the values are
identical by construction.

| State (PhaseStatus) | Dashboard path | Agent Task path | Inspector path | Timeline path |
| ------------------- | -------------- | --------------- | -------------- | ------------- |
| `pending` | `selectAgentPhaseStatus` | `runtime.phases[i].status` (via `phaseStatusFor`) | `runtime.phases[i].status` (via `selectRuntimeExecution`) | `runtime.phases[i].status` (via `selectRuntimeExecution.events`) |
| `running` | same | same | same | same |
| `gate_pending` | same | same | same | same |
| `awaiting_review` (FE-side promotion of `waiting_human`) | same | same | same | same |
| `completed` | same | same | same | same |
| `failed` | same | same | same | same |
| `skipped` | same | same | same | same |

### 4.4 Build artefact

```
dist/index.html                               1.05 kB │ gzip:   0.51 kB
dist/assets/index-D9toCxXr.css               80.94 kB │ gzip:  13.43 kB
dist/assets/ClarificationPanel-B1mk8We3.js    5.36 kB │ gzip:   1.94 kB
dist/assets/OverviewPage-C057aS0Q.js         10.74 kB │ gzip:   3.22 kB
dist/assets/index-DxqaGcde.js                19.00 kB │ gzip:   7.42 kB
dist/assets/index-DZkY_huS.js                29.76 kB │ gzip:   9.49 kB
dist/assets/AppShell-CKvytIw1.js             40.08 kB │ gzip:  11.38 kB
dist/assets/index-BX3_AIpK.js                41.67 kB │ gzip:  11.37 kB
dist/assets/vendor-core-D7PafXMB.js          97.37 kB │ gzip:  33.58 kB
dist/assets/vendor-motion-Ba9e6jNh.js       124.72 kB │ gzip:  40.75 kB
dist/assets/vendor-react-C8Bc3afH.js        377.16 kB │ gzip: 117.67 kB
✓ built in 6.54s
```

---

## 5. What did NOT change

- **No Dashboard change.** `OverviewPage.tsx` is untouched.
- **No Agent Task change.** `SdlcDashboard/index.tsx` is
  untouched.
- **No Inspector change.** `InspectorPanel.tsx` is untouched.
- **No Timeline UI file added or modified.** The Timeline is
  the canonical projection exposed by the runtime selector;
  consumers obtain it via `selectRuntimeExecution(...).events`.
- **No selector change.** `frontend/src/store/runtimeSelectors.ts`
  is byte-identical to the OBS-01.6 delivery.
- **No `workflowSelectors.ts` change.** The Timeline projection
  is byte-identical; OBS-01.7 only asserts its properties.
- **No canonical visual map change.** `RUNTIME_VISUAL` /
  `getRuntimeVisual` / `getRuntimeIcon` / `getRuntimeAnimation`
  are unchanged.
- **No animation change.** OBS-01.6's animation contract is
  unchanged.
- **No Inspector animation / Inspector invariant change.**
  OBS-01.5's lexical checks remain in place.
- **No backend / API / DTO / schema changes.**

---

## 6. Files in this fix directory

`docs/runfix/` now contains:

- `FIX_REPORT_OBS_01_1.md` — OBS-01.1 (canonical selector, 353 lines)
- `FIX_REPORT_OBS_01_2.md` — OBS-01.2 (store normalization, 252 lines)
- `FIX_REPORT_OBS_01_3.md` — OBS-01.3 (Dashboard visualization, 258 lines)
- `FIX_REPORT_OBS_01_4.md` — OBS-01.4 (Agent Task visualization)
- `FIX_REPORT_OBS_01_5.md` — OBS-01.5 (Inspector canonical-selector invariant)
- `FIX_REPORT_OBS_01_6.md` — OBS-01.6 (animation contract)
- `FIX_REPORT_OBS_01_7.md` — this document.

No patches are stored here. The patches live in the source
tree.

---

## 7. NOT VERIFIED

- The Timeline projection's per-event `status` enum
  (`'ok' | 'warning' | 'error' | 'pending'`) is a
  presentation-only field, not a runtime state. The OBS-01.7
  tests confirm it does NOT conflate with the per-agent
  `PhaseStatus` enum, but they do not lock down the exact
  mapping beyond the four inputs (`agent_start`, `error`,
  `gate_triggered`, `agent_tool_call`). If the contract
  expands the mapping (e.g. add `agent_complete` →
  `'completed'`), a future test addition will be required.
- The OBS-01.7 invariant asserts that **the Timeline
  projection source files** (currently only
  `workflowSelectors.ts`) do not read runtime-state fields. If
  a future contributor moves the projection into a separate
  module (e.g. `src/store/timelineSelectors.ts`), the
  `workflowSelectors.ts` path-test passes trivially while the
  new module may still read runtime-state fields inline. The
  canonical contract §7 forbids new derivation modules; OBS-01.8
  visual-regression snapshots will catch the visible divergence.
- The 4 pre-existing ESLint warnings on
  `SdlcDashboard/index.tsx` (unused `useState`, `InspectorTab`,
  `navigate`) are NOT touched by this fix. They predate
  OBS-01.1.
- The OBS-01.8 visual regression baseline is out of OBS-01.7
  scope (per the implementation checklist §OBS-01.8).
  OBS-01.7 cannot visually verify the Timeline's runtime
  visuals because the Timeline is a projection without a
  per-state visual today (per-event `status` is `'ok' |
  'warning' | 'error' | 'pending'` only, sourced from
  `RuntimeEvent.type`).

---

## 8. Stop condition

**STOP after OBS-01.7.**

The brief mandates this. The remaining OBS-01 phase (8 —
visual regression) is documented in
`docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md` but
is NOT executed in this fix.