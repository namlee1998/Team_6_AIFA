# 02 — Repair Batches

> **Status:** DESIGN ONLY. For every drift item documented in
> `docs/architecture-drift/08_DRIFT_MATRIX.md`, this document
> captures root cause, owner, impacted modules, dependencies,
> repair approach, regression risk, and rollout order. No code, no
> patches, no TODO comments.
>
> Batch taxonomy is set in `01_REPAIR_STRATEGY.md §5`.
> Cross-batch dependencies live in `03_DEPENDENCY_GRAPH.md`.
> Regression risk per batch lives in `04_REGRESSION_RISK.md`.
> Implementation order lives in `05_IMPLEMENTATION_ORDER.md`.

Each batch section has the same shape:

- **Concern** — what the batch addresses.
- **Why this batch** — why grouping is sensible.
- **Drifts** — the IDs from `08_DRIFT_MATRIX.md` that belong here.
- **Required external decisions** — ADRs the batch cannot make on
  its own.
- **Test gaps in scope** — pre-existing tests not yet covering the
  fixed behaviour. (Per the Phase-3 prompt, no new tests are
  written; the gaps are listed for Phase 3 to close.)
- **Per-drift design** — root cause, owner, impacted modules,
  dependencies, repair approach, regression risk, rollout order.
- **Rollout** — order within the batch, sequencing notes.

---

## Batch A — Cleanup

### Concern

Remove dead modules (no importers) and dead store actions (no
consumers). No runtime impact.

### Why this batch

Every Phase-2 dead-architecture item is small, isolated, and
free of behavioural risk. They share the property that removing the
item cannot change runtime semantics. Grouping them allows one
release with many file deletions.

### Drifts

- DR-020 — `backend/src/services/authService.js` (no importers).
- DR-021 — `backend/src/utils/agentParser.js` (no importers).
- DR-022 — `backend/src/middleware/validation.js` (no importers).
- DR-023 — `backend/arch_runtime.js` + 5 unreachable smoke scripts
  (`backend/scripts/{cancelTimeoutSmoke,realRunnerSmoke,
  resumeGateSmoke,spikeClaudeAgentSdk,sseReplaySmoke,
  staleWorkerSmoke}.js`).
- DR-027 — `useUiStore` unused actions
  (`toggleSidebar`, `setSidebarCollapsed`, `setSelectedAgentKey`,
  `openAgentDetailDrawer`, `closeAgentDetailDrawer`,
  `openReleaseDialog`, `closeReleaseDialog`, `resetUi`).
- DR-028 — `useWorkflowStore` unused actions
  (`cleanupSession`, `resetAll`).

### Required external decisions

None.

### Test gaps in scope

None (dead code paths are not covered by tests; tests need no
update when these items are removed).

### Per-drift design

#### DR-020 — `authService.js`

- **Root cause**: a standalone password hashing / session module
  that the inline `MembershipService` stub bypassed.
- **Owner**: none post-cleanup (no replacement; auth is the
  bypass middleware's job until Batch G).
- **Impacted modules**: `backend/src/services/authService.js`.
- **Dependencies**: Batch G (RBAC triple) must decide whether this
  module is reincarnated as a real RBAC helper or kept dead.
- **Repair approach**: delete the file. If Batch G decides to
  re-introduce real RBAC, the deletion is reversible from git
  history; the freeze note should record the intent.
- **Regression risk**: very low. No importers.
- **Rollout order**: Batch A, step 1. May be skipped or
  conditional on Batch G's plan.

#### DR-021 — `agentParser.js`

- **Root cause**: legacy output parser predating the canonical
  `agentContract.assertOutputConforms`. Replaced; the file lives
  because no one has removed it.
- **Owner**: none post-cleanup.
- **Impacted modules**: `backend/src/utils/agentParser.js`.
- **Dependencies**: none.
- **Repair approach**: delete the file.
- **Regression risk**: very low. No importers.
- **Rollout order**: Batch A, step 2.

#### DR-022 — `validation.js`

- **Root cause**: a middleware factory (`validate(schema)`) that
  no route uses. Every controller does its own per-field
  validation (see `SdlcController.runArchitectureAgent:35-38`).
- **Owner**: none post-cleanup.
- **Impacted modules**: `backend/src/middleware/validation.js`.
- **Dependencies**: none.
- **Repair approach**: delete the file.
- **Regression risk**: very low. No importers.
- **Rollout order**: Batch A, step 3.

#### DR-023 — `arch_runtime.js` + 5 unreachable smoke scripts

- **Root cause**: ad-hoc diagnostic scripts. The npm `scripts`
  entry that exists (`demoSmokeClaudeCode`) covers the one
  current intent.
- **Owner**: none post-cleanup.
- **Impacted modules**: `backend/arch_runtime.js`,
  `backend/scripts/{cancelTimeoutSmoke,realRunnerSmoke,
  resumeGateSmoke,spikeClaudeAgentSdk,sseReplaySmoke,
  staleWorkerSmoke}.js`.
- **Dependencies**: none.
- **Repair approach**: delete the listed files. Leave
  `demoSmokeClaudeCode.js` and `sseReplaySmoke.js` if the latter
  is exercised by any current ad-hoc test (Phase-3 to verify).
  Pre-condition: Phase 3 should `grep` for these scripts in
  any doc / test before deletion.
- **Regression risk**: very low if confirmed no-importer. Medium
  if a doc references them (the deletion should be paired with
  a doc scrub).
- **Rollout order**: Batch A, step 4. Document-scrub paired.

#### DR-027 / DR-028 — Unused FE store actions

- **Root cause**: store actions were written for UI panels that
  have either been removed or wired through different mechanisms
  (e.g. dialog open/close is now driven inline by `useUiStore`
  state, not the action methods).
- **Owner**: `frontend/src/store/useUiStore.ts` and
  `frontend/src/store/useWorkflowStore.ts` — the store files
  themselves remain; the dead-action methods are removed.
- **Impacted modules**: same two files; possibly imports of
  `useUiStore` if a test references the action symbols (NOT
  VERIFIED).
- **Dependencies**: Batch E (Frontend) carries any reducer /
  type cleanup that requires the store field.
- **Repair approach**: remove the unused methods from the store
  interface and the implementation. Keep field getters that are
  read elsewhere.
- **Regression risk**: very low per method (no consumer).
  Medium collectively if a test/import fails to compile after
  removal (Phase 3 to run `tsc --noEmit` before deletion).
- **Rollout order**: Batch E, step 2.

### Rollout

Batch A is parallel-safe; the deletions are independent. Order
within Batch A is by expected documentation impact (DR-020 first
because it has the most doc references; DR-023 last because the
doc scrub is bulk).

---

## Batch B — Ownership

### Concern

Restore "one writer per object." Each drift here has multiple
durable sources of truth or orphan writes. The repair picks the
canonical owner and migrates the others.

### Why this batch

Multiple-writer drift is the structural risk that any future change
will resume. Picking the canonical owner is governance; the rest
of the codebase can then reason about who calls whom.

### Drifts

- DR-008 — `featureRequest` dual storage
  (`Task.observability.featureRequest` AND `AgentArtifact`
  of type `'feature_request'`).
- DR-009 — `claude_result` / `cli_session_id` /
  `cli_total_cost_usd` orphan writes (no consumer).
- DR-010 — `PendingGate` dual truth (in-memory `gateBridge.pending`
  Map vs `PendingGate` DB row).
- DR-011 — `Task.observability` multi-owner (5 writers; no schema).
- DR-026 — `HitlDecision.reviewerId` always `'local-user-id'`.

### Required external decisions

| Decision                                                                                | Drifts affected    |
| --------------------------------------------------------------------------------------- | ------------------ |
| Canonical owner of `featureRequest` between `Task.observability` and `AgentArtifact`     | DR-008             |
| Canonical `gate` truth (in-memory map vs DB row)                                          | DR-010             |
| Canonical `Task.observability` shape (free JSON vs declared schema)                      | DR-011             |
| Future of real RBAC and `reviewerId` (Batch G prerequisite)                              | DR-026             |

### Test gaps in scope

- `featureRequest` ownership: no test asserts that exactly one
  canonical location is the source of truth.
- `PendingGate` dual truth: no test exercises a backend restart in
  the middle of a `requestGate` cycle.
- `HitlDecision.reviewerId`: the audit-trail test surface does not
  cover multi-user scenarios.

### Per-drift design

#### DR-008 — `featureRequest` dual storage

- **Root cause**: `workflowOrchestrator.runArchitectureAgent:107`
  writes the feature request into `Task.observability`.
  `_saveAgentData` (SdlcWorkflowService.js:1829) then writes an
  `AgentArtifact` of type `'feature_request'` from each runner's
  output. The two stores drift if a rewriter edits one and not
  the other.
- **Owner candidate A**: `Task.observability.featureRequest` —
  keeps the field near the task row and lets downstream agents
  read it via `compactContext` (which already whitelists
  `featureRequest`).
- **Owner candidate B**: `AgentArtifact` of type
  `'feature_request'` — keeps the field part of the artifact
  collection that `getFinalReviewPacket` already returns.
- **Impacted modules**: `services/workflowOrchestrator.js`,
  `services/SdlcWorkflowService.js`,
  `dto/eventEnvelope.js` (do not change), `frontend/src/store/eventMappers.ts`.
- **Dependencies**: none beyond the ADR.
- **Repair approach (post-ADR)**: choose one owner; remove writes
  to the other. Reading path must continue to find the field.
  Migration: keep both as inputs for one release; remove the
  non-canonical writer on the next.
- **Regression risk**: medium. Two production readers exist
  (`workflowOrchestrator.runPOAgent:358`,
  `claudeCodeRunner.compactContext:93-101`); both can fall back to
  the surviving store.
- **Rollout order**: Batch B, step 1.

#### DR-009 — `cli_session_id` / `cli_total_cost_usd` orphan writes

- **Root cause**: `claudeCodeRunner.normalizeOutput:307-313`
  writes these keys into `output.observability`, which then
  cascades to `Task.observability` via `_saveAgentData`. No
  consumer reads them.
- **Owner (post-fix)**: remove the writer. No replacement owner.
- **Impacted modules**: `backend/src/agents/claudeCodeRunner.js`.
- **Dependencies**: must coordinate with DR-011
  (`Task.observability` shape decision) — the CLI keys are part
  of that JSON blob.
- **Repair approach**: stop writing the two keys. Keep the
  `output.observability.runner` field if any consumer reads it
  (NOT VERIFIED — Phase 3 should grep).
- **Regression risk**: low (no reader); medium if a future
  analytics layer was planned (not visible in current source).
- **Rollout order**: Batch B, step 2.

#### DR-010 — `PendingGate` dual truth

- **Root cause**: `gateBridge.requestGate` writes both an
  in-memory `pending` Map entry and a `PendingGate` DB row.
  After backend restart, only the DB row survives. The two
  owners must stay in sync during a single request; under
  failure or restart, they diverge.
- **Owner candidate A**: in-memory only — current design.
- **Owner candidate B**: DB only — would require re-querying
  on every `hasPending` call.
- **Owner candidate C**: keep dual, document the divergence and
  add a reconcile path (`recoverInterruptedGates` style).
- **Impacted modules**: `services/gateBridge.js`,
  `models/PendingGate.js`, `controllers/SdlcController.js`
  (`listPendingApprovals`, `resolveApproval`).
- **Dependencies**: Batch C (Pipeline) for `kind='release'`
  sub-decision; Batch D (Event Bus) for `gate_pending` envelope
  persistence (already DR-007 sibling).
- **Repair approach (post-ADR)**: stabilise on one source. If A
  is kept: add a startup reload from DB into the in-memory Map.
  If B is chosen: redesign `hasPending` / `getPending` to query
  the DB on every call (added latency; mitigated by an LRU).
  If C: document the divergence; add a reconcile tool. The
  freeze document §6 should record the choice.
- **Regression risk**: high (under option B). Medium (under
  options A and C with a reconcile). Phase 3 must decide.
- **Rollout order**: Batch B, step 3.

#### DR-011 — `Task.observability` multi-owner

- **Root cause**: 5 writers (orchestrator, `_saveAgentData`,
  `markTaskFailed`, `cancelTask` (not really, that writes
  `error`), `taskLifecycleService` does not write — see the
  source map in Phase-2 §05):
  - `workflowOrchestrator.runArchitectureAgent:107` writes
    `{ featureRequest }`.
  - `workflowOrchestrator.runPOAgent:358` writes
    `{ repo, featureRequest }`.
  - `SdlcWorkflowService._saveAgentData:2011-2015` merges with
    `completedData.observability`.
  - `agentDispatcher.markTaskFailed:514-528` appends a
    `failure` block.
  - The middleware `requestContext` (requestContext.js:17-20)
    tracks `taskId / phase` for logging only — does not land in
    `Task.observability`.
- **Owner (post-fix)**: pick one owner per key. `featureRequest`
  → `Task.observability.featureRequest` (per DR-008). `repo` →
  `Task.observability.repo` (already there). `failure` →
  `Task.observability.failure` (already there). The runner's
  `observability` block → either `Task.observability.runner` or
  dropped entirely (per DR-009).
- **Impacted modules**: same as DR-008 + DR-009.
- **Dependencies**: DR-008, DR-009.
- **Repair approach (post-ADR)**: declare a JSON schema for
  `Task.observability` in the freeze. Each writer's allowed
  keys are restricted; new keys require a freeze amendment.
- **Regression risk**: medium. The multi-key merge at
  `_saveAgentData:2011-2015` is fragile; the new rule must
  forbid overlapping keys.
- **Rollout order**: Batch B, step 4 (paired with DR-008, DR-009).

#### DR-026 — `HitlDecision.reviewerId` always `'local-user-id'`

- **Root cause**: the auth middleware (`authMiddleware.js:1-10`)
  hardcodes `req.user.id = 'local-user-id'`. Every
  `HitlDecision.create` writes `reviewerId: user?.id || null`.
- **Owner (post-fix)**: pending Batch G. Until Batch G, the
  reviewer is effectively always the local user.
- **Impacted modules**: `middleware/authMiddleware.js`, every
  `HitlDecision.create` caller (SdlcWorkflowService.js:204-230,
  521-527, 2134, releaseManager.js:80).
- **Dependencies**: Batch G (RBAC triple).
- **Repair approach (post-Batch G)**: when real RBAC replaces
  the bypass, the existing writes automatically receive the
  real reviewer id. Until then: no change is required (the
  current shape is consistent with the bypass).
- **Regression risk**: low (cosmetic; current value is
  determinate).
- **Rollout order**: Batch G, after the bypass is removed.

### Rollout

Batch B is sequential. Steps 1, 2, 4 share an ADR (freezing the
`Task.observability` schema). Step 3 has its own ADR (dual-truth
decision). All four ADRs must be approved before any code change.

---

## Batch C — Pipeline

### Concern

Restore the canonical chain's invariants: single-emitter for
`pipeline_completed`, `PipelineSession.status` lifecycle,
`Task.versionStatus` ↔ `executionStatus` synchronisation,
recovery semantics, and the legacy `submitGateDecision` path.

### Why this batch

These are state-machine and release-flow items. They are the spine
of the SDLC. Grouping them ensures the pipeline's invariants are
restored as a unit (or in a tightly-coupled sequence).

### Drifts

- DR-001 / DR-024 — release-flow chain ownership contradiction;
  legacy `submitGateDecision` active.
- DR-002 / DR-003 — release-flow single-emitter / asymmetric
  persistence; `PendingGate` dual write on release path.
- DR-012 — `Task.status` bypass of state machine (8 direct writers).
- DR-013 — `Task.versionStatus` ↔ `executionStatus` desync.
- DR-014 — `recoverInterruptedGates` illegal transition.
- DR-015 — `PipelineSession.status='running'` stuck.

### Required external decisions

| Decision                                                                  | Drifts affected   |
| ------------------------------------------------------------------------- | ----------------- |
| Resolution of legacy `submitGateDecision` (delete / deprecate-shim / keep)  | DR-001 / DR-024   |
| Canonical gate for output_review                                            | DR-001            |
| Canonical placement of the `PendingGate` row for `kind='release'`            | DR-003            |
| Add `'awaiting_gate' → 'running'` to `TRANSITIONS` (vs guard before runAgent) | DR-014          |
| Next-state of `PipelineSession.status` after all tasks fail/cancel          | DR-015           |

### Test gaps in scope

- `submitGateDecision` legacy path coverage:
  `sdlc.handoff.test.js` (already exists) is the only test that
  exercises it. The Phase-3 fix should ensure the test is removed
  or pivoted to the canonical endpoint.
- `recoverInterruptedGates` race: NOT VERIFIED to be covered by
  any test.
- `PipelineSession.status='running'` stuck state: NOT VERIFIED.

### Per-drift design

#### DR-001 / DR-024 — Legacy `submitGateDecision` active

- **Root cause**: `routes/sdlc.js:35` mounts
  `/api/v1/sdlc/tasks/:task_id/gate-decision` to
  `SdlcController.submitGateDecision`, which delegates to
  `SdlcWorkflowService.submitGateDecision` (SdlcWorkflowService.js:185-231).
  The canonical path is `submitStructuredDecision` (line 264-336).
  The legacy path does NOT carry `decisionId`, does NOT call
  `_recordApprovedHandoff`, does NOT call
  `_startNextAgentIfAvailable`, and on `REQUEST_CHANGES` calls
  `_rerunOwningWorker` directly.
- **Owner**: after ADR, the canonical path
  (`submitStructuredDecision`) is the sole owner. The legacy
  endpoint either returns 410 or becomes a thin alias mapping
  request / response to the structured form.
- **Impacted modules**: `routes/sdlc.js`,
  `controllers/SdlcController.js`,
  `services/SdlcWorkflowService.js`,
  `tests/integration/sdlc.handoff.test.js` (legacy coverage).
- **Dependencies**: DR-008 (both legacy and structured paths
  touch `Task.approvedOutput`); DR-013 (`versionStatus`
  semantics).
- **Repair approach (post-ADR)**:
  1. **(Recommended)** Delete `submitGateDecision` entirely;
    the `routes/sdlc.js:35` mount returns 410.
  2. **(De-risk option)** Keep a thin shim that converts body
    fields into `submitStructuredDecision` calls; this preserves
    existing tests but adds an adapter layer.
  3. **(Riskier)** Keep both; ensure FE never uses the legacy
    path. Marker / metric on the legacy endpoint for
    decommissioning.
- **Regression risk**: high under option 1 (removes a tested
  path); medium under option 2; low under option 3.
  Recommendation: option 1, with a deprecation window that
  returns 410 and a freeze note.
- **Rollout order**: Batch C, step 1.

#### DR-002 / DR-003 — Release-flow single-emitter / asymmetric
persistence / `PendingGate` dual write

- **Root cause**: §19.4 A.3 (per the inline comment at
  `releaseManager.js:170-186`) re-homed `pipeline_completed` to
  `releaseManager.submitReleaseDecision`, which IS the single
  emitter. The persistence step was missed (live-only). The
  `PendingGate` row for `kind='release'` is created in
  `SdlcWorkflowService.resolveOutputReviewGate:559-577`, but the
  resolution path (`releaseManager.submitReleaseDecision`) writes
  the `HitlDecision` directly without going through
  `gateBridge.resolveGate`.
- **Owner**: after fixes, `releaseManager.submitReleaseDecision`
  is the sole owner of:
  - the `pipeline_completed` envelope (publish + persist).
  - the FINAL_RELEASE `HitlDecision` row.
  - The `PendingGate` row (per the ADR: drop OR keep).
- **Impacted modules**: `services/releaseManager.js`,
  `services/SdlcWorkflowService.js`,
  `services/gateBridge.js`, `dto/eventEnvelope.js`,
  `models/AgentEvent.js`.
- **Dependencies**: Batch D (Event Bus) for the persistence step.
  DR-010 for the `PendingGate` decision.
- **Repair approach (post-ADR)**:
  - `pipeline_completed`: `publishEvent` returns the envelope;
    `releaseManager` calls `AgentEvent.create(envelope)` in the
    same critical section as `PipelineSession.update({status:
    'completed'})`.
  - `PendingGate` for `kind='release'`: per ADR, drop the row
    (option A) or have `releaseManager.submitReleaseDecision`
    call `gateBridge.resolveGate` first, then write
    `HitlDecision` (option B).
- **Regression risk**: low for the persistence step (additive);
  medium for the `PendingGate` decision (depends on ADR).
- **Rollout order**: Batch C step 2 (persistence step is
  additive and safe); `PendingGate` decision is parallel.

#### DR-012 — `Task.status` bypass

- **Root cause**: 8 callers mutate `Task.status` directly via
  `Task.update({ status: … })` outside `taskLifecycle.transition`.
  See Phase-2 §05 MO-1 for the list.
- **Owner candidate A (recommended)**: keep `Task.status` as a
  derived / coarse field; route all writes through a new helper
  (`setTaskStatus(taskId, status)`) that records the state
  transition without consulting the matrix. The helper is the
  sole writer; tests verify the helper exists.
- **Owner candidate B**: delete the column entirely; rely on
  `Task.executionStatus` only.
- **Impacted modules**: `models/Task.js` (mapping),
  `services/agentDispatcher.js`,
  `services/SdlcWorkflowService.js`,
  `services/taskWorkerService.js`.
- **Dependencies**: Batch F (State / Persistence) for the schema
  decision.
- **Repair approach (post-ADR)**:
  - For option A: introduce `setTaskStatus`. Replace each
    direct `Task.update({ status: … })` with the helper. The
    helper forwards to `taskLifecycle.transition` for
    execution-state-changing values and to a passthrough update
    for cosmetic-only values.
  - For option B: migrate `Task.status` away.
- **Regression risk**: high (option A) — touches 8 sites, each
  must be re-verified for state-machine compatibility. Medium
  (option B) — schema migration.
- **Rollout order**: Batch F first (schema freeze), then Batch C
  step 3.

#### DR-013 — `Task.versionStatus` ↔ `executionStatus` desync

- **Root cause**: `Task.versionStatus` (schema.prisma:75) has
  default `'committed'`. New tasks should be `'draft'` until a
  human approve. The two columns are co-managed by structured HITL
  (SdlcWorkflowService.js:321, 495) and `Task.commitTask`
  (Task.js:214-220), and the schema default can mask a bug.
- **Owner**: `Task.commitTask` (the only setter of `'committed'`).
  Every other writer must funnel through it.
- **Impacted modules**: `prisma/schema.prisma`,
  `models/Task.js`, `services/SdlcWorkflowService.js`.
- **Dependencies**: schema amendment freeze doc.
- **Repair approach**:
  1. Change the Prisma default to `'draft'` for new tasks. Add a
    migration: backfill existing rows whose `versionStatus` is
    `'committed'` only if `agentOutput` is null (or similar
    condition to be derived in a script at migration time).
  2. Ensure `Task.create` and every Task insert specify
    `versionStatus: 'draft'` explicitly (already true for
    `workflowOrchestrator.run*Agent:97` etc.).
  3. Forbid `version_status: 'committed'` direct writes outside
    `Task.commitTask` (typed-update guard at the model layer).
- **Regression risk**: medium (schema default + backfill). The
  `_requireApprovedTask:1602-1604` invariant is preserved
  because approved tasks already have
  `version_status='committed'` written before any check.
- **Rollout order**: Batch F, step 1. Couples with Batch C
  step 3 via DR-012.

#### DR-014 — `recoverInterruptedGates` illegal transition

- **Root cause**: `SdlcWorkflowService._resumeInterruptedTask:1777-1784`
  calls `this._runAgent(task, …)`. `_runAgent` →
  `agentDispatcher.runAgent` → `taskLifecycle.transition(taskId,
  'running', …)`. Current `executionStatus` is `awaiting_gate`.
  The matrix (`taskLifecycleService.js:11-21`) does not list
  `awaiting_gate → running` as a legal edge.
- **Owner (post-fix)**: the matrix owns the transition; the
  agent runtime owns the runner. The recovery path must consult
  the matrix.
- **Owner candidate A (recommended)**: add `'awaiting_gate →
  'running'` to the matrix. Rationale: a task that has been
  waiting for a gate, when its gate is interrupted, must be
  able to resume execution. Document in freeze.
- **Owner candidate B**: introduce a `taskLifecycle.transitionIfPresent`
  guard at `_resumeInterruptedTask` and at
  `agentDispatcher.runAgent`. The runner stays agnostic; the
  recovery path takes responsibility.
- **Owner candidate C**: change `_resumeInterruptedTask` to
  go through `gateBridge.resolveGate({ timedOut: true })` so
  the SDK Promise resolves first, then transition.
- **Impacted modules**: `services/taskLifecycleService.js`,
  `services/SdlcWorkflowService.js`, `services/agentDispatcher.js`,
  `services/gateBridge.js`.
- **Dependencies**: none beyond the choice.
- **Repair approach**: pick one. Option A is the cleanest; the
  matrix becomes a co-equal enforcer of "anyone holding a paused
  thread may resume." Option B is defensive and matches the
  matrix as it stands. Option C is the closest to the existing
  semantics but requires `gateBridge.resolveGate` semantics
  for an interrupted (not-yet-resolved) gate.
- **Regression risk**: low for option A (one matrix entry).
  Medium for option B (new helper code path). Medium for option C
  (extend `gateBridge.resolveGate`).
- **Rollout order**: Batch F, step 2. Must run before Batch C
  step 4 (any matrix change must precede any consumer change).

#### DR-015 — `PipelineSession.status='running'` stuck

- **Root cause**: no transition writes `'failed'` or
  `'cancelled'` to `PipelineSession.status`. A session whose
  tasks all fail or cancel stays `'running'` forever.
- **Owner (post-fix)**: the workflow orchestrator owns the
  final session status transition when all tasks are terminal.
- **Impacted modules**: `services/SdlcWorkflowService.js`,
  `services/workflowOrchestrator.js`,
  `services/agentDispatcher.js`, `models/PipelineSession.js`.
- **Dependencies**: Batch F for the matrix extension.
- **Repair approach**:
  1. Extend `PipelineSession.status` to include `'failed'` and
    `'cancelled'` (no schema change required — already a free
    `String`).
  2. Add a derive function: when `every(Task where
    sessionId=X).executionStatus ∈ {failed, cancelled,
    timeout}` AND `tasks.length > 0` AND no `FINAL_RELEASE`
    decision exists, set `PipelineSession.status = 'failed'`.
  3. Add the same on cancellation of all tasks.
  4. The derive runs after each task terminal transition (in
    `taskLifecycleService.transition`'s `prisma.$transaction`).
- **Regression risk**: medium. Consumers that branch on
  `PipelineSession.status` currently only ever see
  `'running' / 'awaiting_release' / 'completed'`. The new
  `'failed'` state is additive; legacy callers ignoring it
  will continue to behave as before.
- **Rollout order**: Batch C, step 4. Pairs with DR-014.

### Rollout

Batch C is sequential; the steps are tightly coupled. Steps 1
(legacy gate), 2 (persistence + `PendingGate`) can run in
parallel against Batch C. Steps 3, 4 require Batch F first
(DR-012 + DR-013 are owned by Batch F as the schema freeze).

---

## Batch D — Event Bus

### Concern

Restore the invariant "every wire envelope corresponds to a
persisted `AgentEvent` row." Trim the discriminator union to
match the live producer surface. Repair SSE replay so legacy rows
and reconnecting clients see the same contract.

### Why this batch

The event bus is the wire contract between BE and FE. The drift
items here are user-visible on reconnect and audit trail.

### Drifts

- DR-007 / DR-016 — `pipeline_completed` envelope not persisted.
- DR-017 — three EventTypes have no producer
  (`pipeline_failed`, `task_resumed`, `agent_event`).
- DR-018 — `session_resumed` allocates sequence per reconnect.
- DR-019 — SSE replay drops legacy / non-canonical rows.
- DR-029 — `qaResult.commitSha` is a placeholder literal.

### Required external decisions

| Decision                                                                       | Drifts affected    |
| ------------------------------------------------------------------------------ | ------------------ |
| Persist `pipeline_completed` via `AgentEvent.create` (recommended)             | DR-007 / DR-016    |
| Trim the discriminator union (recommended) vs add producers                     | DR-017             |
| Coalesce `session_resumed` snapshot by `Last-Event-ID`                          | DR-018             |
| Synthesise envelopes for legacy rows vs document the gap                       | DR-019             |
| Store the actual release `commitSha` vs drop the field                          | DR-029             |

### Test gaps in scope

- SSE replay continuity after restart: NO TEST.
- `pipeline_completed` persisted then reloaded: NO TEST.
- Discriminator union shrink: required after the fix.

### Per-drift design

#### DR-007 / DR-016 — `pipeline_completed` persistence

- **Root cause**: `releaseManager.submitReleaseDecision:173-186`
  calls `publishEvent` and does NOT pass the returned envelope
  to `AgentEvent.create`. Every other event in the canonical union
  persists.
- **Owner (post-fix)**: `releaseManager.submitReleaseDecision`
  owns both publish and persist for `pipeline_completed`.
- **Impacted modules**: `services/releaseManager.js`,
  `models/AgentEvent.js`.
- **Dependencies**: Batch C step 2 (release-flow single-emitter).
- **Repair approach**: after `publishEvent('pipeline_completed',
  …)` returns, call `AgentEvent.create({ envelope, sequence,
  taskId: qaTask.id, projectId, sessionId, type: 'task_completed'
  (or new 'pipeline_completed' enum), actor: 'release' })`. The
  `type` for the AgentEvent row can be `'pipeline_completed'`
  (extending the lifecycle enum at
  `taskLifecycleService.js:23-32`) or `'task_completed'` — pick
  one and amend the freeze.
- **Regression risk**: low. Additive change.
- **Rollout order**: Batch D, step 1.

#### DR-017 — Orphan EventTypes

- **Root cause**: `pipeline_failed`, `task_resumed`,
  `agent_event` are in the union but have no producer. The
  FE TypeScript mirror inherits the inflation.
- **Owner (post-fix)**: keep the union minimal; trim to the live
  producer set.
- **Impacted modules**: `dto/eventEnvelope.js`,
  `dto/event.ts`, `frontend/src/dto/event.ts`.
- **Dependencies**: any future code that wanted to use the
  orphan types must re-introduce them deliberately.
- **Repair approach**:
  - Trim `EventType` (BE and FE) to: `session_started |
    session_resumed | pipeline_completed | task_started |
    task_completed | task_failed | task_interrupted |
    gate_pending | gate_resolved | runtime_log`.
  - Update `taskLifecycleService.LIFECYCLE_TO_EVENTTYPE` (no
    change — the entries for `pipeline_failed`, `task_resumed`,
    `agent_event` would be deleted if they exist; currently none
    does).
  - Update `sseClient.isEnvelope` (no change — only the
    discriminator narrows).
- **Regression risk**: low (no current producer; no current
  consumer that branches on these specific types).
- **Rollout order**: Batch D, step 2.

#### DR-018 — `session_resumed` sequence per reconnect

- **Root cause**: `SdlcController.streamPipelineStatus:367`
  calls `publishEvent` unconditionally on every reconnect. The
  snapshot envelope allocates a fresh sequence via
  `sequenceService.next`.
- **Owner (post-fix)**: the SSE controller coalesces the snapshot.
  If `Last-Event-ID` matches the current session head, the
  snapshot is not re-emitted.
- **Impacted modules**: `controllers/SdlcController.js`,
  `services/eventPublisher.js`.
- **Dependencies**: none.
- **Repair approach**: in `streamPipelineStatus`, after
  computing `lastSeq`, query `AgentEvent.maxSequence({ sessionId,
  projectId })`. If `lastSeq >= currentHead`, skip the
  `publishEvent` call. The snapshot still ensures the FE has a
  fresh frame on first connect.
- **Regression risk**: medium. The FE deduplicates by
  `envelope.id` already, so omitting a duplicate snapshot does
  not change its state. But a stale FE that missed the previous
  reconnect's snapshot would not catch up — Phase 3 must
  decide on the coalesce policy (per cursor vs per session).
- **Rollout order**: Batch D, step 3.

#### DR-019 — SSE replay drops legacy rows

- **Root cause**: `SdlcController.streamPipelineStatus:340-357`
  rebuilds envelopes only for `gate_audit`-typed rows. Other
  legacy rows without `envelope` are forwarded with their
  raw `type` as the EventType, which may not be a canonical
  type. Rows with neither `envelope` nor `payload` are silently
  dropped.
- **Owner (post-fix)**: the SSE controller is the replay source
  of truth. It must surface every persisted row.
- **Impacted modules**: `controllers/SdlcController.js`,
  `models/AgentEvent.js`.
- **Dependencies**: DR-017 (the trimmed union); a freeze
  decision on what to do with legacy `agent_event` rows.
- **Repair approach (per ADR)**:
  - Option A: synthesise envelopes for legacy rows based on
    `payload` AND `type`, mapping legacy type strings to the
    canonical type (e.g. `agent_event` → `runtime_log`).
  - Option B: drop legacy rows from replay and document the
    gap (the canonical snapshot is enough).
  - Option C: backfill `envelope` on every legacy row at boot
    using the same mapping as A. Persistent.
- **Regression risk**: low for B (no new failures). Medium for
  A or C (new envelope construction code path).
- **Rollout order**: Batch D, step 4.

#### DR-029 — `qaResult.commitSha` placeholder

- **Root cause**: `releaseManager.js:178-184` writes
  `commitSha: 'see session.repoInfo'` — a literal string.
- **Owner (post-fix)**: `releaseManager.submitReleaseDecision`
  carries the actual commit SHA. The string is set on success
  from `git rev-parse HEAD` (after the bundle commit) or from the
  current state if the bundle commit was empty.
- **Impacted modules**: `services/releaseManager.js`,
  `services/repoService.js`.
- **Dependencies**: none.
- **Repair approach**: after `await git(['commit', '-m', …])`,
  read the SHA via `git(['rev-parse', 'HEAD'])`; if the
  commit was skipped, return `null`. Include the real SHA in
  the envelope payload.
- **Regression risk**: low.
- **Rollout order**: Batch D, step 5.

### Rollout

Batch D is sequential. Step 1 (persistence) is the most user-
visible and must run first.

---

## Batch E — Frontend

### Concern

Trim unused store actions; align the FE-store invariants with the
canonical envelope contract; remove orphan DTO types.

### Why this batch

The FE is read-only with respect to backend state. The drifts in
this batch do not affect runtime correctness; they are
cosmetic / structural.

### Drifts

- DR-018 (FE side: duplicate `task_started` arrives; the FE
  reducer must dedup by `envelope.id`).
- DR-027 — `useUiStore` unused actions.
- DR-028 — `useWorkflowStore` unused actions.
- Frontend orphans: `pipeline_failed`, `task_resumed`,
  `agent_event` `EventType` members in
  `frontend/src/dto/event.ts`.

### Required external decisions

None.

### Test gaps in scope

- Frontend reducer dedup test: NOT VERIFIED.
- Frontend store action removal test: N/A (FE tests use
  vitest; not inspected in this design pass; Phase 3 may verify).

### Per-drift design

#### DR-027 / DR-028 — Unused store actions

- **Root cause**: see Batch A.
- **Owner**: the store files
  (`useUiStore.ts`/`useWorkflowStore.ts`).
- **Impacted modules**: same two files.
- **Dependencies**: Batch A.
- **Repair approach**: see Batch A. The actual file edits land
  in Batch E.
- **Regression risk**: low per method; aggregate medium if FE
  build fails.
- **Rollout order**: Batch E, step 1. Run `tsc --noEmit` before
  merge.

#### Frontend reducer dedup

- **Root cause**: every `Task.create` emits a `task_started`
  envelope AND the next state transition emits another
  `task_started`. The FE reducer dedups by `envelope.id` already.
  No consumer sees the duplicate.
- **Owner (no fix)** — current behaviour is correct.
- **Impacted modules**: `frontend/src/store/useWorkflowStore.ts:60-72`.
- **Dependencies**: none.
- **Repair approach**: NO CHANGE. Document only.
- **Regression risk**: none.
- **Rollout order**: not applicable.

#### Frontend DTOs (EventType union)

- **Root cause**: `frontend/src/dto/event.ts:6-19` mirrors the
  orphan BE types.
- **Owner (post-fix)**: the FE DTO aligns with DR-017.
- **Impacted modules**: `frontend/src/dto/event.ts`.
- **Dependencies**: DR-017.
- **Repair approach**: trim the union to match the canonical
  list. The payload interfaces (`GatePendingPayload`,
  `RuntimeLogPayload`, etc.) need not change.
- **Regression risk**: low.
- **Rollout order**: Batch E, step 2 (paired with DR-017).

### Rollout

Batch E is parallel-safe. Steps 1, 2 do not block each other.

---

## Batch F — State / Persistence

### Concern

Schema decisions for the DB layer (`versionStatus` default,
`PendingGate` storage shape). State-machine matrix changes
(`awaiting_gate → running`).

### Why this batch

State-machine and schema decisions are governance. They gate
other batches.

### Drifts

- DR-013 — `Task.versionStatus` default `'committed'` (DB schema).
- DR-014 — `recoverInterruptedGates` illegal transition (matrix).

### Required external decisions

See Batch C for the DR-014 options.

### Test gaps in scope

- `versionStatus` default change: a regression test asserting
  `Task.create({...})` results in `versionStatus='draft'`.
- `awaiting_gate → running` matrix entry: a unit test for the
  transition (and one for the agent-driven recovery path).

### Per-drift design

See Batch C for the per-drift approach. This batch owns the
**decision** rather than the code change. The code change lands
in Batch C.

- DR-013 — Decision: change the schema default to `'draft'`.
  Migration must backfill or quarantine existing `'committed'`
  rows. Freeze doc amendment.
- DR-014 — Decision: pick one of option A (matrix entry) /
  option B (guard) / option C (extend `gateBridge.resolveGate`).
  Document in freeze.

### Rollout

Batch F precedes Batch C in the cross-batch order
(`03_DEPENDENCY_GRAPH.md`).

---

## Batch G — RBAC / Auth

### Concern

Restore the RBAC layer that the inline bypass stub suppresses.

### Why this batch

The auth bypass is the single largest open governance item.
Removing the bypass without a real RBAC layer is unsafe; the batch
must coordinate with whoever owns the real auth strategy.

### Drifts

- DR-004 — HTTP `MembershipService` returns `'owner'` always.
- DR-025 — `releaseGate.canDecide` always `true`.
- DR-026 — `HitlDecision.reviewerId` always
  `'local-user-id'`.

### Required external decisions

| Decision                                                                  | Drifts affected   |
| ------------------------------------------------------------------------- | ----------------- |
| Replace the inline `MembershipService` stub with real RBAC (vs leave the bypass) | DR-004 / DR-025 / DR-026 |

### Test gaps in scope

- Multi-user RBAC tests: NONE EXIST. Phase 3 to address this as
  part of the batch.
- `releaseGate.canDecide` with non-owner role: NONE.

### Per-drift design

#### DR-004 / DR-025 / DR-026 — RBAC triple

- **Root cause**: the inline `MembershipService` stub at
  `SdlcWorkflowService.js:20-31` and `releaseManager.js:33-38`.
  The `authMiddleware.js:1-10` bypass hardcodes
  `req.user.id = 'local-user-id'`.
- **Owner (post-fix)**: a real RBAC service (the
  `MembershipService` block, lifted into a real module). The
  `authMiddleware` reads real credentials.
- **Impacted modules**: `middleware/authMiddleware.js`,
  `services/SdlcWorkflowService.js`, `services/releaseManager.js`,
  `services/workflowQueries.js`.
- **Dependencies**: a real RBAC service and an auth strategy.
  Phase 3 cannot proceed without an architecture owner sign-off.
- **Repair approach (post-ADR)**:
  1. Move `MembershipService` to its own module
    (`services/membershipService.js`).
  2. Replace the bypass with real implementations
    (`requireProjectRole`, `listAccessibleProjectIds`, etc.).
  3. Update `authMiddleware` to set `req.user` from a real auth
    source (see auth team's roadmap).
  4. Update every service that imports the inline stub.
  5. `releaseGate.canDecide` and `HitlDecision.reviewerId`
    become meaningful at this point.
- **Regression risk**: very high. This is the only batch that
  touches authentication. Even with a green RBAC service, the
  rollout must be staged (e.g. canary, then full).
- **Rollout order**: Batch G, steps 1, 2, 3, 4, 5. Can run
  after all earlier batches; gates on the auth roadmap.

### Rollout

Batch G is gated on the auth roadmap. It is the last batch in
the cross-batch order.

---

## Out of scope (across all batches)

- Removing the freeze documents (they are the canonical source;
  they should be amended, not removed).
- Adding new features.
- Renaming anything not necessary for the fix.
- Updating dependencies.
- Running production data migration without a freeze-approved
  script.
- Deciding the auth roadmap (governance, not engineering).