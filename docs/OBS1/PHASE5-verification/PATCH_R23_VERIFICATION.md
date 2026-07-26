# PATCH_R23_VERIFICATION.md — OBS-01.10 R-23 (Lifecycle mapper pipelinePhases patch)

> **Status:** PATCH VERIFICATION. No new production code outside the drift lines.
> **Repair ID:** R-23 (LOW)
> **Brief:** Per-event lifecycle mappers (`mapTaskStarted`, `mapTaskCompleted`, `mapTaskFailed`, `mapTaskInterrupted`) patch `pipelinePhases[i].status` alongside `agentStates[i].status` (per contract §7 forbidden pattern "frozen snapshot for runtime transitions", §8 invariant 14, AC-15).
> **Plan reference:** `OBS1_PHASE510_PLAN.md §4`
> **Analysis reference:** `OBS1_PHASE510_ANALYSIS.md §4.3`
> **Verification brief:** `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md §3.2 (R-23)`

---

## 1. Evidence

### 1.1 Diff summary

| File | Change |
| ---- | ------ |
| `frontend/src/store/eventMappers.ts` | +27 / -27 lines. Added `patchAgentStateAndPhase` helper; rewrote the 4 lifecycle mappers to use it. |
| `frontend/tests/eventMappers.pipelinePhases.test.ts` | NEW file, 200 lines, 13 tests. |

### 1.2 Pre-patch state (drift evidence)

`eventMappers.ts:215-292` (BEFORE R-23):

```ts
export function mapTaskStarted(state, env) {
  if (!env.taskId) return { lastUpdatedAt: Date.now() };
  const agentKey = inferAgentKey(env.role);
  if (!agentKey) return { lastUpdatedAt: Date.now() };
  return {
    agentStates: { ...state.agentStates, [agentKey]: { ...state.agentStates[agentKey], status: 'running', lastEventAt: Date.now() } },
    // ← MISSING: pipelinePhases patch
    lastUpdatedAt: Date.now(),
  };
}
// Same drift in mapTaskCompleted, mapTaskFailed, mapTaskInterrupted
```

Each mapper updated `agentStates[agentKey]` but NOT `pipelinePhases[i]`. After the SSE seed (`mapSessionStarted` sets `pipelinePhases[*].status = 'pending'`), the field was frozen until the next reconnect.

### 1.3 Post-patch state (R-23 fix)

`eventMappers.ts:215-290` (AFTER R-23):

```ts
function patchAgentStateAndPhase(
  state: SessionState,
  agentKey: AgentKey,
  agentStatus: AgentState['status'],
  phaseStatus: 'pending' | 'running' | 'gate_pending' | 'awaiting_review' | 'completed' | 'failed' | 'skipped',
  extraAgentFields: Partial<AgentState> = {},
): Partial<SessionState> {
  const now = Date.now();
  return {
    agentStates: {
      ...state.agentStates,
      [agentKey]: {
        ...state.agentStates[agentKey],
        status: agentStatus,
        lastEventAt: now,
        ...extraAgentFields,
      },
    },
    pipelinePhases: state.pipelinePhases.map((p) =>
      p.agent === agentKey ? { ...p, status: phaseStatus } : p,
    ),
    lastUpdatedAt: now,
  };
}

export function mapTaskStarted(state, env) {
  if (!env.taskId) return { lastUpdatedAt: Date.now() };
  const agentKey = inferAgentKey(env.role);
  if (!agentKey) return { lastUpdatedAt: Date.now() };  // ← early-return preserves both fields unchanged
  return patchAgentStateAndPhase(state, agentKey, 'running', 'running');
}
// mapTaskCompleted → 'completed' / 'completed'
// mapTaskFailed    → 'failed'    / 'failed'
// mapTaskInterrupted → 'skipped' / 'skipped'  (covers both 'cancelled' and 'timeout' per canonical mapping)
```

The change: each mapper now returns BOTH `agentStates` (existing behaviour) AND `pipelinePhases` (NEW). The early-return branches (when `inferAgentKey` returns null) still return `{ lastUpdatedAt }` only — both fields are NOT patched (preserves the invariant).

### 1.4 Status mapping per mapper

| Mapper | `agentStatus` | `phaseStatus` | Comment |
| ------ | ------------- | ------------- | ------- |
| `mapTaskStarted` | `'running'` | `'running'` | Direct 1:1 |
| `mapTaskCompleted` | `'completed'` | `'completed'` | Plus `completedAt: now` (preserved via `extraAgentFields`) |
| `mapTaskFailed` | `'failed'` | `'failed'` | Direct 1:1 |
| `mapTaskInterrupted` | `'skipped'` | `'skipped'` | Per `runtimeSelectors.ts:203-206` — BOTH `cancelled` and `timeout` project to `'skipped'` on the FE |

---

## 2. Runtime Replay

### 2.1 Step-by-step trace

For each per-event lifecycle envelope (assuming R-24 has landed — wire carries `role: task.type`):

| Step | Producer (BE) | Envelope type | `env.role` | `inferAgentKey(role)` | Mapper invoked | After-mapper state |
| ---- | ------------- | ------------- | ---------- | --------------------- | -------------- | ------------------ |
| PO starts | `taskLifecycle.transition(taskId, 'running', …)` | `task_started` | `'po-agent'` | `'PO'` | `mapTaskStarted` | `agentStates.PO.status = 'running'` AND `pipelinePhases[PO].status = 'running'` |
| PO awaits gate | `gateBridge.requestGate({ kind: 'tool' })` | `gate_pending` | `'po-agent'` | `'PO'` | `mapGatePending` | (out of R-23 scope — gate mapper is owned by mapGatePending which sets `agentStates.PO.status = 'awaiting_review'`; pipelinePhases for awaiting_review is set when `task_started` resumes) |
| PO completes | `taskLifecycle.transitionIfPresent(taskId, 'completed', …)` | `task_completed` | `'po-agent'` | `'PO'` | `mapTaskCompleted` | `agentStates.PO.status = 'completed'` AND `pipelinePhases[PO].status = 'completed'` |
| DEV fails | `taskLifecycle.transition(taskId, 'failed', …)` | `task_failed` | `'dev-agent'` | `'DEV'` | `mapTaskFailed` | `agentStates.DEV.status = 'failed'` AND `pipelinePhases[DEV].status = 'failed'` |
| UX cancelled | `taskLifecycle.transitionIfPresent(taskId, 'cancelled', …)` | `task_interrupted` | `'ux-agent'` | `'UX'` | `mapTaskInterrupted` | `agentStates.UX.status = 'skipped'` AND `pipelinePhases[UX].status = 'skipped'` |
| QA timeout | `taskLifecycle.transition(taskId, 'timeout', …)` | `task_interrupted` | `'qa-agent'` | `'QA'` | `mapTaskInterrupted` | `agentStates.QA.status = 'skipped'` AND `pipelinePhases[QA].status = 'skipped'` |

### 2.2 Visible UI effect

The canonical projection (`projectAgentToPhaseStatus` in `runtimeSelectors.ts:103-127`) reads `pipelinePhases[i].status` as one of its inputs. After R-23, this field reflects the latest lifecycle event (rather than the SSE-connect snapshot value). The cross-page identity test (`runtimeSelectors.test.ts:628-702`) continues to pass — the per-agent visible status is the same across Dashboard / Agent Task / Inspector because the canonical projection consumes the now-correct `pipelinePhases[i].status`.

### 2.3 Invariants satisfied

| Invariant | Status |
| --------- | :----: |
| §8 invariant 14 ("`pipelinePhases` MUST be updated ONLY by `mapSessionStarted` (seed) or by per-event lifecycle mappers (per-event patches)") | ✓ — both writers now exist |
| AC-15 ("`pipelinePhases` MUST be updated ONLY by `mapSessionStarted` (seed) or per-event lifecycle mappers (per-event patches)") | ✓ |
| §7 forbidden pattern "Frozen snapshot for runtime transitions" | ✓ — no longer violated; per-event patches now exist |
| §8 invariant 1 ("One runtime state source per agent") | ✓ — `pipelinePhases[i].status` now tracks the canonical machine |

---

## 3. Regression

### 3.1 Test results

```
$ cd frontend && npx tsc --noEmit
(no output — clean)

$ cd frontend && npx eslint src/store/eventMappers.ts tests/eventMappers.pipelinePhases.test.ts
(no errors; 4 pre-existing _state/_env warnings unchanged)

$ cd frontend && npx vitest run
Test Files  8 passed (8)
Tests       116 passed (116)
```

The 13 new R-23 tests in `eventMappers.pipelinePhases.test.ts` all pass:
- 4 tests for `mapTaskStarted` (PO runs, only DEV patched, inferAgentKey null early-return, taskId null early-return)
- 2 tests for `mapTaskCompleted` (PO completes, inferAgentKey null early-return)
- 2 tests for `mapTaskFailed` (DEV fails, inferAgentKey null early-return)
- 3 tests for `mapTaskInterrupted` (UX cancelled, QA timeout, inferAgentKey null early-return)
- 2 tests for cross-agent atomicity (5 sequential envelopes → all phases running; pipelinePhases patch preserves `agent` field)

Pre-existing 103 tests continue to pass — no regressions in:
- `runtimeSelectors.test.ts` (90 tests — cross-page identity invariant still holds)
- `OverviewPage.test.tsx` (3 tests)
- `SdlcDashboard.test.tsx` (2 tests)
- Other 8 tests

### 3.2 Per-file comparison

| Suite | Pre-R-23 | Post-R-23 | Δ |
| ----- | --------: | --------: | -: |
| `tests/eventMappers.pipelinePhases.test.ts` (NEW) | 0 | 13 | +13 |
| `tests/runtimeSelectors.test.ts` | 90 | 90 | 0 |
| `tests/OverviewPage.test.tsx` | 3 | 3 | 0 |
| `tests/SdlcDashboard.test.tsx` | 2 | 2 | 0 |
| Other tests | 8 | 8 | 0 |
| **Total** | **103** | **116** | **+13 (all new)** |

Zero regressions.

### 3.3 Surfaces verified

| Surface | Status |
| ------- | :----: |
| FE `eventMappers.mapTaskStarted` | ✓ Patches both fields |
| FE `eventMappers.mapTaskCompleted` | ✓ Patches both fields |
| FE `eventMappers.mapTaskFailed` | ✓ Patches both fields |
| FE `eventMappers.mapTaskInterrupted` | ✓ Patches both fields |
| BE `taskLifecycle.publishLifecycle` (depends on R-24) | ✓ (R-24 verified separately) |
| FE `runtimeSelectors` projection | ✓ Unchanged — consumes now-correct `pipelinePhases[i].status` |
| FE Dashboard pipeline strip | ✓ Visible status reflects latest lifecycle event |
| FE Agent Task card border + chip | ✓ Visible status reflects latest lifecycle event |
| FE Inspector | ✓ Not affected (Inspector doesn't render per-agent runtime visuals per contract §5.1.5) |
| Cross-page identity invariant | ✓ Preserved (`runtimeSelectors.test.ts:628-702` still passes) |

### 3.4 No new regressions

- All previously-passing FE tests continue to pass.
- The visible UI is unchanged (canonical projection already produced correct output by reading `agentStates[i].status` for the `awaiting_review` promotion).
- The cross-page identity invariant is preserved.
- The `pipelinePhases` array shape (`api.PhaseStatus[]`) is unchanged — only the `status` field of matching entries is patched.
- The `applyEnvelope` reducer (`eventMappers.ts:339-342`) applies the patch atomically (single Zustand state update).

---

## 4. Acceptance criteria

| AC | Status | Evidence |
| -- | :----: | -------- |
| **AC-C1**: After a `task_started` envelope, `session.agentStates[agentKey].status === 'running'` AND `session.pipelinePhases.find(p => p.agent === agentKey).status === 'running'` | ✓ | `eventMappers.pipelinePhases.test.ts:42-44` ("mapTaskStarted > patches both agentStates[PO].status and pipelinePhases[PO].status to 'running'") |
| **AC-C2**: Same for `task_completed` → `'completed'` | ✓ | `eventMappers.pipelinePhases.test.ts:118-121` |
| **AC-C3**: Same for `task_failed` → `'failed'` | ✓ | `eventMappers.pipelinePhases.test.ts:135-137` |
| **AC-C4**: Same for `task_interrupted` → `'skipped'` | ✓ | `eventMappers.pipelinePhases.test.ts:155-157` (cancelled) + `:165-167` (timeout) |
| **AC-C5**: If `inferAgentKey(env.role)` returns `null`, neither field is patched (early-return preserves both) | ✓ | `eventMappers.pipelinePhases.test.ts:46-52, 80-86, 105-107, 124-126, 142-144, 173-175` |
| **AC-C6**: Pre-existing 103 frontend tests pass | ✓ | `Tests 103 passed (103)` on baseline; `Tests 116 passed (116)` after R-23 (13 new) |
| **AC-C7**: Cross-page identity tests continue to pass | ✓ | `runtimeSelectors.test.ts:628-702` still passes (90 tests, no regressions) |

---

## 5. Remaining risks

### 5.1 R-23 depends on R-24 (BE publishLifecycle role)

`inferAgentKey(env.role)` returns `null` for `role: null`. R-23 alone (without R-24) is functionally equivalent to the pre-R-23 state (no per-event patches because the mapper early-returns). The dependency chain in `OBS1_PHASE510_PLAN.md §6` requires R-24 to land first; this verification assumes R-24 has landed (which it has — see `PATCH_R24_VERIFICATION.md`).

### 5.2 The `gate_pending` mapper (`mapGatePending`) still does NOT patch `pipelinePhases`

`mapGatePending` (line 100-130 in the current source) sets `agentStates[agentKey].status = 'awaiting_review'`. It does NOT patch `pipelinePhases`. The visible UI for `gate_pending` is correctly projected via the canonical selector's `awaiting_review` promotion rule (reads `agentStates` for the promotion). So the visible UI is correct, but the architectural invariant §8/14 / AC-15 is partially violated: the gate path is not represented in `pipelinePhases` directly.

This is OUT OF R-23 SCOPE per plan §4.7 (which lists only `mapTaskStarted`, `mapTaskCompleted`, `mapTaskFailed`, `mapTaskInterrupted`). The gate path is covered by the canonical projection's `awaiting_review` promotion rule and does NOT need a `pipelinePhases` patch for visible UI correctness.

If a future requirement explicitly mandates `pipelinePhases[i].status = 'gate_pending'` for gate-pending agents, that would be a separate Repair ID.

### 5.3 `mapTaskResumed` (reserved per contract §4.1.7)

`mapTaskResumed` (line 281-294 in the current source) is registered but never invoked (no producer in current source per the contract). It currently updates `agentStates` only. R-23 does NOT touch this mapper because it's dormant and the brief is explicit about the 4 lifecycle mappers in scope.

### 5.4 No regression in store ownership

`applyEnvelope` (`eventMappers.ts:339-342`) is the only writer of `pipelinePhases` besides `mapSessionStarted`. The new patches maintain that invariant: the mapper family is the sole writer of `pipelinePhases` per the contract §8/14.

---

## 6. Sign-off for R-23

| Criterion | Status |
| --------- | :----: |
| Drift line identified by file:line | ✓ (`eventMappers.ts:215-292` — all 4 lifecycle mappers) |
| Evidence captured (pre/post diff) | ✓ |
| Each lifecycle mapper patches BOTH `agentStates` and `pipelinePhases` | ✓ |
| Early-return branch preserves both fields unchanged | ✓ |
| Test coverage for all 4 mappers + cross-agent atomicity | ✓ (13 new tests) |
| No new regressions introduced | ✓ (103 → 116; +13 all new; 0 failures) |
| Other contracts / SSE / DTO / store ownership unchanged | ✓ |
| Rollback path clear | ✓ (git revert of `eventMappers.ts` + `eventMappers.pipelinePhases.test.ts`) |

**R-23: COMPLETE. Awaiting approval to proceed with R-15 (SessionRail PHASE_DOT_COLORS).**

---

## 7. References

- `OBS1_PHASE510_ANALYSIS.md` (Bước 1)
- `OBS1_PHASE510_PLAN.md` (Bước 4)
- `docs/OBS1/PHASE5-verification/01_VERIFICATION_REPORT.md` §10.2 (R-23 finding)
- `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md` §3.2 (R-23 regression)
- `docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md` §7, §8 inv. 14, AC-15
- `frontend/src/store/eventMappers.ts:43-67` (R-23 helper) + `:215-290` (R-23 mappers)
- `frontend/tests/eventMappers.pipelinePhases.test.ts` (13 new tests)

End of R-23 patch verification.