# 04 — Execution Order

> **Status:** CONSOLIDATION ONLY.
> Canonical execution order for the seven batches. Inherits the
> Phase 3 §05 step numbering and re-expresses it in terms of
> R-N repair IDs.
>
> Per the brief: "For every batch include: Preconditions,
> Implementation scope, Verification, Rollback point, Git
> checkpoint recommendation, Expected completion criteria.
> Nothing else."

---

## Phase 0 — Governance decisions (ADRs)

These are not code. Phase 4 must capture the following ADRs in
`docs/adr/` BEFORE any code lands.

### Step 0.1 — ADR for R-006 (RBAC stub)

- **Preconditions**: Auth team's roadmap commitment (NV-8).
- **Implementation scope**: Decision on whether to keep the
  bypass (defer), replace with a real RBAC service, or extract
  to a separate module.
- **Verification**: ADR document exists with chosen option.
- **Rollback point**: ADR is reversible (revert the doc).
- **Git checkpoint**: `adr/rbactriple-adr` branch; merge to
  `main` only after Batch G lands.
- **Expected completion criteria**: ADR is approved by
  architecture owner.

### Step 0.2 — ADR for R-013 (`reviewerId`)

- **Preconditions**: Step 0.1 (R-006) decided.
- **Implementation scope**: Decision on whether the
  `'local-user-id'` value remains until Batch G removes the
  bypass.
- **Verification**: ADR document exists with chosen option.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: same as 0.1.
- **Expected completion criteria**: ADR approved.

### Step 0.3 — ADR for R-017 (`HitlDecision.action` enum)

- **Preconditions**: (none).
- **Implementation scope**: Decision on enum vs free string; if
  enum, the set of allowed values.
- **Verification**: ADR document + Prisma schema diff preview.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: `adr/hitl-action-enum` branch.
- **Expected completion criteria**: ADR approved; Prisma
  migration preview drafted.

### Step 0.4 — ADR for R-021 (`featureRequest` canonical owner)

- **Preconditions**: (none).
- **Implementation scope**: Owner A (`Task.observability`) vs
  Owner B (`AgentArtifact`).
- **Verification**: ADR document with chosen owner + migration
  story.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: `adr/feature-request-owner` branch.
- **Expected completion criteria**: ADR approved.

### Step 0.5 — ADR for R-026 (`agentOutput` canonical shape)

- **Preconditions**: (none).
- **Implementation scope**: Mock vs real runner shapes; what
  shape the FE should receive.
- **Verification**: ADR document with chosen shape.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: `adr/agent-output-shape` branch.
- **Expected completion criteria**: ADR approved; FE DTO update
  preview drafted.

### Step 0.6 — ADR for R-040 (legacy `submitGateDecision`)

- **Preconditions**: Steps 0.4 (R-021), 0.5 (R-026).
- **Implementation scope**: Delete / deprecate-shim / keep.
- **Verification**: ADR document with chosen resolution.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: `adr/legacy-gate-decision` branch.
- **Expected completion criteria**: ADR approved.

### Step 0.7 — ADR for R-041 (release-flow ownership)

- **Preconditions**: Step 0.8 (R-042).
- **Implementation scope**: `PendingGate` row for
  `kind='release'` (drop or keep).
- **Verification**: ADR document.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: `adr/release-pending-gate` branch.
- **Expected completion criteria**: ADR approved.

### Step 0.8 — ADR for R-042 (`gate` canonical truth)

- **Preconditions**: (none).
- **Implementation scope**: In-memory map vs DB row vs merged.
- **Verification**: ADR document.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: `adr/gate-truth` branch.
- **Expected completion criteria**: ADR approved.

### Step 0.9 — ADR for R-030 (`recoverInterruptedGates` matrix)

- **Preconditions**: (none).
- **Implementation scope**: Option A (matrix entry), Option B
  (guard), Option C (extend `gateBridge.resolveGate`).
- **Verification**: ADR document with chosen option.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: `adr/recover-interrupted` branch.
- **Expected completion criteria**: ADR approved.

### Step 0.10 — ADR for R-044 (`Task.versionStatus` default)

- **Preconditions**: (none).
- **Implementation scope**: Default `'draft'` (recommended) vs
  keep `'committed'`.
- **Verification**: ADR document with backfill plan.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: `adr/version-status-default` branch.
- **Expected completion criteria**: ADR approved; migration
  draft tested on `backend/prisma/dev.db` copy.

### Step 0.11 — ADR for R-045 (`PipelineSession.status` failure transitions)

- **Preconditions**: (none).
- **Implementation scope**: New state value `'failed'` and
  trigger logic.
- **Verification**: ADR document.
- **Rollback point**: ADR is reversible.
- **Git checkpoint**: `adr/session-failed-state` branch.
- **Expected completion criteria**: ADR approved.

### Step 0.X — External: Auth roadmap

- **Preconditions**: (external).
- **Implementation scope**: Auth team's commitment to a real
  RBAC service.
- **Verification**: External commitment recorded.
- **Rollback point**: N/A.
- **Git checkpoint**: N/A (external).
- **Expected completion criteria**: Auth roadmap commitment
  received.

---

## Phase A — Batch A (Cleanup; parallel-safe)

All Batch A steps are independent. They may be done in any
order. They are also safe to defer.

### Step 1 — R-005 (delete `arch_runtime.js`)

- **Preconditions**: (none).
- **Implementation scope**: Delete `backend/arch_runtime.js`;
  scrub docs referencing it.
- **Verification**: `git ls-files backend/arch_runtime.js`
  returns no result; grep for `arch_runtime` in `docs/` returns
  no remaining references.
- **Rollback point**: Restore from git history.
- **Git checkpoint**: Single commit `chore: remove dead
  arch_runtime.js (R-005)`.
- **Expected completion criteria**: File gone; docs clean.

### Step 2 — R-007 (`socketService.js` deletion note)

- **Preconditions**: (none).
- **Implementation scope**: No code change; docs scrub for any
  out-of-tree references.
- **Verification**: grep for `socketService` in
  `docs/` and `backend/` returns no live references.
- **Rollback point**: N/A.
- **Git checkpoint**: N/A (no commit; docs only).
- **Expected completion criteria**: No live references.

### Step 3 — R-014 (lint coverage)

- **Preconditions**: (none).
- **Implementation scope**: Wire `eslint` / `prettier` into the
  backend pipeline; delete `frontend/lint-results.txt`.
- **Verification**: `npm run lint` (or equivalent) runs in CI.
- **Rollback point**: Revert the workflow.
- **Git checkpoint**: Single commit `chore: wire lint (R-014)`.
- **Expected completion criteria**: Lint runs in CI for both
  backend and frontend.

### Step 4 — R-015 (`package.json` scripts)

- **Preconditions**: (none).
- **Implementation scope**: Add `start`, `lint`, `db:push` to
  `backend/package.json`; add a top-level orchestration script.
- **Verification**: `npm run start`, `npm run lint`,
  `npm run db:push` succeed.
- **Rollback point**: Revert the package.json changes.
- **Git checkpoint**: Single commit `chore: package.json scripts
  (R-015)`.
- **Expected completion criteria**: Scripts work as documented.

### Step 5 — R-016 (drop or wire `Project.description`)

- **Preconditions**: (none).
- **Implementation scope**: Either drop the column OR wire a UI
  surface (Batch E R-011).
- **Verification**: Decision is captured; if drop, the column is
  removed via migration; if wire, the FE exposes it.
- **Rollback point**: Revert the migration or wire.
- **Git checkpoint**: Single commit
  `chore: Project.description (R-016)`.
- **Expected completion criteria**: Either column gone or UI
  wired.

### Step 6 — R-019 (route namespace overlap)

- **Preconditions**: (none).
- **Implementation scope**: Add a freeze doc note clarifying the
  `/sessions/:page` vs `/sdlc/sessions/:session_id/...`
  distinction.
- **Verification**: Freeze doc note exists.
- **Rollback point**: Revert the doc.
- **Git checkpoint**: Single commit `docs: route namespace
  clarification (R-019)`.
- **Expected completion criteria**: Doc note exists.

### Step 7 — R-022 (mock flag names)

- **Preconditions**: (none).
- **Implementation scope**: Add a freeze doc note describing the
  three flags and their distinct purposes.
- **Verification**: Doc note exists.
- **Rollback point**: Revert the doc.
- **Git checkpoint**: Single commit
  `docs: mock flag clarification (R-022)`.
- **Expected completion criteria**: Doc note exists.

### Step 8 — R-025 (Sentry init at module load)

- **Preconditions**: (none).
- **Implementation scope**: Move `Sentry.init` inside
  `startServer()`; add a guard for `require.main === module` at
  the top.
- **Verification**: Tests that `require('app')` do not trigger
  Sentry init.
- **Rollback point**: Revert the file.
- **Git checkpoint**: Single commit `chore: Sentry init
  hygiene (R-025)`.
- **Expected completion criteria**: Tests pass without Sentry
  side-effects.

### Step 9 — R-034 (`MOCK_SCENARIO_PROFILES`)

- **Preconditions**: (none).
- **Implementation scope**: Add `failure_path` and
  `gate_rejection_path` to the profiles map.
- **Verification**: Mock runs produce the new scenarios.
- **Rollback point**: Revert the profiles.
- **Git checkpoint**: Single commit
  `test: add mock scenarios (R-034)`.
- **Expected completion criteria**: New scenarios usable from
  tests.

### Step 10 — R-035 (delete `agentParser.js`)

- **Preconditions**: (none).
- **Implementation scope**: Delete the file.
- **Verification**: `git ls-files` returns no result; no
  importers.
- **Rollback point**: Restore from git history.
- **Git checkpoint**: Single commit
  `chore: remove dead agentParser.js (R-035)`.
- **Expected completion criteria**: File gone.

### Step 11 — R-036 (delete `validation.js`)

- **Preconditions**: (none).
- **Implementation scope**: Delete the file.
- **Verification**: `git ls-files` returns no result; no
  importers.
- **Rollback point**: Restore from git history.
- **Git checkpoint**: Single commit
  `chore: remove dead validation.js (R-036)`.
- **Expected completion criteria**: File gone.

### Step 12 — R-037 (`archAskEnforcer.ENFORCED_ROLES`)

- **Preconditions**: (none).
- **Implementation scope**: Add `intent-agent` to
  `ENFORCED_ROLES` (deferred; dormant on current orchestrator).
- **Verification**: Set is updated; orchestrator path still
  unchanged.
- **Rollback point**: Revert the set.
- **Git checkpoint**: Single commit
  `chore: ENFORCED_ROLES update (R-037)`.
- **Expected completion criteria**: Set updated; no regression.

### Step 13 — R-039 (`agents/sandbox/`)

- **Preconditions**: (none).
- **Implementation scope**: Document the sandbox's role OR remove
  it (decision in Batch A scope).
- **Verification**: Either docs exist or directory gone.
- **Rollback point**: Restore from git history.
- **Git checkpoint**: Single commit `chore: sandbox cleanup
  (R-039)`.
- **Expected completion criteria**: Sandbox state matches doc.

### Step 14 — R-046 (FE store actions)

- **Preconditions**: Steps 1–13 (other Batch A items) optional;
  no strict dependency.
- **Implementation scope**: Remove dead actions from
  `useUiStore.ts` and `useWorkflowStore.ts`.
- **Verification**: `npx tsc --noEmit` succeeds; FE build
  succeeds.
- **Rollback point**: Revert the file edits.
- **Git checkpoint**: Single commit
  `chore: remove dead FE store actions (R-046)`.
- **Expected completion criteria**: FE compiles; no consumer
  breaks.

**Verification (Phase A rollup)**: `git ls-files` returns no
result for the deleted files; `tsc --noEmit` succeeds; the
`grep` for removed paths returns nothing.

**Rollout posture**: any. Recommend a single PR per file for
auditability.

---

## Phase F — Batch F (governance decisions become code)

After the ADRs in Phase 0 are approved, Batch F lands first as
a schema / matrix layer. This unlocks Batches B, C, and G.

### Step 15 — R-044 (`Task.versionStatus` default)

- **Preconditions**: Step 0.10 ADR approved.
- **Implementation scope**: Change Prisma default to `'draft'`;
  add migration with backfill.
- **Verification**: `prisma migrate dev` (or dry-run) succeeds;
  all integration tests pass without modification; a copy of
  `backend/prisma/dev.db` is migrated cleanly.
- **Rollback point**: Forward-only migration; rollback is a new
  forward migration.
- **Git checkpoint**: Single commit
  `feat(schema): Task.versionStatus default to draft (R-044)`.
- **Expected completion criteria**: Migration runs cleanly; all
  existing tests pass.

### Step 16 — R-030 (matrix decision)

- **Preconditions**: Step 0.9 ADR approved.
- **Implementation scope**: Apply the chosen option (matrix entry
  / guard / `gateBridge.resolveGate` extension).
- **Verification**: A unit test exercises the
  `awaiting_gate → running` transition; the recovery path runs
  without throwing.
- **Rollback point**: Revert the matrix entry / guard / extension.
- **Git checkpoint**: Single commit
  `fix(state-machine): recoverInterruptedGates (R-030)`.
- **Expected completion criteria**: Recovery succeeds; existing
  tests pass.

### Step 17 — R-045 (matrix decision)

- **Preconditions**: Step 0.11 ADR approved.
- **Implementation scope**: Add `'failed'` /
  `'cancelled'` transition for `PipelineSession.status`; derive
  logic in `_saveAgentData` or `taskLifecycleService.transition`.
- **Verification**: A session whose tasks all fail transitions
  to `'failed'`.
- **Rollback point**: Revert the derive logic.
- **Git checkpoint**: Single commit
  `feat(state-machine): PipelineSession failure transitions
  (R-045)`.
- **Expected completion criteria**: New state transitions fire
  correctly; FE consumers unaffected.

**Verification (Phase F rollup)**: All Phase A + Phase F
integration tests pass. The schema migration is applied to a
copy of `backend/prisma/dev.db` and verified.

**Rollout posture**: behind a feature flag where possible. The
R-044 migration is rolled forward once; rollback is a new
forward migration unless explicitly designed otherwise.

---

## Phase B — Batch B (Ownership)

### Step 18 — R-021 (`featureRequest` canonical owner)

- **Preconditions**: Step 0.4 ADR; Step 15 (R-044 schema).
- **Implementation scope**: Migrate readers; remove
  non-canonical writer.
- **Verification**: `grep -rn 'featureRequest' backend/src`
  returns a single canonical writer per location; the chosen
  owner is correctly populated.
- **Rollback point**: Re-add the legacy writer (dual-write
  period).
- **Git checkpoint**: Single commit
  `refactor: featureRequest canonical owner (R-021)`.
- **Expected completion criteria**: Single owner.

### Step 19 — R-008 (drop `cli_session_id` / `cli_total_cost_usd`)

- **Preconditions**: Step 15 (R-044 schema decision consistent
  with `observability` shape).
- **Implementation scope**: Stop writing the two keys.
- **Verification**: `grep -rn 'cli_session_id\|cli_total_cost_usd'
  backend/src` returns no result.
- **Rollback point**: Re-add the runner output key (one file).
- **Git checkpoint**: Single commit
  `chore: drop orphan cli_* keys (R-008)`.
- **Expected completion criteria**: No writes; no readers
  broken.

### Step 20 — R-042 (`gate` canonical truth)

- **Preconditions**: Step 0.8 ADR; Step 16 (R-030 matrix).
- **Implementation scope**: Apply the chosen gate-truth
  strategy.
- **Verification**: Recovery path works after a backend restart
  with an in-flight gate.
- **Rollback point**: Switch back to dual truth.
- **Git checkpoint**: Single commit
  `refactor: gate canonical truth (R-042)`.
- **Expected completion criteria**: Live and recovery paths are
  consistent.

### Step 21 — R-043 (`Task.observability` canonical schema)

- **Preconditions**: Step 0.5 ADR (R-026 also); Step 18 (R-021).
- **Implementation scope**: Declare JSON schema for
  `Task.observability`; restrict each writer's keys.
- **Verification**: Each writer's keys are validated; the
  multi-key merge at `_saveAgentData` no longer drops keys.
- **Rollback point**: Restore the multi-writer merge.
- **Git checkpoint**: Single commit
  `refactor: Task.observability schema (R-043)`.
- **Expected completion criteria**: Each key has exactly one
  owner.

### Step 22 — R-017 (`HitlDecision.action` enum)

- **Preconditions**: Step 0.3 ADR.
- **Implementation scope**: Apply the enum (Prisma migration);
  update producers and consumers.
- **Verification**: All `HitlDecision.create` writes use the
  enum; all consumers branch on the enum.
- **Rollback point**: Revert the migration (forward-only).
- **Git checkpoint**: Single commit
  `feat(schema): HitlDecision.action enum (R-017)`.
- **Expected completion criteria**: Enum applied; producers and
  consumers conform.

### Step 23 — R-026 (`agentOutput` canonical shape)

- **Preconditions**: Step 0.5 ADR; Step 21 (R-043 schema).
- **Implementation scope**: Apply the chosen `agentOutput`
  shape; trim the FE DTO.
- **Verification**: FE DTO matches the chosen shape;
  `agentContract.REQUIRED_OUTPUT_KEYS` lists the canonical keys.
- **Rollback point**: Revert the contract.
- **Git checkpoint**: Single commit
  `feat(contract): agentOutput canonical shape (R-026)`.
- **Expected completion criteria**: Single shape; FE compiles.

### Step 24 — R-006 / R-013 / R-024 (RBAC triple)

- **Preconditions**: Step 0.1 ADR; Step 0.2 ADR; Step 15
  (R-044 schema); external auth roadmap.
- **Implementation scope**: Implement Batch G's groundwork here
  if the auth roadmap allows. Otherwise these are deferred to
  Batch G.
- **Verification**: (per Batch G).
- **Rollback point**: (per Batch G).
- **Git checkpoint**: (per Batch G).
- **Expected completion criteria**: (per Batch G).

**Verification (Phase B rollup)**: `grep -rn` returns a single
canonical writer per object; the gate-truth strategy works in
both live and recovery paths; the observability schema is
respected.

**Rollout posture**: behind a feature flag where possible.
R-042 requires dual-write for one release and is non-flaggable.

---

## Phase C — Batch C (Pipeline)

### Step 25 — R-040 (legacy `submitGateDecision`)

- **Preconditions**: Step 0.6 ADR; Steps 18, 21, 22 (B / F
  decisions).
- **Implementation scope**: Apply the chosen resolution (delete
  / shim / keep).
- **Verification**: `sdlc.handoff.test.js` either removed
  (option 1) or pivoted to the canonical endpoint (option 2/3).
- **Rollback point**: Re-mount the legacy route at
  `routes/sdlc.js:35`.
- **Git checkpoint**: Single commit
  `refactor: legacy submitGateDecision (R-040)`.
- **Expected completion criteria**: Legacy path resolved;
  tests pass.

### Step 26 — R-041 (release-flow single-emitter + PendingGate)

- **Preconditions**: Step 0.7 ADR; Step 20 (R-042).
- **Implementation scope**: Apply the chosen `PendingGate`
  decision; route the persistence step through `releaseManager`.
- **Verification**: A release-approve dry-run writes the
  `PendingGate` row (if kept) and the `pipeline_completed`
  envelope (Step 28 below).
- **Rollback point**: Re-create the `PendingGate` row on
  release approve (idempotent).
- **Git checkpoint**: Single commit
  `feat(release-flow): single-emitter (R-041)`.
- **Expected completion criteria**: Single emitter; `PendingGate`
  state matches ADR.

### Step 27 — R-029 (`Task.status` bypass)

- **Preconditions**: Step 16 (R-030 matrix).
- **Implementation scope**: Introduce `setTaskStatus` helper or
  route through `taskLifecycle.transition`.
- **Verification**: All 8 direct `Task.update({status:…})` sites
  use the new helper.
- **Rollback point**: Restore the 8 direct writers.
- **Git checkpoint**: Single commit
  `refactor(state-machine): Task.status writers (R-029)`.
- **Expected completion criteria**: All writers routed through
  the helper; matrix accepts each transition.

### Step 28 — R-001 / R-018 (persist `pipeline_completed` + commitSha)

- **Preconditions**: Step 26 (R-041 single-emitter).
- **Implementation scope**: After `publishEvent`, call
  `AgentEvent.create`; after `git commit`, read the real SHA.
- **Verification**: A release-approve dry-run writes a
  `pipeline_completed` `AgentEvent` row carrying the real SHA.
- **Rollback point**: Drop the new `AgentEvent.create` call.
- **Git checkpoint**: Single commit
  `feat(event-bus): persist pipeline_completed (R-001/R-018)`.
- **Expected completion criteria**: Row exists; SHA is real.

### Step 29 — R-045 (code)

- **Preconditions**: Step 17 (R-045 matrix).
- **Implementation scope**: Apply the derive logic for
  `PipelineSession.status` failure transitions.
- **Verification**: A session whose tasks all fail transitions
  to `'failed'`.
- **Rollback point**: Drop the new pipeline-status writer.
- **Git checkpoint**: Single commit
  `feat(pipeline): session failure transitions (R-045)`.
- **Expected completion criteria**: New transitions fire
  correctly.

### Step 30 — R-009 (legacy `Task.create` `sequence:1` rows)

- **Preconditions**: (none).
- **Implementation scope**: Remove the legacy `sessionId=null`
  branch from `Task.create` OR explicitly handle it on the
  replay path.
- **Verification**: Pre-session-bound tasks no longer create
  orphan rows; if kept, the replay surfaces them.
- **Rollback point**: Restore the legacy branch.
- **Git checkpoint**: Single commit
  `fix(persistence): legacy Task.create rows (R-009)`.
- **Expected completion criteria**: No orphan rows.

### Step 31 — R-020 (worker lock single-process)

- **Preconditions**: (none).
- **Implementation scope**: Document the single-process
  assumption; defer the multi-process implementation.
- **Verification**: A freeze doc note records the constraint.
- **Rollback point**: Revert the doc.
- **Git checkpoint**: Single commit
  `docs: single-process assumption (R-020)`.
- **Expected completion criteria**: Doc note exists.

### Step 32 — R-027 (phase derivation)

- **Preconditions**: (none).
- **Implementation scope**: Fix `deriveCurrentPhase` for the
  ARCH-only-no-PO-approved case.
- **Verification**: An ARCH-approved-only session does not
  return `'BACKLOG'`.
- **Rollback point**: Revert the function.
- **Git checkpoint**: Single commit
  `fix(phase): ARCH-only-no-PO edge (R-027)`.
- **Expected completion criteria**: Phase string correct.

### Step 33 — R-031 (resolveGate race)

- **Preconditions**: (none).
- **Implementation scope**: Add a guard against double-resolve
  (e.g. row-level lock or `findUnique` + `updateMany` atomic
  path).
- **Verification**: Two racing callers produce one
  `gate_resolved` envelope.
- **Rollback point**: Revert the guard.
- **Git checkpoint**: Single commit
  `fix(gate): resolveGate double-resolve (R-031)`.
- **Expected completion criteria**: Single envelope per
  resolution.

### Step 34 — R-032 (gate scope)

- **Preconditions**: Step 20 (R-042 gate truth decision).
- **Implementation scope**: Align the FE-facing
  `listPendingApprovals` scope with the lock check's session
  filter.
- **Verification**: A project's pending questions listing
  respects session scope.
- **Rollback point**: Revert the FE listing.
- **Git checkpoint**: Single commit
  `fix(gate-scope): pendingQuestions listing (R-032)`.
- **Expected completion criteria**: FE listing matches lock
  check.

### Step 35 — R-033 (commit/push errors)

- **Preconditions**: (none).
- **Implementation scope**: Distinguish commit failure from push
  failure in `commitAndPushOnApprove`'s return.
- **Verification**: `resolveOutputReviewGate` branches on
  `result.reason`.
- **Rollback point**: Restore the silent-swallow behaviour.
- **Git checkpoint**: Single commit
  `fix(git): commit error surfacing (R-033)`.
- **Expected completion criteria**: Commit failures visible to
  the caller.

### Step 36 — R-037 (`archAskEnforcer.ENFORCED_ROLES`)

- **Preconditions**: Step 12 (Batch A). Code change is a no-op
  for the current orchestrator.
- **Implementation scope**: Add `intent-agent` to
  `ENFORCED_ROLES`.
- **Verification**: The set is updated; no regression on the
  current orchestrator.
- **Rollback point**: Revert the set.
- **Git checkpoint**: Single commit
  `chore: ENFORCED_ROLES update (R-037)`.
- **Expected completion criteria**: Set updated.

**Verification (Phase C rollup)**: `sdlc.handoff.test.js`
passes (or is removed per R-040); `pipeline_completed`
`AgentEvent` rows persist on a manual release-approve dry-run;
`Task.status` writes go through `setTaskStatus`.

**Rollout posture**: behind a canary or feature flag where
possible. Step 25 (R-040) has the largest blast radius.

---

## Phase D — Batch D (Event Bus)

### Step 37 — R-001 (already in Phase C, Step 28)

R-001 is implemented in Phase C Step 28 (alongside R-018). No
separate Phase D step.

### Step 38 — R-002 (trim `EventType` union)

- **Preconditions**: Step 0.7 (R-030 ADR); Step 16 (R-030
  matrix).
- **Implementation scope**: Trim the discriminator union on
  BE and FE; update `sseClient.isEnvelope`.
- **Verification**: TS compiles; the BE reducer receives only
  canonical types.
- **Rollback point**: Restore the three EventTypes.
- **Git checkpoint**: Single commit
  `feat(contract): EventType union shrink (R-002)`.
- **Expected completion criteria**: Discriminator is the
  canonical set.

### Step 39 — R-003 (SSE replay policy)

- **Preconditions**: Step 0.7 (R-030 ADR); Step 20 (R-042).
- **Implementation scope**: Apply the chosen replay strategy
  (synthesise / drop / backfill).
- **Verification**: A pre-fix `AgentEvent` row renders on
  reconnect per the chosen strategy.
- **Rollback point**: Restore silent-drop behaviour.
- **Git checkpoint**: Single commit
  `fix(replay): SSE replay policy (R-003)`.
- **Expected completion criteria**: Replay matches ADR.

### Step 40 — R-004 (CORS docs)

- **Preconditions**: (none).
- **Implementation scope**: Add a freeze doc note describing
  the `isLocalDevOrigin` loopback policy.
- **Verification**: Doc note exists.
- **Rollback point**: Revert the doc.
- **Git checkpoint**: Single commit
  `docs: CORS loopback policy (R-004)`.
- **Expected completion criteria**: Doc note exists.

### Step 41 — R-012 (sequence allocation)

- **Preconditions**: (none).
- **Implementation scope**: Move `sequenceService.next` inside
  the `prisma.$transaction` in `Task.create`.
- **Verification**: A rolled-back transaction does not consume
  a sequence.
- **Rollback point**: Revert the move.
- **Git checkpoint**: Single commit
  `fix(sequence): transactional allocation (R-012)`.
- **Expected completion criteria**: No sequence gap on
  rollback.

### Step 42 — R-028 (`session_resumed` coalesce)

- **Preconditions**: (none).
- **Implementation scope**: Apply the coalesce policy in
  `streamPipelineStatus` (per C-2 resolution).
- **Verification**: A no-op reconnect does not allocate a
  sequence.
- **Rollback point**: Restore unconditional `publishEvent` on
  every reconnect.
- **Git checkpoint**: Single commit
  `fix(event-bus): session_resumed coalesce (R-028)`.
- **Expected completion criteria**: Counter no longer leaks.

### Step 43 — R-038 (eventBus bounded maps)

- **Preconditions**: (none).
- **Implementation scope**: Add LRU bounds to
  `eventBus.sessionSubscribers`, `eventBus.projectSubscribers`,
  `gateBridge.pending`.
- **Verification**: Long-running processes do not accumulate
  unbounded listeners.
- **Rollback point**: Restore unbounded Maps.
- **Git checkpoint**: Single commit
  `fix(memory): bounded subscriber map (R-038)`.
- **Expected completion criteria**: Maps bounded.

**Verification (Phase D rollup)**: A fresh SSE writer
reconnect does not allocate a sequence if no events were
missed. Pre-fix `AgentEvent` rows render correctly. The
discriminator is the canonical set.

**Rollout posture**: behind a feature flag where possible.
Step 42 (R-028) is observable on the FE; a canary helps.

---

## Phase E — Batch E (Frontend)

### Step 44 — R-046 (FE store actions)

- **Preconditions**: Step 14 (Batch A); `tsc --noEmit` passes.
- **Implementation scope**: Remove the dead store actions
  (paired with Batch A Step 14).
- **Verification**: `tsc --noEmit` passes; FE builds.
- **Rollback point**: Restore the actions.
- **Git checkpoint**: Single commit
  `chore: remove dead FE store actions (R-046)`.
- **Expected completion criteria**: FE compiles; no consumer
  breaks.

### Step 45 — R-002 (FE mirror)

- **Preconditions**: Step 38 (BE trim).
- **Implementation scope**: Trim the FE `event.ts` to match.
- **Verification**: FE compiles; mappers consume the canonical
  types.
- **Rollback point**: Restore the three EventTypes.
- **Git checkpoint**: Single commit
  `feat(contract): FE EventType union (R-002)`.
- **Expected completion criteria**: FE DTO matches BE.

### Step 46 — R-010 (session-start subscription)

- **Preconditions**: (none).
- **Implementation scope**: Document the client-driven SSE
  subscription model; optionally add a server-side kickoff
  envelope.
- **Verification**: Doc exists; if server-side envelope added,
  a fresh session receives it.
- **Rollback point**: Revert the doc / envelope.
- **Git checkpoint**: Single commit
  `chore(session-start): subscription model (R-010)`.
- **Expected completion criteria**: Subscription model clear.

### Step 47 — R-011 (project creation UI)

- **Preconditions**: Step 5 (R-016 column decision).
- **Implementation scope**: Wire the project-creation UI; if
  R-016 dropped the column, no UI work.
- **Verification**: The UI exposes project creation / rename.
- **Rollback point**: Revert the UI.
- **Git checkpoint**: Single commit
  `feat(ui): project creation (R-011)`.
- **Expected completion criteria**: UI wired.

### Step 48 — R-023 (module-level dedup)

- **Preconditions**: (none).
- **Implementation scope**: Move dedup state from module-level
  to component-scoped (or hook-scoped).
- **Verification**: Unmount/remount does not retain stale
  dedup entries.
- **Rollback point**: Revert the move.
- **Git checkpoint**: Single commit
  `refactor(store): dedup scope (R-023)`.
- **Expected completion criteria**: No stale dedup.

### Step 49 — R-032 (FE listing scope)

- **Preconditions**: Step 34 (R-032 lock-check alignment).
- **Implementation scope**: Align the FE dashboard's
  `listAllInterventions` scope with the lock check.
- **Verification**: FE listing matches session filter.
- **Rollback point**: Revert the FE listing.
- **Git checkpoint**: Single commit
  `fix(fe): pendingQuestions scope (R-032)`.
- **Expected completion criteria**: FE listing matches lock
  check.

**Verification (Phase E rollup)**: `tsc --noEmit` succeeds;
the FE builds; the dashboard reflects the new scope.

**Rollout posture**: any. FE compile is the verification.

---

## Phase G — Batch G (RBAC / Auth)

Gated on the auth roadmap. Begins after Steps 0.1, 0.2, and 0.X
are satisfied.

### Step 50 — R-006 (replace `MembershipService` stub)

- **Preconditions**: Step 0.1 ADR; Step 15 (R-044); external
  auth roadmap.
- **Implementation scope**: Move `MembershipService` to its
  own module; replace the bypass with real implementations.
- **Verification**: A multi-user test
  (`auth.middleware.test.js`) covers the bypass removal.
- **Rollback point**: Restore the bypass.
- **Git checkpoint**: Single commit
  `feat(auth): real RBAC service (R-006)`.
- **Expected completion criteria**: RBAC service live; bypass
  removed.

### Step 51 — R-024 (`releaseGate.canDecide`)

- **Preconditions**: Step 50 (R-006).
- **Implementation scope**: Restore real RBAC check at
  `releaseGate.canDecide`.
- **Verification**: A non-owner user sees `canDecide: false`.
- **Rollback point**: Restore the unconditional `true` path.
- **Git checkpoint**: Single commit
  `feat(auth): canDecide real check (R-024)`.
- **Expected completion criteria**: RBAC narrows correctly.

### Step 52 — R-013 (`reviewerId`)

- **Preconditions**: Step 50 (R-006).
- **Implementation scope**: Write the real `reviewerId` to
  `HitlDecision`.
- **Verification**: An audit row carries the real reviewer.
- **Rollback point**: Restore the always-`'local-user-id'`
  write.
- **Git checkpoint**: Single commit
  `feat(audit): reviewerId real (R-013)`.
- **Expected completion criteria**: Audit trail distinguishes
  reviewers.

**Verification (Phase G rollup)**: Real auth path is
end-to-end. Multi-user tests pass.

**Rollout posture**: canary-deploy only. The auth bypass is
global; the cutover must be staged.

---

## Cross-batch summary

| Batch | Steps | Independent of others? |
| ----- | ----- | ---------------------- |
| A     | 1–14  | Yes (parallel-safe)    |
| F     | 15–17 | Yes (gates B, C, G)    |
| B     | 18–24 | Independent of C, D, E |
| C     | 25–36 | Independent of D, E    |
| D     | 37–43 | Independent of E       |
| E     | 44–49 | Independent of others  |
| G     | 50–52 | Yes (gated on auth)    |

Batch A may run any time after ADRs are approved. Batches F, B,
C, D, E, G follow the order above. Two batches run concurrently
only when the cross-batch matrix in `03_DEPENDENCY_GRAPH.md §5`
permits.

---

## Verification checklist (per phase)

### Phase A

- `git ls-files | grep -E '(authService|agentParser|validation)\.js$'` → no result.
- `git ls-files backend/scripts/ | wc -l` → 2
  (`demoSmokeClaudeCode.js` and `sseReplaySmoke.js`, if
  retained; else 1).
- `frontend/src/store/useUiStore.ts` no longer contains the
  removed methods.
- `npm run typecheck` in the FE directory succeeds.

### Phase F

- `prisma migrate dev` (or the equivalent dry-run) succeeds.
- All integration tests in `backend/tests/integration/` pass
  without modification.

### Phase B

- `grep -rn 'featureRequest' backend/src` returns a single
  canonical writer per location.
- `grep -rn 'cli_session_id\|cli_total_cost_usd' backend/src`
  returns no result.
- `gateBridge.requestGate` and `resolveGate` paths are updated
  per the ADR.

### Phase C

- `sdlc.handoff.test.js` either removed (option 1) or pivoted
  to the canonical endpoint (option 2/3).
- `pipeline_completed` `AgentEvent` rows persist on a manual
  release-approve dry-run.
- `Task.status` writes go through `setTaskStatus`.

### Phase D

- Reconnect on a fresh SSE writer does not allocate a sequence
  if no events were missed.
- Replay of pre-fix `AgentEvent` rows renders the same wire
  shape (modulo R-002 trim).

### Phase E

- `tsc --noEmit` succeeds.
- The FE builds.

### Phase G

- Real auth path is end-to-end. A multi-user test
  (`auth.middleware.test.js` already exists but should be
  validated for the new path) covers the bypass removal.

---

## Final-rollout posture

The repository has no deployment target documented in any
reviewed source. Phase 4 must record a target before completion.

The default posture for any HIGH or CRITICAL drift fix is a
canary: push the new path behind a feature flag or branch,
enable for 5% of traffic, observe SSE / audit / production-
snapshot metrics, then enable for 100%.

---

## NOT VERIFIED

- Whether the deployment target supports canary deploys
  (NV-10).
- Whether the production data migration for R-044 has an
  existing backfill story (NV-9).
- Whether the auth team's roadmap has a real commitment
  (NV-8).
- Whether the legacy `submitGateDecision` route is reachable
  from any external client (NV-7).
- Whether `setTaskStatus` should live in `models/Task.js` or a
  new helper module.
