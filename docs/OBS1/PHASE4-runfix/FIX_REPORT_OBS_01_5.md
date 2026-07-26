# Runfix Report — OBS-01.5 (Inspector Runtime Canonical-Selector Invariant)

> **Status:** Implementation report.
> Phase: **OBS-01.5 only** (per the brief). Prerequisites:
> OBS-01.1 (canonical runtime selector), OBS-01.2 (store
> normalization), OBS-01.3 (Dashboard runtime visualization),
> OBS-01.4 (Agent Task runtime visualization) — all completed.
> Scope: **Inspector (`InspectorPanel.tsx`) ONLY.**
> No Dashboard, AgentTask, Timeline, backend, schema, API,
> DTO, CSS-token, or selector changes outside the Inspector
> panel.

---

## 1. What was fixed

### 1.1 The drift

The Inspector (`frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx`)
already consumed the canonical runtime selector via the
`selectRuntimeExecution` call at line 37-40 (introduced by
OBS-01.1) — but the invariant ("Inspector must consume the
canonical runtime selector; no runtime derivation is allowed
inside Inspector; render exactly according to the Runtime
Contract") was **not locked in by a regression test**. A
future contributor could easily add an inline runtime read
(`session.pipelinePhases.find(...)` or `session.agentStates[i].status`)
inside the Inspector and break the cross-page identity
invariant documented at canonical runtime contract §5.2.2 —
without any test catching the regression.

| Contract rule | Status before OBS-01.5 | Status after OBS-01.5 |
| ------------- | ---------------------- | --------------------- |
| §7 ❌ "No component may derive runtime state independently" | Inspector source had no enforcement; a future commit could introduce an inline read silently. | Locked by 4 new tests (source-level lexical check + runtime read check). |
| §5.2.2 cross-page identity (Dashboard ≡ Agent Task ≡ Inspector) | Covered by 1 existing integration test (`selectRuntimeExecution.phases matches projectAgentToPhaseStatus for every agent`). | Strengthened with a dedicated OBS-01.5 cross-page identity block that walks every reachable `(pipelineStatus, agentAwaitingReview)` combination and asserts Dashboard / Agent Task / Inspector agree on the runtime visual. |
| AC-13 "Dashboard, Agent Task, and Inspector MUST NEVER disagree on the same input." | Verifiable only for the runtime projection path that exists today. | Verifiable for every reachable canonical-state combination via the new tests. |

The Inspector itself already satisfies the OBS-01.5 invariant —
no inline runtime derivation, no direct `pipelinePhases.find`
lookup, no direct `agentStates[i].status` read. OBS-01.5 is a
**defensive** delivery: it locks the invariant in place so the
Inspector cannot silently regress.

### 1.2 The fix

Two coordinated changes:

1. **Add a clarifying comment** to `InspectorPanel.tsx`
   documenting that `selectRuntimeExecution` is the
   canonical-selector entry-point and that the Inspector
   must not bypass it. This makes the invariant visible to
   the next contributor.

2. **Add a regression test block** (`runtimeSelectors — OBS-01.5
   Inspector canonical-selector invariant`) to
   `frontend/tests/runtimeSelectors.test.ts` with two groups:

   a. **Source-level lexical checks** (4 tests). Reads
      `InspectorPanel.tsx` at test-load time and asserts:
      - The Inspector imports `selectRuntimeExecution` from
        `@/store/workflowSelectors`.
      - The Inspector source contains no direct
        `session.agentStates[i].status` read (with comments
        stripped so the citation in the new OBS-01.5 comment
        block does not match the forbidden regex).
      - The Inspector source contains no direct
        `session.pipelinePhases.find(...)` or
        `session.pipelinePhases[i].status` read.
      - The Inspector source contains no per-state ternary that
        re-derives a runtime colour (e.g. `status === 'completed'
        ? 'bg-emerald-...' : ...`).

   b. **Cross-page identity block** (2 tests) under
      `runtimeSelectors — OBS-01.5 cross-page identity (Dashboard
      ≡ Agent Task ≡ Inspector)`. Asserts that for every
      reachable `(pipelineStatus, agentAwaitingReview)`
      combination, three consumer paths yield byte-identical
      visuals:
      - **Dashboard path**: `selectAgentPhaseStatus(session, agent)`
        + `getRuntimeVisual(status)`.
      - **Agent Task path**: `selectAgentPhaseStatus(session, agent)`
        (same canonical projection; the Agent Task page's
        `phaseStatusFor` reads `runtime.phases[agent].status`
        which is identical to the Inspector's
        `runtime.phases[agent].status`).
      - **Inspector path**: `selectRuntimeExecution(...).phases[agent].status`
        + `getRuntimeVisual(status)`.

      The test then asserts:
      - All three return the same `PhaseStatus` for the same
        input.
      - All three return the same `RuntimeVisualStyle` reference
        (referential stability — required for React render
        memoization).

---

## 2. Files changed

| File | Status | Lines (net) | Purpose |
| ---- | ------ | -----------: | ------- |
| `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx` | **MODIFIED** | +7 / -0 | Added a clarifying comment block above the `selectRuntimeExecution` call documenting the OBS-01.5 invariant. No runtime-touching code changes. |
| `frontend/tests/runtimeSelectors.test.ts` | **MODIFIED** | +180 / -0 | Added the OBS-01.5 source-level lexical checks (4 tests) and the OBS-01.5 cross-page identity block (2 tests). |

**2 files changed. 11 files untouched** (Dashboard
`OverviewPage.tsx`, Agent Task `SdlcDashboard/index.tsx`,
Timeline — no timeline component exists, `runtimeSelectors.ts`
(the canonical map is unchanged), `SessionRail.tsx`,
`ToolGatePanel.tsx`, `ClarificationPanel.tsx`,
`AgentOutputPanel.tsx`, all backend / schema / API files, all
existing tests).

### 2.1 Why each file changed

#### `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx`

One comment block added at the existing `selectRuntimeExecution`
call site. No behaviour change. The comment:

- Names the canonical-selector invariant (the `selectRuntimeExecution`
  call routes through `runtimeSelectors.ts` per the contract
  §2 ownership table).
- Names the forbidden patterns (no direct
  `session.pipelinePhases` / `session.agentStates[i].status`
  reads).
- Notes that today's Inspector renders gate state and
  decisions only — no per-agent runtime visuals — so the
  runtime field surface here is read for parity with Dashboard
  and Agent Task, not because the Inspector currently renders
  per-agent visuals.

#### `frontend/tests/runtimeSelectors.test.ts`

A new `describe('runtimeSelectors — OBS-01.5 Inspector
canonical-selector invariant', ...)` block with **6 tests**.

| Test | Asserts |
| ---- | ------- |
| `Inspector source imports the canonical selector (selectRuntimeExecution)` | The lexical pattern `import { … selectRuntimeExecution … } from '@/store/workflowSelectors'` is present in `InspectorPanel.tsx`. |
| `Inspector source has no inline agentStates[i].status lookup (no derivation)` | The Inspector source (with comments stripped) contains no `session.agentStates[i].status` or `session.agentStates.AGENT.status` pattern. |
| `Inspector source has no inline pipelinePhases.find / pipelinePhases[i].status` | The Inspector source contains no `session.pipelinePhases.find(...)` or `session.pipelinePhases[i].status` pattern. |
| `Inspector source has no inline per-state ternary that re-derives runtime colour` | The Inspector source contains no `status === 'completed' \| 'running' \| 'failed'` colour-branch ternary. |
| `Dashboard / Agent Task / Inspector agree on the per-agent PhaseStatus for every reachable combination` | For every `PhaseStatus` value the canonical projection produces, `selectRuntimeExecution.phases[i].status === selectAgentPhaseStatus(session, i)` AND `getRuntimeVisual(inspectorStatus) === getRuntimeVisual(dashboardStatus)` (background, border, badge all equal). |
| `the canonical projection is referentially stable across the three consumers` | `getRuntimeVisual('running')` returns the SAME object reference on repeated calls (referential stability — required for React render-equality). |

### 2.2 What explicitly did NOT change

- **No Dashboard change.** `OverviewPage.tsx` is untouched.
- **No AgentTask change.** `SdlcDashboard/index.tsx` is
  untouched.
- **No Timeline change.** No timeline component exists; the
  runtime-events log is owned by the Inspector.
- **No selector change.** `frontend/src/store/runtimeSelectors.ts`
  is byte-identical to the OBS-01.3 delivery. The Inspector
  consumes the existing `selectRuntimeExecution` call —
  unchanged.
- **No SessionRail change.** `SessionRail.tsx`'s
  `PHASE_DOT_COLORS` and `STATUS_BADGE` are untouched (correctly
  out of scope per OBS-01.3).
- **No runtime map change.** `RUNTIME_VISUAL` /
  `getRuntimeVisual` / `getRuntimeIcon` are unchanged.
- **No backend / API / DTO / schema changes.**
- **No new runtime states.** The Inspector's source-level
  lexical checks assert that no new inline derivation is
  introduced, but no new state is invented.

---

## 3. Regression risks

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| The Inspector source-level regex is too strict and matches a comment in the new OBS-01.5 comment block | Low | The regex strips comments first (`/\*…\*\/` and `//…$`) before matching, so the citation of the forbidden pattern in the comment does not match. Verified by the test passing. |
| A future contributor renames `selectRuntimeExecution` or moves it to a different file | Low | The source-level regex specifically imports from `@/store/workflowSelectors`. A rename would surface loudly in the OBS-01.5 test as a CI failure. |
| The cross-page identity test produces a false positive (e.g. two consumers return different but equivalent statuses due to TypeScript widening) | Low | The test asserts byte-equal `PhaseStatus` AND byte-equal `RuntimeVisualStyle` (background, border, badge all compared). The referential-stability test asserts object identity. If the canonical selector ever diverges from the canonical map, the test catches it. |
| The Inspector panel genuinely needs to bypass the canonical selector for some specific use case in the future | Low | The OBS-01.5 brief is explicit: "no runtime derivation is allowed inside Inspector". Any future bypass must update the test with explicit justification (Constitution Art. III "One Path"). |
| The Inspector's existing `react-hooks/set-state-in-effect` ESLint error | Low | Pre-existing; the line numbers shift because of the OBS-01.5 comment block, but the underlying code is byte-identical. Verified by `git stash` comparison. |

---

## 4. Test results

```
$ npx tsc --noEmit                        →  0 errors
$ npx vitest run                          →  94 / 94 pass  (88 prior + 6 OBS-01.5)
$ npx vite build                          →  ✓ built in 6.06s (2377 modules transformed)
$ npx eslint tests/runtimeSelectors.test.ts src/pages/SdlcDashboard/components/InspectorPanel.tsx
                                            →  0 NEW errors introduced by OBS-01.5
                                            (4 pre-existing issues on InspectorPanel.tsx:
                                             react-hooks/exhaustive-deps ×2,
                                             react-hooks/set-state-in-effect ×1,
                                             @typescript-eslint/no-explicit-any ×1;
                                             all present before OBS-01.5)
```

### 4.1 Per-file test breakdown

| File | Tests | Status | Change vs. OBS-01.4 |
| ---- | -----: | ------ | ------------------- |
| `tests/runtimeSelectors.test.ts` | 81 | ✓ pass | +6 (OBS-01.5 invariant + cross-page identity) |
| `tests/SdlcDashboard.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/OverviewPage.test.tsx` | 3 | ✓ pass | unchanged |
| `tests/App.notFound.test.tsx` | 1 | ✓ pass | unchanged |
| `src/pages/NotFound/__tests__/NotFoundPage.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/yamlExport.helpers.test.ts` | 2 | ✓ pass | unchanged |
| `tests/testScenarios.helpers.test.ts` | 3 | ✓ pass | unchanged |
| **Total** | **94** | **all pass** | **+6** |

### 4.2 OBS-01.5 coverage matrix

| Invariant | Test | Result |
| --------- | ---- | ------ |
| Inspector imports the canonical selector | "Inspector source imports the canonical selector (selectRuntimeExecution)" | ✓ |
| Inspector has no inline `agentStates[i].status` lookup | "Inspector source has no inline agentStates[i].status lookup (no derivation)" | ✓ |
| Inspector has no inline `pipelinePhases.find` / `pipelinePhases[i].status` lookup | "Inspector source has no inline pipelinePhases.find / pipelinePhases[i].status" | ✓ |
| Inspector has no inline per-state ternary | "Inspector source has no inline per-state ternary that re-derives runtime colour" | ✓ |
| Dashboard ≡ Agent Task ≡ Inspector for the same input | "Dashboard / Agent Task / Inspector agree on the per-agent PhaseStatus for every reachable combination" | ✓ |
| Canonical visual map is referentially stable across consumers | "the canonical projection is referentially stable across the three consumers" | ✓ |

### 4.3 Build artefact

```
dist/index.html                               1.05 kB │ gzip:   0.51 kB
dist/assets/index-BGLerul6.css               80.91 kB │ gzip:  13.42 kB
dist/assets/ClarificationPanel-DOkpFN4I.js    5.21 kB │ gzip:   1.91 kB
dist/assets/OverviewPage-CFOGlFoO.js         10.68 kB │ gzip:   3.19 kB
dist/assets/index-D75aZdTY.js                19.00 kB │ gzip:   7.42 kB
dist/assets/index-DZkY_huS.js                29.76 kB │ gzip:   9.49 kB
dist/assets/AppShell-Cm7fZjuc.js             40.08 kB │ gzip:  11.38 kB
dist/assets/index-C-b5oC0B.js                41.59 kB │ gzip:  11.34 kB
dist/assets/vendor-core-D7PafXMB.js          97.37 kB │ gzip:  33.58 kB
dist/assets/vendor-motion-Ba9e6jNh.js       124.72 kB │ gzip:  40.75 kB
dist/assets/vendor-react-C8Bc3afH.js        377.16 kB │ gzip: 117.67 kB
✓ built in 6.06s
```

---

## 5. What did NOT change

- **No Dashboard change.** `OverviewPage.tsx` is untouched.
- **No Agent Task change.** `SdlcDashboard/index.tsx` is
  untouched.
- **No Timeline change.** No timeline component exists.
- **No selector change.** `frontend/src/store/runtimeSelectors.ts`
  is byte-identical to the OBS-01.3 delivery.
- **No canonical visual map change.** `RUNTIME_VISUAL` /
  `getRuntimeVisual` / `getRuntimeIcon` are unchanged.
- **No Inspector surface change beyond the comment block.**
  The Inspector's three tabs (questions / review / decisions)
  render the same content as before. No new visuals.
- **No backend / API / DTO / schema changes.**

---

## 6. Files in this fix directory

`docs/runfix/` now contains:

- `FIX_REPORT_OBS_01_1.md` — OBS-01.1 (canonical selector, 353 lines)
- `FIX_REPORT_OBS_01_2.md` — OBS-01.2 (store normalization, 252 lines)
- `FIX_REPORT_OBS_01_3.md` — OBS-01.3 (Dashboard visualization, 258 lines)
- `FIX_REPORT_OBS_01_4.md` — OBS-01.4 (Agent Task visualization)
- `FIX_REPORT_OBS_01_5.md` — this document.

No patches are stored here. The patches live in the source
tree.

---

## 7. NOT VERIFIED

- The Inspector today renders no per-agent runtime visuals, so
  the cross-page identity invariant is verified at the
  **selector projection** layer (Dashboard / Agent Task /
  Inspector all read the same `PhaseStatus` for the same input).
  When the Inspector eventually renders per-agent runtime
  visuals (a future OBS phase), the same invariant must hold
  in the rendered DOM — covered by the OBS-01.8 visual
  regression baseline (per the implementation checklist
  §OBS-01.8.c).
- The 4 pre-existing ESLint issues on `InspectorPanel.tsx`
  (`react-hooks/exhaustive-deps` ×2,
  `react-hooks/set-state-in-effect` ×1,
  `@typescript-eslint/no-explicit-any` ×1) are NOT touched by
  this fix. They predate OBS-01.1.
- The source-level regex for `agentStates[i].status` matches
  the citation in the OBS-01.5 comment block. The test strips
  comments before matching, so the comment is excluded. If a
  future contributor removes the comment-stripping step, the
  test will fail — but the regex matches a literal that the
  comment references, not real code.

---

## 8. Stop condition

**STOP after OBS-01.5.**

The brief mandates this. The remaining OBS-01 phases (6, 7, 8)
are documented in
`docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md` but
are NOT executed in this fix.