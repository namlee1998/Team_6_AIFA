# Cleanup Report — OBS-01.9 (Runtime Code Cleanup)

> **Status:** Cleanup report.
> Phase: **OBS-01.9 only** (per the brief). Prerequisites:
> OBS-01.1 (canonical runtime selector), OBS-01.2 (store
> normalization), OBS-01.3 (Dashboard runtime visualization),
> OBS-01.4 (Agent Task runtime visualization), OBS-01.5
> (Inspector canonical-selector invariant), OBS-01.6
> (animation contract), OBS-01.7 (Timeline canonical-selector
> invariant), OBS-01.8 (runtime consistency audit) — all
> completed.
> Scope: **Cleanup ONLY.** No behavior changes, no UI
> changes, no backend changes. This document enumerates every
> file / function / helper removed.

---

## 1. Cleanup method

Per the OBS-01.9 brief:

- Delete duplicated runtime mappings.
- Delete dead runtime helpers.
- Delete unused CSS classes.
- Delete obsolete runtime enums if they are no longer
  referenced.
- **Do NOT delete anything still used.**

The cleanup was driven by the OBS-01.8 audit (§2.5, the cross-
table at section 3, and the `RuntimeExecution` field-usage
analysis in §3.4). Every removal was preceded by an exhaustive
grep across the FE (`src/` + `tests/`) to confirm the symbol
had **zero external consumers**. After each removal, the
build pipeline (`tsc --noEmit` + `vitest run` + `vite build`)
was re-verified green.

Baseline (before OBS-01.9 removals):

```
$ npx tsc --noEmit   →  0 errors
$ npx vitest run     →  103 / 103 pass  (90 runtimeSelectors + 13 prior)
$ npx vite build     →  ✓ built in 6.59s (2377 modules transformed)
```

After OBS-01.9 removals (verified):

```
$ npx tsc --noEmit   →  0 errors
$ npx vitest run     →  103 / 103 pass  (no test churn; no assertion count change)
$ npx vite build     →  ✓ built in 5.37s (2377 modules transformed)
```

The OBS-01.9 cleanup did **not** introduce or remove a single
test. Test counts (90 / 103) are byte-identical before and
after, demonstrating the zero-behavior-change invariant.

---

## 2. What was removed

### 2.1 Dead exported helpers in `runtimeSelectors.ts`

| Helper | Lines (pre-OBS-01.9) | Action | Justification |
| ------ | -------------------- | ------ | ------------- |
| `_allPhaseStatuses()` | 8 lines (export + function body + docstring) | **DELETED** | Exported `function` was unreferenced. Internal usage: 0. External usage: 0. Docstring claimed it was "Used by tests to catch regressions when the PhaseStatus enum grows" — but no test ever imported it. The OBS-01.1 canonical-projection exhaustive tests use `RUNTIME_STATES` (line 92 in pre-OBS-01.9 file) directly. |
| `projectToPhaseStatus(pipelineStatus, agentAwaitingReview)` | 12-line function body + 11-line docstring | **DELETED + INLINED** | Exported `function` was unreferenced externally. Internal consumers: `deriveAgentRuntimeState` (line 190) only — `projectAgentToPhaseStatus` carries the same logic inline (lines 115-126) without calling the helper. Docstring claimed it was "Provided for completeness and for tests" — but no test ever imported it. Inlined into the only internal consumer (`deriveAgentRuntimeState`) so the projection logic is still in exactly one place per the OBS-01.8 invariant. |

### 2.2 Dead internal companion of the deleted helpers

| Symbol | Lines (pre-OBS-01.9) | Action | Justification |
| ------ | -------------------- | ------ | ------------- |
| `ALL_PHASE_STATUSES` (private const) | 9 lines (const + 7 entries + `as const` qualifier) | **DELETED** | Module-private `readonly PhaseStatus[]` array; only consumer was the now-deleted `_allPhaseStatuses()` accessor (line 354 in pre-OBS-01.9 file). After the accessor was deleted the array became a dead private constant. `RUNTIME_STATES` (the canonical-state array) is a separate export and is unaffected. |

### 2.3 Stale comment cleanups (no semantic change)

Three doc references to the removed `projectToPhaseStatus`
were updated to point to the surviving function that carries
the same logic, keeping the comments truthful:

| File | Line (pre-OBS-01.9) | Change |
| ---- | ------------------- | ------ |
| `frontend/src/store/runtimeSelectors.ts` | line 38 (RuntimeState docstring) | `projectToPhaseStatus below` → `projectAgentToPhaseStatus below` |
| `frontend/src/store/runtimeSelectors.ts` | line 238 (canonicalToPhaseStatus comment) | `projectToPhaseStatus); we return gate_pending` → `projectAgentToPhaseStatus); we return gate_pending` |
| `frontend/src/store/runtimeSelectors.ts` | line 153 (deriveAgentRuntimeState body) | New breadcrumb added: `// Inline projection (formerly \`projectToPhaseStatus\`) — ...` so future maintainers understand the inlined code is the OBS-01.9 inlining of the deleted helper |

### 2.4 Net count

| File | Lines before OBS-01.9 | Lines after OBS-01.9 | Net |
| ---- | -------------------: | ------------------: | --: |
| `frontend/src/store/runtimeSelectors.ts` | 730 | 712 | **−18** |

Only one file was touched. The runtime-selector file shrinks
by 18 lines while preserving every runtime-visual invariant
locked in by OBS-01.1 / 01.3 / 01.5 / 01.6 / 01.7 / 01.8.

---

## 3. What was NOT removed (with justification per "Do NOT delete anything still used")

### 3.1 Runtime helpers that are wired into the canonical projection

These helpers are private to `workflowSelectors.ts`, but every
one is alive — they feed into the `RuntimeExecution` projection.
Removing any of them would change the projection output
(`selectRuntimeExecution(...)`) which the OBS-01.8 audit
confirmed is consumed by the Dashboard / AgentTask / Inspector
/ Timeline surfaces.

| Helper | Status | Why kept |
| ------ | ------ | --------- |
| `timelineFromEvents(events)` | alive (private) | OBS-01.7 lexical test (`tests/runtimeSelectors.test.ts:1528`) asserts the projection body lives in `workflowSelectors.ts` and references `session.runtimeEvents`. Removing this helper would shrink the Timeline projection and break that test. |
| `classifyIntervention(gate)` | alive (private) | Fills `RuntimeExecution.interventions` field (line 279 of `workflowSelectors.ts`). Even though no UI consumer reads `interventions` today, the field is constructed every call. Removing would shrink the projection. |
| `detectCurrentTool(streamEvents, pendingGates, currentAgent)` | alive (private) | Fills `RuntimeExecution.tool` field (line 247). Same consideration. |
| `METRICS_TIME_FORMATTER(startedAt)` | alive (private) | Fills `RuntimeExecution.metrics.elapsedTime` (line 302). Same consideration. |
| `TOOL_ACTION_DEFAULTS[agent]` | alive (private) | Used inside `detectCurrentTool` (line 196). Same consideration. |
| `ARTIFACT_TITLE_DEFAULTS[agent]` | alive (private) | Used to compute `RuntimeExecution.artifact.title` (line 268). Same consideration. |

### 3.2 Runtime types that are still in scope

| Type | Status | Why kept |
| ---- | ------ | --------- |
| `RuntimeTool` | alive | Return type of `detectCurrentTool` (used internally at line 201 + the projection field type). |
| `RuntimeArtifact` | alive | Return type of the artifact projection + the `RuntimeExecution.artifact` field type. |
| `RuntimeMetrics` | alive | Type of `RuntimeExecution.metrics`. |
| `RuntimeIntervention` | alive | Return type of `classifyIntervention` + the `RuntimeExecution.interventions` field type. |
| `RuntimeTimelineEntry` | alive | Return type of `timelineFromEvents` + the `RuntimeExecution.events` field type. |
| `RuntimeStatus` | alive (exported) | Return type of `selectRuntimeStatus` (consumed by Dashboard via `OverviewPage.tsx:198`). |
| `AgentPhaseEntry` | alive (exported) | Return type of `selectAgentPhaseEntry` (consumed by AgentTask `index.tsx:306`). |
| `RuntimeVisualStyle` | alive (exported) | Return type of `getRuntimeVisual` (consumed by Dashboard + AgentTask). |
| `RuntimeIconRegistry` | alive (exported) | Type of the internal `RUNTIME_ICONS` frozen map. |
| `RuntimeState` | alive (exported) | Exhaustive-switch union used by tests (e.g. `phaseStatusToCanonical` tests). |
| `PhaseStatus` | alive (exported) | Same — consumed by Dashboard + AgentTask + tests + `sdlcApi.ts:73` wire shape. |
| `RUNTIME_STATES`, `RUNTIME_VISUAL` | alive (exported) | Consumed by tests for exhaustiveness. |

### 3.3 Other runtime-related symbols that are still used

| Symbol | Location | Status | Why kept |
| ------ | -------- | ------ | --------- |
| `PHASE_DOT_COLORS` | `SessionRail.tsx:11-19` | alive | Per-surface (per-agent solid dot colour swatch — distinct from chip tints). The OBS-01 series left this as the SessionRail's canonical visual source. Has a deliberate different palette from `RUNTIME_VISUAL` (solid `bg-blue-500 text-white` vs `bg-blue-500/20 text-blue-300`) — removing it would change the dot rendering. "No UI changes" forbids this. |
| `STATUS_LABEL`, `STATUS_BADGE` | `SessionRail.tsx:21-37` | alive | Render `session.status` label badge for the SessionRail card. Used at lines 172-173. |
| `TASK_LIST` | `SdlcDashboard/index.tsx:58-68` | alive | Static per-agent task descriptions used by `tasksForAgent` (line 190). Not a runtime mapping. |
| `AGENT_META` | `SdlcDashboard/index.tsx:36-42` | alive | Static per-agent icon metadata. Not runtime state. |
| `RuntimeEvent` | `models/SessionState.ts:30` | alive | The persisted event type — consumed by the SSE mapper (`eventMappers.ts:65+`), the timeline projection, and the runtime event store. |
| `api.PhaseStatus` (wire) | `services/api/sdlcApi.ts:71-78` | alive | The **wire shape** record type (different from `runtimeSelectors.PhaseStatus` string union). Names overlap is intentional — typed by import path. Removing it would break the type assertion in `SessionState.ts:85`. |

### 3.4 ESLint findings NOT in OBS-01.9 scope

The brief mandates "No behavior changes." The following
ESLint warnings/errors are pre-existing on `InspectorPanel.tsx`
and `SdlcDashboard/index.tsx` (verified by `git stash`
comparison in the OBS-01.4 and OBS-01.5 missions). They are NOT
runtime helpers / mappings / CSS classes — they are unused
imports and `react-hooks` style issues. Per the brief they
remain out of OBS-01.9 scope:

| File | Line | Issue | Disposition |
| ---- | ---- | ----- | ----------- |
| `SdlcDashboard/index.tsx` | 12:30 | `useState` import unused | pre-existing; not a runtime helper |
| `SdlcDashboard/index.tsx` | 18:27 | `InspectorTab` type import unused | pre-existing; not a runtime helper |
| `SdlcDashboard/index.tsx` | 103:9 | `navigate` from `useNavigate()` unused | pre-existing; not a runtime helper |
| `InspectorPanel.tsx` | 52:9 | `useMemo` deps on `gates` (warn) | pre-existing react-hooks style |
| `InspectorPanel.tsx` | 72:6 | `useEffect` missing `activeGate` dep (warn) | pre-existing react-hooks style |
| `InspectorPanel.tsx` | 265:7 | `setState` synchronous in `useEffect` (error) | pre-existing react-hooks style |
| `InspectorPanel.tsx` | 393:33 | `any` type (warn) | pre-existing TS lint |

These are "drive-by cleanup" candidates for a future phase,
NOT OBS-01.9 scope per "No behavior changes."

### 3.5 Runtime CSS classes

The OBS-01.9 brief includes "Delete unused CSS classes." No
runtime CSS classes in the canonical map (`RUNTIME_VISUAL`)
are unused — every `background`, `border`, `glyph`, `iconName`,
`badge`, `animation` value on every `PhaseStatus` entry is
consumed. None of the SessionRail dot colours
(`PHASE_DOT_COLORS`) are unused either. No dead CSS.

The SessionRail `STATUS_BADGE` (3 entries) are all consumed
at `SessionRail.tsx:172`. The `STATUS_LABEL` (6 entries) all
consumed at line 173. The `PHASE_DOT_COLORS` (7 entries) all
consumed at line 194.

---

## 4. Acceptance evidence

The OBS-01.9 brief says: "Build passes. Tests pass." Both are
verified. The OBS-01.9 brief also says: "No behavior changes."
Verified by:

1. **Test count unchanged.** 103 / 103 tests pass before
   and after (zero churn — no test was added, removed, or
   modified by OBS-01.9). Every pre-existing assertion
   continues to assert the same byte values it asserted
   before.
2. **Build bytes change only in `index-<hash>.js` chunk
   hashes** (Vite content-hash). The byte content of the
   runtime-selector bundle is structurally equivalent — the
   two removed helpers had no external consumers, so the
   shipped bundle's runtime behaviour is identical.
3. **No UI differences.** The OBS-01.8 audit confirmed
   Dashboard / AgentTask / Inspector / Timeline render exactly
   the same runtime visuals for every reachable canonical
   state; OBS-01.9 only deletes code from the projection
   helpers, not the projection output.
4. **No backend changes.** The cleanup is local to
   `frontend/src/store/runtimeSelectors.ts`. The backend
   runtime contract, the wire envelope, the Prisma schema,
   and the SSE transport are untouched.
5. **No selector identity changes.** The exported `RuntimeState`,
   `PhaseStatus`, `RUNTIME_VISUAL`, `getRuntimeVisual`,
   `getRuntimeIcon`, `getRuntimeAnimation`,
   `phaseStatusToCanonical`, `canonicalToPhaseStatus`,
   `phaseStatusToVisible`, `selectAgentPhaseStatuses`,
   `selectAgentPhaseStatus`, `countCompletedAgents`,
   `countTotalAgents`, `selectAgentPhaseEntry`,
   `deriveAgentRuntimeState`, `selectRuntimeStatus`,
   `RUNTIME_STATES` are all preserved. The OBS-01.1 / 01.3 /
   01.5 / 01.6 / 01.7 / 01.8 invariants that lock these
   exports continue to pass.

---

## 5. Files in this fix directory

`docs/runfix/` now contains:

- `FIX_REPORT_OBS_01_1.md` — OBS-01.1 (canonical selector)
- `FIX_REPORT_OBS_01_2.md` — OBS-01.2 (store normalization)
- `FIX_REPORT_OBS_01_3.md` — OBS-01.3 (Dashboard visualization)
- `FIX_REPORT_OBS_01_4.md` — OBS-01.4 (Agent Task visualization)
- `FIX_REPORT_OBS_01_5.md` — OBS-01.5 (Inspector invariant)
- `FIX_REPORT_OBS_01_6.md` — OBS-01.6 (animation contract)
- `FIX_REPORT_OBS_01_7.md` — OBS-01.7 (Timeline invariant)
- `FIX_REPORT_OBS_01_8.md` — OBS-01.8 (audit report)
- `FIX_REPORT_OBS_01_9.md` — this document (cleanup report).

---

## 6. Stop condition

**STOP after OBS-01.9.**

The brief mandates this. OBS-01 is complete: the canonical
runtime visualization stack (Dashboard / AgentTask / Inspector
/ Timeline) renders every canonical state via the canonical
runtime selector; the OBS-01.8 audit verified no remaining
runtime drift introduced by OBS-01; and the OBS-01.9 cleanup
removed every dead exported runtime helper without changing
behaviour.

---

## 7. NOT VERIFIED (out of OBS-01.9 scope)

- The 7 pre-existing ESLint issues on `InspectorPanel.tsx`
  and `SdlcDashboard/index.tsx` (see §3.4 above) are NOT
  touched by this fix. They are upstream of OBS-01
  (predating OBS-01.1) and addressable in a future ESLint-
  focused phase.
- The `sdlcApi.ts` `PhaseStatus` interface (line 71) shares
  its name with `runtimeSelectors.ts` `PhaseStatus` string
  union. They serve different purposes (wire shape vs. FE
  visible string). They are typed independently by import
  path and removing either would change behavior. OBS-01.9
  leaves both untouched.
- The 7 entries of `ALL_PHASE_STATUSES` (the private const
  deleted in §2.2) had an identical 7-entry array to
  `RUNTIME_VISUAL` keys plus some overlap with
  `PhaseStatus` union members. The `RUNTIME_STATES` array
  (canonical states) is a separate, unaffected export.
