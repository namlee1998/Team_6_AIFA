# 03 — Dependency Graph

> **Status:** CONSOLIDATION ONLY.
> Cross-batch and intra-batch dependencies for the seven repair
> batches defined in `02_REPAIR_BATCHES.md`. Canonical repair IDs
> (R-N) are used in place of the source-report IDs.
>
> "Must be fixed before" / "May be parallelized" / "Blocks" /
> "Blocked by" rules are derived from
> `docs/repair-design/03_DEPENDENCY_GRAPH.md` and
> `docs/repair-design/05_IMPLEMENTATION_ORDER.md`, mapped onto
> the R-N taxonomy.

---

## 1. Topological map

```
                                ┌───────────────┐
                                │  Batch F     │   matrix / schema decisions
                                │  (R-044,     │
                                │   R-030,     │
                                │   R-045)     │
                                └───────┬───────┘
                                        │ decision unlocks
                                        ▼
   ┌───────────────┐         ┌───────────────┐         ┌───────────────┐
   │  Batch B     │         │  Batch C     │         │  Batch D     │
   │  (R-006,     │◄────────┤  (R-009,     ├────────►│  (R-001,     │
   │   R-008,     │  coerces  R-020, R-027, │  depends │   R-002,     │
   │   R-013,     │          R-029, R-030,  │          │   R-003,     │
   │   R-017,     │          R-031, R-032,  │          │   R-004,     │
   │   R-021,     │          R-033, R-037,  │          │   R-012,     │
   │   R-024,     │          R-040, R-041,  │          │   R-018,     │
   │   R-026,     │          R-045)         │          │   R-028,     │
   │   R-042,     │                         │          │   R-038)     │
   │   R-043)     │                         │          └───────┬───────┘
   └───────┬───────┘                         └───────────────┘  │
           │                                                            │
           │ shares ADRs                                                │
           │                                                            ▼
           ▼                                                  ┌───────────────┐
   ┌───────────────────────────────────────────────┐         │  Batch E       │
   │   (B / C / D each release independent rollback) │         │  (R-010,       │
   └───────────────────────────────────────────────┘         │   R-011,       │
                                                              │   R-023,       │
                                                              │   R-032,       │
                                                              │   R-046)       │
                                                              └───────┬───────┘
                                                                      │
                                                                      ▼
                                                              ┌───────────────┐
                                                              │  Batch G       │
                                                              │  (R-006,       │
                                                              │   R-013,       │
                                                              │   R-024)       │
                                                              └───────────────┘
```

```
   ┌───────────────┐
   │  Batch A     │   (Cleanup, parallel-safe)
   │  (R-005,     │
   │   R-007,     │
   │   R-014,     │
   │   R-015,     │
   │   R-016,     │
   │   R-019,     │
   │   R-022,     │
   │   R-025,     │
   │   R-034,     │
   │   R-035,     │
   │   R-036,     │
   │   R-037,     │
   │   R-039,     │
   │   R-046)     │
   └───────────────┘
```

- **Batch A** is independent.
- **Batch F** precedes B / C / D (matrix / schema decisions
  those batches depend on).
- **Batch B** provides ADRs that Batch C consumes.
- **Batch D** is independent of B / C but consumes C's
  persistence semantics (R-001 lives in `releaseManager`, which
  C owns).
- **Batch E** mirrors B / D's decisions.
- **Batch G** is gated on the auth roadmap (external).
- **Batch OBS-01** (R-047) is independent of B–G. The BE wire
  change (carry `role: task.type` on lifecycle envelopes) is
  additive; the FE mapper / selector changes are additive.
  OBS-01 may run after Phase 0 ADRs (anytime), independently of
  Batch F (R-044 schema decision) — though it touches a
  subset of R-029 (`Task.status` alignment), so reading
  `OBS-01 + R-029` together is recommended.

  The canonical spec for OBS-01 lives at:
  - `docs/runtime-observability/05_CANONICAL_RUNTIME_STATE.md`
    (single source of truth for every runtime state; mapping
    table at §3.1).
  - `docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md`
    (per-stage checklist OBS-01.1 through OBS-01.8).
  - `docs/runtime-observability/04_REPAIR_PROPOSAL.md` (canonical
    owner per state; 8-phase implementation order; per-state
    acceptance criteria; risk assessment; rollback plan).

  These three documents ARE the OBS-01 specification; this
  backlog row is an index into them. Phase 4 implementation
  engineers should treat the `docs/runtime-observability/` files
  as the source of truth for what must be built.

---

## 2. Per-batch dependency table

| Batch | Depends on                                          | Blocks                              |
| ----- | --------------------------------------------------- | ----------------------------------- |
| A     | (none)                                              | (none — parallel-safe)              |
| B     | Batch F (R-044 schema decision), Batch F (R-030) | Batch C (R-040 legacy path), Batch G (R-006 / R-013 / R-024) |
| C     | Batch F (R-030, R-044, R-045), Batch B (R-042, R-021) | Batch D (R-001), Batch E (R-032)   |
| D     | Batch C step 2 (R-041 single-emitter), Batch B (R-042) | Batch E (R-002 FE mirror, R-046)  |
| E     | Batch D step 2 (R-002 discriminator shrink)        | (none — independent)                |
| F     | (none — produces governance decisions)              | Batch B, Batch C, Batch G           |
| G     | Auth roadmap (external), Batch F (R-044), Batch B (R-006 / R-013 / R-024 ADRs) | (none — independent) |
| OBS-01 | (none — additive on wire and FE)                  | (none — independent; may run with Batch E, Batch D, or alone) |

---

## 3. Per-repair dependency map

This is the per-repair view; the matrix above is the per-batch
view.

### Batch A (parallel-safe)

| Repair | Depends on | Blocks | May parallelize with |
| ------ | ---------- | ------ | -------------------- |
| R-005 | (none) | (none) | any other batch |
| R-007 | (none) | (none) | any other batch |
| R-014 | (none) | (none) | any other batch |
| R-015 | (none) | (none) | any other batch |
| R-016 | (none) | (none) | any other batch |
| R-019 | (none) | (none) | any other batch |
| R-022 | (none) | (none) | any other batch |
| R-025 | (none) | (none) | any other batch |
| R-034 | (none) | (none) | any other batch |
| R-035 | (none) | (none) | any other batch |
| R-036 | (none) | (none) | any other batch |
| R-037 | (none) | (none) | any other batch |
| R-039 | (none) | (none) | any other batch |
| R-046 | (none) | (none) | Batch E (FE compile) |

### Batch B (Ownership)

| Repair | Must be fixed before | May be parallelized with | Blocks |
| ------ | -------------------- | ------------------------ | ------ |
| R-006 | Batch G (Batch G enacts the replacement; Batch B captures the ADR) | R-008, R-013, R-017, R-021, R-024, R-026, R-042, R-043 | Batch G |
| R-008 | (none) | R-006, R-013, R-017, R-021, R-024, R-026, R-042, R-043 | Batch D (FE observability consumers) |
| R-013 | Batch G | R-006, R-008, R-017, R-021, R-024, R-026, R-042, R-043 | Batch G |
| R-017 | (none) | R-006, R-008, R-013, R-021, R-024, R-026, R-042, R-043 | (independent) |
| R-021 | R-043 (schema for `Task.observability`) | R-006, R-008, R-013, R-017, R-024, R-026, R-042 | Batch C (R-040 reads `featureRequest`), Batch D (FE consumers) |
| R-024 | (none) | R-006, R-008, R-013, R-017, R-021, R-026, R-042, R-043 | Batch G |
| R-026 | R-043 (schema for `Task.observability`) | R-006, R-008, R-013, R-017, R-021, R-024, R-042 | Batch D (FE consumers) |
| R-042 | R-044 (Batch F decides `gate` truth semantics consistent with `versionStatus`) | R-006, R-008, R-013, R-017, R-021, R-024, R-026, R-043 | Batch C (R-041 needs the `gate` truth choice) |
| R-043 | R-044 (schema for `Task.observability`) | R-006, R-008, R-013, R-017, R-024, R-026, R-042 | Batch D (FE observability consumers); R-021 (paired) |

### Batch C (Pipeline)

| Repair | Must be fixed before | May be parallelized with | Blocks |
| ------ | -------------------- | ------------------------ | ------ |
| R-009 | (none) | R-020, R-027, R-029, R-030, R-031, R-032, R-033, R-037, R-040, R-041, R-045 | (independent) |
| R-020 | (none) | R-009, R-027, R-029, R-030, R-031, R-032, R-033, R-037, R-040, R-041, R-045 | (independent; documented architectural constraint) |
| R-027 | (none) | R-009, R-020, R-029, R-030, R-031, R-032, R-033, R-037, R-040, R-041, R-045 | (independent) |
| R-029 | R-030 (matrix decision from Batch F) | R-009, R-020, R-027, R-031, R-032, R-033, R-037, R-040, R-041, R-045 | (independent) |
| R-030 | (none — code lands in Batch C; matrix decision is Batch F) | R-009, R-020, R-027, R-029, R-031, R-032, R-033, R-037, R-040, R-041, R-045 | Batch D (R-001 needs the matrix resolved to avoid ordering race) |
| R-031 | (none) | R-009, R-020, R-027, R-029, R-030, R-032, R-033, R-037, R-040, R-041, R-045 | (independent) |
| R-032 | R-042 (lock-check semantics from Batch B) | R-009, R-020, R-027, R-029, R-030, R-031, R-033, R-037, R-040, R-041, R-045 | Batch E (FE listing) |
| R-033 | (none) | R-009, R-020, R-027, R-029, R-030, R-031, R-032, R-037, R-040, R-041, R-045 | (independent) |
| R-037 | (none — dormant; deferred) | any other repair | (independent) |
| R-040 | R-021 (legacy path reads `featureRequest`); R-029 (legacy path writes `Task.status`) | R-009, R-020, R-027, R-030, R-031, R-032, R-033, R-037, R-041, R-045 | (independent) |
| R-041 | R-042 (`gate` truth choice for `kind='release'` PendingGate row) | R-009, R-020, R-027, R-029, R-030, R-031, R-032, R-033, R-037, R-040, R-045 | Batch D (R-001 persistence must run on `releaseManager` which is the canonical site) |
| R-045 | (none — code lands in Batch C; matrix decision is Batch F) | R-009, R-020, R-027, R-029, R-030, R-031, R-032, R-033, R-037, R-040, R-041 | (independent) |

### Batch D (Event Bus)

| Repair | Must be fixed before | May be parallelized with | Blocks |
| ------ | -------------------- | ------------------------ | ------ |
| R-001 | R-041 (single-emitter invariant) | R-002, R-003, R-004, R-012, R-018, R-028, R-038 | (independent; live SSE) |
| R-002 | (none — discriminator shrink is independent) | R-001, R-003, R-004, R-012, R-018, R-028, R-038 | Batch E (FE DTO mirror) |
| R-003 | R-042 (`gate` truth decision for `gate_pending` rows) | R-001, R-002, R-004, R-012, R-018, R-028, R-038 | (independent) |
| R-004 | (none) | R-001, R-002, R-003, R-012, R-018, R-028, R-038 | (independent; documentation only) |
| R-012 | (none) | R-001, R-002, R-003, R-004, R-018, R-028, R-038 | (independent) |
| R-018 | R-001 (real `commitSha` only meaningful if envelope is persisted) | R-002, R-003, R-004, R-012, R-028, R-038 | (independent) |
| R-028 | (none) | R-001, R-002, R-003, R-004, R-012, R-018, R-038 | (independent) |
| R-038 | (none) | R-001, R-002, R-003, R-004, R-012, R-018, R-028 | (independent) |

### Batch E (Frontend)

| Repair | Must be fixed before | May be parallelized with | Blocks |
| ------ | -------------------- | ------------------------ | ------ |
| R-010 | (none) | R-011, R-023, R-032, R-046 | (independent) |
| R-011 | (none) | R-010, R-023, R-032, R-046 | (independent) |
| R-023 | (none) | R-010, R-011, R-032, R-046 | (independent) |
| R-032 | R-042 (Batch B); R-032 code change in Batch C | R-010, R-011, R-023, R-046 | (independent) |
| R-046 | R-002 (BE discriminator trim, mirrored on FE) | R-010, R-011, R-023, R-032 | (independent) |

### Batch F (State / Persistence)

| Repair | Must be fixed before | May be parallelized with | Blocks |
| ------ | -------------------- | ------------------------ | ------ |
| R-030 | (matrix decision; precedes code) | R-044, R-045 | Batch C (R-029, R-030, R-045 code), Batch D (R-001 ordering race) |
| R-044 | (none — independent decision) | R-030, R-045 | Batch B (R-042, R-043 schema coupling), Batch C (R-029 code), Batch G (audit trail) |
| R-045 | (matrix decision; precedes code) | R-030, R-044 | Batch C (R-045 code) |

### Batch G (RBAC / Auth)

| Repair | Must be fixed before | May be parallelized with | Blocks |
| ------ | -------------------- | ------------------------ | ------ |
| R-006 | Auth roadmap (external) | R-013, R-024 | Batch B (R-006 ADR consumed) |
| R-013 | R-006, R-044 | R-006, R-024 | Batch B (R-013 ADR consumed) |
| R-024 | R-006 | R-006, R-013 | Batch B (R-024 ADR consumed) |

---

## 4. Mandatory sequencing rules

These rules are derived from the per-repair map above. They
are non-negotiable for the implementation order.

1. **F precedes B, C, G.** Any matrix / schema decision gates
   the downstream batches. Specifically: the
   `'awaiting_gate → running'` matrix decision (R-030) and the
   `Task.versionStatus` default decision (R-044) must be settled
   before B / C / G can be correctly implemented.

2. **B precedes C step 1 (R-040).** The legacy `submitGateDecision`
   decision (R-040) depends on the ownership ADRs from B
   (especially R-021, R-026).

3. **C step 2 (R-041) precedes D step 1 (R-001).** The
   `pipeline_completed` persistence fix (R-001) must run on the
   `releaseManager.submitReleaseDecision` single-emitter
   (R-041). Otherwise the persistence layer persists from the
   wrong site.

4. **D step 2 (R-002) precedes E step 2 (R-046).** The
   discriminator shrink (R-002) is the source of truth for the
   FE DTO update (R-046).

5. **C step 3, 4 depend on F.** `Task.status` (R-029) and
   `recoverInterruptedGates` (R-030) both require the matrix /
   schema decision from F.

6. **G may run after A, F.** G is independent of B–E; it gates
   only on the auth roadmap.

7. **A is parallel-safe.** A may run at any point. The
   deletions do not affect runtime semantics.

8. **R-042 (`gate` truth) precedes R-041 (release-flow
   PendingGate decision).** The release-flow ownership
   decision (R-041) is coupled to the in-memory vs DB row
   decision (R-042).

9. **R-001 (persistence) is coupled to R-018 (commitSha).**
   Once R-001 makes the envelope persistent, R-018 makes the
   SHA meaningful; the two are independent code but adjacent in
   the wire shape.

---

## 5. Cross-batch concurrency matrix

| Concurrency allowed? | A | B | C | D | E | F | G |
| -------------------- | - | - | - | - | - | - | - |
| **A**                | — | Y | Y | Y | Y | Y | Y |
| **B**                | Y | — | N | N | N | N | Y |
| **C**                | Y | N | — | N*| N | N | Y |
| **D**                | Y | N | N*| — | Y | N | Y |
| **E**                | Y | N | N | Y | — | N | Y |
| **F**                | Y | N | N | N | N | — | Y |
| **G**                | Y | Y | Y | Y | Y | Y | — |

Legend:

- `Y` — can run concurrently (no shared state introduced).
- `N` — must run sequentially (strict dependency).
- `N*` — R-001 (D) must wait for R-041 (C); other D repairs are
  independent.

---

## 6. ADR gating

The cross-batch order requires these ADRs to be approved before
the first step of any batch lands.

| Batch first step needs ADR | Repair affected | Topics |
| -------------------------- | --------------- | ------ |
| B (R-006, R-013, R-024) | Governance for RBAC triple | Replace `MembershipService` stub; real RBAC service |
| B (R-017) | `HitlDecision.action` enum | Stringly-typed → enum |
| B (R-021) | `featureRequest` canonical owner | Owner A (`Task.observability`) vs Owner B (`AgentArtifact`) |
| B (R-026) | `agentOutput` canonical shape | Mock vs real runner shapes |
| B (R-042) | `gate` canonical truth | In-memory map vs DB row vs merged |
| B (R-043) | `Task.observability` canonical schema | Free JSON vs declared schema |
| C (R-040) | Resolution of legacy `submitGateDecision` | Delete / deprecate-shim / keep |
| C (R-041) | Release-flow ownership; `PendingGate` row for `kind='release'` | Drop or keep PendingGate row |
| F (R-030) | `awaiting_gate → running` matrix entry vs guard | Option A / B / C |
| F (R-044) | `Task.versionStatus` default | `'draft'` (recommended) |
| F (R-045) | `PipelineSession.status` failure transitions | New state value |
| G (R-006 / R-025 / R-026) | Replace inline `MembershipService` stub with real RBAC | Auth team's commitment |

Each ADR must include:

- The R-N being addressed.
- The chosen option (with rationale).
- The migration plan (if any).
- The rollback plan (link to `05_REGRESSION_PLAN.md`).
- The freeze document amendments (per
  `docs/repair-design/01_REPAIR_STRATEGY.md §8`).

---

## 7. NOT VERIFIED

Phase 3.5 carries forward these "NOT VERIFIED" flags from the
Phase 2 §10 and Phase 3 §11 lists. They are documented in the
Master Backlog (NV-1 .. NV-10) and not resolved here.
