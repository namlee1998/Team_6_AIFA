# 05 — Implementation Order

> **Status:** DESIGN ONLY. No implementation.
> Per-drift implementation order with rationale, sequencing, and
> freeze-document / ADR gating. Each row corresponds to a single
> drift in `docs/architecture-drift/08_DRIFT_MATRIX.md`. Phase 3
> actions land in this order.

For every drift item:

- **Step**: position in the global order.
- **Batch**: from `01_REPAIR_STRATEGY.md §5`.
- **Drift**: DR-xxx.
- **Title**: short.
- **Severity**: from `08_DRIFT_MATRIX.md`.
- **Predecessor ADRs / decisions**: ADR gating from `03_DEPENDENCY_GRAPH.md §6`.
- **Prerequisite drift items**: what must be fixed first.
- **Implementation order rationale**: why this step is here.
- **Rollout posture**: per-batch default; the row may override.
- **Verification**: how Phase 3 confirms the fix without writing
  tests here (per the Phase-3 prompt).

---

## Phase 0 — Capture governance decisions

Before any code change, the architecture owner must record
decisions for the ADRs in `03_DEPENDENCY_GRAPH.md §6`. No code
lands before ADR approval.

- **Step 0.1** — ADR: canonical storage of `featureRequest` (DR-008).
- **Step 0.2** — ADR: canonical truth for `gate`
  (in-memory vs DB row vs merged) (DR-010).
- **Step 0.3** — ADR: canonical schema for `Task.observability`
  JSON (DR-011).
- **Step 0.4** — ADR: resolution of legacy
  `submitGateDecision` (delete / deprecate-shim / keep); canonical
  gate for output_review (DR-001 / DR-024).
- **Step 0.5** — ADR: release-flow ownership; `PendingGate` row
  for `kind='release'` (DR-002 / DR-003).
- **Step 0.6** — ADR: `versionStatus` default (DR-013).
- **Step 0.7** — ADR: `'awaiting_gate → 'running'` matrix
  entry vs guard (DR-014).
- **Step 0.8** — ADR: replace inline `MembershipService` stub
  with real RBAC service; auth roadmap dependency
  (DR-004 / DR-025 / DR-026; gates Batch G).

External dependencies:

- **Step 0.X** — Auth roadmap (external). Phase 3 must record the
  auth team's commitment before Batch G can be scheduled.

---

## Phase A — Batch A (Cleanup; parallel-safe)

All Batch A steps are independent of any other batch and may
be done in any order. They are also safe to defer.

| Step | Drift  | Title                                       | Severity | Implementation order rationale                                                                                   |
| ---- | ------ | ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| 1    | DR-020 | delete `authService.js`                    | Low      | Smallest deletion; confirms the import-graph claim.                                                                  |
| 2    | DR-021 | delete `agentParser.js`                     | Low      | Same.                                                                                                              |
| 3    | DR-022 | delete `validation.js`                      | Low      | Same.                                                                                                              |
| 4    | DR-023 | delete `arch_runtime.js` + 5 smoke scripts  | Low      | Requires doc-scrub pairing; bulk deletion; last in Batch A so the diff is internally grouped.                       |
| 5    | DR-027 | `useUiStore` unused actions                | Low      | `tsc --noEmit` after removal.                                                                                       |
| 6    | DR-028 | `useWorkflowStore` unused actions           | Low      | Same.                                                                                                              |

**Verification**: `backend/arch_runtime.js` and `backend/scripts/*.js`
files are gone. `tsc --noEmit` succeeds against the FE. The
`grep` command for the removed paths returns nothing.

**Rollout posture**: any. Recommend a single PR with all six steps.

---

## Phase F — Batch F (governance decisions become code)

After the ADRs in Step 0 are approved, Batch F lands first as a
schema / matrix layer. This unlocks Batches B, C, and G.

| Step | Drift  | Title                                                                                                  | Severity | Prerequisite drift items | Implementation order rationale |
| ---- | ------ | ------------------------------------------------------------------------------------------------------ | -------- | -------------------------- | ------------------------------- |
| 7    | DR-013 | change `Task.versionStatus` default to `'draft'`                                                       | Medium   | (none)                      | Gate Batch B step 4 and Batch C step 3. |
| 8    | DR-014 | add `'awaiting_gate → 'running'` to `TRANSITIONS` matrix (option A) — or guard (option B/C)         | Low      | (none)                      | Gate Batch C step 4.            |

The schema migration that accompanies DR-013 must be tested on a
copy of `backend/prisma/dev.db` before it runs in production.
The migration must backfill existing rows that already have
`versionStatus='committed'` and `agentOutput` non-null (heuristic
to be decided in the ADR).

**Rollout posture**: behind a feature flag where possible. The
migration is rolled forward once; rollback is a forward-only
migration unless explicitly designed otherwise.

---

## Phase B — Batch B (Ownership)

| Step | Drift  | Title                                                              | Severity | Prerequisite ADRs | Prerequisite drift items    | Implementation order rationale |
| ---- | ------ | ------------------------------------------------------------------ | -------- | ------------------ | ------------------------------ | ------------------------------- |
| 9    | DR-008 | pick canonical owner for `featureRequest` and migrate              | Medium   | Step 0.1           | Step 7 (`versionStatus` default) | Reader migration must precede writer removal. |
| 10   | DR-009 | stop writing `cli_session_id` / `cli_total_cost_usd`                | Low      | (covered by Step 0.3)| Step 7                          | Pairs with Step 9 schema shrink. |
| 11   | DR-010 | stabilise `gate` truth (per ADR)                                   | High     | Step 0.2           | Step 8 (matrix)               | Critical for release flow.       |
| 12   | DR-011 | declare `Task.observability` JSON schema                           | Medium   | Step 0.3           | Step 9, Step 10               | Schema first; writers migrate second. |

**Rollout posture**: behind a feature flag where possible. DR-010
requires dual-write for one release and is non-flaggable.

---

## Phase C — Batch C (Pipeline)

Steps 13–17 are sequential. The legacy gate fix (Step 13) and
the release-flow ownership (Step 14) can run concurrently if
their ADRs are split.

| Step  | Drift     | Title                                                                                                  | Severity | Prerequisite drift items | Implementation order rationale |
| ----- | --------- | ------------------------------------------------------------------------------------------------------ | -------- | -------------------------- | ------------------------------- |
| 13    | DR-001 / DR-024 | resolve legacy `submitGateDecision` (delete OR shim)                                            | High     | Steps 0.4, 9, 12            | Removes a tested path; must deprecate with a window. |
| 14    | DR-002 / DR-003 | release-flow single-emitter + `PendingGate` decision                                              | Low–Medium (per ADR) | Steps 0.5, 11 | Couples to Step 16 (`pipeline_completed` persistence). |
| 15    | DR-012    | introduce `setTaskStatus` helper / `Task.status` refactor                                            | High     | Step 8                       | Eight writers touched; matrix edit at Step 8 gates this. |
| 16    | DR-007 / DR-016 | persist `pipeline_completed` envelope                                                            | Low      | Step 14                      | Already designed in Step 14.    |
| 17    | DR-015    | add `PipelineSession.status` failure transition                                                     | Medium   | Step 15                      | Derive logic in `_saveAgentData` post-task-terminal. |
| 18    | DR-013 (code) | keep code-level guard against direct `version_status` writes                                 | Medium   | Step 7                       | Pairs with the schema change; keeps the invariant in code. |

Note: the `recoverInterruptedGates` matrix edit is in Step 8
(Batch F). Its code change lands in Batch C step 15 or as a
separate one-line commit if the implementation chooses the
matrix option.

**Rollout posture**: behind a canary or feature flag where possible.
Step 13 (legacy deprecation) has the largest blast radius.

---

## Phase D — Batch D (Event Bus)

| Step | Drift   | Title                                                                                                  | Severity | Prerequisite drift items | Implementation order rationale |
| ---- | ------- | ------------------------------------------------------------------------------------------------------ | -------- | -------------------------- | ------------------------------- |
| 19   | DR-007 / DR-016 | already counted as Step 16                                                                              | Low      | (executed in Batch C)        | Code-level duplicate; no extra step. |
| 20   | DR-017  | trim `EventType` union (BE + FE)                                                                       | Low      | Step 0.7                     | Discriminator shrinks; BE first, FE immediately after. |
| 21   | DR-029  | store real `commitSha` in `pipeline_completed` envelope                                                | Low      | Step 16                      | Cosmetic; pairs with persistence. |
| 22   | DR-018  | coalesce `session_resumed` snapshot by `Last-Event-ID`                                                | Medium   | (none)                      | Behaviour change for reconnecting FE; freeze amendment. |
| 23   | DR-019  | SSE replay policy (synthesise OR document legacy rows)                                                | Medium   | Step 0.7                     | Decision-gated; may need migration. |

**Rollout posture**: behind a feature flag where possible. Step 22
(coalesce) is observable on the FE; a canary helps.

---

## Phase E — Batch E (Frontend)

| Step | Drift   | Title                                                                                                  | Severity | Prerequisite drift items | Implementation order rationale |
| ---- | ------- | ------------------------------------------------------------------------------------------------------ | -------- | -------------------------- | ------------------------------- |
| 24   | DR-027  | remove `useUiStore` unused actions                                                                    | Low      | (none)                      | After `tsc --noEmit` passes.    |
| 25   | DR-028  | remove `useWorkflowStore` unused actions                                                               | Low      | (none)                      | Same.                            |
| 26   | (FE DTO) | mirror DR-017 in `frontend/src/dto/event.ts`                                                          | Low      | Step 20                      | FE DTO must follow BE DTO.      |

**Rollout posture**: any. FE compile is the verification.

---

## Phase G — Batch G (RBAC / Auth)

Gated on the auth roadmap. Begins after Steps 0.8 and 0.X (auth
commitment) are satisfied.

| Step | Drift   | Title                                                                                                  | Severity | Prerequisite drift items | Implementation order rationale |
| ---- | ------- | ------------------------------------------------------------------------------------------------------ | -------- | -------------------------- | ------------------------------- |
| 27   | DR-004  | replace inline `MembershipService` stub with real RBAC service                                          | Critical | Step 0.8                    | First; the rest depend on it.    |
| 28   | DR-025  | restore real RBAC check at `releaseGate.canDecide`                                                    | Critical | Step 27                     | Coupled with DR-004.              |
| 29   | DR-026  | write real `reviewerId` to `HitlDecision`                                                              | High     | Step 27                     | Coupled with DR-004.              |

**Rollout posture**: canary-deploy only. The auth bypass is global;
the cutover must be staged.

---

## Cross-batch summary

| Batch | Steps         | Independent of others? |
| ----- | ------------- | ----------------------- |
| A     | 1–6           | Yes (parallel-safe)     |
| F     | 7, 8          | Yes (gates B, C, G)       |
| B     | 9–12          | Independent of C, D, E   |
| C     | 13–18         | Independent of D, E      |
| D     | 19–23         | Independent of E        |
| E     | 24–26         | Independent of others    |
| G     | 27–29         | Yes (gated on auth)      |

Batch A may run any time after ADRs are approved. Batches F, B,
C, D, E, G follow the order above. Two batches run concurrently
only when the cross-batch matrix in `03_DEPENDENCY_GRAPH.md §5`
permits.

---

## Verification checklist (per phase)

After each phase, the following commands must succeed without
modifying anything in the source tree.

### Phase A

- `git ls-files | grep -E '(authService|agentParser|validation)\.js$'` → no result.
- `git ls-files backend/scripts/ | wc -l` → 2 (`demoSmokeClaudeCode.js`
  and `sseReplaySmoke.js`, if retained; else 1).
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

- `sdlc.handoff.test.js` either removed (option 1) or
  pivoted to the canonical endpoint (option 2/3).
- `pipeline_completed` `AgentEvent` rows persist on a manual
  release-approve dry-run.
- `Task.status` writes go through `setTaskStatus`.

### Phase D

- Reconnect on a fresh SSE writer does not allocate a sequence
  if no events were missed.
- Replay of pre-fix `AgentEvent` rows renders the same wire
  shape (modulo DR-017 trim).

### Phase E

- `tsc --noEmit` succeeds.
- The FE builds.

### Phase G

- Real auth path is end-to-end. A multi-user test
  (`auth.middleware.test.js` already exists but should be
  validated for the new path) covers the bypass removal.

---

## Final-rollout posture

The repository has no deployment target documented in any reviewed
source. Phase 3 must record a target before completion.

The default posture for any HIGH or CRITICAL drift fix is a
canary: push the new path behind a feature flag or branch, enable
for 5% of traffic, observe SSE / audit / production-snapshot
metrics, then enable for 100%.

---

## NOT VERIFIED

- Whether the deployment target supports canary deploys (NOT
  VERIFIED — no deployment docs in `docs/`).
- Whether the production data migration for DR-013 has an
  existing backfill story (NOT VERIFIED).
- Whether the auth team's roadmap has a real commitment (NOT
  VERIFIED — externally owned).
- Whether the legacy `submitGateDecision` route is reachable
  from any external client (NOT VERIFIED — only the FE store
  was reviewed).
- Whether `setTaskStatus` should live in `models/Task.js` (the
  model wrapper) or a new helper module (the choice is
  governance; not engineered here).