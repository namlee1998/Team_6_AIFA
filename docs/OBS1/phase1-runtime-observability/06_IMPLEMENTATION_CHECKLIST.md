# 06 — Implementation Checklist

> **Status:** IMPLEMENTATION CHECKLIST.
> Per-stage breakdown of every observable piece of OBS-01.
> No patches, no code, no diffs. Each row lists: the producer,
> the transport, the reducer, the selector, the view-model, the
> Dashboard, the Agent Task page, the Inspector, the timeline,
> the badge, the colour, the animation, the regression tests,
> the visual regression, the acceptance criteria.
>
> Nothing may be marked complete without evidence. Each
> completion evidence is a pointer to the file:line of the
> change AND the test that exercises it.
>
> Owners and dependencies are recorded per row. Rollback
> strategy is recorded per row. The checklist is grouped by
> the eight implementation phases OBS-01.1 through OBS-01.8.
>
> Evidence rule: every concrete claim cites a `file:line`.
> Where evidence is missing the document explicitly writes
> "Evidence not found." — it does not infer.

---

## OBS-01.1 — Producer verification (BE)

**Purpose:** Verify that the canonical producer layer emits the
correct state, in the correct order, with the correct role.

### OBS-01.1.a — `taskLifecycle.publishLifecycle` propagates `role`

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `publishLifecycle` (canonical lifecycle publisher) | `backend/src/services/taskLifecycleService.js:78-93` |
| Owner | `taskLifecycleService` module | (single owner) |
| Dependencies | none | (no upstream changes required) |
| Verification method | Manual: a unit test asserts the `base.role` arg equals `task.type` for every `publishEvent` call inside `publishLifecycle`. Pre-existing integration test: `backend/tests/integration/task-lifecycle.test.js` exercises the matrix. | `task-lifecycle.test.js` (existing) |
| Rollback strategy | Revert the `role: task.type` change; the wire envelope returns to `role: null`; the FE mappers continue to early-return (no worse than today). | git revert |
| Completion evidence | (a) the `base.role` value at `taskLifecycleService.js:90` is `task.type`; (b) `task-lifecycle.test.js` passes; (c) a manual SSE dump shows `role: 'po-agent'` etc. on every lifecycle envelope. | tbd |

### OBS-01.1.b — `SdlcWorkflowService.getPipelineResponse` reads `executionStatus`

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `toPhaseStatus` helper | `backend/src/services/SdlcWorkflowService.js:1253-1264` |
| Owner | `SdlcWorkflowService` module | (single owner) |
| Dependencies | depends on OBS-01.1.a | (the snapshot now reads canonical state) |
| Verification method | Manual: a unit test asserts `toPhaseStatus(agent, {executionStatus:'running'})` returns `status: 'running'`; `toPhaseStatus(agent, {executionStatus:'awaiting_gate'})` returns `status: 'gate_pending'`; etc. | (no existing test) |
| Rollback strategy | Revert `phaseData.executionStatus` reads back to `phaseData.status`; the snapshot returns to the legacy projection. | git revert |
| Completion evidence | (a) the `status` variable at `SdlcWorkflowService.js:1256` reads from `phaseData.executionStatus`; (b) the projection map covers all 8 canonical states; (c) the SSE snapshot payload reflects `pipelinePhases[i].status` derived from the canonical machine. | tbd |

### OBS-01.1.c — `agentDispatcher.runAgent` writes `'running'` (not `'processing'`)

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `agentDispatcher.runAgent` | `backend/src/services/agentDispatcher.js:312` |
| Owner | `agentDispatcher` module | (single owner for the legacy field) |
| Dependencies | partial subset of existing backlog R-029 / DR-012 | (orchestrated; OBS-01 does not require the full R-029 fix) |
| Verification method | Manual: a unit test asserts `Task.update(task.id, {status:'running'})` is called when the agent starts. | (no existing test) |
| Rollback strategy | Revert the `'processing'` → `'running'` change; the legacy field remains `'processing'` (no worse than today). | git revert |
| Completion evidence | (a) `agentDispatcher.js:312` reads `status: 'running'`; (b) the FE `PhaseStatus.status` enum (`sdlcApi.ts:73`) already contains `'running'`; (c) the `getPipelineResponse` snapshot now sees `Task.status === 'running'` for an active agent. | tbd |

---

## OBS-01.2 — Transport verification (BE SSE controller)

**Purpose:** Verify that the SSE controller emits the snapshot
correctly and that no other transport path is required.

### OBS-01.2.a — `session_started` snapshot publishes canonical phases

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `streamPipelineStatus` | `backend/src/controllers/SdlcController.js:367-378` |
| Owner | `SdlcController` module | (single owner of the SSE transport) |
| Dependencies | OBS-01.1.b | (the snapshot reads from `getPipelineResponse`) |
| Verification method | Manual: connect to `/api/v1/sdlc/stream/<sessionId>`, observe the first envelope's `payload.pipelinePhases[i].status` matches the canonical machine. | (no existing test for the SSE controller's snapshot shape) |
| Rollback strategy | Revert OBS-01.1.b (the `toPhaseStatus` reader); the snapshot returns to the legacy projection. | git revert OBS-01.1.b |
| Completion evidence | (a) the first SSE frame after connect is `session_started`; (b) its `payload.pipelinePhases` matches the canonical projection in `05_CANONICAL_RUNTIME_STATE.md §3.1`. | tbd |

### OBS-01.2.b — `session_resumed` snapshot re-publishes canonical phases

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `streamPipelineStatus` (reconnect branch) | `backend/src/controllers/SdlcController.js:366` (`snapshotType = isResume ? 'session_resumed' : 'session_started'`) |
| Owner | `SdlcController` module | (same owner as OBS-01.2.a) |
| Dependencies | OBS-01.2.a | (reconnect re-uses the snapshot producer) |
| Verification method | Manual: reconnect to the SSE stream with `Last-Event-ID` set; observe the `session_resumed` frame carries the same `pipelinePhases` shape as `session_started`. | (no existing test) |
| Rollback strategy | The `session_resumed` frame is published via the same `publishEvent` call; reverting OBS-01.1.b undoes both. | git revert OBS-01.1.b |
| Completion evidence | (a) reconnect produces a `session_resumed` frame; (b) the frame carries `payload.pipelinePhases`. | tbd |

### OBS-01.2.c — `pipeline_completed` (R-001) is persisted

This item is owned by Batch D step 1 (existing backlog R-001).
OBS-01 does NOT touch it. Listed here for completeness.

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `releaseManager.submitReleaseDecision` | `backend/src/services/releaseManager.js:173-186` |
| Owner | `releaseManager` module | (Batch D) |
| Dependencies | Batch C step 2 (R-041 single-emitter) | (existing backlog) |
| Verification method | Manual: after a release APPROVE, query `AgentEvent` table for `type='pipeline_completed'` rows. | (existing backlog R-001) |
| Rollback strategy | Drop the new `AgentEvent.create` call. | git revert |
| Completion evidence | (a) `pipeline_completed` row exists in `AgentEvent` after release APPROVE; (b) `getAuditTrail` includes the terminal phase. | tbd (out of OBS-01 scope) |

---

## OBS-01.3 — Store verification (FE reducer family)

**Purpose:** Verify that the FE reducers update BOTH
`agentStates[i].status` and `pipelinePhases[i].status` for every
lifecycle event.

### OBS-01.3.a — `mapTaskStarted` writes both fields

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `mapTaskStarted` | `frontend/src/store/eventMappers.ts:215-227` |
| Owner | `eventMappers` module | (single owner of the FE reducer family) |
| Dependencies | OBS-01.1.a (`role: task.type` on the wire) | (the mapper needs the role to identify the agent) |
| Verification method | Unit test: a FE mapper unit test asserts that a `task_started` envelope with `role: 'po-agent'`, `taskId: 't-1'` updates `state.agentStates.PO.status = 'running'` AND `state.pipelinePhases.find(p => p.agent === 'PO').status = 'running'`. | (no existing test — gap noted in `02_REPAIR_BATCHES.md` Batch OBS-01 test gaps) |
| Rollback strategy | Revert the mapper; the FE returns to the existing early-return behaviour (no worse than today). | git revert |
| Completion evidence | (a) the mapper branch at `eventMappers.ts:218-227` (after the early-return guard) patches both fields; (b) the unit test passes. | tbd |

### OBS-01.3.b — `mapTaskCompleted` writes both fields

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `mapTaskCompleted` | `frontend/src/store/eventMappers.ts:229-244` |
| Owner | `eventMappers` module | (same as OBS-01.3.a) |
| Dependencies | OBS-01.1.a | |
| Verification method | Unit test: a `task_completed` envelope with `role: 'dev-agent'` updates `state.agentStates.DEV.status = 'completed'` AND `state.pipelinePhases.find(p => p.agent === 'DEV').status = 'completed'`. | (gap) |
| Rollback strategy | git revert | |
| Completion evidence | mapper branch updated; unit test passes. | tbd |

### OBS-01.3.c — `mapTaskFailed` writes both fields

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `mapTaskFailed` | `frontend/src/store/eventMappers.ts:246-260` |
| Owner | `eventMappers` module | |
| Dependencies | OBS-01.1.a | |
| Verification method | Unit test: a `task_failed` envelope updates both fields to `'failed'`. | (gap) |
| Rollback strategy | git revert | |
| Completion evidence | mapper branch updated; unit test passes. | tbd |

### OBS-01.3.d — `mapTaskInterrupted` writes both fields

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `mapTaskInterrupted` | `frontend/src/store/eventMappers.ts:262-276` |
| Owner | `eventMappers` module | |
| Dependencies | OBS-01.1.a | |
| Verification method | Unit test: a `task_interrupted` envelope updates both fields to `'skipped'`. | (gap) |
| Rollback strategy | git revert | |
| Completion evidence | mapper branch updated; unit test passes. | tbd |

### OBS-01.3.e — `mapSessionResumed` applies the snapshot payload

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `mapSessionResumed` | `frontend/src/store/eventMappers.ts:210-213` |
| Owner | `eventMappers` module | |
| Dependencies | OBS-01.2.b (reconnect snapshot carries `pipelinePhases`) | |
| Verification method | Unit test: a `session_resumed` envelope updates `state.pipelinePhases` (currently a no-op). | (gap) |
| Rollback strategy | Restore the no-op behaviour (return `{}`). | git revert |
| Completion evidence | mapper branch updated; unit test passes. | tbd |

---

## OBS-01.4 — Selectors (FE projection)

**Purpose:** Verify that the FE projection (`selectRuntimeExecution`)
promotes `agentStates[i].status` into `phases[i].status` for every
canonical state, not just `awaiting_review`.

### OBS-01.4.a — `selectRuntimeExecution` merges all canonical states

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `selectRuntimeExecution` | `frontend/src/store/workflowSelectors.ts:216-317` |
| Owner | `workflowSelectors` module | (single owner of the projection) |
| Dependencies | OBS-01.3.a–e (mappers must populate `agentStates`) | |
| Verification method | Unit test: a `SessionState` with `agentStates.DEV.status = 'running'` projects to `phases.find(p => p.agent === 'DEV').status === 'running'`. Repeat for `'completed'`, `'failed'`, `'skipped'`, `'awaiting_review'`. | (gap) |
| Rollback strategy | Restore the merge loop at `workflowSelectors.ts:251-255` to its existing single-value form (`'awaiting_review'` only). | git revert |
| Completion evidence | merge loop updated; unit tests pass. | tbd |

### OBS-01.4.b — `currentAgent` derivation is preserved

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Producer | `selectRuntimeExecution` | `frontend/src/store/workflowSelectors.ts:224-231` |
| Owner | `workflowSelectors` module | |
| Dependencies | OBS-01.4.a | (depends on the merge loop being intact) |
| Verification method | Existing behaviour preserved. | (no change required) |
| Rollback strategy | N/A — unchanged. | |
| Completion evidence | behaviour unchanged after OBS-01.4.a lands. | tbd |

---

## OBS-01.5 — Dashboard rendering

**Purpose:** Verify that the Dashboard pipeline strip, the
session monitor card, and the dashboard cards render the
canonical states correctly.

### OBS-01.5.a — Pipeline strip renders every canonical state

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `OverviewPage` pipeline strip | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx:234-249` |
| Owner | `OverviewPage.tsx` | (single owner of the Dashboard pipeline strip) |
| Dependencies | OBS-01.4.a (selector must project correctly) | |
| Verification method | Manual: a Dashboard session whose `agentStates.ARCH.status === 'running'` shows the ARCH dot in the blue `bg-blue-500/20 text-blue-300` colour with the `…` glyph (per `PhaseStatusLabel:363`). | (manual; existing tests cover only the empty state and the session-list rendering) |
| Rollback strategy | The strip already renders every canonical value today; OBS-01 only changes the input. No rollback required. | (no change) |
| Completion evidence | (a) `OverviewPage.tsx:240-249` renders the same colour for the same input; (b) the visual regression baseline (see OBS-01.8) is captured. | tbd |

### OBS-01.5.b — Session monitor card renders `currentAgent`

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `OverviewPage` per-session card | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx:184-275` |
| Owner | `OverviewPage.tsx` | |
| Dependencies | OBS-01.4.b (`currentAgent` derivation) | |
| Verification method | Manual: a Dashboard session whose `agentStates.DEV.status === 'running'` shows the "DEV running" line with the spinning Loader2 icon. | (manual) |
| Rollback strategy | No code change required at the view layer. | |
| Completion evidence | behaviour unchanged after OBS-01.4.b lands. | tbd |

### OBS-01.5.c — Dashboard cards (Completed / Files / Errors / Warnings)

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `SessionSummaryBar` | `frontend/src/pages/SdlcDashboard/index.tsx:387-487` |
| Owner | `SdlcDashboard/index.tsx` | |
| Dependencies | none (reads `session.pipelinePhases` directly; OBS-01.1.b feeds the snapshot) | |
| Verification method | Manual: the "Completed" card shows `completed / 5` correctly after the pipeline runs. | (manual) |
| Rollback strategy | No code change required. | |
| Completion evidence | behaviour unchanged. | tbd |

---

## OBS-01.6 — Agent Task rendering

**Purpose:** Verify that the Agent Task card (border, chip,
per-task icons, badge text) renders the canonical states correctly.

### OBS-01.6.a — Card border reflects the canonical state

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `SdlcDashboard` per-agent card | `frontend/src/pages/SdlcDashboard/index.tsx:306-313` |
| Owner | `SdlcDashboard/index.tsx` | |
| Dependencies | OBS-01.4.a | |
| Verification method | Manual: the ARCH card border is `border-blue-500/30` when `runtime.phases[ARCH].status === 'running'`; `border-emerald-500/20` when `'completed'`; `border-red-500/30` when `'failed'`; `border-dashed border-outline-variant/20` when `'skipped'`. | (manual) |
| Rollback strategy | No code change required at the view layer; OBS-01 only changes the input. | (no change) |
| Completion evidence | visual regression baseline captured (OBS-01.8). | tbd |

### OBS-01.6.b — Chip text + chip background reflect the canonical state

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `PhaseChip` | `frontend/src/pages/SdlcDashboard/index.tsx:503-516` |
| Owner | `SdlcDashboard/index.tsx` | |
| Dependencies | OBS-01.4.a | |
| Verification method | Manual: the ARCH chip reads `RUNNING` with `bg-blue-500/20 text-blue-300` background when running; `COMPLETED` with `bg-emerald-500/20 text-emerald-400` when completed; etc. | (manual) |
| Rollback strategy | No code change required. | (no change) |
| Completion evidence | visual regression baseline captured. | tbd |

### OBS-01.6.c — Per-task icons + dot colours reflect the canonical state

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | per-task rendering | `frontend/src/pages/SdlcDashboard/index.tsx:331-345` |
| Owner | `SdlcDashboard/index.tsx` | |
| Dependencies | OBS-01.4.a | |
| Verification method | Manual: the first task of an agent whose `phaseStatus === 'running'` shows the `Loader2 animate-spin text-blue-500` icon; `completed` shows `Check text-emerald-500`; etc. | (manual) |
| Rollback strategy | No code change required. | (no change) |
| Completion evidence | visual regression baseline captured. | tbd |

### OBS-01.6.d — SessionPill reflects the session-level status

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `SessionPill` | `frontend/src/pages/SdlcDashboard/index.tsx:364-385` |
| Owner | `SdlcDashboard/index.tsx` | |
| Dependencies | none (reads `session.status`; OBS-01.1.b may update its initial value) | |
| Verification method | Manual: the session pill reads `RUNNING` (blue) when `session.status === 'running'`; `AWAITING RELEASE` (amber) when `'awaiting_release'`; etc. | (manual) |
| Rollback strategy | No code change required. | (no change) |
| Completion evidence | visual regression baseline captured. | tbd |

### OBS-01.6.e — SessionSummaryBar pipeline status text

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `SessionSummaryBar` pipeline status label | `frontend/src/pages/SdlcDashboard/index.tsx:413-420` |
| Owner | `SdlcDashboard/index.tsx` | |
| Dependencies | OBS-01.4.a (`currentAgent` derivation) | |
| Verification method | Manual: the summary bar reads "Running · ARCH" when ARCH is the running agent. | (manual) |
| Rollback strategy | No code change required. | (no change) |
| Completion evidence | visual regression baseline captured. | tbd |

---

## OBS-01.7 — Inspector rendering

**Purpose:** Verify that the Inspector tabs render the canonical
gates and decisions correctly.

### OBS-01.7.a — Questions tab renders `kind: 'question' | 'tool'`

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `InspectorPanel` questions tab | `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx:55-114` |
| Owner | `InspectorPanel.tsx` | |
| Dependencies | none (reads `session.pendingGates`; OBS-01 does not change gate creation) | |
| Verification method | Manual: a pending tool gate renders in the questions tab with an amber tab badge. | (manual) |
| Rollback strategy | No code change required. | (no change) |
| Completion evidence | behaviour unchanged. | tbd |

### OBS-01.7.b — Output review tab renders `kind: 'output_review' | 'release'`

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `InspectorPanel` review tab | `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx:55-114` |
| Owner | `InspectorPanel.tsx` | |
| Dependencies | none | |
| Verification method | Manual: a pending output-review gate renders in the review tab with an indigo tab badge. | (manual) |
| Rollback strategy | No code change required. | (no change) |
| Completion evidence | behaviour unchanged. | tbd |

### OBS-01.7.c — Decision history tab renders `gateHistory`

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| View | `InspectorPanel` decisions tab | `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx:114` |
| Owner | `InspectorPanel.tsx` | |
| Dependencies | none | |
| Verification method | Manual: the decisions tab lists every `gateHistory` entry. | (manual) |
| Rollback strategy | No code change required. | (no change) |
| Completion evidence | behaviour unchanged. | tbd |

---

## OBS-01.8 — Visual regression

**Purpose:** Capture a visual regression baseline BEFORE the
OBS-01 fix lands so that any colour / layout drift is detectable.

### OBS-01.8.a — Snapshot every visual state

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Owner | Phase 4 implementation engineer | (no current owner; OBS-01 introduces this) |
| Dependencies | OBS-01.1 through OBS-01.7 complete | |
| Verification method | Capture a snapshot of every visible state in §3.1 of `05_CANONICAL_RUNTIME_STATE.md` for both the Dashboard and the Agent Task page. Compare before/after. | (no current visual regression suite) |
| Rollback strategy | Restore the pre-OBS-01 CSS maps if the visual diff exceeds acceptable drift. | (no change yet) |
| Completion evidence | (a) pre-OBS-01 snapshot archive stored at a known path; (b) post-OBS-01 snapshot archive; (c) visual diff report. | tbd |

### OBS-01.8.b — Snapshot every session-level state

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Owner | Phase 4 implementation engineer | (no current owner) |
| Dependencies | OBS-01.8.a | |
| Verification method | Capture a snapshot of the SessionPill + SessionSummaryBar for every session-level state in §2.12 of `05_CANONICAL_RUNTIME_STATE.md`. | (no current visual regression suite) |
| Rollback strategy | Restore pre-OBS-01 if drift detected. | |
| Completion evidence | snapshot archive. | tbd |

### OBS-01.8.c — Snapshot the Inspector

| Item | Detail | Evidence / file:line |
| ---- | ------ | --------------------- |
| Owner | Phase 4 implementation engineer | (no current owner) |
| Dependencies | OBS-01.7 | |
| Verification method | Capture a snapshot of every Inspector tab with a pending gate of each `kind`. | (no current visual regression suite) |
| Rollback strategy | Restore pre-OBS-01 if drift detected. | |
| Completion evidence | snapshot archive. | tbd |

---

## Cross-cutting test gaps

OBS-01 surfaces the following test gaps that Phase 4 must close
(no edits in Phase 3.5; just enumeration):

| Gap | Test file to add | What it exercises |
| --- | ---------------- | ----------------- |
| `taskLifecycleService.publishLifecycle` propagates `role: task.type` | `backend/tests/integration/task-lifecycle.test.js` (extend existing) | every lifecycle event has the role on the wire |
| `toPhaseStatus` reads `executionStatus` | `backend/tests/integration/workflow-report.test.js` (extend) | the snapshot's `pipelinePhases[i].status` derives from canonical |
| `mapTaskStarted` patches `pipelinePhases` | `frontend/tests/eventMappers.test.ts` (new) | FE reducer updates both fields |
| `mapTaskCompleted` patches `pipelinePhases` | `frontend/tests/eventMappers.test.ts` | same |
| `mapTaskFailed` patches `pipelinePhases` | `frontend/tests/eventMappers.test.ts` | same |
| `mapTaskInterrupted` patches `pipelinePhases` | `frontend/tests/eventMappers.test.ts` | same |
| `mapSessionResumed` applies the snapshot | `frontend/tests/eventMappers.test.ts` | reconnect refreshes phases |
| `selectRuntimeExecution` merges all canonical states | `frontend/tests/workflowSelectors.test.ts` (new) | every canonical state is projected |

These tests do NOT yet exist in the repo. Phase 3.5 only
records the gaps; Phase 4 writes the tests.

---

## Acceptance criteria summary

OBS-01 is COMPLETE when ALL of the following hold:

1. The wire envelope carries `role: task.type` on every lifecycle
   event (OBS-01.1.a). Evidence: a manual SSE dump.
2. The SSE snapshot's `pipelinePhases[i].status` is derived from
   `Task.executionStatus`, not `Task.status` (OBS-01.1.b).
   Evidence: a unit test on `toPhaseStatus`.
3. Every FE mapper (OBS-01.3.a–e) patches both `agentStates` and
   `pipelinePhases`. Evidence: the unit tests enumerated in the
   cross-cutting test gaps table.
4. `selectRuntimeExecution` (OBS-01.4.a) merges every canonical
   state. Evidence: the unit test on the selector.
5. Dashboard, Agent Task, and Inspector render every canonical
   state with the same colour and the same badge text. Evidence:
   OBS-01.8 visual regression snapshots.
6. The wire shape change is additive; no existing envelope key
   changes. Evidence: a diff of the wire contract.
7. The change is behind the feature flag
   `OBS_01_RUNTIME_OBSERVABILITY=true` (default off). Rollback =
   flip the flag.

If any item cannot be verified, OBS-01 is NOT COMPLETE.

---

## NOT VERIFIED

- Whether the pre-existing tests in
  `backend/tests/integration/task-lifecycle.test.js`,
  `backend/tests/integration/eventBus.test.js`, or
  `backend/tests/integration/gateBridge.subscribeProject.test.js`
  exercise the role propagation. Phase 4 to grep.
- Whether the FE mapper tests (new in OBS-01.3.a–e) require
  any zustand mock setup beyond what
  `frontend/tests/SdlcDashboard.test.tsx` already does. Phase 4
  to inspect.
- Whether the visual regression baseline tooling exists in
  the repo. Phase 4 to grep.