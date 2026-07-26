# 05 — Regression Plan

> **Status:** CONSOLIDATION ONLY.
> Per-batch verification and rollback strategy for the seven
> repair batches defined in `02_REPAIR_BATCHES.md`. Inherits the
> Phase 3 §04 regression-risk matrix; per-repair rollback plans
> are reused under the R-N canonical IDs.
>
> Per the brief: "For every repair batch specify: Compile
> checks, Unit tests, Integration tests, Pipeline verification,
> Manual verification, Expected runtime logs, Expected UI
> behaviour, Regression risks, Rollback strategy."

---

## Risk scale (carried forward from Phase 3 §04)

| Rating | Meaning |
| ------ | ------- |
| Critical | Reasonable fix-regression scenario can take the SDLC pipeline offline. |
| High | Reasonable fix-regression scenario causes user-visible behaviour loss; rollback is mandatory. |
| Medium | Reasonable fix-regression scenario exposes a soft spot that future drift will resume; rollback is optional. |
| Low | Reasonable fix-regression scenario is cosmetic; rollback is unnecessary. |

Probability is a separate axis; this document tracks magnitude.

---

## Batch A — Cleanup

### Compile checks

- Backend: `npx prisma generate` succeeds (no schema change).
- Frontend: `npx tsc --noEmit` succeeds after store action
  removals.
- ESLint: `npm run lint` passes on both backend and frontend
  (after R-014 wires lint).

### Unit tests

- Pre-existing `backend/tests/integration/*` and
  `frontend/tests/*` continue to pass without modification
  (Phase 4 rule: no test edits in this consolidation phase).

### Integration tests

- A smoke run on the dev DB confirms the pipeline still
  starts.

### Pipeline verification

- Manual: start the backend, open the dashboard, observe no
  warnings about missing modules.

### Manual verification

- `git ls-files | grep -E '(authService|agentParser|validation|arch_runtime)\.js$'` → no result.
- `git ls-files backend/scripts/` → only the two retained
  scripts (`demoSmokeClaudeCode.js`, `sseReplaySmoke.js` if
  retained; else 1).
- `frontend/src/store/useUiStore.ts` no longer contains
  removed action methods.
- `npm run typecheck` succeeds.

### Expected runtime logs

- No new warnings about missing modules.
- No Sentry init at module load (after R-025).

### Expected UI behaviour

- No visible change. The store actions were unused; their
  removal is invisible to users.

### Regression risks

- Low per file. Aggregate Low.

### Rollback strategy

- Per-file git revert. The deletions are independent; one
  revert per file.
- For the FE store action removals: re-add the deleted methods.
- For R-014 / R-015: revert the workflow / package.json.

---

## Batch B — Ownership

### Compile checks

- `npx prisma generate` succeeds after the schema diff (R-017
  enum).
- `npx tsc --noEmit` succeeds on the FE after R-026 contract
  change.

### Unit tests

- All pre-existing unit tests pass.
- New assertions are not added in this phase (per the brief).

### Integration tests

- `backend/tests/integration/agent-contract.test.js` exercises
  the `agentOutput` shape.
- `backend/tests/integration/output-contract.test.js` exercises
  the `agentContract.REQUIRED_OUTPUT_KEYS` (post-R-026).
- `backend/tests/integration/aifa-gate.test.js` exercises the
  gate semantics (post-R-042).

### Pipeline verification

- A pipeline dry-run from Architecture to Release verifies
  that the canonical `featureRequest` reaches PO.
- A recovery dry-run verifies the gate-truth strategy after
  restart.

### Manual verification

- `grep -rn 'featureRequest' backend/src` returns a single
  canonical writer per location.
- `grep -rn 'cli_session_id\|cli_total_cost_usd' backend/src`
  returns no result.
- `gateBridge.requestGate` and `resolveGate` paths are
  updated per the ADR.
- `HitlDecision.action` writes use the enum (if R-017 chose
  enum).
- `agentOutput` shape matches the chosen canonical shape.

### Expected runtime logs

- No new warnings about duplicate writes.
- The dual-write window (if R-021 / R-042 chose one) logs a
  warning per duplicate write so Phase 4 can confirm both
  writers fire.

### Expected UI behaviour

- FE consumers continue to read `featureRequest` from the
  canonical location (no visible change unless the chosen
  shape differs from the current).
- FE reducers must accept the chosen `agentOutput` shape
  (after R-026 contract change).

### Regression risks

- R-021: Medium (readers exist; wrong owner breaks
  auto-advance).
- R-008: Low (no reader).
- R-042: High (the dual-truth design is intentional for
  in-flight SDK waits).
- R-043: Medium (multi-key merge fragility).
- R-017: Medium (enum migration).
- R-026: Medium (FE reducer coupling).
- R-006 / R-013 / R-024 (governance; implementation is
  Batch G).

### Rollback strategy

- R-021: Re-add the legacy writer (dual-write period). The
  one-time migration story documents this.
- R-008: Re-add the runner output key (one file).
- R-042: Switch back to dual truth. If option A was chosen,
  restore the in-memory map reload.
- R-043: Restore the multi-writer merge.
- R-017: Re-run schema migration to revert enum (forward-only).
- R-026: Revert the contract.

---

## Batch C — Pipeline

### Compile checks

- `npx prisma generate` (no schema change in Batch C unless
  the ADR for R-040 chose to drop the legacy endpoint, which
  removes a test file but not a column).
- `npx tsc --noEmit` succeeds.

### Unit tests

- All pre-existing tests pass.

### Integration tests

- `backend/tests/integration/sdlc.handoff.test.js` either
  removed (R-040 option 1) or pivoted (option 2/3).
- `backend/tests/integration/task-lifecycle.test.js`
  exercises `Task.executionStatus` transitions.
- `backend/tests/integration/gateBridge.terminal-state.test.js`
  exercises the `interrupted` state.

### Pipeline verification

- A manual pipeline run from Architecture through Release on a
  fresh DB.
- A release-approve dry-run writes the `pipeline_completed`
  `AgentEvent` row (post-R-001).
- A backend restart with an in-flight `awaiting_gate` task
  recovers without throwing (post-R-030).
- A session whose tasks all fail transitions to `'failed'`
  (post-R-045).

### Manual verification

- `sdlc.handoff.test.js` either removed or pivoted.
- `pipeline_completed` `AgentEvent` rows persist on a manual
  release-approve dry-run.
- `Task.status` writes go through `setTaskStatus`.
- `deriveCurrentPhase` returns the correct phase for the
  ARCH-only-no-PO-approved edge (R-027).

### Expected runtime logs

- No `Invalid task transition: awaiting_gate -> running`
  errors after R-030.
- The `pipeline_completed` envelope is persisted (visible via
  `getAuditTrail`).
- The `releaseGate.canDecide` value is `false` for non-owners
  (post-Batch G).

### Expected UI behaviour

- The session dashboard reflects the persisted terminal
  event.
- The session detail view shows `'failed'` for sessions whose
  tasks all fail.

### Regression risks

- R-040 (legacy gate): High.
- R-041 (release-flow persistence): Low for the persistence
  step; Medium for the `PendingGate` decision.
- R-029 (Task.status bypass): High.
- R-030 (recovery transition): Low if matrix entry; Medium if
  guard.
- R-045 (PipelineSession.status): Medium.
- R-009 (legacy Task.create): Low.
- R-020 (worker lock): Documented; no code change in Batch C.
- R-027 (phase derivation): Low.
- R-031 (resolveGate race): Low.
- R-032 (gate scope): Low.
- R-033 (commit/push errors): Medium.
- R-037 (archAskEnforcer): Low (dormant).

### Rollback strategy

- R-040: Re-mount the legacy route at `routes/sdlc.js:35`; the
  legacy controller implementation is preserved in git history.
- R-041: Re-create the `PendingGate` row on release approve
  (idempotent).
- R-001 / R-018: Drop the new `AgentEvent.create` call.
- R-029: Restore the 8 direct writers; re-verified by
  integration test.
- R-030: Revert the matrix entry or guard.
- R-045: Drop the new pipeline-status writer.
- R-009: Restore the legacy `Task.create` branch.
- R-027: Revert the function.
- R-031: Revert the guard.
- R-032: Revert the FE listing.
- R-033: Restore the silent-swallow behaviour.

---

## Batch D — Event Bus

### Compile checks

- `npx prisma generate` succeeds (no schema change in Batch D).
- `npx tsc --noEmit` succeeds after R-002 FE mirror.

### Unit tests

- All pre-existing tests pass.

### Integration tests

- `backend/tests/integration/eventBus.test.js` exercises the
  event bus.
- `backend/tests/integration/gateBridge.subscribeProject.test.js`
  exercises the subscription path.

### Pipeline verification

- A release-approve dry-run writes a `pipeline_completed`
  `AgentEvent` row.
- A reconnect on a fresh SSE writer does not allocate a
  sequence if no events were missed (post-R-028).
- Replay of pre-fix `AgentEvent` rows renders the same wire
  shape (modulo R-002 trim).

### Manual verification

- `grep -rn 'pipeline_completed' backend/src` returns one
  producer (`releaseManager.submitReleaseDecision`).
- `grep -rn 'pipeline_failed\|task_resumed\|agent_event'
  backend/src` returns no producer (after R-002 trim).
- The discriminator union is the canonical set (post-R-002).
- A sequence allocation that rolls back does not consume a
  sequence (post-R-012).

### Expected runtime logs

- The `pipeline_completed` envelope appears in the SSE stream
  AND in `getAuditTrail` (post-R-001).
- `session_resumed` allocations are coalesced on no-op
  reconnects (post-R-028).

### Expected UI behaviour

- The dashboard's audit trail table shows the terminal event
  (post-R-001).
- The session detail view reflects the real `commitSha`
  (post-R-018).

### Regression risks

- R-001: Low (additive).
- R-002: Low (trim is a no-op for current code paths).
- R-003: Medium (synthesising envelopes for legacy rows
  changes the SSE wire).
- R-004: Low (documentation only).
- R-012: Medium (sequence allocation coupling).
- R-018: Low (real SHA in envelope is additive).
- R-028: Medium (coalescing can hide reconnect gaps for stale
  FE clients — see C-2).
- R-038: Low (bounded map is additive).

### Rollback strategy

- R-001 / R-018: Drop the new `AgentEvent.create` call.
- R-002: Restore the three EventTypes in the discriminated
  union.
- R-003: Restore silent-drop behaviour; document the gap.
- R-004: Revert the doc.
- R-012: Revert the move of `sequenceService.next`.
- R-028: Restore unconditional `publishEvent` on every
  reconnect.
- R-038: Restore unbounded Maps.

---

## Batch E — Frontend

### Compile checks

- `npx tsc --noEmit` succeeds.

### Unit tests

- Pre-existing `frontend/tests/*` pass.

### Integration tests

- `backend/tests/integration/interventions.test.js` exercises
  the FE-facing interventions listing (post-R-032).

### Pipeline verification

- Manual: open the dashboard, verify the project-creation UI
  is wired (R-011), the session-start subscription works
  (R-010), the dedup state is component-scoped (R-023), the
  pending questions listing is session-scoped (R-032).

### Manual verification

- `npx tsc --noEmit` succeeds.
- `frontend/src/store/useUiStore.ts` no longer contains the
  removed action methods.
- The FE DTO matches the BE DTO (post-R-002 mirror).

### Expected runtime logs

- No FE console errors related to missing actions or types.

### Expected UI behaviour

- The session-start subscription emits a fresh envelope on
  first connect (post-R-010).
- The project-creation UI exposes project creation / rename
  (post-R-011).
- The pending questions listing respects session scope
  (post-R-032).
- The store no longer retains stale dedup entries
  (post-R-023).

### Regression risks

- R-010: Low (UX wiring).
- R-011: Low (UI surface).
- R-023: Low–Medium (stale dedup entries).
- R-032: Low (FE listing aligns with the existing lock check).
- R-046: Low per method; aggregate Medium if FE compile fails.

### Rollback strategy

- R-010: Revert the doc / envelope.
- R-011: Revert the UI.
- R-023: Revert the move.
- R-032: Revert the FE listing.
- R-046: Re-add the deleted store actions.

---

## Batch F — State / Persistence

### Compile checks

- `npx prisma generate` succeeds after the schema diff.
- `npx tsc --noEmit` succeeds (no FE change in Batch F).

### Unit tests

- All pre-existing tests pass.

### Integration tests

- `backend/tests/integration/task-lifecycle.test.js` exercises
  the transition matrix (post-R-030).
- `backend/tests/integration/database.config.test.js` exercises
  the schema (post-R-044).

### Pipeline verification

- A pipeline dry-run from Architecture to Release verifies
  that `Task.versionStatus` is `'draft'` at create and
  `'committed'` at approve (post-R-044).
- A backend restart with an in-flight `awaiting_gate` task
  recovers (post-R-030).
- A session whose tasks all fail transitions to `'failed'`
  (post-R-045).

### Manual verification

- `prisma migrate dev` (or the equivalent dry-run) succeeds.
- A copy of `backend/prisma/dev.db` is migrated cleanly.
- The matrix edit is documented in the freeze.

### Expected runtime logs

- The `versionStatus` default is `'draft'` for fresh rows.
- The matrix transition `awaiting_gate → running` succeeds
  (no log).

### Expected UI behaviour

- No visible change (matrix edit is internal).

### Regression risks

- R-030: Low if matrix entry; Medium if guard.
- R-044: Medium (schema default change can flip freshly-created
  rows).
- R-045: Medium (new state value).

### Rollback strategy

- R-030: Revert the matrix entry or guard.
- R-044: Re-run schema migration to revert default.
- R-045: Drop the new pipeline-status writer.

---

## Batch G — RBAC / Auth

### Compile checks

- `npx tsc --noEmit` succeeds (no FE change in Batch G).

### Unit tests

- All pre-existing tests pass.
- New multi-user tests are added as part of Batch G's
  implementation (separate PR; not in this consolidation
  phase).

### Integration tests

- `backend/tests/integration/auth.middleware.test.js` exercises
  the new auth path.

### Pipeline verification

- A multi-user dry-run verifies that the RBAC narrows
  correctly.
- A release-approve dry-run by a non-owner user returns 403.

### Manual verification

- A non-owner user cannot decide a release.
- The audit trail records the real `reviewerId`.

### Expected runtime logs

- The bypass is no longer triggered (no `req.user.id ===
  'local-user-id'` log lines).

### Expected UI behaviour

- The release dialog shows `canDecide: false` for non-owner
  users.
- The audit trail UI shows the real reviewer id.

### Regression risks

- R-006: Critical (removing the bypass without a real RBAC
  layer is unsafe).
- R-024: Critical.
- R-013: High.

### Rollback strategy

- R-006: Restore the bypass middleware (revert the file).
- R-024: Restore the unconditional `true` path.
- R-013: Restore the always-`'local-user-id'` write.

---

## Cross-batch risk summary (carried forward from Phase 3 §04)

| Risk dimension | Batches | Severity |
| ------------- | ------- | -------- |
| Auth / RBAC removal | G | Critical |
| Pipeline state machine | C, F | High |
| `PendingGate` dual truth | B, C, D | High |
| Schema migration | F, C | Medium |
| Wire shape changes | D, E | Low |
| Dead code removal | A | Low |

The aggregate risk profile is dominated by Batches C and G.

---

## NOT VERIFIED

- Whether the rollback plans above are functionally correct in
  every case (rollback paths are exercises for Phase 4 to
  validate with dry-runs; this document records the intent).
- Whether the production data migration under R-044 has a
  backfill story (NV-9).
- Whether any pre-existing tests rely on the legacy
  `submitGateDecision` behaviour at the wire level (NV-7).
- Whether Batch G's rollout can be staged through a canary
  process in the current deployment target (NV-10).
