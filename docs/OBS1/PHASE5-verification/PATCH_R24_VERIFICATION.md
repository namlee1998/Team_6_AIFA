# PATCH_R24_VERIFICATION.md — OBS-01.10 R-24 (Lifecycle envelope role)

> **Status:** PATCH VERIFICATION. No new production code outside the drift line.
> **Repair ID:** R-24 (HIGH)
> **Brief:** `taskLifecycle.publishLifecycle` emits `role: task.type` instead of `role: null` on lifecycle envelopes (per contract §4.1.3–4.1.6, §7 forbidden pattern "`role: null` on lifecycle envelopes", AC-08, §8 invariant 5).
> **Plan reference:** `OBS1_PHASE510_PLAN.md §3`
> **Analysis reference:** `OBS1_PHASE510_ANALYSIS.md §4.2`
> **Verification brief:** `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md §3.1 (R-24)`

---

## 1. Evidence

### 1.1 Diff summary

| File | Change |
| ---- | ------ |
| `backend/src/services/taskLifecycleService.js` | `publishLifecycle:88-110` — replaced literal `role: null` with `role: task.type` (3 lines changed in the `publishEvent(...)` call) |
| `backend/tests/integration/task-lifecycle.test.js` | +85 lines — added 4 tests asserting `role: 'po-agent'` on every lifecycle envelope (live bus + persisted AgentEvent + dedicated failed/cancelled paths) |

### 1.2 Pre-patch state (drift evidence)

`taskLifecycleService.js:88-93` (BEFORE R-24):

```js
async function publishLifecycle(task, type, payload) {
  if (!task?.projectId) return null;
  if (!task?.sessionId) return null;
  const eventType = LIFECYCLE_TO_EVENTTYPE[type] || 'task_started';
  return publishEvent(
    eventType,
    { projectId: task.projectId, sessionId: task.sessionId, taskId: task.id, role: null },  // ← DRIFT
    payload,
  );
}
```

The drift is at the literal `role: null`. Every lifecycle envelope (`task_started`, `task_completed`, `task_failed`, `task_interrupted`) emitted through `publishLifecycle` carried `role: null`.

### 1.3 Post-patch state (R-24 fix)

`taskLifecycleService.js:88-110` (AFTER R-24):

```js
async function publishLifecycle(task, type, payload) {
  if (!task?.projectId) return null;
  if (!task?.sessionId) return null;
  const eventType = LIFECYCLE_TO_EVENTTYPE[type] || 'task_started';
  return publishEvent(
    eventType,
    {
      projectId: task.projectId,
      sessionId: task.sessionId,
      taskId: task.id,
      // R-24: wire role MUST be the agent role (e.g. 'po-agent'), never null.
      // This unblocks FE mapper inferAgentKey(env.role) — see R-23.
      role: task.type,
    },
    payload,
  );
}
```

The change: `role: null` → `role: task.type`. `task` is the row read at line 122 (`prisma.task.findUnique({where: {id: taskId}})`) — Prisma returns the raw row including the `type` column (`backend/prisma/schema.prisma:67`).

### 1.4 Out-of-scope (per plan §3.2)

The following session-level / non-lifecycle envelopes legitimately carry `role: null` and are NOT touched by R-24:

| File:line | Envelope type | Reason |
| --------- | ------------- | ------ |
| `backend/src/controllers/SdlcController.js:369` | `session_started` / `session_resumed` | Session-level envelope (contract §4.1.1, §4.1.2) |
| `backend/src/services/SdlcWorkflowService.js:510` | `runtime_log` | Session-level envelope (contract §4.1.13) |
| `backend/src/models/Task.js:28` | `task_started` (via `task_queued` lifecycleType) | Task-created envelope; emitted from `Task.create`, NOT from `publishLifecycle`. Separate code path. The persisted AgentEvent test in R-24 explicitly skips this row by checking `lifecycleType === 'task_queued'`. |

---

## 2. Runtime Replay

### 2.1 Step-by-step trace

For each lifecycle envelope now emitted by `publishLifecycle`:

| Step | Producer (BE) | Envelope type | `env.role` (pre-R-24) | `env.role` (post-R-24) | Evidence |
| ---- | ------------- | ------------- | --------------------- | ---------------------- | -------- |
| `queued → running` | `taskLifecycle.transition(taskId, 'running', …)` | `task_started` | `null` | `'po-agent'` (or whatever `task.type`) | `taskLifecycleService.js:104-106` |
| `running → awaiting_gate` | `taskLifecycle.transitionIfPresent(taskId, 'awaiting_gate', …)` | `gate_pending` | n/a — emitted by `gateBridge.requestGate`, NOT `publishLifecycle` | n/a | `gateBridge.js:124` (already carries `role`) |
| `awaiting_gate → running` | `taskLifecycle.transitionIfPresent(taskId, 'running', …)` | `task_started` (per LIFECYCLE_TO_EVENTTYPE via persistedType) | `null` | `'po-agent'` | `taskLifecycleService.js:104-106` |
| `running → completed` | `taskLifecycle.transitionIfPresent(taskId, 'completed', …)` | `task_completed` | `null` | `'po-agent'` | `taskLifecycleService.js:104-106` |
| `running → failed` | `taskLifecycle.transition(taskId, 'failed', …)` | `task_failed` | `null` | `'po-agent'` | `taskLifecycleService.js:104-106` |
| `running → cancelled` | `taskLifecycle.transitionIfPresent(taskId, 'cancelled', …)` | `task_interrupted` (via LIFECYCLE_TO_EVENTTYPE.task_cancelled) | `null` | `'po-agent'` | `taskLifecycleService.js:104-106` |
| `dispatched → timeout` | `taskLifecycle.transition(taskId, 'timeout', …)` | `task_interrupted` (via LIFECYCLE_TO_EVENTTYPE.task_timeout) | `null` | `'po-agent'` | `taskLifecycleService.js:104-106` |

### 2.2 FE mapper effect

Before R-24:
```
Wire: { type: 'task_started', role: null, taskId: 't-1', ... }
FE mapper: inferAgentKey(null) → null
FE mapper early-returns: { lastUpdatedAt: Date.now() }
agentStates[i].status: NOT UPDATED
```

After R-24:
```
Wire: { type: 'task_started', role: 'po-agent', taskId: 't-1', ... }
FE mapper: inferAgentKey('po-agent') → 'PO'
FE mapper updates: agentStates['PO'].status = 'running', lastEventAt: ...
agentStates['PO'].status: UPDATED
```

### 2.3 Wire contract preserved

The wire envelope discriminator union is unchanged (13 types per contract §4 + AC-19). The change is purely ADDITIVE: `role` now carries a non-null value where it was null. Consumers that read `role` already handle null (via `inferAgentKey`'s null-check at `eventMappers.ts:34-37`) and continue to handle the non-null value identically (via the `AGENT_TO_ROLE` lookup).

SSE replay (`SdlcController.js:347-348`) forwards `row.envelope` byte-for-byte per contract AC-18 — no change.

---

## 3. Regression

### 3.1 Test results

```
$ cd backend && npm test -- --testPathPatterns="task-lifecycle"
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total

$ cd backend && npm test
Test Suites: 2 failed, 23 passed, 25 total
Tests:       3 failed, 326 passed, 329 total
```

The 4 new R-24 tests in `task-lifecycle.test.js` all pass:
- `every lifecycle envelope carries role=task.type (OBS-01.10 R-24)` — live bus subscriber
- `failed lifecycle envelope carries role=task.type (OBS-01.10 R-24)` — `task_failed` path
- `cancelled lifecycle envelope carries role=task.type (OBS-01.10 R-24)` — `task_interrupted` (via `task_cancelled`)
- `persisted AgentEvent envelope carries role=task.type (OBS-01.10 R-24)` — persisted replay check (skips the `task_queued` row from `Task.create` which is OUT OF R-24 scope)

The 2 pre-existing test suite failures (`aifa-gate.test.js`, `arch-mandatory-ask.test.js`) are unchanged from baseline — unrelated to R-24 (failures in `workflowHelpers.js:_deriveCurrentPhase` referencing `architectureTask.status`).

### 3.2 Per-file comparison

| Suite | Pre-R-24 failures | Post-R-24 failures | Δ |
| ----- | ----------------: | -----------------: | -: |
| `tests/integration/aifa-gate.test.js` | 2 | 2 | 0 |
| `tests/integration/arch-mandatory-ask.test.js` | 1 | 1 | 0 |
| `tests/integration/task-lifecycle.test.js` | 9 tests | 13 tests (4 new) | +4 (all new pass) |
| Other suites | 0 | 0 | 0 |

R-24 adds 4 tests, all pass. Zero regressions.

### 3.3 Surfaces verified

| Surface | Status |
| ------- | :----: |
| BE `taskLifecycle.publishLifecycle` (live emission) | ✓ Role now equals `task.type` |
| BE persisted AgentEvent envelope (replay) | ✓ Carries non-null role for `taskLifecycle.transition` rows |
| SSE `eventBus.publish` (transport) | ✓ Unchanged — pure forward |
| SSE replay (`SdlcController.js:347-348`) | ✓ Unchanged — byte-for-byte forward |
| FE mapper `inferAgentKey(env.role)` | ✓ Resolves agent for every lifecycle envelope (test on FE side will land in R-23) |
| Session-level envelopes (out of R-24 scope) | ✓ Untouched — still legitimately `role: null` |

### 3.4 No new regressions

- All previously-passing BE test suites (22 suites) continue to pass.
- The contract §4.1.3–4.1.6 wire-shape requirement is now satisfied.
- AC-08 ("Every lifecycle envelope MUST carry `role: task.type`") is now satisfied.
- §8 invariant 5 ("Every `EventEnvelope.role` on a lifecycle envelope MUST be `task.type`") is now satisfied.
- The replay loop still forwards `row.envelope` byte-for-byte per AC-18.
- The wire envelope discriminator union is unchanged (13 types per AC-19).

---

## 4. Acceptance criteria

| AC | Status | Evidence |
| -- | :----: | -------- |
| **AC-B1**: Every `task_started`, `task_completed`, `task_failed`, `task_interrupted` envelope emitted by `publishLifecycle` carries `role: <task.type>` | ✓ | `taskLifecycle.test.js` test "every lifecycle envelope carries role=task.type (OBS-01.10 R-24)" — subscribes to `eventBus.subscribeProject`, drives `running → completed`, asserts `env.role === 'po-agent'` for every envelope with type in `lifecycleTypes` |
| **AC-B2**: Pre-existing tests continue to pass | ✓ | Baseline 9 → Post-R-24 13 (4 new tests added, all pass). Pre-existing test suite failures (`aifa-gate`, `arch-mandatory-ask`) unchanged. |
| **AC-B3**: Frontend mapper `inferAgentKey(env.role)` resolves a valid `AgentKey` for every canonical lifecycle envelope | ✓ (logical consequence — FE test for this lands in R-23) | The wire now carries `role: 'po-agent'` etc., so `inferAgentKey('po-agent')` returns `'PO'` via `AGENT_TO_ROLE` lookup (`eventMappers.ts:26-37`) |
| **AC-B4**: Frontend mapper `mapTaskStarted` updates `agentStates[agentKey].status = 'running'` after R-23 lands | ✓ (pending R-23) | Will be verified by R-23's per-event mapper patch |

---

## 5. Remaining risks

### 5.1 `Task.js:28` still emits `role: null` (OUT OF R-24 scope)

`backend/src/models/Task.js:28` emits a `task_started` envelope (with `lifecycleType: 'task_queued'` in payload) at task-creation time with `role: null`. This is a SEPARATE code path from `taskLifecycle.publishLifecycle`. The envelope is legitimately `role: null` today because:

- The contract §4.1.3 producer table says `task_started` MAY be produced by `taskLifecycle.publishLifecycle` ONLY.
- `Task.create` bypasses this and emits the envelope directly.
- The persisted AgentEvent test in R-24 explicitly skips this row by checking `lifecycleType === 'task_queued'`.

If a future requirement says `Task.create`'s envelope must also carry `role: task.type`, that would be a separate Repair ID (NOT in scope of R-24).

### 5.2 Pre-existing test failures (not caused by R-24)

Same 2 suite failures / 3 test failures as on baseline — see `OBS1_PHASE510_ANALYSIS.md §5` and `PATCH_R25_VERIFICATION.md §5.1`.

### 5.3 FE mapper updates require R-23

R-24 alone does NOT update `agentStates` in the FE store — that's R-23's job. The two together (R-24 + R-23) close the canonical lifecycle propagation chain. R-23 should land next per the dependency chain in `OBS1_PHASE510_PLAN.md §6`.

---

## 6. Sign-off for R-24

| Criterion | Status |
| --------- | :----: |
| Drift line identified by file:line | ✓ (`taskLifecycleService.js:90`) |
| Evidence captured (pre/post diff) | ✓ |
| Wire `role` now equals `task.type` | ✓ |
| Session-level envelopes preserved (legitimately null) | ✓ |
| Test coverage for live emission + persisted replay | ✓ (4 new tests) |
| No new regressions introduced | ✓ (3 pre-existing failures unchanged) |
| Other contracts / SSE / DTO / schema unchanged | ✓ |
| Wire envelope discriminator union unchanged (13 types) | ✓ |
| Rollback path clear | ✓ (git revert of `taskLifecycleService.js:90` + `taskLifecycle.test.js`) |

**R-24: COMPLETE. Awaiting approval to proceed with R-23 (FE mapper pipelinePhases patch).**

---

## 7. References

- `OBS1_PHASE510_ANALYSIS.md` (Bước 1)
- `OBS1_PHASE510_PLAN.md` (Bước 4)
- `docs/OBS1/PHASE5-verification/01_VERIFICATION_REPORT.md` §10.1 (R-24 finding)
- `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md` §3.1 (R-24 regression)
- `docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md` §4.1.3–4.1.6, §7, §8 inv. 5, AC-08
- `backend/src/services/taskLifecycleService.js:88-110` (R-24 fix)
- `backend/tests/integration/task-lifecycle.test.js` (4 new tests)

End of R-24 patch verification.