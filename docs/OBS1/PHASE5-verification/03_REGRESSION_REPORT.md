# OBS-01 Phase 5 — Regression Report

> **Status:** VERIFICATION ONLY. No production code was modified.
> **Purpose:** Enumerate every potential regression introduced
> by Patches 01–09 of OBS-01, with severity, evidence, risk,
> and owner columns.

---

## 1. Regression Matrix

| # | Surface | Patch | Severity | Evidence | Risk | Owner |
| - | ------- | ----- | :------: | -------- | ---- | ----- |
| R-01 | Dashboard pipeline strip | Patch 03 | None | `OverviewPage.tsx:244-265` reads via `selectAgentPhaseStatus` + `getRuntimeVisual` + `getRuntimeIcon` + `getRuntimeAnimation`. No inline ternary remains. | — | Frontend |
| R-02 | Dashboard session monitor card | Patch 02 | None | `OverviewPage.tsx:190, 197-200` reads via `countCompletedAgents` + `selectRuntimeStatus`. No inline derivation remains. | — | Frontend |
| R-03 | Dashboard per-agent strip (running/reviewing indicators) | Patch 03 | None | `OverviewPage.tsx:280-302` reads via `getRuntimeVisual('running')` / `getRuntimeVisual('awaiting_review')` + `getRuntimeIcon` + `getRuntimeAnimation`. No hardcoded color/icon. | — | Frontend |
| R-04 | Agent Task card border | Patch 04 | None | `SdlcDashboard/index.tsx:311, 319` reads via `getRuntimeVisual(ps).border`. | — | Frontend |
| R-05 | Agent Task chip | Patch 04 | None | `SdlcDashboard/index.tsx:331-336` reads via `getRuntimeVisual(ps).background` + `.badge`. | — | Frontend |
| R-06 | Agent Task per-task icons + animation | Patch 04, Patch 06 | None | `SdlcDashboard/index.tsx:351-358` reads via `getRuntimeVisual(task.status)` + `getRuntimeIcon(task.status)` + `getRuntimeAnimation(task.status)`. | — | Frontend |
| R-07 | Agent Task SessionPill | (unchanged) | None | Session-level status is a separate enum from per-agent runtime. The SessionPill is preserved. | — | Frontend |
| R-08 | Agent Task summary bar | Patch 02 | None | `SdlcDashboard/index.tsx:432-433` reads via `countCompletedAgents` + `countTotalAgents`. | — | Frontend |
| R-09 | Inspector tabs (rendering) | Patch 05 | None | `InspectorPanel.tsx:47-50` consumes `selectRuntimeExecution`. Inspector renders gates, not agent state. Per the contract §5.1.5, this is correct. | — | Frontend |
| R-10 | Inspector QuestionGate (Clarification) | (unchanged) | None | `InspectorPanel.tsx:142-198` (QuestionsTab). Unchanged. | — | Frontend |
| R-11 | Inspector OutputReview | (T3, B2 commit) | None | `OutputReviewInline` integration in `InspectorPanel.tsx` is from the T3 commit, not OBS-01. | — | Frontend |
| R-12 | Inspector ToolGate | (T6, B5 commit) | None | `ToolGatePanel.tsx` was added in the T6 commit, not OBS-01. | — | Frontend |
| R-13 | Inspector Decisions history | (unchanged) | None | `InspectorPanel.tsx:114` (DecisionsTab). Unchanged. | — | Frontend |
| R-14 | Timeline rendering | Patch 07 | None | `workflowSelectors.ts:204-218` (`timelineFromEvents`) reads `RuntimeEvent[]` only. Verified by lexical test `runtimeSelectors.test.ts:1355-1565`. | — | Frontend |
| R-15 | SessionRail per-agent dot | Patch 02 + Drift | Low | `SessionRail.tsx:190` reads via `selectAgentPhaseStatus` (correct). BUT `SessionRail.tsx:12-20` defines a local `PHASE_DOT_COLORS` map that DUPLICATES the canonical `RUNTIME_VISUAL` mapping. The colours differ (e.g., `running` → `bg-blue-500 text-white` vs `RUNTIME_VISUAL.running.background` → `bg-blue-500/20 text-blue-300`). | Cross-page identity drift (contract §5.2.2, §7). | Frontend (Phase 6 / OBS-01.10) |
| R-16 | SSE transport (live) | (unchanged) | None | `eventBus.subscribeProject` + `sendEnvelope` byte-for-byte. `SdlcController.js:299-303`. | — | Backend |
| R-17 | SSE replay (resume) | (unchanged) | None | `SdlcController.js:341-358` forwards `row.envelope` byte-for-byte. | — | Backend |
| R-18 | Store — `session.pipelinePhases` | (unchanged) | None | Only `mapSessionStarted` writes. All other reducers use the agent-states-derived canonical projection. | — | Frontend |
| R-19 | Store — `session.agentStates` | (unchanged) | None | Only per-event lifecycle mappers + `mapGatePending` write. | — | Frontend |
| R-20 | Store — `session.status` | (unchanged) | None | Only `mapSessionStarted`, `mapGatePending`, `mapGateResolved`, `mapPipelineCompleted`, `mapPipelineFailed`. | — | Frontend |
| R-21 | Selectors — `selectRuntimeExecution` | Patch 01 | None | `workflowSelectors.ts:220-313` reads via canonical selector. | — | Frontend |
| R-22 | Selectors — `selectRuntimeStatus` | Patch 01 | None | `runtimeSelectors.ts:299-322`. | — | Frontend |
| R-23 | Event Mapping — per-event lifecycle mappers | (unchanged) | **Low** | `eventMappers.ts:215-292` updates `agentStates` but NOT `pipelinePhases`. This is a pre-existing gap from the OBS-01.3 checklist that was never landed. | Architectural invariant §8/14 (low visible-UI impact). | Frontend (Phase 6 / OBS-01.10) |
| R-24 | Backend — lifecycle envelope `role: null` | (pre-existing, out of scope) | **High** | `taskLifecycleService.js:90` still emits `role: null`. AC-08 violation. The FE mapper cannot resolve `env.role` to an agent and early-returns. | Blocks per-event lifecycle propagation (mitigated by `agent_event` envelopes from T6 commit, but the canonical `task_*` envelopes cannot drive `agentStates`). | Backend (Phase 6 / OBS-01.10) |
| R-25 | Backend — snapshot reads legacy `phaseData.status` | (pre-existing, out of scope) | **High** | `SdlcWorkflowService.js:1256` reads `phaseData.status` (legacy `Task.status`), not `phaseData.executionStatus`. Implementation Checklist OBS-01.1.b was never landed. | SSE snapshot's `pipelinePhases[i].status` may be `'processing'` instead of `'running'` — the FE's `RUNTIME_VISUAL` has no entry for `'processing'`, so the snapshot falls back to dim gray. | Backend (Phase 6 / OBS-01.10) |

---

## 2. Severity rubric

- **None**: no regression; behaviour preserved or improved.
- **Low**: minor visible or architectural drift; does not break
  user-visible behaviour.
- **Medium**: visible drift or invariant violation; user-visible
  impact is bounded.
- **High**: contract violation with user-visible impact OR
  blocking invariant violation.

---

## 3. High-severity findings (must address)

### 3.1 R-24 — Backend `role: null`

| Aspect | Detail |
| ------ | ------ |
| Contract rule | §7 "`role: null` on lifecycle envelopes" — FORBIDDEN |
| AC violated | AC-08 |
| Evidence | `backend/src/services/taskLifecycleService.js:90` |
| Risk | The wire `task_started` / `task_completed` / `task_failed` / `task_interrupted` envelopes cannot be routed to an `agentKey` by the FE mapper (`inferAgentKey(env.role)` returns `null`). The mappers early-return `{ lastUpdatedAt: Date.now() }` without updating `agentStates`. |
| Mitigation today | The T6 commit (`9965ac0`) added an `agent_event` envelope path that carries the agent explicitly, and the FE mapper `mapAgentEvent` updates `agentStates` via `applyAgentRuntime`. So `agentStates` IS updated in practice, but via a separate wire path, NOT the canonical lifecycle path. The canonical `task_*` envelopes are functionally dead-letter. |
| Owner | Backend (Phase 6 / OBS-01.10) |
| Recommended fix | Update `taskLifecycle.publishLifecycle:90` to pass `role: task.type` (drop the literal `null`). Also update `backend/src/models/Task.js:28` (task creation envelope) to carry `role: <role>`. The session-level envelopes at `SdlcController.js:369` (`session_started`/`session_resumed`) and `SdlcWorkflowService.js:510` (`runtime_log`) may legitimately carry `role: null` because they are session-level envelopes (not lifecycle envelopes per the contract §4.1.1 / §4.1.2 / §4.1.13). |

### 3.2 R-25 — Snapshot reads legacy `phaseData.status`

| Aspect | Detail |
| ------ | ------ |
| Contract rule | §7 "Deriving runtime from `Task.status` (legacy)" — FORBIDDEN |
| AC violated | Implementation Checklist OBS-01.1.b |
| Evidence | `backend/src/services/SdlcWorkflowService.js:1256` (`let status = phaseData.status`) |
| Risk | The SSE snapshot's `pipelinePhases[i].status` is derived from `Task.status` (legacy), which may be `processing` per the legacy writer at `agentDispatcher.runAgent:312`. The FE's `RUNTIME_VISUAL` has no entry for `'processing'`, so the snapshot falls back to dim gray (`RUNTIME_VISUAL['pending']`) regardless of the agent's actual state. |
| Mitigation today | The FE runtime selector (`projectAgentToPhaseStatus`) compensates by reading `agentStates[i].status` for the `awaiting_review` promotion. For `running` agents, `agentStates.status === 'running'` causes `projectAgentToPhaseStatus` to return `'running'` IF `pipelineStatus === 'running'`. But `pipelineStatus` here is the legacy value `'processing'`, so the promotion rule doesn't fire and the visible UI is dim. |
| Owner | Backend (Phase 6 / OBS-01.10) |
| Recommended fix | Update `SdlcWorkflowService.toPhaseStatus:1253-1265` to read `phaseData.executionStatus` instead of `phaseData.status`, with a mapping from `executionStatus` (8 values) → visible `PhaseStatus` (7 values per the FE enum): `queued` → `pending`, `dispatched` → `pending`, `running` → `running`, `awaiting_gate` → `gate_pending`, `completed` → `completed`, `failed` → `failed`, `cancelled` → `skipped`, `timeout` → `skipped`. |

---

## 4. Low-severity findings (recommended cleanup)

### 4.1 R-15 — `PHASE_DOT_COLORS` in SessionRail

| Aspect | Detail |
| ------ | ------ |
| Contract rule | §7 "Duplicated CSS mapping" — FORBIDDEN |
| AC violated | AC-13 |
| Evidence | `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:12-20` |
| Risk | SessionRail per-agent dots render in a different palette from Dashboard pipeline strip + Agent Task card. Subtle visual divergence. |
| Mitigation today | None — the divergence is real. |
| Owner | Frontend (Phase 6 / OBS-01.10) |
| Recommended fix | Replace `PHASE_DOT_COLORS` with `RUNTIME_VISUAL[status].background` (or a small per-state dot variant). |

### 4.2 R-23 — Per-event mappers don't update `pipelinePhases`

| Aspect | Detail |
| ------ | ------ |
| Contract rule | §7 "Frozen snapshot for runtime transitions" — FORBIDDEN |
| AC violated | AC-15 |
| Invariant violated | §8 invariant 14 |
| Evidence | `frontend/src/store/eventMappers.ts:215-292` |
| Risk | Direct readers of `pipelinePhases` (none exist post-cleanup) would see stale data. Visible UI is correct because the canonical selector reads `agentStates` for the awaiting_review promotion. |
| Mitigation today | The canonical projection (`projectAgentToPhaseStatus`) reads `agentStates[i].status`, which IS updated per-event by `mapTaskStarted` etc. So the visible UI is correct. |
| Owner | Frontend (Phase 6 / OBS-01.10) |
| Recommended fix | Update each per-event lifecycle mapper to ALSO patch `pipelinePhases[i].status`, e.g., for `mapTaskStarted`: `pipelinePhases: state.pipelinePhases.map((p) => p.agent === agentKey ? { ...p, status: 'running' } : p)`. |

---

## 5. No-regression findings (informational)

### 5.1 `SessionPill` colour hardcoding

`SdlcDashboard/index.tsx:396-417` defines a local ternary for the
SessionPill colour. This is acceptable because `session.status` is
session-level, not per-agent runtime execution. The contract §5.1
covers per-agent runtime states; session-level `SessionStatus` is a
separate enum.

### 5.2 `animate-pulse` on connection dots

`OverviewPage.tsx:415-416` uses `animate-pulse` on the connection
dot. This is connection-level UI, not per-agent runtime. Per the
contract §5.1.5 ("`animate-pulse` allowed on session-level
indicators only"), this is correct.

### 5.3 Inline `animate-spin` on `SessionStatusIcon`

`OverviewPage.tsx:388` uses `<Loader2 size={13} className="animate-spin text-blue-400" />` for the session-level `'running'` icon. This is session-level (not per-agent runtime), so it is
out of scope of OBS-01.6 (which is per-agent runtime animation).

### 5.4 `ErrorBoundary.tsx`, `App.tsx`, `AppSidebar.tsx`, `AgentOutputPanel.tsx`

These files use `animate-spin` / `animate-pulse` for non-runtime
purposes (loading spinners, modal submit buttons, sync/commit/push
buttons). None of these are per-agent runtime visualization, so
they are correctly outside OBS-01.6 scope.

### 5.5 `ClarificationPanel.tsx`, `ToolGatePanel.tsx`, `FeatureRequestChatbox.tsx`

These use `animate-spin` on the submit button. Not runtime
visualization.

---

## 6. Test regression matrix

Per the verification brief ("Tests must not regress"):

| Test file | Pre-OBS-01 status | Post-Patch 09 status |
| --------- | ----------------- | -------------------- |
| `tests/runtimeSelectors.test.ts` (NEW) | — | 90 tests pass |
| `tests/OverviewPage.test.tsx` | 3 tests pass | 3 tests pass (unchanged behaviour) |
| `tests/SdlcDashboard.test.tsx` | 2 tests pass | 2 tests pass (unchanged behaviour) |
| `tests/App.notFound.test.tsx` | 1 test pass | 1 test pass |
| `tests/yamlExport.helpers.test.ts` | 2 tests pass | 2 tests pass |
| `tests/testScenarios.helpers.test.ts` | 3 tests pass | 3 tests pass |
| `src/pages/NotFound/__tests__/NotFoundPage.test.tsx` | 2 tests pass | 2 tests pass |
| **Total** | **13 tests** | **103 tests pass** (90 new) |

No test regressions. All pre-existing tests pass; 90 new tests
added.

---

## 7. Regression summary

| Severity | Count |
| :-------: | :---: |
| None | 23 (no regression) |
| Low | 2 (R-15, R-23) |
| Medium | 0 |
| High | 2 (R-24, R-25) |

**No regressions introduced by Patches 01–09.** The two
high-severity findings (R-24, R-25) are **pre-existing
contract drift** that was NOT addressed by the patches (the
patches were explicitly frontend-only per their FIX_REPORTs).
The two low-severity findings (R-15, R-23) are minor FE-side
drift.

---

## 8. Owner assignment

| Owner | Items | Recommendation |
| ----- | ----- | -------------- |
| **Backend** | R-24, R-25 | Phase 6 / OBS-01.10 should land BE-side changes per the implementation checklist §OBS-01.1.a / §OBS-01.1.b |
| **Frontend** | R-15, R-23 | Phase 6 / OBS-01.10 should land FE-side cleanup for the two minor drifts |
| **(none)** | R-01 to R-14, R-16 to R-22 | No action required; no regressions |

---

## 9. Sign-off

The OBS-01 Phase 4 patches (Patch 01 – Patch 09) introduce **NO
regressions** within their declared frontend-only scope. Two
high-severity contract drifts (R-24, R-25) remain on the
**backend**, both pre-existing and explicitly out of scope of
the patches per the FIX_REPORT files.

See `01_VERIFICATION_REPORT.md` for the full verification
summary and `04_PHASE5_SIGNOFF.md` for the go/no-go decision.