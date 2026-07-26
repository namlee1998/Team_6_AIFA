# Runfix Report — OBS-01.3 (Dashboard Runtime Visualization)

> **Status:** Implementation report.
> Phase: **OBS-01.3 only** (per the brief). Prerequisites:
> OBS-01.1 (canonical runtime selector), OBS-01.2 (store
> normalization) — both completed.
> Scope: **Dashboard runtime visualization ONLY.** No AgentTask,
> Inspector, Timeline, backend, schema, API, DTO, CSS, or
> component UI changes outside the Dashboard.

---

## 1. What was fixed

### 1.1 The drift

The Dashboard (`OverviewPage.tsx`) had **two** duplicated,
hard-coded runtime projections that the canonical runtime
contract (`07_CANONICAL_RUNTIME_CONTRACT.md`) forbids:

| Forbidden pattern (contract §7) | Location in `OverviewPage.tsx` (pre-OBS-01.3) |
| --------------------------------- | ------------------------------------------ |
| ❌ "Duplicated CSS mapping" | Lines 244-252: inline 5-way ternary `status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : status === 'running' ? 'bg-blue-500/20 text-blue-300' : …`. |
| ❌ "UI guessing executionStatus" | Lines 265-272: `<Loader2 animate-spin text-blue-400>` for the running agent indicator. |
| ❌ "UI guessing executionStatus" | Lines 274-278: `<Clock text-amber-400>` for the reviewing agent indicator. |
| ❌ "No hardcoded colour string" | Lines 364-372: `PhaseStatusLabel` returned hard-coded glyphs (`✓ … ! ✗ ⊘ ·`) per status string. |
| ❌ "Animation class is not in the canonical map" | `animate-spin` on the running indicator (contract §5.1.4 reserves animations for the Loader2's spin behaviour but a future OBS phase should own it; OBS-01.3 brief forbids animations). |

### 1.2 The fix

Introduced the Dashboard's **canonical runtime visual map** —
the single source of `background`, `border`, `glyph`, `iconName`,
and `badge` for every runtime state on the Dashboard. Every
Dashboard runtime rendering now obtains its colour, icon, and
badge text from `getDashboardRuntimeVisual(status)`. The icon
component itself is obtained from `getDashboardRuntimeIcon(status)`
via the canonical icon registry. No Dashboard component may
hard-code runtime colours, icons, or badge strings outside these
helpers.

The map's values are transcribed verbatim from the contract
§5.1 tables. A dedicated test file section
(`runtimeSelectors — OBS-01.3 Dashboard runtime visual maps`)
asserts the contract compliance.

---

## 2. Files changed

| File | Status | Lines (net) | Purpose |
| ---- | ------ | -----------: | ------- |
| `frontend/src/store/runtimeSelectors.ts` | **MODIFIED** | +194 | Added the Dashboard canonical runtime visual map + icon registry + helpers. |
| `frontend/src/pages/SdlcDashboard/OverviewPage.tsx` | **MODIFIED** | +63 / -54 | Replaced 4 hard-coded renderings (pipeline-strip ternary, runningAgent indicator, reviewingAgent indicator, `PhaseStatusLabel`) with calls to the canonical map helpers. Removed the `animate-spin` class. |
| `frontend/tests/runtimeSelectors.test.ts` | **MODIFIED** | +291 | Added 16 OBS-01.3-specific tests covering the visual map exhaustively, exhaustivity vs. every `PhaseStatus`, contract-source byte-transcription, frozen-map property, no-animation invariant. |

**3 files changed. 6 files untouched** (AgentTask, Inspector,
Timeline, session-level UI, backend, schema, API).

### 2.1 Why each file changed

#### `frontend/src/store/runtimeSelectors.ts`

Added a new section **"OBS-01.3 — Dashboard runtime visual
maps"** containing three exports:

| Export | Signature | Purpose |
| ------ | --------- | ------- |
| `RuntimeVisualStyle` | interface `{ background, border, glyph, iconName, badge }` | The shape the contract §5.1 mandates. |
| `DASHBOARD_RUNTIME_VISUAL` | `Readonly<Record<PhaseStatus, RuntimeVisualStyle>>` | The frozen canonical map. |
| `getDashboardRuntimeVisual(status)` | `(status) → RuntimeVisualStyle` | The single accessor. |
| `getDashboardRuntimeIcon(status)` | `(status) → React component` | The single icon accessor (returns the lucide-react component via the canonical registry). |
| `DashboardRuntimeIconRegistry` | interface | The icon registry shape. |

The map is `Object.freeze`-d to guarantee the frozen invariant
tested at runtime.

#### `frontend/src/pages/SdlcDashboard/OverviewPage.tsx`

4 inline renderings replaced:

1. **Pipeline-strip inline ternary** (lines 244-252):
   ```tsx
   // before
   className={`…${status === 'completed' ? 'bg-emerald-500/20 …' : status === 'running' ? … : …}`}
   <PhaseStatusLabel status={status} />
   // after
   const visual = getDashboardRuntimeVisual(status);
   const Icon = getDashboardRuntimeIcon(status);
   className={`flex flex-col items-center gap-0.5 rounded-md border ${visual.border} py-1 … ${visual.background}`}
   <Icon size={10} aria-hidden="true" />
   …
   <span className="font-mono">{visual.glyph}</span>
   ```
2. **`runningAgent` indicator**: hardcoded `<Loader2 animate-spin text-blue-400>` →
   `<RunningIcon className={visual.background}>` (animation removed).
3. **`reviewingAgent` indicator**: hardcoded `<Clock text-amber-400>` →
   `<ReviewIcon className={visual.background}>`.
4. **`PhaseStatusLabel` function**: deleted entirely (replaced by
   `visual.glyph` lookup).

The renamed `<button>` `<Stat>` icons in `Header` (lines 132-134)
and `<EmptyState>` icon (line 165) render **aggregate stats** /
**session-level UI state** — NOT per-agent runtime state. They
are correctly out of scope for OBS-01.3 (the brief scopes this
phase to runtime visualization; aggregate stats are a
different concern).

`SessionStatusIcon` (lines 374-380) renders session-level
status (a `SessionStatus` enum, not a canonical runtime state
per §5.1). It is also correctly out of scope — the brief
mandates "Dashboard runtime visualization" and the contract
§5.1 explicitly lists 8 per-agent runtime states.

#### `frontend/tests/runtimeSelectors.test.ts`

A new top-level `describe('runtimeSelectors — OBS-01.3 Dashboard
runtime visual maps', …)` block with **16 new tests** covering:

| Test | Asserts |
| ---- | ------- |
| exhaustive coverage | every `PhaseStatus` has a non-null entry |
| `pending` | dim gray + PlayCircle, badge=PENDING, glyph=`·` |
| `running` | blue + Loader2, badge=RUNNING, glyph=`…` |
| `gate_pending` | yellow + Clock, badge=GATE PENDING, glyph=`!` |
| `awaiting_review` | yellow + Clock, badge=AWAITING REVIEW, glyph=`!` |
| `completed` | green + Check, badge=COMPLETED, glyph=`✓` |
| `failed` | red + AlertCircle, badge=FAILED, glyph=`✗` |
| `skipped` | dim gray + dashed border + SkipForward, badge=CANCELLED, glyph=`⊘` |
| every visual carries all 5 contract aspects | background, border, glyph, iconName, badge all non-empty strings |
| frozen invariant | `Object.isFrozen(DASHBOARD_RUNTIME_VISUAL) === true` |
| referential stability | `getDashboardRuntimeVisual('running')` returns the same reference on repeated calls |
| contract-source byte-transcription | the map equals a hand-typed transcription of contract §5.1 |
| icon registry completeness | every status yields a defined icon component |
| runningAgent/reviewingAgent visual lock | the two indicator visuals use the canonical running/awaiting_review values (guards against future divergence) |
| no-animation invariant | no visual string contains `animate-*` |

---

## 3. Regression risks

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| The visual map drifts from contract §5.1 | Critical | The byte-transcription test asserts equality against a hand-typed expected object. If the contract is amended, the test will fail until both are updated together. |
| The pipeline-strip loses its `border` class because the prior code had no border | Low | The contract §5.1 mandates a `border` for every state. OBS-01.3 introduces the border via the canonical map; visual adds one new class per cell. Pre-existing `OverviewPage.test.tsx` still passes (no class-name assertion). |
| The running indicator loses `animate-spin` | Low | The brief explicitly forbids animations for this phase. The contract §5.1.4 reserves the animation for a future phase. OBS-01.3 omits it intentionally. Static `Loader2` conveys "running" without the spin animation. |
| `PhaseStatusLabel` removal breaks a downstream consumer | Low | The function was only referenced inside `OverviewPage.tsx`. After the refactor, no usage remains. |
| `getDashboardRuntimeIcon` returns a wrapper or proxy that React cannot render | Low | The icon registry imports the lucide-react icons directly and returns them. The component test checks `typeof Icon === 'function' \|\| typeof Icon === 'object'` which covers both function and forwardRef components. |
| A future addition of a `PhaseStatus` value goes uncaught | Medium | `Record<PhaseStatus, RuntimeVisualStyle>` enforces exhaustive coverage at compile time. The exhaustive test also enumerates every value. If PhaseStatus grows, both fail. |

---

## 4. Test results

```
$ npx tsc --noEmit                          →  0 errors
$ npx vitest run                            →  88 / 88 pass  (16 OBS-01.3 + 72 prior)
$ npx vite build                            →  ✓ built in 6.51s (2377 modules transformed)
$ npx eslint src/store/runtimeSelectors.ts  →  0 errors, 0 warnings on changed files
   src/pages/SdlcDashboard/OverviewPage.tsx
   tests/runtimeSelectors.test.ts
```

### 4.1 Per-file test breakdown

| File | Tests | Status | Change vs. OBS-01.2 |
| ---- | -----: | ------ | ------------------- |
| `tests/runtimeSelectors.test.ts` | 75 | ✓ pass | +16 (OBS-01.3 visual maps) |
| `tests/OverviewPage.test.tsx` | 3 | ✓ pass | unchanged |
| `tests/SdlcDashboard.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/App.notFound.test.tsx` | 1 | ✓ pass | unchanged |
| `src/pages/NotFound/__tests__/NotFoundPage.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/yamlExport.helpers.test.ts` | 2 | ✓ pass | unchanged |
| `tests/testScenarios.helpers.test.ts` | 3 | ✓ pass | unchanged |
| **Total** | **88** | **all pass** | **+16** |

### 4.2 OBS-01.3 coverage matrix

Every canonical runtime state's visual mapping is asserted:

| State | Test | Verified visual |
| ----- | ---- | --------------- |
| `idle` (renders as `pending`) | "pending renders dim gray…" | dim gray + PlayCircle + `·` + `PENDING` |
| `queued` (renders as `pending`) | "pending renders dim gray…" | same — pending collapses idle/queued/dispatched per OBS-01.1 |
| `dispatched` (renders as `pending`) | "pending renders dim gray…" | same — rendered as `pending` by the contract |
| `running` | "running renders blue…" | blue + Loader2 + `…` + `RUNNING` |
| `waiting_human` (renders as `gate_pending`) | "gate_pending renders yellow…" | yellow + Clock + `!` + `GATE PENDING` |
| `waiting_human` (renders as `awaiting_review` after FE promotion) | "awaiting_review renders yellow…" | yellow + Clock + `!` + `AWAITING REVIEW` |
| `completed` | "completed renders green…" | green + Check + `✓` + `COMPLETED` |
| `failed` | "failed renders red…" | red + AlertCircle + `✗` + `FAILED` |
| `cancelled` (renders as `skipped`) | "skipped renders dim gray with dashed border…" | dim gray + dashed + SkipForward + `⊘` + `CANCELLED` |
| `timeout` (renders as `skipped`) | same as `cancelled` | identical — FE projects timeout → skipped |

Plus the cross-cutting invariant tests (frozen map, referential
stability, exhaustive coverage, every-state-carries-all-five-aspects,
no-animation invariant, contract-source byte-transcription).

### 4.3 Build artefact

```
dist/index.html                               1.05 kB │ gzip:   0.51 kB
dist/assets/index-C-XdpaMp.css               81.60 kB │ gzip:  13.50 kB
dist/assets/OverviewPage-D4EvsJrh.js         10.68 kB │ gzip:   3.19 kB
dist/assets/ClarificationPanel-CRybor_2.js    5.21 kB │ gzip:   1.91 kB
… (11 chunks total) …
✓ built in 6.51s
```

The `OverviewPage` chunk grew slightly (10.68 kB) due to the
two IIFEs that wrap the running/reviewing indicator renderings.

---

## 5. What did NOT change

- **No AgentTask change.** `SdlcDashboard/index.tsx` (the Agent Task page) is untouched. Its existing maps (`COLUMN_BORDER` at line 76-83, `TASK_ICON` at line 44-51, `PhaseChip` at line 503-516) remain in place.
- **No Inspector change.** `InspectorPanel.tsx` is untouched.
- **No Timeline change.** No timeline component was modified.
- **No SessionRail change.** `SessionRail.tsx`'s `PHASE_DOT_COLORS` at line 8 is untouched.
- **No SessionStatusIcon change in OverviewPage.** This is session-level UI (a `SessionStatus` enum), not per-agent runtime state. It's intentionally out of OBS-01.3 scope.
- **No Header stat icons change.** Aggregate KPI cards (Total / Running / Pending / Completed) use aggregate-colour accents — not per-agent runtime state.
- **No animations.** The brief forbids animations. The contract §5.1 reserves `animate-spin` for a future OBS phase.
- **No backend / API / DTO / schema changes.** The selector consumes only the existing `PhaseStatus` union; no wire-shape change.
- **No new runtime states.** The map covers exactly the 7 visible `PhaseStatus` values from contract §5.2.1 — no invented values.

---

## 6. Files in this fix directory

`docs/runfix/` now contains:

- `FIX_REPORT_OBS_01_1.md` — OBS-01.1 (canonical selector, 353 lines)
- `FIX_REPORT_OBS_01_2.md` — OBS-01.2 (store normalization, 252 lines)
- `FIX_REPORT_OBS_01_3.md` — this document (Dashboard visualization)

No patches are stored here. The patches live in the source tree.

---

## 7. NOT VERIFIED

- The visual map test asserts the bytes of every visual against a
  hand-typed expected object. If the contract §5.1 changes
  (e.g. a new colour is added for one state), the test will
  fail until both the map and the test are updated together.
  This is intentional — it forces the divergence to surface
  loudly during code review rather than silently shipping.
- The contract §5.1 reserves `Pulse: YES` for the `running`
  state. OBS-01.3 does not implement any pulse / glow / animation
  per the brief. A future OBS phase (e.g. OBS-01.5 per the
  implementation checklist) will own animations.
- The pre-existing 3 ESLint warnings in `SdlcDashboard/index.tsx`
  (unused `useState`, `InspectorTab`, `navigate`) are NOT touched
  by this fix. They predate OBS-01.1.

---

## 8. Stop condition

**STOP after OBS-01.3.**

The brief mandates this. The remaining OBS-01 phases (4, 5, 6, 7,
8) are documented in `docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md`
but are NOT executed in this fix.
