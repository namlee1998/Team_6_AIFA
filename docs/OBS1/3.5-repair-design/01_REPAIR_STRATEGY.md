# 01 — Repair Strategy

> **Status:** DESIGN ONLY. No implementation. No patches. No TODO
> comments. Production code unchanged.
>
> Sources of truth:
> `docs/engineering-freeze/01–09.md`,
> `docs/engineering-audit/01–04.md`,
> `docs/architecture-drift/01–09.md`.
> Every drift item cited to source code or to a Phase-2 drift
> document. Items marked **NOT VERIFIED** are flagged honestly.

This document defines the overarching repair strategy. Per-drift
items live in `02_REPAIR_BATCHES.md` and `04_REGRESSION_RISK.md`.
The cross-batch ordering lives in `03_DEPENDENCY_GRAPH.md` and
`05_IMPLEMENTATION_ORDER.md`.

---

## 1. Goals

1. Convert every confirmed drift from
   `docs/architecture-drift/08_DRIFT_MATRIX.md` into an executable
   engineering design.
2. Group fixes into batches by concern (ownership, pipeline, event
   bus, frontend, state-machine, RBAC, cleanup).
3. Define within-batch ordering and cross-batch dependencies.
4. Document regression risk per batch.
5. Surface the auth / schema / freeze-document amendments that
   any fix depends on.

Out of scope: writing code, writing tests, opening PRs, removing
or renaming modules, changing dependencies. All of these are
explicitly forbidden under the Phase-3 prompt.

---

## 2. Non-goals

- Not implementing anything.
- Not proposing new features.
- Not making architectural decisions that have not already been
  made (Phase-2 marked some items as "Bucket C — Needs Architecture
  Decision"; those remain decisions for Phase 3 to make, not
  pre-decided here).
- Not changing tests, contracts, or schemas without an ADR.

---

## 3. Strategy principles

The strategy is governed by four principles, derived from the freeze
documents and the Phase-1 / Phase-2 audits:

### 3.1 One owner per object (Phase-2 §04)

Every repair in the Ownership batch (Batch B) must establish exactly
one writer per object. Drift items DR-008, DR-009, DR-010, DR-011,
DR-026 all violate this. Repairs pick the canonical owner and
move or remove the others, with a backward-compatibility window if
needed.

### 3.2 Persistence parity (Phase-2 §06, §03)

Every repair in the Pipeline batch (Batch C) and Event Bus batch
(Batch D) must restore the invariant that any envelope published
live has a corresponding `AgentEvent` row. Drift DR-007 / DR-016,
DR-018, DR-019 violate this. Repairs route the envelope through
`AgentEvent.create` after `publishEvent` and update the SSE
controller to replay accordingly.

### 3.3 State machine strict adherence (Phase-2 §05)

Every repair in the Pipeline batch must align with the canonical
`taskLifecycle.TRANSITIONS` matrix. Drift DR-012, DR-013, DR-014
violate this. Repairs either add the missing edge to the matrix
with a documented rationale, or remove the offending writer, or
introduce a `transitionIfPresent` guard. No silent bypass.

### 3.4 Single emitter per canonical event (Phase-2 §02)

Every repair in the Event Bus batch must enforce that exactly one
producer is responsible for each canonical `EventType`. Drift
DR-016, DR-018, DP-1 (Phase-2 §06) violate this. Repairs route
through `releaseManager.submitReleaseDecision` (the §19.4 A.3
single emitter for `pipeline_completed`) and document any
alternative emission path as deprecated.

---

## 4. Inputs from prior phases

The Phase-2 drift matrix is the work list. The Phase-1 pipeline
trace is the call-chain source of truth. The freeze documents are
the contract source of truth.

| Source                                | Used for                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/engineering-freeze/01_SYSTEM_OVERVIEW.md` | System shape; module ownership; canonical envelope invariants             |
| `docs/engineering-freeze/04_AGENT_PIPELINE_BASELINE.md` | Per-stage call chains; gate kinds; SPEC §6.1 mid-run AskUserQuestion |
| `docs/engineering-freeze/05_HTTP_ENDPOINT_INVENTORY.md` | Route surface; 410 routes; removed endpoints                          |
| `docs/engineering-freeze/06_EVENT_INVENTORY.md`     | Canonical event inventory; producer / consumer map                          |
| `docs/engineering-freeze/07_DATABASE_ENTITY_MAP.md` | DB schema; FK / scalar columns; `@@unique([sessionId, sequence])`       |
| `docs/engineering-freeze/08_CURRENT_KNOWN_ISSUES.md` | Pre-existing 30-item observation log (Phase-0 input)                       |
| `docs/engineering-audit/01_PIPELINE_TRACE.md`         | Per-stage call chain with file:line citations                              |
| `docs/engineering-audit/02_STATE_MACHINE.md`          | Reconstructed state machines for Task, PipelineSession, PendingGate       |
| `docs/engineering-audit/03_PIPELINE_GAPS.md`           | Phase-1 G-1..G-20 gap inventory                                              |
| `docs/architecture-drift/02_FLOW_DRIFT.md`            | DR-001 to DR-003                                                            |
| `docs/architecture-drift/03_CONTRACT_DRIFT.md`        | DR-004 to DR-007, DR-017 to DR-019                                           |
| `docs/architecture-drift/04_OWNERSHIP_DRIFT.md`       | DR-008 to DR-011, DR-026                                                    |
| `docs/architecture-drift/05_STATE_DRIFT.md`           | DR-012 to DR-015                                                            |
| `docs/architecture-drift/06_EVENT_DRIFT.md`           | DR-016 to DR-019                                                            |
| `docs/architecture-drift/07_DEAD_ARCHITECTURE.md`     | DR-020 to DR-028                                                            |
| `docs/architecture-drift/08_DRIFT_MATRIX.md`          | Severity, owner, and suggested phase per drift                              |
| `docs/architecture-drift/09_PHASE3_PLAN.md`           | Prior bucket assignments (Bucket A–D, Phase-2 §09)                        |

The Phase-2 `09_PHASE3_PLAN.md` defines four buckets (Safe / Needs
Contract Review / Needs Architecture Decision / High Regression
Risk). This strategy preserves that bucket taxonomy and repackages
it into seven engineering-design batches (A through G below).

---

## 5. Batch taxonomy (Phase-3 design)

| Batch | Concern                                     | Drift items                                            | Source bucket (Phase-2) |
| ----- | ------------------------------------------- | ------------------------------------------------------ | ------------------------ |
| A     | Cleanup (dead modules, dead store actions)  | DR-020, DR-021, DR-022, DR-023, DR-027, DR-028          | Safe (Bucket A)          |
| B     | Ownership (one writer per object)           | DR-008, DR-009, DR-010, DR-011, DR-026                  | Architecture Decision (Bucket C) |
| C     | Pipeline (release-flow, state machine)      | DR-001, DR-002, DR-003, DR-012, DR-013, DR-014, DR-015, DR-024 | High Regression Risk / Architecture Decision (Bucket C/D) |
| D     | Event Bus (envelope persistence, replay)    | DR-007, DR-016, DR-017, DR-018, DR-019, DR-029          | Needs Contract Review (Bucket B) |
| E     | Frontend (state, reducers, store actions)    | DR-018 (FE side), DR-027, DR-028, FE-orphan types       | Cleanup / Safe (Bucket A)  |
| F     | State / Persistence (DB defaults)           | DR-013 (DB schema), DR-014 (state machine edit)        | High Regression Risk (Bucket D) |
| G     | RBAC / Auth (bypass removal)                | DR-004, DR-025, DR-026                                  | High Regression Risk (Bucket D) |

The batch order is linear (A → G). Cross-batch dependencies are
documented in `03_DEPENDENCY_GRAPH.md`. Within-batch ordering is
documented in `05_IMPLEMENTATION_ORDER.md`.

Batch A (Cleanup) is independent of all other batches and may run
in parallel.

---

## 6. Per-drift design pattern

For every drift item the design documents:

- **Root cause** — what was written and why it drifted.
- **Owner** — the module / function that should own the post-repair
  canonical state.
- **Impacted modules** — files that must change (NO CODE in this
  document; only listing).
- **Dependencies** — items or external decisions this drift
  depends on (other drift items, ADRs, schema amendments).
- **Repair approach** — the engineering shape of the fix (steps,
  sequencing, fallback strategy).
- **Regression risk** — what could break and at what magnitude.
- **Rollout order** — position in the cross-batch and within-batch
  sequence.

Each per-drift design lives in `02_REPAIR_BATCHES.md`. Per-batch
regression-risk aggregation lives in `04_REGRESSION_RISK.md`.

---

## 7. Required external decisions

The Phase-2 drift analysis flagged some items as "Bucket C — Needs
Architecture Decision." Phase 3 cannot proceed past those items
without explicit decisions from the architecture owner.

### Decisions required before Batch B starts

| Decision                                                                        | Drifts affected    |
| ------------------------------------------------------------------------------- | ------------------ |
| Choose the canonical storage for `featureRequest` (Task.observability vs AgentArtifact) | DR-008             |
| Choose the canonical `gate` truth (in-memory map vs DB row vs merged)            | DR-010             |
| Choose the canonical observation schema for `Task.observability` (free JSON vs declared schema) | DR-011             |

### Decisions required before Batch C starts

| Decision                                                                        | Drifts affected    |
| ------------------------------------------------------------------------------- | ------------------ |
| Choose the resolution of the legacy `submitGateDecision` (delete, deprecate-shim, OR keep) | DR-001 / DR-024    |
| Choose the canonical gate for output review (current path vs legacy)            | DR-001             |
| Choose the resolution of the `PendingGate` row for `kind='release'` (drop vs keep) | DR-003 / DR-010    |

### Decisions required before Batch F starts

| Decision                                                                        | Drifts affected    |
| ------------------------------------------------------------------------------- | ------------------ |
| Add `'awaiting_gate' → 'running'` to the `TRANSITIONS` matrix (vs. add a guard before `agentDispatcher.runAgent`) | DR-014 |
| Pick the next-state of `PipelineSession.status` after all tasks fail/cancel (`failed` vs leave-as-is) | DR-015 |

### Decisions required before Batch G starts

| Decision                                                                        | Drifts affected    |
| ------------------------------------------------------------------------------- | ------------------ |
| Replace the inline `MembershipService` stub with real RBAC (vs. leave the bypass) | DR-004 / DR-025 / DR-026 |

These decisions are NOT made here. They are inputs Phase 3 must
gather before the relevant batch starts.

---

## 8. Auth / schema / freeze-document amendments

The Phase-3 repairs will require amendments to the freeze documents
in some places. None of those amendments are made here; this strategy
only flags where they will be needed.

| Document                                              | Affected by                                              |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `freeze/06_EVENT_INVENTORY.md`                       | DR-007 (persisted now), DR-017 (discriminator shrinks), DR-018 (sequence policy), DR-019 (replay policy) |
| `freeze/04_AGENT_PIPELINE_BASELINE.md`               | DR-001 (gate ownership), DR-014 (recovery semantics)     |
| `freeze/07_DATABASE_ENTITY_MAP.md`                  | DR-013 (`versionStatus` default), DR-014 (`executionStatus` matrix) |
| `freeze/08_CURRENT_KNOWN_ISSUES.md`                  | Remove items after fixes land; re-issue for remaining    |
| `archive/AIFA_V3_FROZEN_SPEC_DRAFT.md` (if it re-emerges) | Schema contracts                                       |
| `.claude/CLAUDE.md`                                  | Possibly re-state rule: "no direct `Task.update({status:…})` writes outside `taskLifecycle`" |

These amendments are inputs to Phase 3, not output.

---

## 9. Test strategy

Per drift item the design should specify whether regression coverage
is needed. The pre-existing tests are:

- `backend/tests/integration/aifa-gate.test.js`
- `backend/tests/integration/agent-contract.test.js`
- `backend/tests/integration/output-contract.test.js`
- `backend/tests/integration/task-lifecycle.test.js`
- `backend/tests/integration/workflow-report.test.js`
- `backend/tests/integration/eventBus.test.js`
- `backend/tests/integration/gateBridge.subscribeProject.test.js`
- `backend/tests/integration/gateBridge.terminal-state.test.js`
- `backend/tests/integration/a2a-project-definition-plumbing.test.js`
- `backend/tests/integration/arch-mandatory-ask.test.js`
- `backend/tests/integration/dev-prompt-phase3.test.js`
- `backend/tests/integration/po-prompt-phase3.test.js`
- `backend/tests/integration/qa-prompt-phase3.test.js`
- `backend/tests/integration/ux-prompt-phase3.test.js`
- `backend/tests/integration/sdlc.handoff.test.js`
- `backend/tests/integration/repoUrlValidation.test.js`
- `backend/tests/integration/upstreamArtifactGuard.test.js`
- `backend/tests/integration/auth.middleware.test.js`
- `backend/tests/integration/database.config.test.js`
- `backend/tests/integration/getSessionRepoInfo.test.js`
- `backend/tests/integration/normalizeClarificationQuestions.test.js`
- `backend/tests/integration/interventions.test.js`
- `backend/tests/integration/session-state.model.test.js`

Each Batch in `02_REPAIR_BATCHES.md` lists which of the above tests
already exercise the drift and which gaps remain. Per the Phase-3
prompt, no new tests are written in this design document; the design
names which test gaps would need closing.

---

## 10. Rollout plan (high-level)

The implementation order in `05_IMPLEMENTATION_ORDER.md` is the
canonical rollout sequence. Each row in that document corresponds
to a drift item; each row carries:

- Drift ID (from `08_DRIFT_MATRIX.md`).
- Batch (A–G).
- Within-batch step number.
- Cross-batch ordering rationale.
- Rollback strategy (per `04_REGRESSION_RISK.md`).

---

## 11. NOT VERIFIED

The strategy document does not verify:

- Whether the auth team's roadmap has a real RBAC layer planned
  (DR-004 / DR-025 / DR-026 depend on this).
- Whether the SQLite `Task.versionStatus` column default can be
  changed via a Prisma migration without data backfill impact
  (DR-013).
- Whether the SSE replay policy (DR-019) is acceptable to the FE
  team as-is or whether a contract amendment is required first.
- Whether the freeze documents are owned by anyone with authority
  to amend them per the amendments in §8.
- Whether any historical `AgentEvent` rows in
  `backend/prisma/dev.db` would interact with the DR-007 /
  DR-019 fix.

These are flagged for Phase 3 to confirm before implementation,
not bypassed here.