# 09 — Phase 3 Plan (Phase 2 Output)

> **Status:** PLAN ONLY. NO IMPLEMENTATION. NO CODE CHANGES.
> Group every drift into repair buckets. Define repair order.
> Do not write code.

This document is the handoff from Phase 2 (drift analysis) to Phase 3
(repair). It is the response to the prompt's request: "Prepare ONLY
the repair strategy. NO implementation. Group every drift into
buckets. Define repair order."

All drift items are listed in `08_DRIFT_MATRIX.md` with full
evidence. This document groups them by required repair style.

---

## Bucket A — Safe (no live behavior change)

These items are dead code, orphan types, or unused store actions.
Removal or quarantine does not affect runtime behaviour. Phase 3 may
choose to leave them in place if the diff cost is non-trivial; the
recommendation is to delete.

| ID       | Title                                                                 | Why safe                                                                                            |
| -------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| DR-020   | `authService.js` dead                                                 | Zero importers. No runtime impact.                                                                  |
| DR-021   | `agentParser.js` dead                                                 | Zero importers.                                                                                     |
| DR-022   | `validation.js` dead                                                 | Zero importers.                                                                                     |
| DR-023   | `arch_runtime.js` + 5 dead scripts                                    | Not in `package.json` `scripts` (except `demoSmokeClaudeCode.js`).                                   |
| DR-027   | `useUiStore` unused actions                                          | Field-readers exist; only the action creators are dead. FE compiles.                              |
| DR-028   | `useWorkflowStore.cleanupSession`, `resetAll` unused                  | State is lost on page reload anyway.                                                                |

**Repair order**: trivial. Single PR per item, or one bulk PR.

**Phase 5 (cleanup) candidate.**

---

## Bucket B — Needs Contract Review

These items require a contract decision before any code change.
Each one needs an architectural ADR or freeze document amendment
that names the canonical shape, then code that conforms.

| ID       | Title                                                                 | Why contract review                                                                                |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| DR-005   | `agentOutput` payload shape not stable                                | Two runners produce two shapes. Decide on canonical `agentOutput` schema; document it in freeze.    |
| DR-006   | `HitlDecision.action` / `decision` string typos                       | Decide on enum or free string. If enum, update schema. Update all consumers and producers.        |
| DR-007   | `pipeline_completed` envelope not persisted                          | Decide: persist via `AgentEvent.create` after `publishEvent`. Aligns with every other event type.  |
| DR-008   | `featureRequest` dual storage                                         | Decide: `Task.observability.featureRequest` only, OR `AgentArtifact` only, OR pick one as canonical and rewrite the other. |
| DR-009   | `cli_session_id` / `cli_total_cost_usd` orphan writes                | Decide: stop writing, OR add a reader, OR expose as a typed observability field.                   |
| DR-016   | `pipeline_completed` persistence asymmetry                           | Same as DR-007. Fix as part of the same change.                                                    |
| DR-017   | Three EventTypes have no producer                                     | Decide: remove from union, OR add producers. Either way, the discriminator shrinks.               |
| DR-018   | `session_resumed` allocates sequence per reconnect                    | Decide: deduplicate reconnect snapshots by sequence, OR coalesce on `Last-Event-ID`.               |
| DR-019   | SSE replay drops legacy / non-canonical rows                         | Decide: synthesise envelopes for legacy rows, OR document the gap.                                  |
| DR-029   | `qaResult.commitSha` placeholder literal                              | Decide: store the actual release commit SHA in the envelope, OR drop the field.                  |

**Repair order (within Bucket B)**:

1. **DR-007 + DR-016 first** (same fix; user-visible terminal-event
   loss).
2. **DR-019** (continuity of replay; the existing replay path is
   fragile).
3. **DR-017** (cheap; reduce the discriminator union).
4. **DR-006** (cheap; reduce stringly-typed contracts).
5. **DR-005, DR-008, DR-009, DR-018, DR-029** (each requires its own
   ADR; cluster by FE-affecting / DB-affecting).

**Phase 3 candidate.**

---

## Bucket C — Needs Architecture Decision

These items require an ownership consensus — which module is the
single owner of an object that currently has multiple owners. The
decision is governance, not code.

| ID       | Title                                                                 | Why architecture decision                                                                          |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| DR-001   | Release-flow chain ownership contradiction                            | Pick canonical gate (output_review). Decide what to do with legacy `submitGateDecision` (delete or keep as deprecated shim). |
| DR-002   | Release-flow single-emitter / asymmetric persistence                  | Confirm `releaseManager` is the SOLE owner of `pipeline_completed`. Decision is documented; only the persistence side needs the fix (already DR-007). |
| DR-003   | PendingGate dual write on release path                               | Decide: drop the `PendingGate` row for `kind='release'`, OR keep it.                                |
| DR-010   | PendingGate dual truth (in-memory map + DB row)                       | Decide: make the DB the only truth, OR make the in-memory map the only truth and persist on the next read. Today's design is dual on purpose. |
| DR-011   | `Task.observability` multi-owner                                     | Decide: schema for `observability`; pick one writer per key.                                        |
| DR-024   | Legacy `submitGateDecision` path active                              | Same as DR-001.                                                                                    |

**Repair order (within Bucket C)**:

1. **DR-001 + DR-024 first** (the legacy path needs an ADR before
   the canonical path can be considered alone).
2. **DR-002 + DR-003** (release-flow ownership; small surface).
3. **DR-010 + DR-011** (multi-owner objects; larger surface; require
   careful migration).

**Phase 4 candidate.**

---

## Bucket D — High Regression Risk

These items affect state machines, authorization, or session-level
lifecycle. Any change requires a rollback plan and may need
dual-write for one release.

| ID       | Title                                                                 | Why high regression risk                                                                              |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| DR-004   | HTTP `MembershipService` bypass                                       | The auth bypass (`authMiddleware`) is the entire RBAC story today. Any change requires real auth.     |
| DR-012   | `Task.status` bypass of state machine                                 | 8 callers; replacing with `taskLifecycle.transition` may surface state-machine rejections.             |
| DR-013   | `versionStatus` ↔ `executionStatus` desync                            | Changing `versionStatus` semantics affects the predecessor-check invariant used by every downstream agent. |
| DR-014   | `recoverInterruptedGates` illegal transition                          | The fix changes `executionStatus` from `awaiting_gate` to `running` on restart. Requires the matrix to admit the edge. |
| DR-015   | `PipelineSession.status='running'` stuck                             | Adding `running → failed` may break FE consumers that assume `'running'` is the only post-creation value. |
| DR-025   | `releaseGate.canDecide` always `true`                                 | Coupled with DR-004 (the bypass makes the branch dead).                                                  |
| DR-026   | `HitlDecision.reviewerId` always `'local-user-id'`                    | Coupled with DR-004.                                                                                  |

**Repair order (within Bucket D)**:

1. **DR-014 first** (smallest surface; one boot-path bug; high user-
   visible impact; small regression risk if the matrix edit is
   gated behind a transition guard).
2. **DR-013** (only the schema default needs to change;
   `versionStatus: 'draft'` should be the default for new tasks;
   add a CHECK constraint if SQLite supports it).
3. **DR-012** (replace direct `Task.update({ status: … })` writers
   one at a time; verify the state machine accepts each transition).
4. **DR-015** (define `running → failed` and
   `running → cancelled` transitions on `PipelineSession`; update
   `countActive` to filter by `'running' | 'awaiting_release'`).
5. **DR-004 + DR-025 + DR-026** (the RBAC trio; requires removing the
   bypass; couples to the auth team's roadmap).

**Phase 3 first; Phase 5 (cleanup) for the RBAC triple after auth
strategy is decided.**

---

## Cross-bucket dependency graph

```
Bucket B (contracts) ──► Bucket C (architecture) ──► Bucket D (state / RBAC)
        │                       │                              │
        ▼                       ▼                              ▼
   ADR required           Ownership decision            Rollback plan
```

- Bucket B fixes may surface new drift that Bucket C addresses
  (e.g. DR-007 + DR-016 fix may reveal new asymmetry once persisted).
- Bucket C fixes may invalidate some Bucket B fixes (e.g. deciding
  `releaseManager` is the SOLE owner of `pipeline_completed` collapses
  DR-002 and DR-007 into one).
- Bucket D fixes (especially DR-012, DR-014) are gated on Bucket B
  because the new contract shapes may affect state-machine
  transitions.

---

## Recommended Phase 3 repair order

Following the dependency graph and the within-bucket orders above:

1. **DR-014** (Bucket D; one bug; boot path).
2. **DR-007 + DR-016** (Bucket B; persist `pipeline_completed`).
3. **DR-019** (Bucket B; SSE replay continuity).
4. **DR-006** (Bucket B; tighten enum).
5. **DR-013** (Bucket D; `versionStatus` default).
6. **DR-017** (Bucket B; trim discriminator union).
7. **DR-012** (Bucket D; one writer at a time).
8. **DR-015** (Bucket D; PipelineSession lifecycle).
9. **DR-001 + DR-024** (Bucket C; legacy `submitGateDecision` ADR).
10. **DR-002 + DR-003** (Bucket C; release-path ownership).
11. **DR-010 + DR-011** (Bucket C; multi-owner objects).
12. **DR-005, DR-008, DR-009, DR-018, DR-029** (Bucket B; FE/DB-
    affecting contracts; cluster by surface).
13. **DR-004 + DR-025 + DR-026** (Bucket D; RBAC triple — gated on
    auth strategy).
14. **Bucket A items** (cleanup; can run anytime after step 6).

---

## Required inputs from outside Phase 3

- **Auth roadmap**: who owns the post-bypass RBAC layer? Without
  this, DR-004 / DR-025 / DR-026 cannot be planned beyond "remove
  the bypass and observe behaviour."
- **Freeze document maintenance**: every Bucket B fix should
  update `docs/engineering-freeze/06_EVENT_INVENTORY.md` (or
  equivalent) with the new contract. Without this, drift recurs.
- **Test coverage**: Phase 0 / Phase 1 did not require new tests.
  Phase 3 fixes that touch `taskLifecycle` / `gateBridge` / event
  publication should add regression tests.

---

## Out of scope for Phase 3

The following are explicitly forbidden in Phase 3 (matching the
Phase-0/Phase-1/Phase-2 constraints):

- Renaming anything.
- Refactoring unrelated code.
- Optimising anything.
- Adding new features.
- Changing API contracts that are not drift-driven.
- Updating dependencies.
- Changing database schema (except `versionStatus` default + maybe
  `agentOutput` schema, both of which require ADR).
- Removing items from Bucket A without a separate PR / approval.

---

## Success criteria for Phase 3 (per the prompt)

> Phase 3 can begin immediately.

Yes — the buckets above are ordered. Phase 3 has the inputs it
needs. The plan defines repair order; the matrix defines evidence;
the freeze + audit documents define the baseline.

The repair plan does NOT include code. It defines what to change
and in what order. Implementation is Phase 3's responsibility.