# 04 — Repair Proposal

> **Status:** DESIGN ONLY.
> Canonical owner, recommended repair batch, dependencies, risk,
> rollback considerations, implementation order, acceptance
> criteria, and risk assessment for the agent runtime visualization
> drift.
>
> No code, no patches, no TODO comments. Production code
> unchanged.

---

## 1. The single repair item (R-047)

**Title:** Agent runtime visualization drift.

**Severity:** HIGH.

**Category:** Runtime Observability.

**Affected modules:**

- Backend:
  - `backend/src/services/taskLifecycleService.js:78-93`
    (`publishLifecycle` — `role: null`).
  - `backend/src/services/agentDispatcher.js:312`
    (`Task.status = 'processing'`).
  - `backend/src/services/SdlcWorkflowService.js:1256`
    (`pipelinePhases` built from `Task.status`).
  - `backend/src/controllers/SdlcController.js:367-378`
    (single snapshot per SSE connection).
- Frontend:
  - `frontend/src/store/eventMappers.ts:199-213`
    (`mapSessionStarted` writes `pipelinePhases`;
    `mapSessionResumed` returns `{}`).
  - `frontend/src/store/eventMappers.ts:215-292`
    (every task-lifecycle mapper early-returns when
    `env.role` is null).
  - `frontend/src/store/workflowSelectors.ts:247-264`
    (`phases` array built from `pipelinePhases`; single
    merge from `agentStates` for `awaiting_review` only).
  - `frontend/src/pages/SdlcDashboard/index.tsx:181-201,
    306, 324` (border / chip / per-task derived from
    `ps = pipelinePhases[i].status`).
  - `frontend/src/pages/SdlcDashboard/OverviewPage.tsx:234-249`
    (pipeline strip colour from `pipelinePhases[i].status`).
  - `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:178-183`
    (dot colour from `pipelinePhases[i].status`).

**Evidence documents:**

- `docs/runtime-observability/01_RUNTIME_STATE_TRACE.md`
  (full producer → consumer trace).
- `docs/runtime-observability/02_FRONTEND_STATE_MAPPING.md`
  (FE rendering chain).
- `docs/runtime-observability/03_DRIFT_ANALYSIS.md`
  (drift catalogue D-1 through D-9).
- `docs/runtime-observability/05_CANONICAL_RUNTIME_STATE.md`
  (canonical state spec, mapping table).
- `docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md`
  (per-stage checklist).

---

## 2. Canonical runtime state ownership

### 2.1 The single-owner rule

Runtime visualization MUST have exactly one owner per state.
This is a non-negotiable rule derived from
`docs/engineering-freeze/01_SYSTEM_OVERVIEW.md §7` and
`.claude/CLAUDE.md` ("One artifact. One owner. Never create
shared ownership.").

Without a single owner per state, the visible UI drifts because
multiple producers each emit a slightly different value, and
each consumer picks a different field. This is exactly the bug
that R-047 documents (per `03_DRIFT_ANALYSIS.md` D-7).

### 2.2 The canonical owner per state

Per `05_CANONICAL_RUNTIME_STATE.md §3.4`, the ownership is:

| State aspect | Owner | Producer file:line |
| ------------ | ----- | ------------------- |
| Canonical backend state | `Task.executionStatus` | `backend/src/services/taskLifecycleService.js:11-21` (governed by `TRANSITIONS` matrix) |
| Wire envelope type | `eventPublisher.publishEvent` (single facade) | `backend/src/services/eventPublisher.js:17-28` |
| `PhaseStatus.status` (visible) | `selectRuntimeExecution.phases` | `frontend/src/store/workflowSelectors.ts:247-264` |
| `AgentState.status` (visible) | `applyEnvelope` mappers | `frontend/src/store/eventMappers.ts:100-336` |
| Badge text | `PhaseChip` reading `status.replace('_', ' ')` | `frontend/src/pages/SdlcDashboard/index.tsx:503-516` |
| Border colour class | `COLUMN_BORDER` map | `frontend/src/pages/SdlcDashboard/index.tsx:76-83` |
| Chip background class | `PhaseChip` cfg map | `frontend/src/pages/SdlcDashboard/index.tsx:504-510` |
| Per-task icon | `TASK_ICON` map | `frontend/src/pages/SdlcDashboard/index.tsx:44-51` |
| Animation | `TASK_ICON` class attribute | `frontend/src/pages/SdlcDashboard/index.tsx:44-51` |

Each row above has EXACTLY ONE owner. No state has two producers.
No state has two consumers (the same `runtime.phases[i].status`
value drives both the Dashboard and the Agent Task page — this
is the single-source projection).

### 2.3 Why runtime visualization needs exactly one owner

The reason is concrete: today the codebase has FOUR parallel state
views on the same agent (per `03_DRIFT_ANALYSIS.md` D-7):

1. `Task.executionStatus` (canonical, governed).
2. `Task.status` (legacy, free-form, 8 writers).
3. `pipelinePhases[i].status` (BE snapshot, frozen at SSE connect).
4. `agentStates[i].status` (FE-only, dormant for the canonical
   path).

Each consumer reads a different field. The visible UI
inconsistency is a direct consequence. To restore runtime
visibility, OBS-01 reduces these four views to two (canonical
backend state + a single FE projection) and enforces that the
FE projection is computed from the canonical state for every
transition.

### 2.4 What "exactly one owner" means in practice

After OBS-01 lands, the following invariants hold:

- A change to `Task.executionStatus` on the backend MUST flow to
  the visible FE `PhaseStatus.status` within one SSE round-trip.
- The SSE envelope that carries the change MUST carry the
  agent's role on the wire (per `05_CANONICAL_RUNTIME_STATE.md
  §3.4`).
- The FE mapper for that envelope MUST patch BOTH
  `agentStates[agentKey].status` AND
  `pipelinePhases[i].status` in the same patch.
- The `selectRuntimeExecution` projection MUST promote
  `agentStates[i].status` into `phases[i].status` for every
  canonical state (not only `awaiting_review`).
- The CSS maps (`COLUMN_BORDER`, `TASK_ICON`, `PhaseChip`) MUST
  NOT change.

---

## 3. Implementation order

OBS-01 is broken into eight implementation phases. Each phase
has a single owner, a single verification method, and a clear
rollback strategy. The phases MUST land in order; each phase
is independently revertible.

### OBS-01.1 — Producer verification (BE)

- **Scope:** `backend/src/services/taskLifecycleService.js`
  (publishLifecycle propagates `role: task.type`);
  `backend/src/services/SdlcWorkflowService.js`
  (toPhaseStatus reads `executionStatus`);
  `backend/src/services/agentDispatcher.js`
  (`'processing'` → `'running'`).
- **Owner:** Backend engineer.
- **Dependencies:** none.
- **Rollback:** revert the three files; no FE change required.
- **Completion evidence:** (a) SSE dump shows `role: 'po-agent'`
  on the wire; (b) unit test on `toPhaseStatus` covers all 8
  canonical states; (c) pre-existing
  `backend/tests/integration/task-lifecycle.test.js` passes.

### OBS-01.2 — Transport verification (BE SSE controller)

- **Scope:** `backend/src/controllers/SdlcController.js:367-378`
  (snapshot publishes canonical phases; reconnect re-publishes).
- **Owner:** Backend engineer.
- **Dependencies:** OBS-01.1.b (snapshot reads from canonical
  machine).
- **Rollback:** revert to the legacy projection.
- **Completion evidence:** (a) SSE connect produces a
  `session_started` frame with `payload.pipelinePhases` matching
  the canonical projection; (b) SSE reconnect produces a
  `session_resumed` frame with the same shape.

### OBS-01.3 — Store verification (FE reducer family)

- **Scope:** `frontend/src/store/eventMappers.ts:215-292`
  (every lifecycle mapper patches both fields);
  `eventMappers.ts:210-213` (mapSessionResumed applies the
  snapshot).
- **Owner:** Frontend engineer.
- **Dependencies:** OBS-01.1.a (the wire envelope must carry
  `role: task.type`).
- **Rollback:** revert the mappers; the FE returns to the
  existing early-return behaviour.
- **Completion evidence:** (a) the new mapper branches exist;
  (b) new mapper unit tests pass; (c) pre-existing
  `frontend/tests/SdlcDashboard.test.tsx` still passes (no
  regression).

### OBS-01.4 — Selectors (FE projection)

- **Scope:** `frontend/src/store/workflowSelectors.ts:251-255`
  (extend the merge loop to cover `'running'`, `'completed'`,
  `'failed'`, `'skipped'`).
- **Owner:** Frontend engineer.
- **Dependencies:** OBS-01.3 (mappers must populate
  `agentStates`).
- **Rollback:** restore the single-value merge loop.
- **Completion evidence:** (a) the merge loop covers every
  canonical state; (b) new selector unit tests pass.

### OBS-01.5 — Dashboard rendering

- **Scope:** `frontend/src/pages/SdlcDashboard/OverviewPage.tsx`
  (pipeline strip, session monitor card, dashboard cards).
- **Owner:** Frontend engineer.
- **Dependencies:** OBS-01.4 (selector must project correctly).
- **Rollback:** no code change required; OBS-01 only changes
  the input.
- **Completion evidence:** (a) the pipeline strip renders
  every canonical state with the colour from `05_CANONICAL_RUNTIME_STATE.md
  §3.1`; (b) the session monitor card shows the running agent
  with the spinning Loader2 icon; (c) the visual regression
  baseline (OBS-01.8) confirms the layout matches the spec.

### OBS-01.6 — Agent Task rendering

- **Scope:** `frontend/src/pages/SdlcDashboard/index.tsx:306-345,
  364-385, 387-487` (per-agent card, SessionPill, SessionSummaryBar).
- **Owner:** Frontend engineer.
- **Dependencies:** OBS-01.4 (selector must project correctly).
- **Rollback:** no code change required.
- **Completion evidence:** (a) every canonical state renders
  the correct border, chip text, chip background, per-task icon,
  and per-task dot colour (per `05_CANONICAL_RUNTIME_STATE.md
  §3.1`); (b) the visual regression baseline (OBS-01.8) confirms
  the layout matches the spec.

### OBS-01.7 — Inspector rendering

- **Scope:** `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx`
  (questions tab, output review tab, decision history tab).
- **Owner:** Frontend engineer.
- **Dependencies:** none (the Inspector reads `pendingGates`
  and `gateHistory` only; OBS-01 does not change gate creation).
- **Rollback:** no code change required.
- **Completion evidence:** (a) every pending gate of each
  `kind` (`'question'`, `'tool'`, `'output_review'`,
  `'release'`) renders in the correct tab with the correct
  tab badge colour; (b) the visual regression baseline
  (OBS-01.8) confirms the layout matches the spec.

### OBS-01.8 — Visual regression

- **Scope:** capture pre-OBS-01 and post-OBS-01 snapshots of
  every state in `05_CANONICAL_RUNTIME_STATE.md §3.1` for
  Dashboard, Agent Task, and Inspector.
- **Owner:** Phase 4 implementation engineer.
- **Dependencies:** OBS-01.1 through OBS-01.7 complete.
- **Rollback:** restore the pre-OBS-01 CSS maps if drift
  exceeds acceptable limits.
- **Completion evidence:** (a) pre-OBS-01 snapshot archive;
  (b) post-OBS-01 snapshot archive; (c) visual diff report.

### Implementation order summary

```
OBS-01.1 (Producer)        ── no upstream dependency
OBS-01.2 (Transport)       ── depends on OBS-01.1.b
OBS-01.3 (Store/Reducer)   ── depends on OBS-01.1.a
OBS-01.4 (Selector)        ── depends on OBS-01.3
OBS-01.5 (Dashboard)       ── depends on OBS-01.4
OBS-01.6 (Agent Task)      ── depends on OBS-01.4
OBS-01.7 (Inspector)       ── independent (no change required)
OBS-01.8 (Visual reg.)     ── depends on OBS-01.5 + OBS-01.6 + OBS-01.7
```

OBS-01.1 and OBS-01.7 can land in parallel. The remaining
phases are sequential.

---

## 4. Acceptance criteria

OBS-01 is COMPLETE when EVERY runtime state in `05_CANONICAL_RUNTIME_STATE.md §2` has exactly one visual representation, and Dashboard, Agent Task, and Inspector never disagree.

### 4.1 Per-state acceptance criteria

For each of the 8 canonical states (`queued`, `dispatched`,
`running`, `awaiting_gate`, `completed`, `failed`, `cancelled`,
`timeout`):

| # | Criterion | Verification | Acceptance threshold |
| - | --------- | ------------ | --------------------- |
| 1 | The backend `Task.executionStatus` is the canonical source | unit test on `toPhaseStatus` | passes for all 8 states |
| 2 | The wire envelope carries `role: task.type` | SSE dump on a live session | manual pass |
| 3 | The FE mapper patches both `agentStates` and `pipelinePhases` | new mapper unit tests | passes for all 8 states |
| 4 | `selectRuntimeExecution.phases[i].status` reflects the canonical state | new selector unit test | passes for all 8 states |
| 5 | The Dashboard pipeline strip renders the correct colour | manual visual review + OBS-01.8 snapshot | matches `05_CANONICAL_RUNTIME_STATE.md §3.1` row for that state |
| 6 | The Agent Task card renders the correct border + chip + per-task icon | manual visual review + OBS-01.8 snapshot | matches `05_CANONICAL_RUNTIME_STATE.md §3.1` row for that state |
| 7 | The Inspector tabs render the correct pending gates | manual visual review + OBS-01.8 snapshot | matches the gate kind |
| 8 | Dashboard and Agent Task NEVER disagree on the same input | manual visual review | same `PhaseStatus.status` value renders the same colour on both pages |

### 4.2 Per-component acceptance criteria

| Component | Criterion |
| --------- | --------- |
| Dashboard (OverviewPage) | renders all 8 canonical states; the SessionMonitorCard shows the running agent |
| Agent Task (SdlcDashboard) | renders all 8 canonical states; the SessionPill + SessionSummaryBar reflect the session-level status |
| Inspector (InspectorPanel) | renders every pending gate in the correct tab |
| Timeline (Inspector timeline tab, if present) | renders every gate event in chronological order |
| Badge (PhaseChip + SessionPill) | the badge text + chip background matches the canonical state for every state |
| Colour (COLUMN_BORDER + Dashboard pipeline strip + SessionRail dot) | the colour matches `05_CANONICAL_RUNTIME_STATE.md §3.1` for every state |
| Animation (TASK_ICON + SessionStatusIcon) | the animation runs only for `'running'` and `'awaiting_gate'` (per the canonical spec) |

### 4.3 Cross-component invariant

For every state in `05_CANONICAL_RUNTIME_STATE.md §3.1`:

- Dashboard Pipeline strip colour == Agent Task column border colour
  for the same input.
- Dashboard PhaseStatusLabel glyph == Agent Task PhaseChip text for
  the same input.
- Dashboard per-agent card label (`<Agent> running`) == Agent Task
  card chip text for the same input.

If any pair disagrees, OBS-01 is NOT COMPLETE.

### 4.4 Negative acceptance criteria

OBS-01 must NOT:

- Add new states to the canonical machine.
- Change the wire envelope discriminator union.
- Change the HTTP route shape.
- Change the Prisma schema.
- Rename any architectural concept.
- Refactor unrelated code.
- Modify any test file (test additions are NEW files; existing
  tests must continue to pass).

---

## 5. Risk assessment

Per `docs/repair-backlog/05_REGRESSION_PLAN.md` risk scale:
Critical = takes the SDLC pipeline offline; High = user-visible
behaviour loss; Medium = soft spot that future drift could resume;
Low = cosmetic.

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| Wire envelope breaks consumers that key on `role: null` | High | no current consumer keys on lifecycle `role`; the gate consumer reads `payload.gate.role` (unaffected); the SSE controller passes `role: null` only for the snapshot envelope (correct); the FE mapper additions are additive (read `env.role` only after the early-return guard) |
| `toPhaseStatus` switch from `Task.status` to `Task.executionStatus` introduces drift | High | the projection map covers all 8 canonical states explicitly; the legacy `'running'` writer at `SdlcWorkflowService.resumeTask:1356` aligns with the canonical name; the legacy `'processing'` writer at `agentDispatcher.runAgent:312` is rewritten to `'running'` in OBS-01.1.c |
| Mappers patch both fields inconsistently | Medium | each mapper is tested in isolation (OBS-01.3.a–e); the test gaps are enumerated in `06_IMPLEMENTATION_CHECKLIST.md` |
| `selectRuntimeExecution` over-promotes `agentStates` values | Medium | the merge loop is tested for every canonical state (OBS-01.4.a); the existing `awaiting_review` merge is preserved |
| FE reducer breaks for envelopes with `taskId: null` | Low | `mapTaskStarted` already returns early when `env.taskId` is null (line 216); the new branch is added AFTER the early-return guard |
| `pipelinePhases` patch loses other entries | Low | the patch replaces the ONE entry by `agent`, not the whole array |
| Visual regression drift | Medium | OBS-01.8 captures a snapshot baseline before and after the change |
| Feature flag bypass | Medium | the change MUST be behind the feature flag `OBS_01_RUNTIME_OBSERVABILITY=true` (default off); rollout = flip the flag; rollback = flip the flag back |
| `Task.status = 'running'` alignment (OBS-01.1.c) breaks a downstream consumer that branches on `'processing'` | Medium | grep confirmed no consumer branches on the literal `'processing'`; the legacy langchain path that uses `'PENDING_TOOL_APPROVAL'` is dormant on current paths |
| `timeout` and `cancelled` projection to `'skipped'` confuses the user | Low | the FE spec collapses both to `'skipped'`; OBS-01 preserves this; a future redesign may distinguish |
| `dispatched` state has no UI mapping | Low | the canonical matrix permits `dispatched`; no consumer ever produces it; OBS-01 does not change this |

### 5.1 Aggregate risk profile

- **High:** 2 (wire-shape breakage; `toPhaseStatus` switch).
- **Medium:** 5 (mapper inconsistency; selector over-promotion;
  feature flag bypass; `'processing'` → `'running'` alignment;
  visual regression).
- **Low:** 4 (envelope guards; array patch; `timeout`/`cancelled`
  collapse; `dispatched` UI gap).

The aggregate risk profile is dominated by the High-severity
items; both are addressable with the feature flag + visual
regression baseline. OBS-01 is a MEDIUM-HIGH risk batch.

---

## 6. Rollback plan

OBS-01 is rolled back by reverting the feature flag
`OBS_01_RUNTIME_OBSERVABILITY=false`. The change MUST be hidden
behind this flag (default off) so that production deployment
does not see the new behaviour until the team is ready.

### 6.1 Per-phase rollback

| Phase | Rollback strategy | Recovery time |
| ----- | ----------------- | ------------- |
| OBS-01.1.a (`role: task.type`) | Revert `taskLifecycleService.js:90` to `role: null` | < 5 minutes (single line) |
| OBS-01.1.b (`toPhaseStatus`) | Revert `SdlcWorkflowService.js:1256` to read `phaseData.status` | < 5 minutes (single line) |
| OBS-01.1.c (`'running'` writer) | Revert `agentDispatcher.js:312` to `status: 'processing'` | < 5 minutes (single line) |
| OBS-01.2 (snapshot) | Reverts automatically with OBS-01.1.b (snapshot reads from `getPipelineResponse` which reads from `toPhaseStatus`) | < 5 minutes |
| OBS-01.3 (mappers) | Revert the new mapper branches; the existing early-return behaviour returns | < 10 minutes per mapper (5 mappers) |
| OBS-01.4 (selector) | Restore the single-value merge loop at `workflowSelectors.ts:251-255` | < 5 minutes |
| OBS-01.5 (Dashboard) | No code change; rollback is implicit | N/A |
| OBS-01.6 (Agent Task) | No code change; rollback is implicit | N/A |
| OBS-01.7 (Inspector) | No code change; rollback is implicit | N/A |
| OBS-01.8 (visual regression) | Restore pre-OBS-01 CSS maps if drift detected | < 30 minutes |

### 6.2 Blast radius

A failed OBS-01 release shows the following symptoms (in order
of likelihood):

1. The visible agent cards show stale or wrong states.
2. The SSE replay re-emits envelopes with `role: <agent>` that
   the FE does not handle.
3. The `toPhaseStatus` projection introduces a new state value
   that the FE does not render.

Each symptom is detectable within 5 minutes of production
deploy via the visual regression baseline (OBS-01.8). Rollback
= flip the flag.

### 6.3 Forward-only migrations

OBS-01 makes NO schema change. The Prisma schema at
`backend/prisma/schema.prisma` is unchanged. No data migration
is required. The only persisted state change is the
`AgentEvent` row containing the lifecycle envelope — but the
envelope's `role` field is added to the `base` of the existing
`publishEvent` call, not to the `AgentEvent` row's columns.
The `AgentEvent` schema is unchanged.

### 6.4 Idempotency

Every per-envelope mapper patch is idempotent (re-applying the
same envelope to the same state produces the same result).
The `pipelinePhases[i].status = 'running'` patch overwrites the
previous value. Re-applying is safe.

### 6.5 Rollback checklist

When the feature flag is flipped back to `false`:

- [ ] Pre-existing tests pass.
- [ ] SSE replay (via `Last-Event-ID` reconnect) does not surface
  any new envelope types.
- [ ] The agent cards show the pre-OBS-01 visual state.
- [ ] The SessionPill shows the pre-OBS-01 session-level state.
- [ ] The Inspector renders every gate in the correct tab.

If any item fails, the rollback is incomplete and Phase 4 must
investigate.

---

## 7. Recommended repair batch

R-047 lives in **Batch OBS-01 — Runtime Observability** (created
in `02_REPAIR_BATCHES.md`). The batch is independent of Batches
A–G. See `03_DEPENDENCY_GRAPH.md` for the topological placement.

### 7.1 Files likely affected (read-only inventory)

- `backend/src/services/taskLifecycleService.js`
  (publishLifecycle).
- `backend/src/services/agentDispatcher.js`
  (Task.status writer).
- `backend/src/services/SdlcWorkflowService.js`
  (snapshot builder).
- `backend/src/controllers/SdlcController.js`
  (snapshot publisher).
- `frontend/src/store/eventMappers.ts`
  (mappers).
- `frontend/src/store/workflowSelectors.ts`
  (selector merge).
- `frontend/src/dto/event.ts`
  (optional: annotate `TaskLifecyclePayload.role` schema).
- `frontend/src/services/api/sdlcApi.ts` (no change; enums
  already include the values).
- `frontend/src/models/SessionState.ts` (no change; enums
  already include the values).
- `frontend/src/pages/SdlcDashboard/index.tsx` (no CSS change).
- `frontend/src/pages/SdlcDashboard/OverviewPage.tsx`
  (no change).
- `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx`
  (no change).

### 7.2 Files explicitly forbidden

- `backend/src/services/releaseManager.js` (Batches C / D / G
  own).
- `backend/src/services/gateBridge.js` (Batches B / C / D own;
  R-047 does NOT modify the gate path).
- `backend/src/services/authMiddleware.js`,
  `backend/src/services/MembershipService.js` (Batch G owns).
- `backend/src/services/eventPublisher.js`,
  `backend/src/services/eventBus.js` (Batch D owns the
  publishEvent facade and the bus).
- `backend/prisma/schema.prisma` (Batch F owns; R-047 does not
  require a schema change).
- All test files (out of scope; no edits in any batch).
- All prompt files under `backend/src/agents/prompts/`.

---

## 8. NOT VERIFIED

- Whether the SSE wire carries `task_id` on every lifecycle
  envelope. It does, per `taskLifecycle.publishLifecycle` (BE).
  The mapper already uses `env.taskId` for `mapTaskStarted`
  (line 216) and `env.role` for the others.
- Whether the FE store's `set()` correctly applies the new
  `pipelinePhases` patch without losing other phases.
  Standard spread on `pipelinePhases` array, replacing the one
  entry by `agent`. The behaviour is correct by construction.
- Whether any pre-existing test exercises the FE mapper's
  `pipelinePhases` update path. The current FE tests
  (`SdlcDashboard.test.tsx`, `OverviewPage.test.tsx`) use mock
  sessions with hand-crafted `pipelinePhases`; they do NOT
  exercise the mapper directly. Phase 4 must add mapper unit
  tests.