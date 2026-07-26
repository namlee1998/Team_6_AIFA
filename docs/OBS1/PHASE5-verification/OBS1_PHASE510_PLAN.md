# OBS1_PHASE510_PLAN.md

> **Status:** PLAN ONLY. No production code modified yet.
> **Phase:** OBS-01.10 — Close remaining runtime drifts.
> **Authority:**
> - `OBS1_PHASE510_ANALYSIS.md` (Bước 1, just produced)
> - `docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md`
> - `docs/OBS1/PHASE5-verification/01_VERIFICATION_REPORT.md`
> - `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md`
>
> **Patch strategy (per brief):** Each Repair ID = one patch.
> Per patch: tsc → eslint → test → verify → next patch.
> No batching.
>
> **Coding constraints (per brief):** No architecture / API / SSE
> contract / Runtime Contract / DB schema / event name / DTO /
> store ownership / selector ownership / runtime state model
> changes. Only the lines causing drift.

---

## 1. Workstreams

| Workstream | Repair ID | Priority | Scope |
| ---------- | --------- | :------: | ----- |
| **A** | R-25 | HIGH | Backend: `SdlcWorkflowService.toPhaseStatus` reads `phaseData.executionStatus` instead of `phaseData.status`. |
| **B** | R-24 | HIGH | Backend: `taskLifecycle.publishLifecycle` emits `role: task.type` instead of `role: null`. |
| **C** | R-23 | LOW | Frontend: per-event lifecycle mappers patch `pipelinePhases` alongside `agentStates`. |
| **D** | R-15 | LOW | Frontend: `SessionRail.PHASE_DOT_COLORS` removed; dots consume `getRuntimeVisual(status).background`. |

---

## 2. Workstream A — R-25 (HIGH)

### 2.1 Problem

`SdlcWorkflowService.toPhaseStatus` (`backend/src/services/SdlcWorkflowService.js:1253-1265`) reads `phaseData.status` (legacy `Task.status`), NOT `phaseData.executionStatus` (canonical machine). Per contract §7 forbidden pattern "Deriving runtime from `Task.status` (legacy)", the snapshot must source from the canonical field.

### 2.2 Fix

| Aspect | Detail |
| ------ | ------ |
| File | `backend/src/services/SdlcWorkflowService.js` |
| Lines | `1253-1265` (`toPhaseStatus`) |
| Change | Read `phaseData.executionStatus` first; map to visible `PhaseStatus`; fall back to `phaseData.status` ONLY if `executionStatus` is null (defensive — schema default is `'queued'`, so this branch is unreachable in current source). |
| `awaitingReview` projection (line 1257) | MUST be preserved — it is the canonical way to surface output_review gates per contract §4 evidence gaps. |

### 2.3 Mapping (canonical `executionStatus` → visible `PhaseStatus`)

| `executionStatus` (canonical) | Visible `PhaseStatus` |
| ----------------------------- | ---------------------- |
| `queued` | `pending` |
| `dispatched` (reserved) | `pending` |
| `running` | `running` |
| `awaiting_gate` | `gate_pending` |
| `completed` | `completed` |
| `failed` | `failed` |
| `cancelled` | `skipped` |
| `timeout` | `skipped` |

### 2.4 Acceptance criteria

- AC-A1: A `Task` with `executionStatus = 'running'` produces `pipelinePhases[i].status = 'running'` in the SSE `session_started` payload.
- AC-A2: A `Task` with `executionStatus = 'completed'` produces `pipelinePhases[i].status = 'completed'`.
- AC-A3: A `Task` with `executionStatus = 'awaiting_gate'` AND `awaitingReview = true` produces `pipelinePhases[i].status = 'gate_pending'` (per existing `awaitingReview` branch).
- AC-A4: A `Task` with `executionStatus = 'cancelled'` OR `'timeout'` produces `pipelinePhases[i].status = 'skipped'`.
- AC-A5: Existing `backend/tests/integration/task-lifecycle.test.js` passes.
- AC-A6: Existing `backend/tests/integration/workflow-report.test.js` passes.
- AC-A7: New test added in `backend/tests/integration/workflow-report.test.js` (or extend existing) — `toPhaseStatus` maps each of the 8 canonical states to the expected `PhaseStatus`.

### 2.5 Rollback

- Git revert of the `toPhaseStatus` change.
- The legacy `phaseData.status` read returns; no schema or API change.
- Visible UI reverts to the legacy projection (dim gray fallback for `'processing'`).

### 2.6 Regression risk

| Risk | Severity | Mitigation |
| ---- | :------: | ---------- |
| Pre-existing tests assume legacy `phaseData.status` values | Low | The fallback to `phaseData.status` when `executionStatus` is null preserves the legacy value path; tests that pass `status: 'processing'` without `executionStatus` continue to pass |
| `awaitingReview` projection lost | High | Code preserves the existing line 1257 `if (phaseData.awaitingReview) status = 'gate_pending'` |
| Visible UI for legacy `'processing'` value | Low | After the fix, the visible value comes from `executionStatus` (which is `'running'`); the legacy `'processing'` is no longer reachable through `toPhaseStatus` |

### 2.7 Owner

Backend engineer (single-owner module: `SdlcWorkflowService`).

### 2.8 Estimated changed files

- `backend/src/services/SdlcWorkflowService.js` (modify `toPhaseStatus:1253-1265`)
- `backend/tests/integration/workflow-report.test.js` (extend with canonical mapping tests)

Net: 1 production file + 1 test file = 2 files.

---

## 3. Workstream B — R-24 (HIGH)

### 3.1 Problem

`taskLifecycle.publishLifecycle` (`backend/src/services/taskLifecycleService.js:78-93`) emits lifecycle envelopes with `role: null` (line 90). Per contract §4.1.3–4.1.6, §7 forbidden pattern "`role: null` on lifecycle envelopes", AC-08, and §8 invariant 5, lifecycle envelopes MUST carry `role: task.type`. The FE mapper `inferAgentKey(env.role)` (`frontend/src/store/eventMappers.ts:34-37`) returns `null` for `role: null`, causing the per-event lifecycle mappers to early-return without updating `agentStates`.

### 3.2 Fix

| Aspect | Detail |
| ------ | ------ |
| File | `backend/src/services/taskLifecycleService.js` |
| Lines | `88-92` (the `publishEvent(...)` call inside `publishLifecycle`) |
| Change | Replace `role: null` with `role: task.type` |
| Side effect | None — `task` is already in scope (`publishLifecycle`'s first arg), and `task.type` is a column on the `Task` model (`backend/prisma/schema.prisma`). |
| Session-level envelopes exempt | `SdlcController.js:369` (`session_started` / `session_resumed`), `SdlcWorkflowService.js:510` (`runtime_log`), `Task.js:28` (task_created envelope) are session-level / non-lifecycle per contract §4.1.1, §4.1.2, §4.1.13. They are NOT in scope of this workstream. |

### 3.3 Acceptance criteria

- AC-B1: Every `task_started`, `task_completed`, `task_failed`, `task_interrupted` envelope emitted by `publishLifecycle` carries `role: <task.type>` (e.g., `'po-agent'`, `'dev-agent'`), verified by an SSE dump or by extending `backend/tests/integration/task-lifecycle.test.js`.
- AC-B2: Pre-existing tests in `backend/tests/integration/task-lifecycle.test.js`, `eventBus.test.js`, `gateBridge.subscribeProject.test.js` continue to pass (they pass `role: null` as test fixture, which is accepted by `publishEvent` via `base.role ?? null` per `eventEnvelope.js:62`).
- AC-B3: Frontend mapper `inferAgentKey(env.role)` resolves a valid `AgentKey` for every canonical lifecycle envelope.
- AC-B4: Frontend mapper `mapTaskStarted` updates `agentStates[agentKey].status = 'running'` after R-23 lands.

### 3.4 Rollback

- Git revert of the literal change (`role: null` ← `role: task.type`).
- Wire envelopes revert to `role: null`; FE mapper early-returns (no worse than today).

### 3.5 Regression risk

| Risk | Severity | Mitigation |
| ---- | :------: | ---------- |
| Replay path mutates envelope | High | No change to `SdlcController.js:299-303` (`sendEnvelope`); replay still forwards `row.envelope` byte-for-byte per contract AC-18 |
| Wire schema change breaks consumers | Medium | The change is purely additive — adding `role` where it was null. Existing consumers that read `role` already handle null (via `inferAgentKey` null-check) and continue to handle the non-null value identically |
| Other emitters of `role: null` | Low | Audit confirms session-level envelopes at `SdlcController.js:369`, `SdlcWorkflowService.js:510`, `Task.js:28` are session-level and legitimately exempt (per contract §4.1.1 / §4.1.2 / §4.1.13) |

### 3.6 Owner

Backend engineer (single-owner module: `taskLifecycleService`).

### 3.7 Estimated changed files

- `backend/src/services/taskLifecycleService.js` (modify line 90)
- `backend/tests/integration/task-lifecycle.test.js` (extend to assert `role: task.type` on lifecycle envelopes)

Net: 1 production file + 1 test file = 2 files.

---

## 4. Workstream C — R-23 (LOW)

### 4.1 Problem

Per-event lifecycle mappers in `frontend/src/store/eventMappers.ts:215-292` update `agentStates[agentKey]` but NOT `pipelinePhases[i]`. Per contract §7 forbidden pattern "Frozen snapshot for runtime transitions", §8 invariant 14, and AC-15, the per-event lifecycle mappers are the canonical writers of `pipelinePhases[i].status` patches (alongside `mapSessionStarted` for the seed).

### 4.2 Fix

| Aspect | Detail |
| ------ | ------ |
| File | `frontend/src/store/eventMappers.ts` |
| Lines | `215-227` (`mapTaskStarted`), `229-244` (`mapTaskCompleted`), `246-260` (`mapTaskFailed`), `262-276` (`mapTaskInterrupted`) |
| Change | Each mapper returns an additional `pipelinePhases: state.pipelinePhases.map((p) => p.agent === agentKey ? { ...p, status: <canonical> } : p)` field |
| `<canonical>` mapping | `mapTaskStarted`: `'running'`; `mapTaskCompleted`: `'completed'`; `mapTaskFailed`: `'failed'`; `mapTaskInterrupted`: `'skipped'` |
| Early-return branch | If `inferAgentKey(env.role)` returns `null` (the `!agentKey` early-return), the mapper MUST NOT patch `pipelinePhases` either — preserves the "no info, no patch" invariant |

### 4.3 Patch shape (per mapper)

Example for `mapTaskStarted` (lines 215-227):

```ts
export function mapTaskStarted(state: SessionState, env: EventEnvelope<TaskLifecyclePayload>): Partial<SessionState> {
  if (!env.taskId) return { lastUpdatedAt: Date.now() };
  const agentKey = inferAgentKey(env.role);
  if (!agentKey) return { lastUpdatedAt: Date.now() };
  return {
    agentStates: {
      ...state.agentStates,
      [agentKey]: { ...state.agentStates[agentKey], status: 'running', lastEventAt: Date.now() },
    },
    pipelinePhases: state.pipelinePhases.map((p) =>
      p.agent === agentKey ? { ...p, status: 'running' } : p
    ),
    lastUpdatedAt: Date.now(),
  };
}
```

(Same shape for `mapTaskCompleted` / `mapTaskFailed` / `mapTaskInterrupted`, with the corresponding status.)

### 4.4 Acceptance criteria

- AC-C1: After a `task_started` envelope, `session.agentStates[agentKey].status === 'running'` AND `session.pipelinePhases.find(p => p.agent === agentKey).status === 'running'`.
- AC-C2: Same for `task_completed` → `'completed'`.
- AC-C3: Same for `task_failed` → `'failed'`.
- AC-C4: Same for `task_interrupted` → `'skipped'`.
- AC-C5: If `inferAgentKey(env.role)` returns `null`, neither field is patched (early-return preserves both).
- AC-C6: Pre-existing 103 frontend tests pass.
- AC-C7: Cross-page identity tests (`runtimeSelectors.test.ts:628-702`) continue to pass.

### 4.5 Rollback

- Git revert of the mapper changes.
- `pipelinePhases` is no longer patched per-event; canonical projection compensates (visible UI is unchanged).
- Reverts to current behaviour.

### 4.6 Regression risk

| Risk | Severity | Mitigation |
| ---- | :------: | ---------- |
| `pipelinePhases` patch order with `agentStates` patch | Low | Both are in the same returned object; Zustand `applyEnvelope` applies them atomically |
| Stale `pipelinePhases[i].status` from SSE seed | Low | R-25 fixes the seed source; R-23 makes per-event patches consistent with the seed |
| Cross-page identity | Low | Test `runtimeSelectors.test.ts:546-617` asserts `selectRuntimeExecution.phases[i].status === projectAgentToPhaseStatus(session, i)` for every agent; this must still hold |
| Multiple agents racing | Low | `pipelinePhases.map` iterates the immutable array; only the matching agent is patched |

### 4.7 Owner

Frontend engineer (single-owner module: `eventMappers.ts`).

### 4.8 Estimated changed files

- `frontend/src/store/eventMappers.ts` (modify 4 mappers)
- `frontend/tests/runtimeSelectors.test.ts` (add 4 unit tests for the per-mapper pipeline patch — extend existing `eventMappers` describe block, or add new file `frontend/tests/eventMappers.test.ts` if preferred)

Net: 1 production file + 1 test file = 2 files.

---

## 5. Workstream D — R-15 (LOW)

### 5.1 Problem

`frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:12-20` declares a local `PHASE_DOT_COLORS` map that duplicates the canonical colour mapping. Per contract §7 forbidden pattern "Duplicated CSS mapping", §5.2.2 cross-page identity, and AC-13, SessionRail per-agent dots must consume the canonical `RUNTIME_VISUAL`.

### 5.2 Fix

| Aspect | Detail |
| ------ | ------ |
| File | `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx` |
| Lines | `12-20` (declaration), `194` (usage) |
| Change | Delete `PHASE_DOT_COLORS` declaration. Import `getRuntimeVisual` from `@/store/runtimeSelectors`. Replace `PHASE_DOT_COLORS[status]` with `getRuntimeVisual(status).background` at line 194. |
| Session-level status badge | Out of scope (`STATUS_BADGE[session.status]` at line 31-38 is session-level, NOT per-agent). NOT touched. |

### 5.3 Patch shape

At top of `SessionRail.tsx`:

```ts
import {
  countCompletedAgents,
  selectAgentPhaseStatus,
  getRuntimeVisual,        // NEW
} from '@/store/runtimeSelectors';
```

Delete lines 12-20 (`PHASE_DOT_COLORS` map).

At line 194 (the dot rendering):

```tsx
<span
  key={k}
  className={`flex items-center justify-center rounded text-[8px] font-bold ${getRuntimeVisual(status).background}`}
  title={`${k} · ${status}`}
>
  {k}
</span>
```

### 5.4 Acceptance criteria

- AC-D1: `PHASE_DOT_COLORS` is no longer declared in `SessionRail.tsx` (verified by `grep`).
- AC-D2: SessionRail per-agent dot for `running` agent renders with `bg-blue-500/20 text-blue-300` (the canonical `RUNTIME_VISUAL.running.background`).
- AC-D3: SessionRail per-agent dot for `completed` agent renders with `bg-emerald-500/20 text-emerald-400`.
- AC-D4: All 5 dots visually match the corresponding Dashboard pipeline strip cell.
- AC-D5: Pre-existing 103 frontend tests pass.
- AC-D6: `runtimeSelectors.test.ts` `RUNTIME_VISUAL[*].background` tests continue to pass.

### 5.5 Rollback

- Git revert of the `SessionRail.tsx` change.
- Local `PHASE_DOT_COLORS` returns; dots render in the saturated palette.

### 5.6 Regression risk

| Risk | Severity | Mitigation |
| ---- | :------: | ---------- |
| Visual change (saturated → muted) | Low | This is the intended fix; muted palette is the canonical one |
| `getRuntimeVisual` import path | Low | Already used by `OverviewPage.tsx` and `SdlcDashboard/index.tsx` |
| `text-[8px]` readability on muted bg | Low | Pre-existing palette; readability preserved |
| Cross-page identity regression | Low | Test `runtimeSelectors.test.ts:628-702` asserts identity |

### 5.7 Owner

Frontend engineer (single-owner module: `SessionRail.tsx`).

### 5.8 Estimated changed files

- `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx` (delete 9 lines, modify 1 line, add 1 import)

Net: 1 production file.

---

## 6. Dependency graph (per Repair ID)

```
R-25 (BE snapshot)
   │
   │  fixes SSE seed source for pipelinePhases[i].status
   │
   ▼
R-24 (BE publishLifecycle)
   │
   │  fixes wire envelope role so FE mapper can resolve agentKey
   │
   ▼
R-23 (FE mapper pipeline patch)
   │
   │  makes the canonical projection explicit in store
   │
   ▼
R-15 (FE SessionRail colour map)
   │
   │  removes duplicate CSS mapping; cross-page identity holds
   │
   ▼
(visible UI consistent across Dashboard / Agent Task / SessionRail)
```

### 6.1 Prerequisite chain

- **R-25 → R-24**: R-25 must land first because the SSE seed now publishes canonical values; R-24 then ensures subsequent per-event envelopes carry the agent.
- **R-24 → R-23**: R-24 must land first because `mapTaskStarted` etc. require `env.role` to be non-null to resolve the agent; without R-24, the mapper early-returns and R-23's `pipelinePhases` patch never fires.
- **R-15**: Independent of R-25/R-24/R-23. Can land at any point after Phase 5. Logically last because it is the cosmetic completion of the canonical refactor.

### 6.2 Patch ordering

| Order | Patch | Rationale |
| :---: | ----- | --------- |
| 1 | R-25 | Closes the SSE seed drift; canonical state machine becomes the visible source |
| 2 | R-24 | Enables per-event lifecycle propagation to the FE |
| 3 | R-23 | Makes the canonical projection explicit in store (works after R-24 because mapper now resolves agentKey) |
| 4 | R-15 | Cosmetic / cross-page identity |

---

## 7. Rollback strategy (workstream-level)

Each workstream is independently reversible via `git revert`. The dependency chain means:

- If R-23 is reverted, the store falls back to frozen `pipelinePhases` (current behaviour); visible UI is unchanged (canonical projection compensates).
- If R-24 is reverted, `role: null` is restored; per-event lifecycle mappers early-return; visible UI is unchanged (the `agent_event` path from T6 commit still updates `agentStates`).
- If R-25 is reverted, the snapshot reverts to reading `phaseData.status`; visible UI reverts to dim gray at SSE connect (current drift).
- If R-15 is reverted, the local `PHASE_DOT_COLORS` returns; SessionRail dots revert to saturated palette.

**No workstream introduces a destructive change that requires DB migration, API change, or SSE contract change.** All four patches are purely code-level drift closures.

---

## 8. Acceptance criteria (project-level)

OBS-01.10 is COMPLETE when:

| # | Criterion | Status check |
| - | --------- | ------------ |
| 1 | R-25 resolved | `toPhaseStatus` reads `phaseData.executionStatus`; new test covers all 8 canonical mappings |
| 2 | R-24 resolved | `publishLifecycle` emits `role: task.type`; new test asserts `role` on lifecycle envelopes |
| 3 | R-23 resolved | All 4 per-event lifecycle mappers patch `pipelinePhases`; new unit tests cover each mapper |
| 4 | R-15 resolved | `PHASE_DOT_COLORS` removed; SessionRail dots read `getRuntimeVisual` |
| 5 | Runtime Contract still satisfied | All 20 invariants from `07_CANONICAL_RUNTIME_CONTRACT.md §8` verified |
| 6 | 103/103 tests still pass | `npx vitest run` + `npx tsc --noEmit` |
| 7 | No new Repair ID created | git log + grep audit |
| 8 | Phase 5 verification still passes | `docs/OBS1/PHASE5-verification/01_VERIFICATION_REPORT.md` clauses verified unchanged |

---

## 9. Estimated changed files (summary)

| Workstream | Production files | Test files | Total |
| ---------- | ----------------: | ---------: | ----: |
| A — R-25 | 1 (`SdlcWorkflowService.js`) | 1 (`workflow-report.test.js`) | 2 |
| B — R-24 | 1 (`taskLifecycleService.js`) | 1 (`task-lifecycle.test.js`) | 2 |
| C — R-23 | 1 (`eventMappers.ts`) | 1 (`runtimeSelectors.test.ts` OR `eventMappers.test.ts`) | 2 |
| D — R-15 | 1 (`SessionRail.tsx`) | 0 (existing cross-page identity tests cover) | 1 |
| **Total** | **4** | **3** | **7** |

---

## 10. Patch-by-patch verification (template)

After each patch, a `PATCH_RXX_VERIFICATION.md` is produced with:

1. **Evidence** — file:line of the change; pre/post diff.
2. **Runtime replay** — step-by-step trace through Producer → Transport → Store → Projection → UI for the affected canonical state.
3. **Regression** — list of surfaces verified; no new regressions.
4. **Acceptance criteria** — workstream-level ACs (§2.4 / §3.3 / §4.4 / §5.4) pass.
5. **Remaining risks** — open items, blockers, follow-ups.

---

## 11. References

- `OBS1_PHASE510_ANALYSIS.md` (Bước 1)
- `docs/OBS1/PHASE5-verification/01_VERIFICATION_REPORT.md`
- `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md`
- `docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md`
- `docs/OBS1/phase1-runtime-observability/06_IMPLEMENTATION_CHECKLIST.md`
- `frontend/src/store/eventMappers.ts`
- `frontend/src/store/runtimeSelectors.ts`
- `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx`
- `backend/src/services/taskLifecycleService.js`
- `backend/src/services/SdlcWorkflowService.js`

---

## 12. Open questions (none)

The plan has no open questions. All four workstreams are bounded, evidence-based, and reversible. Awaiting approval to proceed with Patch R-25.