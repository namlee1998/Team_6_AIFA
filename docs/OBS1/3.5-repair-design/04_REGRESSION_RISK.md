# 04 — Regression Risk

> **Status:** DESIGN ONLY. No implementation.
> Per-drift regression risk (defined in `02_REPAIR_BATCHES.md`) plus a
> per-batch aggregation. Risk rating reflects the magnitude of
> damage if the fix regresses normal operation, NOT the probability.

---

## 1. Risk scale

| Rating    | Meaning                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Critical | Reasonable fix-regression scenario can take the SDLC pipeline offline.                                    |
| High     | Reasonable fix-regression scenario causes user-visible behaviour loss; rollback is mandatory.           |
| Medium   | Reasonable fix-regression scenario exposes a soft spot that future drift will resume; rollback is optional. |
| Low      | Reasonable fix-regression scenario is cosmetic; rollback is unnecessary.                                  |

Probability is a separate axis; this document tracks magnitude. Phase
3 should also estimate probability for each row before implementation.

---

## 2. Per-batch regression risk

### Batch A — Cleanup

| Drift  | Rating | Magnitude                                                                                                                                                                                                                            |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-020 | Low    | Deleting `authService.js` cannot affect runtime because nothing reads it. The only risk is that a future batch (Batch G) wanted this file as the seed — handled by reading from git history.                                          |
| DR-021 | Low    | Same as DR-020.                                                                                                                                                                                                                       |
| DR-022 | Low    | Same as DR-020.                                                                                                                                                                                                                       |
| DR-023 | Low    | Deletion is safe if no importer exists. Medium if a doc references them — Phase 3 must scrub.                                                                                                                                        |
| DR-027 | Low    | Per-method removal is dead-code elimination. Aggregate: `tsc --noEmit` may surface a missed import; Phase 3 should run that command.                                                                                                  |
| DR-028 | Low    | Same as DR-027.                                                                                                                                                                                                                       |

**Aggregate Batch A risk**: Low. Roll-forward is safe; roll-back is
by file restore.

---

### Batch B — Ownership

| Drift  | Rating | Magnitude                                                                                                                                                                                                                            |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-008 | Medium | Two production readers exist (`runPOAgent:358` and `compactContext:93-101`). A wrong-owner choice can break the auto-advance from ARCH to PO, freezing the pipeline. Migration window is necessary.                                |
| DR-009 | Low    | No consumer. Stopping the writes cannot regress anything live.                                                                                                                                                                       |
| DR-010 | High    | The dual-truth design is intentional for in-flight SDK waits. Any switch to DB-only or in-memory-only must handle the race window where the SDK is mid-pause and the backend restarts. Rollback is mandatory if recovery fails. |
| DR-011 | Medium | Same multi-key merge fragility. A wrong owner mapping can drop keys.                                                                                                                                                                |
| DR-026 | (Pending Batch G)                                                                                                                                                                                                                  |

**Aggregate Batch B risk**: Medium-High (DR-010 dominates). Requires
regression tests for both the live path and the recovery path.

---

### Batch C — Pipeline

| Drift   | Rating | Magnitude                                                                                                                                                                                                                            |
| ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-001  | High   | Removing the legacy `submitGateDecision` removes a tested path (`sdlc.handoff.test.js`). If the deprecation window is too short, the FE may issue legacy calls and see HTTP 410 mid-session.                                |
| DR-002  | Low    | Persisting the `pipeline_completed` envelope is additive. The SSE writer already publishes it. The new `AgentEvent` row is read on replay; no current producer skips it.                                                       |
| DR-003  | Medium | Dropping the `PendingGate` row for `kind='release'` removes a durable record. If the `HitlDecision` row ever fails to persist, the release event has no second-source.                                                              |
| DR-012  | High   | 8 direct writers touched. Each replacement must preserve the existing semantic — `setTaskStatus` helper must understand the canonical matrix. If any conversion is wrong, the state machine rejects the update, freezing the agent.  |
| DR-013  | Medium | Schema default change can flip a freshly-created row to `'committed'`. The `_requireApprovedTask:1602-1604` invariant depends on this. A failed migration can drop `'committed'` to `'draft'` for tasks that should be approved.   |
| DR-014  | Low    | One matrix entry or one guard. The risk is in the choice, not in the implementation. The freeze document must record the choice.                                                                                                  |
| DR-015  | Medium | New state-machine state for sessions. Consumers that assume only `'running' / 'awaiting_release' / 'completed'` may break. Most are FE read-only; the wire check at `_getRepoContext:1495` is safe.                              |
| DR-024  | (coupled with DR-001)                                                                                                                                                                                                              |

**Aggregate Batch C risk**: High. The matrix / status / versionStatus
changes touch the spine of the SDLC. Rollback plan mandatory.

---

### Batch D — Event Bus

| Drift   | Rating | Magnitude                                                                                                                                                                                                                            |
| ------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-007  | Low    | Additive. SSE replay continuity improves; no current producer is harmed.                                                                                                                                                            |
| DR-016  | Low    | Same as DR-007.                                                                                                                                                                                                                      |
| DR-017  | Low    | Trim is a no-op for current code paths. The TS union shrinks; the FE may surface the change only at compile time. The aggregate discriminator is smaller.                                                                       |
| DR-018  | Medium | Coalescing by cursor can hide reconnect gaps. If the FE is missing frames, omitting a snapshot does not help.                                                                                                                      |
| DR-019  | Medium | Replay continuity. Synthesising envelopes for legacy rows changes the SSE wire for those rows; the FE reducer drops them silently (no mapper). Net effect: the same. The freeze doc must record the choice.                            |
| DR-029  | Low    | Real SHA in the envelope is additive. No consumer branches on it today.                                                                                                                                                            |

**Aggregate Batch D risk**: Low-Medium. The persistence and trim
items are safe; the replay synthesis is the most subtle.

---

### Batch E — Frontend

| Drift     | Rating | Magnitude                                                                                                                                                                                                                  |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-027    | Low    | Action removal. `tsc --noEmit` catches any missed import.                                                                                                                                                                  |
| DR-028    | Low    | Same as DR-027.                                                                                                                                                                                                            |
| DR-018-FE | (no fix; documentary)                                                                                                                                                                                                     |
| FE DTO    | Low    | Discriminator shrink mirrors D step 2. The FE compile is type-checked; missing members are detected.                                                                                                                       |

**Aggregate Batch E risk**: Low. FE compilation is the verification.

---

### Batch F — State / Persistence

| Drift  | Rating | Magnitude                                                                                                                                                                                                                  |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-013 | Medium | Schema default change. The migration must backfill existing rows that have `versionStatus='committed'`; any error can break the predecessor invariant.                                                                  |
| DR-014 | Low    | Matrix edit. Documented risk; the choice lives in the freeze.                                                                                                                                                              |

**Aggregate Batch F risk**: Medium (DR-013 schema migration).

---

### Batch G — RBAC / Auth

| Drift   | Rating | Magnitude                                                                                                                                                                                                                  |
| ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-004  | Critical | Removing the auth bypass without a real RBAC layer is unsafe. Replacing with a real layer is a one-shot operation. Regression can break authentication for every route.                                                  |
| DR-025  | Critical | Coupled with DR-004. `releaseGate.canDecide` becomes meaningful; wrong role → wrong user is denied a release decision.                                                                                              |
| DR-026  | High    | Coupled with DR-004. Audit-trail `reviewerId` becomes meaningful; wrong writes can impersonate.                                                                                                                              |

**Aggregate Batch G risk**: Critical. This batch is gated on the auth
team's strategy. The Phase-3 PR must be canary-deployable.

---

## 3. Cross-batch risk

| Risk dimension             | Batches     | Severity |
| ------------------------- | ----------- | -------- |
| Auth / RBAC removal        | G           | Critical |
| Pipeline state machine    | C, F        | High     |
| `PendingGate` dual truth  | B, C, D     | High     |
| Schema migration          | F, C        | Medium   |
| Wire shape changes         | D, E        | Low      |
| Dead code removal          | A           | Low      |

The aggregate risk profile is dominated by Batches C and G.

---

## 4. Per-drift roll-back plans

| Drift   | Roll-back plan                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-001  | Re-mount the legacy route at `routes/sdlc.js:35`; the legacy controller implementation is preserved in git history.                                  |
| DR-002  | Drop the new `AgentEvent.create` call. The envelope is still published; only the persistence is reverted.                                       |
| DR-003  | Re-create the `PendingGate` row on release approve. Idempotent if the row already exists.                                                       |
| DR-007  | Drop the new `AgentEvent.create` call. (Same as DR-002; they are the same fix.)                                                                  |
| DR-008  | Re-add the legacy writer. Requires the dual-write period.                                                                                       |
| DR-009  | Re-add the runner output key. One file change.                                                                                                  |
| DR-010  | Switch back to dual truth. If option A was chosen, restore the in-memory map reload.                                                            |
| DR-011  | Restore the multi-writer merge. Document the freeze amendment.                                                                                   |
| DR-012  | Restore the 8 direct writers. Re-verified by integration test.                                                                                  |
| DR-013  | Re-run schema migration to revert default. Re-validate backfill.                                                                                |
| DR-014  | Revert the matrix entry or guard.                                                                                                               |
| DR-015  | Drop the new pipeline-status writer.                                                                                                            |
| DR-016  | (same as DR-007)                                                                                                                                |
| DR-017  | Restore the three EventTypes in the discriminated union.                                                                                          |
| DR-018  | Restore unconditional `publishEvent` on every reconnect.                                                                                        |
| DR-019  | Restore silent-drop behaviour; document the gap.                                                                                                |
| DR-020  | Restore `authService.js` from git history.                                                                                                       |
| DR-021  | Restore `agentParser.js` from git history.                                                                                                       |
| DR-022  | Restore `validation.js` from git history.                                                                                                        |
| DR-023  | Restore `arch_runtime.js` and the 5 scripts from git history.                                                                                    |
| DR-024  | (coupled with DR-001)                                                                                                                            |
| DR-025  | Restore `canDecide` to the unconditional `true` path.                                                                                             |
| DR-026  | Restore the always-`'local-user-id'` write.                                                                                                      |
| DR-027  | Restore the deleted store actions.                                                                                                               |
| DR-028  | Restore the deleted store actions.                                                                                                               |
| DR-029  | Restore the `'see session.repoInfo'` literal.                                                                                                    |

---

## 5. NOT VERIFIED

- Whether the rollback plans above are functionally correct in
  every case (rollback paths are exercises for Phase 3 to validate
  with dry-runs; the design documents the intent only).
- Whether the production data migration under DR-013 has a real
  backfill story for the existing rows that already pass the
  invariant (NOT VERIFIED — requires running the migration
  script on a copy of `backend/prisma/dev.db`).
- Whether any pre-existing tests rely on the legacy
  `submitGateDecision` behaviour at the wire level (Phase 3 to
  grep).
- Whether Batch G's rollout can be staged through a canary
  process in the current deployment target (NOT VERIFIED —
  requires the auth team's deployment plan).