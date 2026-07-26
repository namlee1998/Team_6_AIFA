# 03 — Dependency Graph

> **Status:** DESIGN ONLY. No implementation.
> Cross-batch and intra-batch dependencies for the seven repair
> batches defined in `02_REPAIR_BATCHES.md`.
> The roll-out sequence lives in `05_IMPLEMENTATION_ORDER.md`.

---

## 1. Cross-batch dependency map

The seven batches are A (Cleanup), B (Ownership), C (Pipeline),
D (Event Bus), E (Frontend), F (State / Persistence), G (RBAC /
Auth).

Topological order:

```
                            ┌───────────────┐
                            │  Batch F     │   matrix / schema decisions
                            │  (State /    │
                            │   DB)        │
                            └───────┬───────┘
                                    │ decision unlocks
                                    ▼
   ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
   │  Batch B     │         │  Batch C     │         │  Batch D     │
   │  (Ownership) │◄────────┤  (Pipeline)  ├────────►│  (Event Bus) │
   └───────┬───────┘  coerces  └───────────────┘  depends  └───────┬───────┘
           │                                  │                       │
           │ shares ADRs                      │                       ▼
           │                                  │              ┌───────────────┐
           ▼                                  ▼              │  Batch E       │
   ┌───────────────────────────────────────────────────────┐   │  (Frontend)    │
   │   (B / C / D each release independent rollback)        │   └───────────────┘
   └───────────────────────────────────────────────────────┘             │
                                                                          ▼
                                                                ┌───────────────┐
                                                                │  Batch G       │
                                                                │  (RBAC / Auth) │
                                                                └───────────────┘
```

```
   ┌───────────────┐
   │  Batch A     │   (Cleanup, parallel-safe)
   └───────────────┘
```

- Batch A is independent.
- Batch F precedes B / C / D (it is the source of matrix / schema
  decisions those batches depend on).
- Batch B provides ADRs that Batch C consumes.
- Batch D is independent of B / C but consumes C's persistence
  semantics (the `pipeline_completed` envelope lives in
  `releaseManager`, which C owns).
- Batch E mirrors B / D's decisions.
- Batch G is gated on the auth roadmap (external).

---

## 2. Per-batch dependency table

| Batch | Depends on                                    | Blocks                       |
| ----- | --------------------------------------------- | ---------------------------- |
| A     | (none)                                        | (none — parallel-safe)        |
| B     | Batch F (drift-013 decision on `observability`) | Batch C (drift-001 chain ownership) |
| C     | Batch F (matrix), Batch B (ownership ADRs)    | Batch D step 1 (persistence)  |
| D     | Batch C step 2 (release-flow single-emitter)  | Batch E step 2 (FE discriminator) |
| E     | Batch D step 2 (union shrink)                | (none — independent)           |
| F     | (none — produces governance decisions)        | Batch B, Batch C, Batch G     |
| G     | Auth roadmap (external), Batch F (RBAC schema) | (none — independent)           |

---

## 3. Per-drift dependency map

This is the per-drift view; the matrix above is the per-batch
view. Each drift (from `08_DRIFT_MATRIX.md`) is listed with its
upstream and downstream dependencies.

### Batch A

| Drift  | Depends on         | Blocks   |
| ------ | ------------------ | -------- |
| DR-020 | (none)             | (none)   |
| DR-021 | (none)             | (none)   |
| DR-022 | (none)             | (none)   |
| DR-023 | (none)             | (none)   |
| DR-027 | (none)             | (none)   |
| DR-028 | (none)             | (none)   |

### Batch B (Ownership)

| Drift  | Upstream                                  | Downstream                             |
| ------ | ----------------------------------------- | -------------------------------------- |
| DR-008 | F (decision on `observability` schema)    | C (legacy gate-path reads featureRequest) |
| DR-009 | F (decision on `observability` schema)    | D (FE reducers consuming observability) |
| DR-010 | F (decision on `gate` truth)              | C (release-flow PendingGate decision) |
| DR-011 | F (decision on `observability` schema)    | D (FE observability consumers)          |
| DR-026 | G (real RBAC)                              | (independent of others)                  |

### Batch C (Pipeline)

| Drift   | Upstream                                  | Downstream                              |
| ------- | ----------------------------------------- | --------------------------------------- |
| DR-001  | (none — governed by ADR)                  | (independent)                            |
| DR-002  | (independent)                             | D step 1 (`pipeline_completed` envelope) |
| DR-003  | B (decision on `PendingGate` dual truth)  | (independent)                            |
| DR-012  | F (matrix decision)                       | (independent)                            |
| DR-013  | (independent decision in F)               | (independent)                            |
| DR-014  | F (matrix decision)                       | (independent)                            |
| DR-015  | F (matrix decision)                       | (independent)                            |
| DR-024  | (coupled to DR-001)                       | (independent)                            |

### Batch D (Event Bus)

| Drift   | Upstream                                   | Downstream                              |
| ------- | ------------------------------------------ | --------------------------------------- |
| DR-007  | C step 2 (release-flow single-emitter)     | (independent; live SSE)                  |
| DR-016  | C step 2                                   | (independent)                            |
| DR-017  | (independent — trim decision)              | E step 2 (FE discriminator)              |
| DR-018  | (independent)                              | (independent)                            |
| DR-019  | (independent)                              | (independent)                            |
| DR-029  | (independent)                              | (independent)                            |

### Batch E (Frontend)

| Drift   | Upstream                            | Downstream   |
| ------- | ----------------------------------- | ------------ |
| DR-027  | (independent)                       | (independent) |
| DR-028  | (independent)                       | (independent) |
| DR-018-FE | D step 2 (union shrink)           | (independent) |

### Batch F (State / Persistence)

| Drift   | Upstream   | Downstream                          |
| ------- | ---------- | ----------------------------------- |
| DR-013  | (independent) | B step 1 (observability schema); C step 3 (versionStatus writes) |
| DR-014  | (independent) | C step 4 (recovery semantics)     |

### Batch G (RBAC / Auth)

| Drift   | Upstream                              | Downstream   |
| ------- | ------------------------------------- | ------------ |
| DR-004  | Auth roadmap (external governance)    | B (reviewerId ownership) |
| DR-025  | DR-004                                 | (independent) |
| DR-026  | DR-004                                 | B (reviewerId) |

---

## 4. Mandatory sequencing rules

These rules are derived from the per-drift map. They are
non-negotiable for the implementation order.

1. **F precedes B, C, G.** Any matrix / schema decision gates the
   downstream batches. Specifically: the `'awaiting_gate → running'`
   matrix decision (DR-014) and the `versionStatus` default
   decision (DR-013) must be settled before B / C / G can be
   correctly implemented.

2. **B precedes C step 1.** The legacy `submitGateDecision`
   decision (DR-001) depends on the ownership ADRs from B (especially
   DR-008, DR-010, DR-011).

3. **C step 2 precedes D step 1.** The `pipeline_completed`
   persistence fix (D step 1) must run on the
   `releaseManager.submitReleaseDecision` release-flow
   single-emitter (C step 2). Otherwise the persistence layer
   persists from the wrong site.

4. **D step 2 precedes E step 2.** The discriminator shrink (D
   step 2) is the source of truth for the FE DTO update
   (E step 2).

5. **C step 3, 4 depend on F.** `Task.status` (DR-012) and
   `recoverInterruptedGates` (DR-014) both require the
   matrix / schema decision from F.

6. **G may run after A, F.** G is independent of B–E; it gates
   only on the auth roadmap.

7. **A is parallel-safe.** A may run at any point. The
   deletions do not affect runtime semantics.

---

## 5. Cross-batch concurrency matrix

| Concurrency allowed?     | A  | B  | C  | D  | E  | F  | G  |
| ------------------------ | -- | -- | -- | -- | -- | -- | -- |
| A                        | —  | Y  | Y  | Y  | Y  | Y  | Y  |
| B                        | Y  | —  | N  | N  | N  | N  | Y  |
| C                        | Y  | N  | —  | N* | N  | N  | Y  |
| D                        | Y  | N  | N* | —  | Y  | N  | Y  |
| E                        | Y  | N  | N  | Y  | —  | N  | Y  |
| F                        | Y  | N  | N  | N  | N  | —  | Y  |
| G                        | Y  | Y  | Y  | Y  | Y  | Y  | —  |

Legend:

- `Y` — can run concurrently (no shared state introduced).
- `N` — must run sequentially (strict dependency).
- `N*` — see rule 3 above (D step 1 must wait for C step 2; D
  other steps are independent).

---

## 6. ADR gating

The cross-batch order requires these ADRs to be approved before
the first step of any batch lands.

| Batch first step needs ADR | ADR owner | Topics                                                                                                                                  |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| B step 1 (DR-008)          | Architecture owner | Canonical storage of `featureRequest`; one-time migration story                                                                       |
| B step 3 (DR-010)          | Architecture owner | Canonical truth for gates (in-memory vs DB row)                                                                                          |
| B step 4 (DR-011)          | Architecture owner | Canonical schema for `Task.observability` JSON                                                                                          |
| C step 1 (DR-001 / DR-024) | Architecture owner | Resolution of legacy `submitGateDecision` (delete / deprecate-shim / keep); canonical gate for output_review                           |
| C step 2 (DR-002 / DR-003) | Architecture owner | Release-flow ownership; `PendingGate` row for `kind='release'`                                                                         |
| F (DR-013 / DR-014)        | Architecture owner | `versionStatus` default; new transition `'awaiting_gate → 'running'` or guard                                                              |
| G (DR-004 / DR-025 / DR-026) | Auth team | Replace inline `MembershipService` stub; real RBAC service                                                                              |

Each ADR must include:

- The drift being addressed (DR-xxx).
- The chosen option (with rationale).
- The migration plan (if any).
- The rollback plan (link to `04_REGRESSION_RISK.md`).
- The freeze document amendments (per `01_REPAIR_STRATEGY.md §8`).

---

## 7. NOT VERIFIED

- Whether the dependency between DR-007 and C step 2 is strict
  enough to require the C step 2 fix to land first (it does —
  `releaseManager` is the canonical site).
- Whether the FE DTO trim (D step 2) is safe to land in advance of
  the BE trim (the FE store currently has a strict discriminator;
  removing a member that no longer exists is additive).
- Whether Batch A's doc scrub for DR-023 has any external consumer
  (NOT VERIFIED).