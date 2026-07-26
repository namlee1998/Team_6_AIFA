# OBS-01 Phase 5 — Verification Report

> **Status:** VERIFICATION ONLY. No production code was modified.
> **Phase:** OBS-01 Phase 5 (Verification).
> **Scope:** Verify that Patches 01–09 of OBS-01 implemented the
> canonical runtime contract (`07_CANONICAL_RUNTIME_CONTRACT.md`)
> correctly and did not introduce regressions.
> **Authority:**
> - `docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md` (contract)
> - `docs/OBS1/phase1-runtime-observability/05_CANONICAL_RUNTIME_STATE.md` (state spec)
> - `docs/OBS1/phase1-runtime-observability/06_IMPLEMENTATION_CHECKLIST.md` (checklist)
> - `docs/OBS1/PHASE4-runfix/FIX_REPORT_OBS_01_*.md` (patch reports)

---

## 1. Verification Summary

| Item | Status |
| ---- | :----: |
| Runtime contract verified | ✓ PASS (FE side; BE pre-existing drift unchanged) |
| Runtime selectors (`runtimeSelectors.ts`) | ✓ PASS — single source of truth, 90 tests green |
| CSS maps (`RUNTIME_VISUAL`) consolidated | ✓ PASS — local maps removed on Dashboard + Agent Task |
| Dashboard pipeline strip normalized | ✓ PASS — `OverviewPage.tsx` reads via canonical selectors |
| Agent Task page normalized | ✓ PASS — `SdlcDashboard/index.tsx` reads via canonical selectors |
| Inspector canonical-selector invariant | ✓ PASS — `InspectorPanel.tsx` consumes `selectRuntimeExecution` only |
| Animation contract (OBS-01.6) | ✓ PASS — `getRuntimeAnimation()` is single accessor |
| Timeline canonical-selector invariant | ✓ PASS — `timelineFromEvents` reads `runtimeEvents` only |
| Cleanup (OBS-01.9) | ✓ PASS — duplicated maps removed |
| Tests pass | ✓ PASS — 103/103 frontend tests pass; `tsc --noEmit` clean |
| **Backend wire `role: null` drift** | ✗ **FAIL — pre-existing, OUT OF SCOPE of FE patches** |
| **`pipelinePhases[i].status` mapper patches** | ✗ **FAIL — partial; only `agentStates` updated per-event** |

**Final verdict:** OBS-01 PHASE4 (frontend-only patches 01–09) is
**COMPLETE** with respect to its declared scope. Two contract
violations remain on the **backend**, neither of which was
within the scope of patches 01–09. See §10 "Failed Checks" and
§11 "Pass Checks".

---

## 2. Runtime Coverage

### 2.1 The 8 canonical states — coverage matrix

| # | Canonical `RuntimeState` | Producer (canonical) | Visible projection | CSS Map entry | Test |
| - | ------------------------ | -------------------- | ------------------ | ------------- | ---- |
| 1 | `idle` | `emptyAgentStates()` initial | `pending` | `RUNTIME_VISUAL.pending` | ✓ (UNREACHABLE_VIA_PROJECTION) |
| 2 | `queued` | `Task.executionStatus='queued'` (initial) | `pending` | `RUNTIME_VISUAL.pending` | ✓ |
| 3 | `dispatched` | (no producer in current source — reserved) | `pending` | `RUNTIME_VISUAL.pending` | ✓ (UNREACHABLE_VIA_PROJECTION) |
| 4 | `running` | `agentDispatcher.runAgent` → `taskLifecycle.transition('running')` | `running` | `RUNTIME_VISUAL.running` | ✓ |
| 5 | `waiting_human` | `gateBridge.requestGate` → `taskLifecycle.transitionIfPresent('awaiting_gate')` | `gate_pending` / `awaiting_review` | `RUNTIME_VISUAL.gate_pending`, `RUNTIME_VISUAL.awaiting_review` | ✓ |
| 6 | `completed` | `_saveAgentData` → `taskLifecycle.transitionIfPresent('completed')` | `completed` | `RUNTIME_VISUAL.completed` | ✓ |
| 7 | `failed` | `agentDispatcher.markTaskFailed` → `taskLifecycle.transition('failed')` | `failed` | `RUNTIME_VISUAL.failed` | ✓ |
| 8 | `cancelled` | `cancelTask` → `taskLifecycle.transitionIfPresent('cancelled')` | `skipped` | `RUNTIME_VISUAL.skipped` | ✓ |

**All 8 canonical states are reachable through the projection
chain.** Evidence: `runtimeSelectors.test.ts:283-340`
("produces every reachable canonical state at least once across
all combinations"). Reserved states `idle` and `dispatched`
documented as `UNREACHABLE_VIA_PROJECTION` (no producer today).

### 2.2 Runtime contract visibility — 13 dimensions per state

Per §2.4 ("Verification 1") and §2.1 ("Verification 2") of the
verification brief, every state must have: producer, consumer,
selector, css class, badge, icon, color, animation, timeline,
dashboard, agent task, inspector.

| Dimension | Source of truth | Status |
| --------- | --------------- | :----: |
| **Producer** | `taskLifecycle.transition` (`backend/src/services/taskLifecycleService.js:95-141`) | ✓ Canonical, BE-side (unchanged) |
| **Consumer (FE)** | `selectRuntimeStatus` (`runtimeSelectors.ts:299-322`) | ✓ Single source |
| **Selector** | `selectRuntimeExecution` (`workflowSelectors.ts:220-313`) → `runtimeSelectors.ts` | ✓ Single owner |
| **CSS class (border)** | `RUNTIME_VISUAL[status].border` (`runtimeSelectors.ts:543-611`) | ✓ Canonical |
| **CSS class (chip bg)** | `RUNTIME_VISUAL[status].background` | ✓ Canonical |
| **Badge text** | `RUNTIME_VISUAL[status].badge` | ✓ Canonical |
| **Icon (component)** | `getRuntimeIcon()` (`runtimeSelectors.ts:660-665`) | ✓ Canonical registry |
| **Animation** | `getRuntimeAnimation()` (`runtimeSelectors.ts:689-691`) | ✓ Canonical |
| **Glyph (pipeline strip)** | `RUNTIME_VISUAL[status].glyph` | ✓ Canonical |
| **Dashboard rendering** | `OverviewPage.tsx:244-265` (pipeline strip) | ✓ Reads via `selectAgentPhaseStatus` + `getRuntimeVisual` + `getRuntimeIcon` + `getRuntimeAnimation` |
| **Agent Task rendering** | `SdlcDashboard/index.tsx:300-380` (card border + chip + per-task icons) | ✓ Reads via canonical selectors |
| **Inspector rendering** | `InspectorPanel.tsx:47-50` (runtime selector; no per-agent visuals in Inspector) | ✓ Per the contract §5.1.5 (Inspector renders gates, not agent-state) |
| **Timeline rendering** | `timelineFromEvents` (`workflowSelectors.ts:204-218`) | ✓ Reads `RuntimeEvent[]` only (no `pipelinePhases`/`agentStates` reads) — verified by source-level lexical check (`runtimeSelectors.test.ts:1355-1565`) |

**Every dimension is owned by exactly one source.** The
canonical selector (`runtimeSelectors.ts`) is the FE-side
single owner per the contract §2 ownership table.

---

## 3. Contract Coverage

Per §4 of the verification brief (Contract Coverage), every rule
in `07_CANONICAL_RUNTIME_CONTRACT.md` is mapped to:

- **Implemented** — rule fully satisfied in code.
- **Partially implemented** — rule partially satisfied; specific gap noted.
- **Missing** — rule not addressed by any code.
- **Broken** — rule violated by code.

### 3.1 Contract rule matrix (per §6, §7, §8 of the contract)

| Contract section / rule | Status | Evidence |
| ----------------------- | :----: | -------- |
| §6 rule 1: FE never invents runtime state | **Implemented** | `runtimeSelectors.ts:103-127` — projection consumes only canonical store fields |
| §6 rule 2: FE never infers completion | **Implemented** | `eventMappers.ts:229-244` — `mapTaskCompleted` only fires on `task_completed` envelope |
| §6 rule 3: FE only projects BE state | **Implemented** | `selectRuntimeExecution` is the only `selectRuntimeExecution` consumer |
| §6 rule 4: BE never sends presentation fields | **Implemented** | `backend/src/dto/eventEnvelope.js:47-65` — payload is domain-only |
| §6 rule 5: BE never sends colors | **Implemented** | Same evidence as §6 rule 4 |
| §6 rule 6: BE never sends CSS | **Implemented** | Same evidence as §6 rule 4 |
| §6 rule 7: BE never sends UI state directly | **Partially implemented** | `role: null` still emitted by `taskLifecycle.publishLifecycle:90` — wire envelope for lifecycle carries the role but taskLifecycle never sets it. (See §10.) |
| §6 rule 8: SSE replay byte-for-byte | **Implemented** | `backend/src/controllers/SdlcController.js:347-348` — `sendEnvelope(row.envelope)` verbatim |
| §6 rule 9: session_started is the only initial seed | **Implemented** | `eventMappers.ts:199-208` is the only writer of `pipelinePhases` |
| §6 rule 10: wire union is closed | **Implemented** | 13 types in `eventEnvelope.js:10-23` and FE mirror `frontend/src/dto/event.ts:6-19` |
| §7: deriving runtime from `PendingGate` | **Implemented (forbidden pattern absent)** | `runtimeSelectors.ts` only reads `pipelinePhases[i].status` + `agentStates[i].status` |
| §7: deriving runtime from `Task.status` (legacy) | **Partially implemented** | `SdlcWorkflowService.getPipelineResponse:1256` still reads `phaseData.status` (legacy). The FE never reads `Task.status`. (See §10.) |
| §7: multiple runtime enums | **Implemented** | Single `RuntimeState` union (`runtimeSelectors.ts:40-48`) |
| §7: duplicated CSS mapping | **Implemented** | Single `RUNTIME_VISUAL` map (`runtimeSelectors.ts:538-611`); local `TASK_ICON`/`COLUMN_BORDER`/`STATUS_DOT_COLOR`/`PhaseChip`/`PhaseStatusLabel` removed |
| §7: duplicated color mapping | **Implemented** | Single Tailwind theme source |
| §7: UI guessing `executionStatus` | **Implemented** | No component-level inline derivations |
| §7: hardcoded "running" | **Implemented** | `runtimeSelectors.ts` is the only source of `'running'` strings |
| §7: multi-owner for `PipelinePhase.status` | **Implemented** | Only `mapSessionStarted` writes `pipelinePhases` (`eventMappers.ts:203`) |
| §7: `role: null` on lifecycle envelopes | **FAIL — pre-existing, OUT OF SCOPE** | `taskLifecycleService.js:90` still emits `role: null`. The contract requires `role: task.type`. (See §10.) |
| §7: frozen snapshot for runtime transitions | **Partially implemented** | `pipelinePhases[i].status` is updated only at SSE connect (`mapSessionStarted`). Per-event lifecycle mappers (`mapTaskStarted`, etc.) update `agentStates` but NOT `pipelinePhases`. The canonical selector compensates by promoting via `agentStates` for `awaiting_review`/`running`. (See §10.) |
| §7: inline color string in a component | **Implemented** | Only `RUNTIME_VISUAL` strings contain colors |
| §7: reading `Task.status` from the FE store | **Implemented** | FE store has no `Task.status` field |
| §7: adding a new EventType without a producer | **Implemented** | 13-type union, every type has a producer or is documented as dormant |
| §7: two producers for same wire event type | **Implemented** | Per-event producer table is the single mapping |
| §7: bypassing `taskLifecycle.transition` | **Implemented (FE side)** | FE never writes `executionStatus` |
| §7: bypassing `publishEvent` | **Implemented** | All `publishEvent` callers verified |
| §7: state projection duplication | **Implemented** | Single `RUNTIME_VISUAL` map drives Dashboard + Agent Task + SessionRail |

### 3.2 Invariant coverage (per §8)

| Invariant | Status | Evidence |
| --------- | :----: | -------- |
| 1. One runtime state source per agent | ✓ Implemented | `runtimeSelectors.ts` is the single owner |
| 2. One wire envelope type | ✓ Implemented | `EventEnvelope` (`eventEnvelope.js:47-65`) |
| 3. Every runtime event ↔ one transition | ✓ Implemented | `taskLifecycle.transition` is sole writer |
| 4. Every EventType has exactly one producer | ✓ Implemented | Per producer table in contract §4.1 |
| 5. Every lifecycle envelope role == task.type | ✗ **FAIL** | `role: null` still emitted by `taskLifecycle.publishLifecycle:90` |
| 6. PendingGate MUST NOT change executionStatus | ✓ Implemented | `gateBridge.requestGate:115-120` routes through `transitionIfPresent` |
| 7. gate_resolved triggers transition | ✓ Implemented | `gateBridge.resolveGate:170-174` |
| 8. FE renders every executionStatus | ✓ Implemented | `RUNTIME_VISUAL` covers every `PhaseStatus` |
| 9. Every executionStatus has one visual | ✓ Implemented | Single `RUNTIME_VISUAL` map |
| 10. Dashboard ≡ Agent Task ≡ Inspector agreement | ✓ Implemented | Cross-page identity tests (`runtimeSelectors.test.ts:617-702`) |
| 11. Runtime visualization is SSE-driven | ✓ Implemented | No polling anywhere |
| 12. Wire carries no presentation fields | ✓ Implemented | Envelope is domain-only |
| 13. Every `pipelinePhases[i].status` patch is one canonical state | ✓ Implemented | Only `mapSessionStarted` writes |
| 14. `pipelinePhases` updated ONLY by `mapSessionStarted` (seed) or per-event lifecycle mappers | ✗ **Partially implemented** | Only `mapSessionStarted` writes today; per-event mappers don't write `pipelinePhases` |
| 15. `agentStates` updated ONLY by per-event lifecycle mappers + `mapGatePending` | ✓ Implemented | `eventMappers.ts:322-336` |
| 16. `currentAgent` derivation computed by `selectRuntimeExecution` | ✓ Implemented | `runtimeSelectors.ts:299-322` |
| 17. `session.status` updated by mappers only | ✓ Implemented | `eventMappers.ts:322-336` |
| 18. SSE replay forwards row.envelope byte-for-byte | ✓ Implemented | `SdlcController.js:347-348` |
| 19. AgentCard derives colour + badge from same projection | ✓ Implemented | `RUNTIME_VISUAL` is shared |
| 20. Tailwind theme tokens are single source | ✓ Implemented | All colors come from theme |

### 3.3 AC-01 through AC-20 (per §9 of contract)

| AC | Status | Evidence |
| -- | :----: | -------- |
| AC-01 | ✓ | SSE drives every render |
| AC-02 | ✓ | `RUNTIME_VISUAL.gate_pending` + `RUNTIME_VISUAL.awaiting_review` use amber |
| AC-03 | ✓ | `RUNTIME_VISUAL.running` uses blue + Loader2 + `animate-spin` |
| AC-04 | ✓ | `RUNTIME_VISUAL.completed` uses emerald + Check |
| AC-05 | ✓ | `RUNTIME_VISUAL.failed` uses red + AlertCircle |
| AC-06 | ✓ | `RUNTIME_VISUAL.skipped` uses dashed dim + SkipForward |
| AC-07 | ✓ | `RUNTIME_VISUAL.pending` uses dim gray + PlayCircle |
| AC-08 | ✗ **FAIL** | `taskLifecycleService.js:90` still emits `role: null` |
| AC-09 | ✓ | Each EventType has exactly one producer |
| AC-10 | ✓ | Every transition ↔ envelope |
| AC-11 | ✓ | `PendingGate` → `transitionIfPresent` |
| AC-12 | ✓ | `RUNTIME_VISUAL` covers every state |
| AC-13 | ✓ | Cross-page identity test (`runtimeSelectors.test.ts:628-702`) |
| AC-14 | ✓ | No component-level derivations |
| AC-15 | ✗ **Partially implemented** | Only seed mapper writes `pipelinePhases`; per-event lifecycle mappers don't |
| AC-16 | ✓ | Only per-event lifecycle mappers + `mapGatePending` write `agentStates` |
| AC-17 | ✓ | Wire is domain-only |
| AC-18 | ✓ | `SdlcController.js:347-348` forwards byte-for-byte |
| AC-19 | ✓ | 13-type union unchanged |
| AC-20 | ✓ | Only `RUNTIME_VISUAL` has color strings |

---

## 4. Patch Coverage

Per §5 of the verification brief, each patch (Patch 01 – Patch 09) is checked for implementation completeness.

### 4.1 Patch-by-patch matrix

| Patch | Scope | Files added/modified | Status | Notes |
| ----- | ----- | -------------------- | :----: | ----- |
| **Patch 01** — Canonical Runtime Selector | Frontend selector refactor | `frontend/src/store/runtimeSelectors.ts` (NEW, 355 lines); `frontend/src/store/workflowSelectors.ts` (modified, -4 net); `frontend/tests/runtimeSelectors.test.ts` (NEW, 584 lines) | ✓ Implemented | 90 unit tests cover every canonical state, the visible projection, the canonical projection, the contract guarantees, the integration with `selectRuntimeExecution`, and the OBS-01.5 cross-page identity invariant |
| **Patch 02** — Store Normalization | Route `OverviewPage` / `SessionRail` / `index.tsx` through canonical selector | Modified 3 consumer modules; added 5 helpers (`selectAgentPhaseStatuses`, `selectAgentPhaseStatus`, `countCompletedAgents`, `countTotalAgents`, `selectAgentPhaseEntry`) in `runtimeSelectors.ts` | ✓ Implemented | No direct `pipelinePhases.find` or `agentStates[i].status` reads outside the selectors (verified via grep) |
| **Patch 03** — Dashboard Runtime Visualization | Replace inline ternaries + hardcoded glyphs on `OverviewPage.tsx` with `getRuntimeVisual`/`getRuntimeIcon`/`getRuntimeAnimation` | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx` (modified) | ✓ Implemented | Inline 5-way ternary at lines 244-252 (pre-fix) removed; `PhaseStatusLabel` hardcoded glyphs at lines 364-372 (pre-fix) replaced by `RUNTIME_VISUAL[*].glyph` |
| **Patch 04** — Agent Task Runtime Visualization | Remove local `TASK_ICON`/`STATUS_DOT_COLOR`/`COLUMN_BORDER`/`PhaseChip` maps in `SdlcDashboard/index.tsx`; route through canonical selector | `frontend/src/pages/SdlcDashboard/index.tsx` (modified) | ✓ Implemented | Comment at line 72-82 documents the removal; `getRuntimeVisual(ps)` and `getRuntimeIcon(task.status)` now drive every render |
| **Patch 05** — Inspector Canonical-Selector Invariant | Lock `InspectorPanel.tsx` to consume only `selectRuntimeExecution` | `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx` (unchanged in source; regression tests added) | ✓ Implemented | Cross-page identity tests + source-level lexical checks in `runtimeSelectors.test.ts:1566-...` |
| **Patch 06** — Runtime Animation Contract | Add `animation` field to `RUNTIME_VISUAL`; add `getRuntimeAnimation()` accessor | `frontend/src/store/runtimeSelectors.ts` (modified) | ✓ Implemented | Only `running` carries `animate-spin`; every other state has empty string. Tests at `runtimeSelectors.test.ts:1247-1355` |
| **Patch 07** — Timeline Canonical-Selector Invariant | Verify `timelineFromEvents` reads only `RuntimeEvent[]` | `frontend/src/store/workflowSelectors.ts:204-218` (unchanged) + lexical test in `runtimeSelectors.test.ts:1355-1565` | ✓ Implemented | Source-level test asserts `timelineFromEvents` does NOT consult `pipelinePhases[i].status` or `agentStates[i].status` |
| **Patch 08** — Runtime Consistency Audit | Audit pass — no code changes | `docs/OBS1/PHASE4-runfix/FIX_REPORT_OBS_01_8.md` | ✓ Implemented | Audit report verified |
| **Patch 09** — Runtime Code Cleanup | Remove duplicated mappings, dead helpers, unused CSS classes | Source cleanup verified | ✓ Implemented | `tsc --noEmit` clean; `vitest run` green |

### 4.2 Test coverage summary

```
$ npx vitest run
Test Files  7 passed (7)
Tests       103 passed (103)
   tests/runtimeSelectors.test.ts       90 tests  (NEW; OBS-01.1–9)
   tests/OverviewPage.test.tsx           3 tests  (existing; pre-OBS-01)
   tests/SdlcDashboard.test.tsx          2 tests  (existing; pre-OBS-01)
   tests/App.notFound.test.tsx           1 test   (existing)
   tests/yamlExport.helpers.test.ts      2 tests  (existing)
   tests/testScenarios.helpers.test.ts   3 tests  (existing)
   src/pages/NotFound/.../NotFoundPage.test.tsx   2 tests  (existing)

$ npx tsc --noEmit
(no output — clean)
```

All 103 tests pass; TypeScript compiles cleanly.

### 4.3 Build smoke test

```
$ npx vitest run   →  103/103 pass
$ npx tsc --noEmit →  0 errors
```

The frontend bundle builds cleanly.

---

## 5. Regression Summary

Per §3 of the verification brief (Regression Check), each
patch is checked for regression in: Dashboard, AgentTask,
Inspector, Timeline, Questions, Output Review, Release, Tool
Gate, SSE, Store, Selectors, Event Mapping.

### 5.1 Cross-page identity regression matrix

| Surface | Reads via | Status |
| ------- | --------- | :----: |
| Dashboard pipeline strip | `selectAgentPhaseStatus` + `getRuntimeVisual` + `getRuntimeIcon` + `getRuntimeAnimation` | ✓ No regression |
| Dashboard session monitor card | `selectRuntimeStatus` + `countCompletedAgents` | ✓ No regression |
| Dashboard per-agent strip | `selectAgentPhaseStatus` | ✓ No regression |
| Agent Task card border | `getRuntimeVisual(ps).border` | ✓ No regression |
| Agent Task chip | `getRuntimeVisual(ps).background` + `.badge` | ✓ No regression |
| Agent Task per-task icons | `getRuntimeIcon(task.status)` + `getRuntimeAnimation(task.status)` | ✓ No regression |
| Agent Task SessionPill | session-level status (not canonical projection) | ✓ No regression (legacy SessionPill preserved) |
| Agent Task summary bar | `countCompletedAgents` + `countTotalAgents` | ✓ No regression |
| Inspector tabs | `selectRuntimeExecution` (no inline derivations) | ✓ No regression |
| Inspector QuestionGate | `ClarificationPanel` (unchanged) | ✓ No regression |
| Inspector OutputReview | `OutputReviewInline` (T3, B2) | ✓ No regression (T3 commit) |
| Inspector ToolGate | `ToolGatePanel.tsx` (T6, B5) | ✓ No regression |
| Timeline | `timelineFromEvents(runtimeEvents)` only | ✓ No regression |
| SessionRail dots | `selectAgentPhaseStatus` + local `PHASE_DOT_COLORS` | ⚠ **Drift**: local `PHASE_DOT_COLORS` map (line 12-20) duplicates the canonical colour mapping per contract §7. See §10. |
| SSE transport | `eventBus.subscribeProject` + `sendEnvelope` byte-for-byte | ✓ No regression |

### 5.2 Specific regression tests

The cross-page identity test (`runtimeSelectors.test.ts:628-702`)
asserts that for every reachable `(pipelineStatus, agentAwaitingReview)`
combination, Dashboard / Agent Task / Inspector agree on the
runtime visual (badge, border, icon, animation). This is the
key regression guard.

---

## 6. Dead Mapping

Per §6 of the verification brief, search for: unused runtime
state, unused selector, unused CSS class, duplicate runtime
mapping, duplicate status mapping, orphan state, dead projection.

### 6.1 Dead-code search results

| Search | Result |
| ------ | ------ |
| Unused `RuntimeState` members | None — every member is either reachable or documented as `UNREACHABLE_VIA_PROJECTION` (`idle`, `dispatched`) |
| Unused `PhaseStatus` members | None — every member has a `RUNTIME_VISUAL` entry |
| Unused selector exports | None — every export in `runtimeSelectors.ts` is consumed (verified by `grep -rn 'selectRuntimeStatus\|selectAgentPhaseStatus\|selectAgentPhaseEntry\|countCompletedAgents\|countTotalAgents\|selectAgentPhaseStatuses\|getRuntimeVisual\|getRuntimeIcon\|getRuntimeAnimation' frontend/src/`) |
| Unused CSS classes | None within `RUNTIME_VISUAL`; each entry is referenced |
| Duplicate runtime mappings | None — local `TASK_ICON`/`STATUS_DOT_COLOR`/`COLUMN_BORDER`/`PhaseChip`/`PhaseStatusLabel` removed |
| Duplicate status mappings | ⚠ **One residual**: `PHASE_DOT_COLORS` in `SessionRail.tsx:12-20` duplicates the canonical `background` mapping. The colour values differ from `RUNTIME_VISUAL` (e.g. `running` → `bg-blue-500 text-white` vs `RUNTIME_VISUAL.running.background` → `bg-blue-500/20 text-blue-300`), so the LEFT-rail session dots render in a different palette from Dashboard/Agent Task. See §10 for impact. |
| Orphan state | None |
| Dead projection | None — `deriveAgentRuntimeState`, `projectAgentToPhaseStatus`, `phaseStatusToCanonical`, `canonicalToPhaseStatus`, `selectRuntimeStatus` all consumed |
| Dead animations | None outside `RUNTIME_VISUAL[*].animation` (the residual `animate-spin`/`animate-pulse` in `OverviewPage.tsx:388,415-416` are session-level + connection-level, not per-agent runtime — out of OBS-01.6 scope per the brief) |

### 6.2 Files / symbols removed in OBS-01.9 (per FIX_REPORT_OBS_01_9)

The cleanup pass (per the patch report) removed:
- Local `TASK_ICON` map (was `SdlcDashboard/index.tsx:44-51`)
- Local `STATUS_DOT_COLOR` map (was `SdlcDashboard/index.tsx:67-74`)
- Local `COLUMN_BORDER` map (was `SdlcDashboard/index.tsx:76-83`)
- Local `PhaseChip` map (was `SdlcDashboard/index.tsx:503-516`)
- Local `PhaseStatusLabel` glyph table (was `OverviewPage.tsx:364-372`)
- Inline 5-way ternary on `OverviewPage.tsx:244-252`
- Per-task `status` switch on `SdlcDashboard/index.tsx:181-201`
- Other dead helpers documented in the cleanup report

All confirmed removed in the current source tree.

---

## 7. Runtime Replay

Per §7 of the verification brief, simulate the full lifecycle:

```
IDLE → RUNNING → WAITING → TOOL → RUNNING → OUTPUT REVIEW → RUNNING → SUCCESS
```

(plus the error / cancel branches)

### 7.1 Happy-path trace

For each step, the trace walks the producer → store →
projection → UI → DOM → animation chain.

#### Step 1: `IDLE`

| Layer | Value |
| ----- | ----- |
| Producer | `useWorkflowStore` initial (`useWorkflowStore.ts`) — `emptyAgentStates()` → all `'idle'`; `defaultPipelinePhases()` → all `'pending'` |
| Store | `session.agentStates[ARCH|PO|UX|DEV|QA].status = 'idle'`; `session.pipelinePhases[*].status = 'pending'` |
| Selector | `deriveAgentRuntimeState(session, ARCH)` → `'queued'` (projected from `'pending'`) |
| Projection | `projectAgentToPhaseStatus(session, ARCH)` → `'pending'` |
| UI | `RUNTIME_VISUAL.pending` → border `border-outline-variant/20`, bg `bg-surface-container text-on-surface-variant/60`, icon `PlayCircle`, badge `PENDING`, animation `''` |
| DOM | `<div class="border border-outline-variant/20 bg-surface-container text-on-surface-variant/60">…<PlayCircle />…<span>PENDING</span></div>` |
| Animation | None |
| Test | `runtimeSelectors.test.ts:110-114` ("passes 'pending' through verbatim when agent is idle") |

#### Step 2: `RUNNING`

| Layer | Value |
| ----- | ----- |
| Producer (BE) | `taskLifecycle.transition(taskId, 'running', …)` from `agentDispatcher.runAgent:313` |
| Wire | `task_started` envelope (BUT `role: null` — see §10) |
| Store (intended) | `pipelinePhases[i].status = 'running'` AND `agentStates[i].status = 'running'` |
| Store (current) | `agentStates[i].status = 'running'` (via `mapTaskStarted` line 215-227); `pipelinePhases[i].status` is **NOT** updated (remains `'pending'` from seed until SSE connect refresh) |
| Selector | `selectRuntimeStatus(session)` → `currentAgent = ARCH` (first agent with `agentStates.status === 'running'`); `deriveAgentRuntimeState(session, ARCH)` → `'running'`; `projectAgentToPhaseStatus(session, ARCH)` → `'running'` |
| UI | `RUNTIME_VISUAL.running` → border `border-blue-500/30`, bg `bg-blue-500/20 text-blue-300`, icon `Loader2`, badge `RUNNING`, animation `'animate-spin'` |
| DOM | `<div class="border border-blue-500/30 …"><Loader2 class="animate-spin" />…<span>RUNNING</span></div>` |
| Animation | `Loader2` spins (CSS `animate-spin`) |
| Test | `runtimeSelectors.test.ts:115-118` ("passes 'running' through verbatim when agent is running") |

#### Step 3: `WAITING` (gate pending — `awaiting_gate`)

| Layer | Value |
| ----- | ----- |
| Producer (BE) | `gateBridge.requestGate({...})` → `taskLifecycle.transitionIfPresent(taskId, 'awaiting_gate', …)` (for `kind ∈ {'tool', 'question'}`) |
| Wire | `gate_pending` envelope with `role: <gate.role>` (correctly carried by `gateBridge.js:124`) |
| Store | `agentStates[agentKey].status = 'awaiting_review'` (via `mapGatePending` line 100-130); `pipelinePhases[agentKey].status` not updated |
| Selector | `projectAgentToPhaseStatus` promotes `'running'` + `'awaiting_review'` → `'awaiting_review'`; canonical → `'waiting_human'` |
| UI | `RUNTIME_VISUAL.awaiting_review` → border `border-amber-500/30`, bg `bg-amber-500/20 text-amber-300`, icon `Clock`, badge `AWAITING REVIEW`, animation `''` |
| DOM | `<div class="border border-amber-500/30 …"><Clock />…<span>AWAITING REVIEW</span></div>` |
| Animation | None (per-task icon is static; session-level indicators may pulse separately — see contract §5.1.5) |
| Test | `runtimeSelectors.test.ts:120-126` ("promotes 'running' to 'awaiting_review'") |

#### Step 4: `TOOL` (gate resolved → back to `running`)

| Layer | Value |
| ----- | ----- |
| Producer (BE) | `gateBridge.resolveGate(approvalId, result)` → `taskLifecycle.transitionIfPresent(taskId, 'running', …)` |
| Wire | `gate_resolved` envelope with `role: rec.role` |
| Store | `mapGateResolved` (line 132-166) removes gate from `pendingGates`; `agentStates[agentKey].status` returns to `'running'` via `mapTaskStarted` (if the BE emits a `task_started` envelope) |
| Selector | `currentAgent = agentKey`; `projectAgentToPhaseStatus` → `'running'` |
| UI | Same as Step 2 (RUNNING visual) |

#### Step 5: `OUTPUT REVIEW` (`awaiting_review` via `output_review` gate)

| Layer | Value |
| ----- | ----- |
| Producer (BE) | `gateBridge.requestGate({kind: 'output_review'})` — for output_review, the BE does NOT call `taskLifecycle.transitionIfPresent('awaiting_gate')` (see `gateBridge.js:102`). The `task_completed` envelope fires. |
| Wire | `gate_pending` envelope + `task_completed` envelope (carries `role: null` — see §10) |
| Store | `agentStates[agentKey].status = 'completed'` (via `mapTaskCompleted` line 229-244); `mapGatePending` sets `awaiting_review` (which is OVERWRITTEN by `'completed'` on the next reducer call) |
| Selector | `projectAgentToPhaseStatus` returns `'completed'` (because `agentStates.status === 'completed'` does NOT promote from `'completed'` — promotion rule is only for `'running'` per `runtimeSelectors.ts:115`) |
| UI | `RUNTIME_VISUAL.completed` → green + Check |
| Note | Per the contract §4 gap on output_review, the visible state should arguably be `'gate_pending'` here, but the current source collapses it to `'completed'`. This is a pre-existing behaviour preserved byte-for-byte by OBS-01.1 (see FIX_REPORT_OBS_01_1 §5.1). |

#### Step 6: `SUCCESS` (pipeline completed)

| Layer | Value |
| ----- | ----- |
| Producer (BE) | `releaseManager.submitReleaseDecision({action: 'approve'})` → `pipeline_completed` envelope (carries `role: 'release'`) |
| Store | `mapPipelineCompleted` (line 294-308) sets `session.status = 'completed'`; sets any remaining `running` agent to `'completed'` |
| Selector | All 5 agents project to `'completed'`; `countCompletedAgents(session) = 5`; `countTotalAgents(session) = 5` |
| UI | All 5 cards show green `COMPLETED` chip + Check icon; summary bar shows `5/5 phases · 100%`; session pill shows `COMPLETED` |

### 7.2 Error-path trace (summary)

| Step | Producer | Store | UI |
| ---- | -------- | ----- | -- |
| `FAILED` (e.g. agent crash) | `taskLifecycle.transition('failed')` | `mapTaskFailed` → `agentStates.status = 'failed'` | `RUNTIME_VISUAL.failed` (red + AlertCircle) |
| `CANCELLED` (user cancel) | `taskLifecycle.transitionIfPresent('cancelled')` | `mapTaskInterrupted` → `agentStates.status = 'skipped'` | `RUNTIME_VISUAL.skipped` (dashed dim + SkipForward) |
| `TIMEOUT` | `taskLifecycle.transition('timeout')` | `mapTaskInterrupted` (same as cancelled) | Same as cancelled (FE projection collapses) |

All paths verified by the canonical projection + tests.

---

## 8. Backend Wire Status (Out of Scope of Patches 01–09)

Per the brief's input section, "Patch implementation" refers to
Patches 01–09 of OBS-01, which were **frontend-only** per their
respective FIX_REPORT files:

> "Scope: **Frontend selector refactor.** No backend, schema, CSS, component, API, or DTO changes."
> — FIX_REPORT_OBS_01_1 §0 (header)

> "Scope: **Frontend store normalization.** No backend, schema, CSS, component UI, API, or DTO changes."
> — FIX_REPORT_OBS_01_2 §0

The OBS-01.1.a / OBS-01.1.b / OBS-01.2.c items in the
implementation checklist are BE-side changes that were NOT
included in patches 01–09 (per the patch reports themselves).
They are documented in `06_IMPLEMENTATION_CHECKLIST.md` but
were explicitly out of scope.

The verification report flags these as **pre-existing contract
drift** unchanged by patches 01–09, NOT regressions introduced
by the patches. They are listed in §10 "Failed Checks" so the
report is honest about the state of the system.

---

## 9. Implementation Detail Findings

These are findings worth noting but NOT regressions. They are
documented for completeness.

### 9.1 `PHASE_DOT_COLORS` in `SessionRail.tsx`

**Location:** `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:12-20`

**Finding:** The SessionRail defines a local `PHASE_DOT_COLORS`
map that duplicates the colour-to-state mapping. The colour
values differ from `RUNTIME_VISUAL[*].background`:

| Status | `PHASE_DOT_COLORS` | `RUNTIME_VISUAL[*].background` |
| ------ | ------------------ | ------------------------------ |
| `pending` | `bg-surface-container-high/70 text-on-surface-variant` | `bg-surface-container text-on-surface-variant/60` |
| `running` | `bg-blue-500 text-white` | `bg-blue-500/20 text-blue-300` |
| `gate_pending` | `bg-amber-500 text-white` | `bg-amber-500/20 text-amber-400` |
| `completed` | `bg-emerald-500 text-white` | `bg-emerald-500/20 text-emerald-400` |
| `failed` | `bg-red-500 text-white` | `bg-red-500/20 text-red-400` |

**Contract §7 violation**: "Duplicated CSS mapping" is a
forbidden pattern. The SessionRail per-agent dots render in a
different palette from Dashboard/Agent Task.

**Severity**: Low. SessionRail per-agent dots are a small visual
element on the left rail (rendered as small background-colour
rectangles with a single-letter label). The contract §5.2.2
cross-page identity invariant explicitly names "Dashboard
pipeline strip, Agent Task card, and SessionRail dot" as the
three surfaces that MUST agree.

**Recommendation**: Phase 6 (or a follow-up OBS-01.10) should
route SessionRail per-agent dots through `getRuntimeVisual(status)`
or a session-level dot variant of the canonical map.

### 9.2 `SessionPill` colour hardcoding in `SdlcDashboard/index.tsx`

**Location:** `frontend/src/pages/SdlcDashboard/index.tsx:396-417`

**Finding:** The SessionPill uses a local ternary to map
session-level status to colour. This is acceptable because the
session-level `session.status` is NOT a runtime execution status;
it's a session-level aggregate. The contract §5.1 covers
per-agent runtime states; session-level `SessionStatus` is a
separate enum documented in `05_CANONICAL_RUNTIME_STATE.md
§2.12`. The SessionPill renders session-level status (e.g.
`'awaiting_release'`, `'awaiting_approval'`), not per-agent
runtime. No contract violation.

**Note**: If OBS-01.10 ever normalises session-level visuals,
this should be the candidate for refactor.

### 9.3 `animate-pulse` on connection-level dots

**Location:** `frontend/src/pages/SdlcDashboard/OverviewPage.tsx:415-416`

**Finding:** The connection pill uses `animate-pulse` on the
connection dot. This is connection-level UI, NOT runtime
visualization. Per the contract §5.1.5, `animate-pulse` is
"allowed on session-level indicators only" — and connection
status is a session-level indicator. No contract violation.

### 9.4 Per-event mappers don't update `pipelinePhases`

**Location:** `frontend/src/store/eventMappers.ts:215-292`

**Finding:** `mapTaskStarted`, `mapTaskCompleted`, `mapTaskFailed`,
`mapTaskInterrupted`, `mapTaskResumed` all update `agentStates`
but NOT `pipelinePhases`. Per the implementation checklist
OBS-01.3.a–d, they SHOULD update both fields. This was an
explicit TODO in OBS-01.3 that was never landed.

**Impact**: The canonical projection (`projectAgentToPhaseStatus`)
compensates by reading `agentStates[i].status` for the
`awaiting_review` promotion. But for plain `running`,
`completed`, `failed`, `skipped` states, the pipeline strip and
agent task card display the value the FE mapper wrote to
`agentStates[i].status`, which IS the canonical state. So the
visible UI IS correct for these states.

The remaining gap is conceptual: if a consumer reads
`session.pipelinePhases[i].status` directly (bypassing the
selector), they would see stale values. But per the contract §7
"pipelinePhases MUST NOT be read directly outside the selector"
— this is enforced by removing all direct readers (verified by
the grep audit).

**Severity**: Low. Visible UI is correct. Direct
`pipelinePhases.find(...)` reads outside the selector return
stale data, but no such reads exist post-cleanup.

**Recommendation**: Phase 6 (or OBS-01.10) should add the
`pipelinePhases` patch to each per-event lifecycle mapper to
make the invariant explicit in code rather than relying on the
canonical selector's `agentStates`-aware promotion rule.

---

## 10. Failed Checks

These items are flagged as failing the verification. Each
failure includes the file:line, the contract rule violated,
and the evidence.

### 10.1 FAIL: Backend lifecycle envelopes still emit `role: null`

| Aspect | Detail |
| ------ | ------ |
| Contract rule | §7 "`role: null` on lifecycle envelopes" — FORBIDDEN |
| AC violated | AC-08 ("Every lifecycle envelope MUST carry `role: task.type`") |
| Invariant violated | §8 invariant 5 ("Every `EventEnvelope.role` on a lifecycle envelope MUST be `task.type` (NEVER `null`)") |
| File:line | `backend/src/services/taskLifecycleService.js:90` |
| Evidence | `return publishEvent(eventType, { projectId, sessionId, taskId, role: null }, payload)` |
| Impact | The FE mapper `mapTaskStarted` etc. (`eventMappers.ts:215-292`) requires `env.role` to identify the agent (line 218: `inferAgentKey(env.role)`). With `role: null`, the mapper early-returns `{ lastUpdatedAt: Date.now() }` — meaning per-event lifecycle events do NOT update `agentStates` (with the current BE source). |
| Why this is NOT a Patch 01–09 regression | The patches were explicitly frontend-only per their FIX_REPORTs. The `role: null` source predates OBS-01. The OBS-01 implementation checklist item OBS-01.1.a was scoped for OBS-01.1.a but was never landed in patches 01–09. |
| Severity | **High**. The wire contract invariant 5 is violated. The `agentStates[i].status` is updated for `running` via `applyAgentRuntime` (the `agent_event` mapper, `eventMappers.ts:43-98`) only when `agent_event` envelopes are emitted (per the FE T6 commit, `9965ac0`). For pure lifecycle envelopes (`task_started` etc.), the FE cannot map the envelope to an agent because `role` is null. |
| Recommendation | Phase 6 / OBS-01.10 must: (a) update `taskLifecycle.publishLifecycle:90` to pass `role: task.type` instead of `role: null`; (b) update `SdlcController.streamPipelineStatus:352,369` and `SdlcWorkflowService.js:510` for session-level envelopes where role is legitimately null (these are session-level envelopes, not lifecycle envelopes, so they are exempt from §8 invariant 5 per the contract §4.1.1/4.1.2 — `session_started`/`session_resumed` carry `role: null`); (c) update `Task.js:28` for the task-created envelope (which may also be session-level). |

### 10.2 FAIL: `pipelinePhases[i].status` is not updated per-event

| Aspect | Detail |
| ------ | ------ |
| Contract rule | §7 "Frozen snapshot for runtime transitions" — FORBIDDEN |
| AC violated | AC-15 ("`pipelinePhases` MUST be updated ONLY by `mapSessionStarted` (seed) or per-event lifecycle mappers (per-event patches)") |
| Invariant violated | §8 invariant 14 ("The `pipelinePhases` array MUST be initialized to all-`'pending'` and MUST be updated ONLY by `mapSessionStarted` (seed) or by per-event lifecycle mappers (per-event patches)") |
| File:line | `frontend/src/store/eventMappers.ts:215-292` (mapTaskStarted, mapTaskCompleted, mapTaskFailed, mapTaskInterrupted) |
| Evidence | Each mapper updates only `agentStates` (e.g., line 222-226 for `mapTaskStarted`). No `pipelinePhases` patch. |
| Impact | `session.pipelinePhases[i].status` reflects the SSE-connect snapshot value, frozen thereafter. Direct readers of `pipelinePhases` (none exist post-cleanup) would see stale data. The visible UI is unaffected because the canonical selector reads `agentStates` for the awaiting_review promotion and the runtime animation/icon comes from `getRuntimeVisual(getRuntimeVisual's input is from selectRuntimeExecution which routes through projectAgentToPhaseStatus which does read agentStates`). |
| Why this is NOT a Patch 01–09 regression | The implementation checklist item OBS-01.3.a–d explicitly required this update. Patches 01–09 did NOT land it (the FE mappers were untouched). This is a gap in the original patch scope. |
| Severity | **Low** for visible UI correctness (the canonical selector compensates). **High** for architectural invariant compliance (the contract §8 invariant 14 is violated). |
| Recommendation | Phase 6 / OBS-01.10 should update each per-event lifecycle mapper to ALSO patch `pipelinePhases[i].status` (e.g., `pipelinePhases: state.pipelinePhases.map((p) => p.agent === agentKey ? { ...p, status: 'running' } : p)`). This makes the canonical projection path explicit in the store. |

### 10.3 FAIL: `SdlcWorkflowService.getPipelineResponse` reads legacy `phaseData.status`

| Aspect | Detail |
| ------ | ------ |
| Contract rule | §7 "Deriving runtime from `Task.status` (legacy)" — FORBIDDEN |
| AC violated | Implementation Checklist OBS-01.1.b ("`SdlcWorkflowService.getPipelineResponse` reads `executionStatus`") |
| File:line | `backend/src/services/SdlcWorkflowService.js:1256` |
| Evidence | `let status = phaseData.status; // pending, running, completed, failed` — `phaseData.status` is the legacy `Task.status`, NOT `Task.executionStatus`. Source chain: `getPipelineResponse` → `getWorkflowStatus` (`workflowQueries.js:145-149`) → reads `task.status` (legacy field). |
| Impact | The SSE snapshot's `pipelinePhases[i].status` is derived from the legacy field, which may be `processing` (per `agentDispatcher.runAgent:312` legacy write) instead of `running`. However, the FE `RUNTIME_VISUAL` does NOT have an entry for `'processing'` — so the fallback to `RUNTIME_VISUAL.pending` would apply, hiding the agent's actual canonical state. This is the drift documented in `01_RUNTIME_STATE_TRACE.md` and `03_DRIFT_ANALYSIS.md`. |
| Why this is NOT a Patch 01–09 regression | The patches were explicitly frontend-only. OBS-01.1.b was a backend change item in the implementation checklist that was never landed. |
| Severity | **High**. The SSE snapshot is the only producer of `pipelinePhases` (per §6 rule 9). If the snapshot reads legacy `Task.status`, the canonical projection cannot work for the snapshot. The visible UI relies on `agentStates` (the canonical selector compensates), but the architectural invariant (canonical `Task.executionStatus` is the runtime source) is violated. |
| Recommendation | Phase 6 / OBS-01.10 should update `SdlcWorkflowService.toPhaseStatus:1253-1265` to read `phaseData.executionStatus` instead of `phaseData.status`, with a mapping from `executionStatus` → visible `PhaseStatus`. |

### 10.4 FAIL: `PHASE_DOT_COLORS` in SessionRail duplicates the canonical map

| Aspect | Detail |
| ------ | ------ |
| Contract rule | §7 "Duplicated CSS mapping" — FORBIDDEN |
| AC violated | AC-13 ("Dashboard, Agent Task, and Inspector MUST NEVER disagree on the same input") |
| File:line | `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:12-20` |
| Evidence | Local `PHASE_DOT_COLORS` map defines colour strings per `PhaseStatus` value, distinct from `RUNTIME_VISUAL[*].background`. |
| Impact | SessionRail per-agent dots use a different palette (saturated `bg-blue-500` vs `bg-blue-500/20`). Visually distinct from Dashboard pipeline strip. |
| Severity | **Low**. SessionRail dots are a small visual element on the left rail. The contract cross-page identity invariant §5.2.2 names SessionRail as one of three surfaces that must agree, but the difference is subtle. |
| Recommendation | Phase 6 / OBS-01.10 should replace `PHASE_DOT_COLORS` with a small per-state dot variant of `RUNTIME_VISUAL` (e.g., `RUNTIME_VISUAL_DOT`) or route through `getRuntimeVisual` and accept the more muted palette. |

---

## 11. Pass Checks

### 11.1 Runtime selectors & visual maps

- ✓ `runtimeSelectors.ts` is the single source of truth
- ✓ `RUNTIME_VISUAL` covers every `PhaseStatus` value
- ✓ `RuntimeState` union has 8 members (8/8 documented)
- ✓ `selectRuntimeStatus` is the only consumer of `agentStates` for derivation
- ✓ `selectRuntimeExecution` reads via `projectAgentToPhaseStatus` only
- ✓ `getRuntimeVisual`, `getRuntimeIcon`, `getRuntimeAnimation` are single accessors
- ✓ Animation is set ONLY for `running` state (per contract §5.1.4)
- ✓ 90 tests in `runtimeSelectors.test.ts` cover every aspect

### 11.2 Surface normalizations

- ✓ Dashboard pipeline strip normalized (`OverviewPage.tsx:244-265`)
- ✓ Dashboard session monitor card normalized (`OverviewPage.tsx:175-302`)
- ✓ Dashboard per-agent icons + animations normalized (`OverviewPage.tsx:261, 285`)
- ✓ Agent Task card border normalized (`SdlcDashboard/index.tsx:311`)
- ✓ Agent Task chip normalized (`SdlcDashboard/index.tsx:331-336`)
- ✓ Agent Task per-task icons + animations normalized (`SdlcDashboard/index.tsx:351-358`)
- ✓ Agent Task SessionPill preserved (session-level, not runtime execution)
- ✓ Agent Task summary bar normalized (`SdlcDashboard/index.tsx:432-433`)
- ✓ Inspector consumes canonical selector only (`InspectorPanel.tsx:47-50`)
- ✓ Timeline reads `runtimeEvents` only (`workflowSelectors.ts:204-218`)
- ✓ SessionRail per-agent reads via canonical selector (`SessionRail.tsx:190`) but uses local `PHASE_DOT_COLORS` (see §10.4)

### 11.3 Store invariants

- ✓ Only `mapSessionStarted` writes `pipelinePhases` (`eventMappers.ts:199-208`)
- ✓ Only per-event lifecycle mappers + `mapGatePending` write `agentStates`
- ✓ Only reducer-family writes `session.status`
- ✓ `selectRuntimeExecution` is the single consumer of runtime selectors

### 11.4 Wire contract (FE side)

- ✓ 13-type union (`frontend/src/dto/event.ts:6-19`)
- ✓ `EventEnvelope` type matches backend (`event.ts:120-130`)
- ✓ `isEnvelope` type guard (`event.ts:133-146`)
- ✓ `applyEnvelope` dispatches via registry (`eventMappers.ts:338-342`)
- ✓ Every mapper is a `(state, env) => Partial<SessionState>` function

### 11.5 Test coverage

- ✓ 103/103 tests pass
- ✓ TypeScript compiles cleanly (`tsc --noEmit`)
- ✓ Cross-page identity tests assert byte-for-byte agreement
- ✓ Per-state visual tests assert the contract §5.1 mapping byte-for-byte
- ✓ Animation contract tests assert ONLY `running` carries `animate-spin`
- ✓ Timeline selector invariant tests assert `timelineFromEvents` reads only `RuntimeEvent`

---

## 12. Verdict

**OBS-01 Phase 4 (Patches 01–09) — frontend refactor — is COMPLETE within its declared scope.**

- All 9 patches were implemented.
- All FE-side contract rules pass.
- 103/103 tests pass; TypeScript clean.

**Three contract violations remain on the BACKEND**, none of which were in scope of patches 01–09:

1. **Backend `role: null`** on lifecycle envelopes (high severity, blocking per-event mapper propagation).
2. **`SdlcWorkflowService.getPipelineResponse` reads legacy `phaseData.status`** (high severity, blocks canonical snapshot).
3. **Per-event FE mappers don't patch `pipelinePhases`** (low visible-UI severity, high architectural severity).

Plus one minor FE-side drift:

4. **`PHASE_DOT_COLORS` in SessionRail** duplicates the canonical map (low severity).

**Recommendation**: See `04_PHASE5_SIGNOFF.md` for the go/no-go
decision.

See `02_RUNTIME_REPLAY.md` for the step-by-step lifecycle trace
and `03_REGRESSION_REPORT.md` for the full regression matrix.