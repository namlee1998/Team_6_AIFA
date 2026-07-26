# Runfix Report — OBS-01.6 (Runtime Animation Contract)

> **Status:** Implementation report.
> Phase: **OBS-01.6 only** (per the brief). Prerequisites:
> OBS-01.1 (canonical runtime selector), OBS-01.2 (store
> normalization), OBS-01.3 (Dashboard runtime visualization),
> OBS-01.4 (Agent Task runtime visualization), OBS-01.5
> (Inspector canonical-selector invariant) — all completed.
> Scope: **Presentation-only.** No runtime logic, no selectors,
> no store, no backend, no schema, no API, no DTO changes.
> The canonical runtime selector is extended with a
> presentation-only `animation` field (consistent with the
> contract §5.1 Pulse / Animation columns), and every runtime
> animation class is routed through the new accessor
> `getRuntimeAnimation(status)`.

---

## 1. What was fixed

### 1.1 The drift

The canonical runtime contract (`docs/runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md`)
§5.1.4 specifies the per-state animation contract:

| State | Pulse | Animation |
| ----- | :---: | :-------- |
| `idle` / `queued` / `dispatched` | none | none |
| `running` | **YES** (Loader2 has `animate-spin`) | **`animate-spin` on the per-task icon** |
| `waiting_human` (`gate_pending` / `awaiting_review`) | none (per-task icon is static) | none (per-task); `animate-pulse` allowed on session-level indicators only |
| `completed` | none | none |
| `failed` | none | none |
| `cancelled` (`skipped`) | none | none |

OBS-01.3 explicitly **forbade** implementing animations and
codified that into the runtime visual map (no `animate-*` class
on the canonical `RuntimeVisualStyle.background` / `.border`
fields). OBS-01.3's brief comment in
`runtimeSelectors.ts:501-505` states:

> Animation classes are NOT included here. The brief for
> OBS-01.3 mandates "Do NOT implement animations yet."
> Animations are deferred to a future phase. The contract
> §5.1.4 reserves the `animate-spin` class for the running
> state's Loader2; OBS-01.3 renders the Loader2 icon without
> the animation class.

OBS-01.6 lifts this restriction and implements the animation
contract for the **runtime visuals only**. The OBS-01.6
invariant:

- Animations are driven **ONLY** by canonical runtime state
  (`RUNTIME_VISUAL[*].animation` → `getRuntimeAnimation(status)`).
- No consumer may inline `animate-spin` / `animate-pulse` on a
  runtime-state-derived element.
- Submit-button spinners, loading-state spinners, and
  connection-state pulses stay where they are — they are
  **local UI state**, not runtime state per the contract §5.1,
  and remain correctly out of OBS-01.6 scope.

### 1.2 The fix

Extend the canonical `RuntimeVisualStyle` interface with an
`animation` field (the per-state Tailwind animation class —
`'animate-spin'` for `running`, `''` for every other state per
contract §5.1). Add the accessor `getRuntimeAnimation(status)`
that returns the animation class for a given `PhaseStatus`. Route
every runtime icon's animation class through this accessor.

Per-state mapping (single source: `RUNTIME_VISUAL[*].animation`):

| State | Background | Border | Icon | Animation |
| ----- | ---------- | ------ | ---- | --------- |
| `pending` | dim gray | dim gray | `PlayCircle` | `''` |
| `running` | blue | blue | `Loader2` | **`'animate-spin'`** |
| `gate_pending` | yellow | yellow | `Clock` | `''` |
| `awaiting_review` | yellow | yellow | `Clock` | `''` |
| `completed` | green | green | `Check` | `''` |
| `failed` | red | red | `AlertCircle` | `''` |
| `skipped` | dim dashed | dim dashed | `SkipForward` | `''` |

The four runtime-icon render sites consume the accessor:

1. `OverviewPage.tsx` — Dashboard pipeline strip
   (`<Icon size={10} className={animation} />`).
2. `OverviewPage.tsx` — Dashboard `runningAgent` indicator
   (`<RunningIcon ... className={`${visual.background} ${animation}`.trim()} />`).
3. `SdlcDashboard/index.tsx` — Agent Task per-task icon
   (`<TaskIcon ... className={`... ${taskAnimation}`.trim()} />`).
4. `SdlcDashboard/index.tsx` — Agent Task `currentAgent`
   indicator inside `SessionSummaryBar` (`<RunningIcon ... className={`${visual.background} ${animation}`.trim()} />`).

---

## 2. Files changed

| File | Status | Lines (net) | Purpose |
| ---- | ------ | -----------: | ------- |
| `frontend/src/store/runtimeSelectors.ts` | **MODIFIED** | +84 / -33 | Extended `RuntimeVisualStyle` with `animation` field; populated `RUNTIME_VISUAL` with the per-state animation class; added the `getRuntimeAnimation(status)` accessor; updated section-header comment to reflect OBS-01.6. |
| `frontend/src/pages/SdlcDashboard/OverviewPage.tsx` | **MODIFIED** | +12 / -5 | Imported `getRuntimeAnimation`; routed Dashboard pipeline strip icon and `runningAgent` indicator icon through the canonical animation accessor. |
| `frontend/src/pages/SdlcDashboard/index.tsx` | **MODIFIED** | +14 / -4 | Imported `getRuntimeAnimation`; routed Agent Task per-task icon and `currentAgent` indicator icon through the canonical animation accessor. |
| `frontend/tests/runtimeSelectors.test.ts` | **MODIFIED** | +107 / -7 | Retired the OBS-01.3 "no animation" assertion (now stale); added the OBS-01.6 per-state animation invariant test; updated the contract-source byte-transcription to include the `animation` field; added the OBS-01.6 canonical-only animation contract block (4 tests, source-level lexical checks for Dashboard / Agent Task consumers). |

**4 files changed. 9 files untouched** (Inspector
`InspectorPanel.tsx`, Timeline — no timeline component exists,
`SessionRail.tsx`, `ToolGatePanel.tsx`,
`ClarificationPanel.tsx`, `AgentOutputPanel.tsx`, `AppShell.tsx`,
all backend / schema / API files, all `tests/*` outside the
canonical-selector test file).

### 2.1 Why each file changed

#### `frontend/src/store/runtimeSelectors.ts`

Two changes:

1. **`RuntimeVisualStyle` interface** gained the `animation`
   field with a docstring that names the contract §5.1 source.

2. **`RUNTIME_VISUAL`** — every entry now carries the
   `animation` field. `running.animation = 'animate-spin'`;
   every other state has `animation: ''`. The byte-transcription
   against contract §5.1 is preserved — a one-line annotation
   per state cites the relevant contract section.

3. **`getRuntimeAnimation(status)`** accessor added at the
   same site as `getRuntimeVisual` / `getRuntimeIcon`. Returns
   the canonical animation class for the given `PhaseStatus`.
   Referentially stable (returns the literal string from the
   frozen canonical map).

The OBS-01.3 "no animation" sentinel at
`runtimeSelectors.ts:501-505` is updated to reflect OBS-01.6:
animations are now enabled, sourced from the canonical map,
and routed exclusively through `getRuntimeAnimation`.

#### `frontend/src/pages/SdlcDashboard/OverviewPage.tsx`

Two render sites updated:

1. **Dashboard pipeline strip** (line 254):
   `<Icon size={10} className={animation} aria-hidden="true" />`
   where `animation = getRuntimeAnimation(status)`. The previous
   OBS-01.3 render had `className={undefined}` (no animation);
   OBS-01.6 adds `animate-spin` for the `running` cell and
   nothing else.

2. **Dashboard `runningAgent` indicator** (line 265-285):
   `<RunningIcon ... className={`${visual.background} ${animation}`.trim()} />`
   where `animation = getRuntimeAnimation('running')`. The
   previous OBS-01.3 render had no animation class; OBS-01.6
   adds it.

#### `frontend/src/pages/SdlcDashboard/index.tsx`

Two render sites updated:

1. **Agent Task per-task icon** (line 358-361):
   `<TaskIcon ... className={`${...} ${taskAnimation}`.trim()} />`
   where `taskAnimation = getRuntimeAnimation(task.status)`.
   The previous OBS-01.4 render had no animation class;
   OBS-01.6 adds `animate-spin` for any task whose status is
   `running`.

2. **Agent Task `currentAgent` indicator** (line 497-503):
   `<RunningIcon ... className={`${visual.background} ${animation}`.trim()} />`
   where `animation = getRuntimeAnimation('running')`. The
   previous OBS-01.4 render had no animation class;
   OBS-01.6 adds it.

#### `frontend/tests/runtimeSelectors.test.ts`

Three changes:

1. **The OBS-01.3 byte-transcription** (`EXPECTED_VISUAL`
   inside the `runtimeSelectors — OBS-01.3 Dashboard runtime
   visual maps` block) is updated to include the new
   `animation` field per state. The "exhaustive" assertion
   still passes because the byte-transcription now matches the
   canonical map exactly.

2. **The OBS-01.3 "no animation" sentinel**
   (`'no animation class is present in any visual (OBS-01.3
   brief forbids animations)'`) is retired and replaced by
   the OBS-01.6 per-state animation invariant: `'running'
   carries `'animate-spin'`; every other state carries `''`.
   The rename keeps the assertion's intent (forbid inline
   animation on `background` / `border`) but routes the
   per-state animation through the canonical map.

3. **A new `runtimeSelectors — OBS-01.6 animation contract
   (canonical-only)` block** with 4 tests:
   - Dashboard source routes animation through the canonical
     selector (lexical check; no inline `animate-spin` on
     `<Icon>` or `<RunningIcon>` runtime visuals).
   - Agent Task source routes animation through the canonical
     selector (lexical check; no inline `animate-spin` on
     `<TaskIcon>` or `<RunningIcon>` runtime visuals).
   - Canonical animation field is sourced from the frozen
     canonical map (referential-stability check via
     `getRuntimeAnimation`).
   - `getRuntimeAnimation` is referentially stable for the
     same input.

### 2.2 What explicitly did NOT change

- **No runtime-logic change.** No selector function is
  renamed; no `RuntimeState` / `PhaseStatus` value is added or
  removed.
- **No store change.** `frontend/src/store/useWorkflowStore.ts`,
  `frontend/src/store/workflowSelectors.ts` are byte-identical.
- **No Inspector change.** `InspectorPanel.tsx` is untouched —
  the Inspector renders no per-agent runtime visuals today
  (per the implementation checklist §OBS-01.7).
- **No Timeline change.** No timeline component exists.
- **No SessionRail change.** Session-level CSS maps are owned
  by `SessionRail.tsx` and `OverviewPage.tsx`'s session-level
  helpers, correctly out of scope per the contract §5.1.
- **No submit-button / connection-state animation change.**
  `ClarificationPanel.tsx:99`, `ToolGatePanel.tsx:115`,
  `InspectorPanel.tsx:376, 435`, `FeatureRequestChatbox.tsx:89`,
  `AgentOutputPanel.tsx:788, 808, 831, 837, 843, 849` all
  carry inline `animate-spin` on **submit / loading** state,
  not runtime state per the contract §5.1. They stay.
- **No `animate-pulse` on session-level indicators.** Per the
  contract §5.1.5, `animate-pulse` is "allowed on session-level
  indicators only" — an optional surface concession owned by
  the per-surface CSS maps (`OverviewPage.tsx:407-408`,
  `index.tsx:398`, `SessionRail.tsx:222, 225`). OBS-01.6 does
  not modify these — they are session-level UI state, not
  per-agent runtime state. The OBS-01.6 invariant ("animations
  driven ONLY by canonical runtime state") applies to the
  per-state `RUNTIME_VISUAL[*].animation` field, which is
  empty for every state except `running`.
- **No backend / API / DTO / schema changes.**

---

## 3. Regression risks

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| A future contributor adds an inline `animate-spin` on a runtime-state-derived element bypassing the canonical selector | Medium | The OBS-01.6 source-level lexical check (`Dashboard source routes animation through the canonical selector`, `Agent Task source routes animation through the canonical selector`) fails any future regression. The regex strips comments and string literals first so the OBS-01.6 documentation citations do not match the forbidden regex. |
| The `getRuntimeAnimation('running')` value is `'animate-spin'` but the consuming `<Loader2>` icon is rendered without that class for some reason | Low | The accessor returns the literal `RUNTIME_VISUAL.running.animation`, which is `'animate-spin'`. The four render sites append it to the icon's `className`. The vitest snapshot tests for the Dashboard and Agent Task pages exercise the pipeline strip / per-task icon and would catch a className divergence. |
| A new `PhaseStatus` value enters the union without an `animation` field | High (compile-time) | The `Record<PhaseStatus, RuntimeVisualStyle>` type enforces exhaustiveness. If a new value enters the union, TypeScript flags the missing entry; the visual map MUST grow with it. |
| The byte-transcription test drifts from the canonical map | High | The test asserts `RUNTIME_VISUAL` deep-equals a hand-typed object literal. Both are updated in lock-step in OBS-01.6; any future divergence surfaces as a CI failure. |
| The OBS-01.6 source-level regex falsely matches a comment in the new doc block | Low | The regex strips comments first (`\/\*…\*\/` and `\/\/…$`) before matching. Verified by the tests passing on the post-edit consumer source. |

---

## 4. Test results

```
$ npx tsc --noEmit                        →  0 errors
$ npx vitest run                          →  99 / 99 pass  (94 prior + 5 OBS-01.6)
$ npx vite build                          →  ✓ built in 6.02s (2377 modules transformed)
$ npx eslint src/store/runtimeSelectors.ts
           src/pages/SdlcDashboard/OverviewPage.tsx
           src/pages/SdlcDashboard/index.tsx
           tests/runtimeSelectors.test.ts
                                            →  0 NEW errors introduced by OBS-01.6
                                            (3 pre-existing warnings on index.tsx:
                                             useState, InspectorTab, navigate;
                                             all present before OBS-01.6)
```

### 4.1 Per-file test breakdown

| File | Tests | Status | Change vs. OBS-01.5 |
| ---- | -----: | ------ | ------------------- |
| `tests/runtimeSelectors.test.ts` | 86 | ✓ pass | +5 (OBS-01.6 per-state invariant + 4 canonical-only animation contract tests); 1 OBS-01.3 test (`no animation class is present in any visual`) renamed and tightened to "no animation on background / border" |
| `tests/SdlcDashboard.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/OverviewPage.test.tsx` | 3 | ✓ pass | unchanged |
| `tests/App.notFound.test.tsx` | 1 | ✓ pass | unchanged |
| `src/pages/NotFound/__tests__/NotFoundPage.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/yamlExport.helpers.test.ts` | 2 | ✓ pass | unchanged |
| `tests/testScenarios.helpers.test.ts` | 3 | ✓ pass | unchanged |
| **Total** | **99** | **all pass** | **+5** |

### 4.2 OBS-01.6 coverage matrix

Every state in the contract §5.1 Pulse / Animation columns is
asserted:

| State | Expected animation | Test | Result |
| ----- | ------------------ | ---- | ------ |
| `idle` / `queued` / `dispatched` | none (rendered as `pending`) | "runtime animation contract — OBS-01.6 per-state animation invariant" | ✓ (`pending.animation === ''`) |
| `running` | `animate-spin` | same | ✓ (`running.animation === 'animate-spin'`) |
| `waiting_human` (`gate_pending`) | none (per-task) | same | ✓ (`gate_pending.animation === ''`) |
| `waiting_human` (`awaiting_review`) | none (per-task) | same | ✓ (`awaiting_review.animation === ''`) |
| `completed` | none | same | ✓ (`completed.animation === ''`) |
| `failed` | none | same | ✓ (`failed.animation === ''`) |
| `cancelled` (`skipped`) | none | same | ✓ (`skipped.animation === ''`) |

Plus the cross-cutting invariants:

| Invariant | Test | Result |
| --------- | ---- | ------ |
| Dashboard source routes animation through the canonical selector (no inline `animate-spin` on `<Icon>` / `<RunningIcon>`) | "Dashboard source routes animation through the canonical selector" | ✓ |
| Agent Task source routes animation through the canonical selector (no inline `animate-spin` on `<TaskIcon>` / `<RunningIcon>`) | "Agent Task source routes animation through the canonical selector" | ✓ |
| Canonical animation field is sourced from the frozen canonical map | "canonical animation field is sourced from the frozen canonical map" | ✓ |
| `getRuntimeAnimation` is referentially stable | "getRuntimeAnimation is referentially stable for the same input" | ✓ |
| `RUNTIME_VISUAL` matches the contract §5.1 byte-transcription including the new `animation` column | "every visual respects the contract — exhaustively compared against the contract source" | ✓ |

### 4.3 Build artefact

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
✓ built in 6.02s
```

---

## 5. What did NOT change

- **No runtime-logic change.** Selectors (`projectAgentToPhaseStatus`,
  `phaseStatusToCanonical`, `selectRuntimeStatus`,
  `deriveAgentRuntimeState`, etc.) are byte-identical.
- **No store change.** `useWorkflowStore`, `workflowSelectors`
  are byte-identical.
- **No Inspector change.** `InspectorPanel.tsx` is untouched.
- **No Timeline change.** No timeline component exists.
- **No SessionRail change.** Session-level CSS maps owned by
  `SessionRail.tsx` are byte-identical.
- **No submit-button / loading-state animation change.** Inline
  `animate-spin` on submit / loading states
  (`ClarificationPanel.tsx`, `ToolGatePanel.tsx`,
  `InspectorPanel.tsx`, `FeatureRequestChatbox.tsx`,
  `AgentOutputPanel.tsx`) is local UI state, not runtime state
  per the contract §5.1, and remains correctly out of scope.
- **No `animate-pulse` on session-level indicators.** Session-level
  pulse (`OverviewPage.tsx:407-408`, `index.tsx:398`,
  `SessionRail.tsx:222, 225`) is session-level UI state, not
  per-agent runtime state per the contract §5.1, and remains
  correctly out of scope.
- **No backend / API / DTO / schema changes.**

---

## 6. Files in this fix directory

`docs/runfix/` now contains:

- `FIX_REPORT_OBS_01_1.md` — OBS-01.1 (canonical selector, 353 lines)
- `FIX_REPORT_OBS_01_2.md` — OBS-01.2 (store normalization, 252 lines)
- `FIX_REPORT_OBS_01_3.md` — OBS-01.3 (Dashboard visualization, 258 lines)
- `FIX_REPORT_OBS_01_4.md` — OBS-01.4 (Agent Task visualization)
- `FIX_REPORT_OBS_01_5.md` — OBS-01.5 (Inspector canonical-selector invariant)
- `FIX_REPORT_OBS_01_6.md` — this document.

No patches are stored here. The patches live in the source
tree.

---

## 7. NOT VERIFIED

- The pre-existing 3 ESLint warnings on
  `SdlcDashboard/index.tsx` (unused `useState`,
  `InspectorTab`, `navigate`) are NOT touched by this fix.
  They predate OBS-01.1.
- The byte-transcription test asserts `RUNTIME_VISUAL`
  deep-equals a hand-typed object literal. If the contract
  §5.1 columns are ever amended (e.g. adding a `glow`
  column), the test will fail until both the map and the
  test are updated together.
- The OBS-01.6 invariant asserts that the **per-agent
  runtime** animation is canonical-only. The
  **session-level** pulse (`animate-pulse` on connection
  dots, agent-summary spinners, etc.) is owned by per-surface
  CSS maps and is correctly out of scope. If the contract
  ever formalises session-level animation, it will be a
  separate fix.

---

## 8. Stop condition

**STOP after OBS-01.6.**

The brief mandates this. The remaining OBS-01 phases (7, 8)
are documented in
`docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md` but
are NOT executed in this fix.