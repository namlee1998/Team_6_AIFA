# 02 — Repair Batches

> **Status:** CONSOLIDATION ONLY.
> Batch taxonomy inherits from Phase 3
> (`docs/repair-design/02_REPAIR_BATCHES.md`), with the canonical
> R-N repair IDs substituted for the DR-N drift IDs. The seven
> batches (A–G) are preserved; their membership is the same set
> of issues; cross-references to source reports are preserved.
>
> No new batches are introduced.
> No new repair IDs are introduced.
> Batches A through G map 1:1 to Phase-3 design batches.

---

## Batch A — Cleanup (dead modules, dead scripts, dead FE store actions)

### Purpose

Remove dead backend modules (zero importers), dead diagnostic
scripts (not wired into `package.json`), dead FE store actions (no
consumers), and minor tooling/observation issues that cannot
affect runtime behaviour. All deletions are parallel-safe and
reversible from git history.

### Contained Repair IDs

R-005 (`arch_runtime.js`), R-007 (`socketService.js` deletion
note), R-014 (lint coverage), R-015 (`package.json` scripts
gap), R-016 (`Project.description` dead column), R-019
(route namespace overlap), R-022 (mock flag names), R-025
(Sentry init at module load), R-034 (`MOCK_SCENARIO_PROFILES`
single-entry), R-035 (`agentParser.js` dead), R-036
(`validation.js` dead), R-037 (`archAskEnforcer.ENFORCED_ROLES`
dormant — keep), R-039 (`agents/sandbox/` dead), R-046
(`useUiStore`/`useWorkflowStore` unused actions).

(Note: R-007 and R-014/R-015/R-019/R-022/R-025/R-034/R-037/R-039
are not "pure deletions" — they are "no-op observations" that
Batch A handles via docs-scrub or tooling consolidation, not via
file removal. They cluster here because they share the property
"no runtime impact today.")

### Dependencies

- (none — Batch A is the only batch that can run before all
  ADRs are captured.)

### Estimated risk

Low. Every entry is reversible from git history. No schema, no
contract, no runtime semantics are affected.

### Regression risk

Low. The only aggregate risk is FE compilation (`useUiStore` /
`useWorkflowStore` action removals — `tsc --noEmit` verifies).
For `arch_runtime.js` and the smoke scripts, the risk is
documentation references — Phase 4 must scrub the docs.

### Files likely affected (read-only inventory; no edits in this phase)

- `backend/arch_runtime.js`
- `backend/src/services/authService.js` (zero importers; lives
  here only because `R-006` / Batch G may re-introduce it as the
  RBAC service — see Batch G)
- `backend/src/utils/agentParser.js`
- `backend/src/middleware/validation.js`
- `backend/scripts/{cancelTimeoutSmoke,realRunnerSmoke,resumeGateSmoke,spikeClaudeAgentSdk,staleWorkerSmoke}.js`
  (`sseReplaySmoke.js` may be retained if exercised by any
  current ad-hoc test — Phase 4 to verify; Phase 3.5 NOT VERIFIED)
- `frontend/src/store/useUiStore.ts` (dead action methods only)
- `frontend/src/store/useWorkflowStore.ts` (dead action methods only)
- `agents/sandbox/` (cleanup / docs)
- `backend/package.json` (optional tooling scripts)
- `frontend/eslint.config.js` / `.prettierrc` / `lint-results.txt`
  (docs only)

### Files explicitly forbidden

- `backend/src/services/releaseManager.js` (Batch C / D / G own
  any change here)
- `backend/src/services/SdlcWorkflowService.js` (Batch C / F own
  any change here)
- `backend/src/services/gateBridge.js` (Batch B / C / D own any
  change here)
- `backend/src/services/eventPublisher.js`,
  `backend/src/services/eventBus.js` (Batch D owns any change
  here)
- `backend/src/services/taskLifecycleService.js` (Batch C / F
  own any change here)
- `backend/src/models/Task.js`,
  `backend/src/models/AgentEvent.js`,
  `backend/src/models/PendingGate.js`,
  `backend/src/models/PipelineSession.js`,
  `backend/src/models/Project.js` (Batch B / C / D / F / G own
  any change here)
- `backend/prisma/schema.prisma` (Batch F owns any change here)
- `backend/src/agents/claudeCodeRunner.js`,
  `backend/src/agents/codexRunner.js`,
  `backend/src/agents/claudePermissionDispatcher.js` (Batch C
  owns any change here; coordinate with R-008, R-026, R-037)
- `backend/src/agents/prompts/*.prompt.md` (no changes; out of
  scope across all batches)
- All `backend/tests/**` files (out of scope; no test edits in
  Phase 3.5)
- All `frontend/src/dto/event.ts` and
  `frontend/src/store/eventMappers.ts` (Batch E owns any change
  here)
- `docs/engineering-freeze/**` and
  `docs/engineering-audit/**` (out of scope; freeze documents
  are amended by Phase 4 only, never by this consolidation)

---

## Batch B — Ownership (one writer per object)

### Purpose

Restore the architectural invariant "one artifact, one owner"
(per `.claude/CLAUDE.md` ownership rules). Pick the canonical
owner for each multi-writer object and migrate the others.

### Contained Repair IDs

R-006 (MembershipService RBAC stub — couples to Batch G), R-008
(`cli_session_id` / `cli_total_cost_usd` orphan writes), R-013
(`HitlDecision.reviewerId` — couples to Batch G), R-017
(`HitlDecision.action` stringly-typed), R-021 (`featureRequest`
dual storage), R-026 (`Task.agentOutput` non-stable shape), R-042
(`gate` dual truth), R-043 (`Task.observability` multi-owner),
R-024 (`releaseGate.canDecide` always true — couples to Batch G).

(R-006, R-013, R-024 are listed in Batch B because they involve
ownership decisions that Batch G implements. Batch B is the
governance layer; Batch G is the deployment layer.)

### Dependencies

- **Batch F** must capture the governance decisions before Batch B
  step 4 (R-043) lands: schema for `Task.observability`, schema
  for `HitlDecision.action`, schema for `Task.agentOutput`.
- **Batch G** is the implementation target for R-006, R-013, R-024
  (Batch B defines the ADR; Batch G enacts it).
- **Batch C** depends on R-042's decision (R-041 / DR-003 needs
  the `gate` truth choice).

### Estimated risk

Medium–High. The ownership changes touch multiple writers per
object and require a backward-compatibility window (dual-write
for one release).

### Regression risk

Medium. Specifically:

- R-021 (featureRequest): two production readers exist
  (`runPOAgent:358`, `compactContext:93-101`). Wrong owner
  breaks ARCH→PO auto-advance.
- R-026 (`agentOutput`): FE reducers depend on runner-specific
  shape. Trimming the contract must coordinate with the FE DTO.
- R-042 (`gate` truth): the dual-truth design is intentional
  for in-flight SDK waits; switching to DB-only must handle the
  race window where the SDK is mid-pause.
- R-008: low (no reader).

### Files likely affected (read-only inventory)

- `backend/src/services/SdlcWorkflowService.js` (R-026,
  R-043 writers)
- `backend/src/services/workflowOrchestrator.js` (R-021,
  R-043 writers)
- `backend/src/services/agentDispatcher.js` (R-043 writer)
- `backend/src/services/gateBridge.js` (R-042)
- `backend/src/models/PendingGate.js` (R-042)
- `backend/src/agents/claudeCodeRunner.js` (R-008)
- `backend/src/agents/agentContract.js` (R-026)
- `backend/src/services/agentContract.js` (R-026 contract shape)
- `backend/src/middleware/requestContext.js` (R-043 scope)
- `backend/prisma/schema.prisma` (R-017 enum / R-026 schema)
- `backend/tests/integration/*` (no edits — Phase 4 verifies via
  pre-existing tests)

### Files explicitly forbidden

- All test files (no edits in any batch)
- All prompt files under `backend/src/agents/prompts/` (out of
  scope)
- `backend/src/agents/claudePermissionDispatcher.js` (Batch C
  owns)
- `backend/src/services/releaseManager.js` (Batch C / D / G own)
- `backend/src/services/taskLifecycleService.js` (Batch C / F own)
- `frontend/src/store/**` (Batch E owns)

---

## Batch C — Pipeline (release-flow, state machine, gate semantics)

### Purpose

Restore the canonical chain's invariants: single-emitter for
`pipeline_completed`, `PipelineSession.status` lifecycle,
`Task.versionStatus` ↔ `executionStatus` synchronisation,
recovery semantics, legacy `submitGateDecision` resolution,
`Task.status` ↔ `taskLifecycle.transition` discipline, gate
scope and concurrency semantics, git commit failure semantics.

### Contained Repair IDs

R-009 (legacy `Task.create` `sequence:1` rows), R-020 (per-task
worker lock single-process assumption), R-027
(`deriveCurrentPhase` ARCH-only-no-PO collapse), R-029
(`Task.status` bypass, 8 writers), R-030 (`recoverInterruptedGates`
illegal transition — couples to Batch F), R-031 (`gateBridge.resolveGate`
double-resolve race), R-032 (`pendingQuestions` scope mismatch),
R-033 (`commitAndPushOnApprove` swallows errors), R-037
(`archAskEnforcer.ENFORCED_ROLES` intent-agent gap), R-040
(legacy `submitGateDecision`), R-041 (release-flow single-emitter
+ PendingGate decision for `kind='release'`), R-045
(`PipelineSession.status='running'` stuck).

### Dependencies

- **Batch F** must capture the matrix / schema decisions before
  Batch C step 3 (R-029), step 4 (R-030), step 5 (R-045) land.
- **Batch B** must capture the ownership ADRs for R-042 before
  R-041 can decide on the `PendingGate` row for `kind='release'`.
- **Batch D** step 1 (R-001) depends on Batch C step 2 (R-041)
  for the single-emitter invariant.

### Estimated risk

High. The matrix / status / `versionStatus` changes touch the
spine of the SDLC. Rollback plan is mandatory.

### Regression risk

- R-040 (legacy gate): High. Removing the legacy path removes a
  tested path (`sdlc.handoff.test.js`). Deprecation window
  required.
- R-041 (release-flow persistence): Low (additive) for the
  envelope-persistence step; Medium for the `PendingGate`
  decision.
- R-029 (Task.status): High. 8 direct writers touched.
- R-030 (recovery transition): Low if the matrix entry is
  added; Medium if a guard is added instead.
- R-045 (PipelineSession.status): Medium. New state value
  `'failed'` is additive; consumers that branch only on
  `'running' / 'awaiting_release' / 'completed'` continue to
  behave as before.
- R-031 (resolveGate race): Low. Defensive guard, narrow surface.
- R-032 (gate scope): Low. UI / lock-check alignment.
- R-033 (commit/push errors): Medium. New error-branch
  semantics.

### Files likely affected (read-only inventory)

- `backend/src/controllers/SdlcController.js` (R-040, R-041)
- `backend/src/routes/sdlc.js` (R-040)
- `backend/src/services/SdlcWorkflowService.js` (R-029, R-030,
  R-032, R-033, R-041, R-045, R-009)
- `backend/src/services/workflowOrchestrator.js` (R-009, R-045)
- `backend/src/services/agentDispatcher.js` (R-029, R-037)
- `backend/src/services/taskLifecycleService.js` (R-029, R-030,
  R-045)
- `backend/src/services/taskWorkerService.js` (R-029)
- `backend/src/services/gateBridge.js` (R-031, R-042 siblings)
- `backend/src/services/releaseManager.js` (R-001, R-018, R-041)
- `backend/src/services/repoService.js` (R-033)
- `backend/src/services/workflowHelpers.js` (R-027)
- `backend/src/services/gateManager.js` (R-032)
- `backend/src/agents/claudeCodeRunner.js` (R-008 — see Batch B)
- `backend/src/services/archAskEnforcer.js` (R-037)
- `backend/src/models/Task.js` (R-029, R-009, R-021)

### Files explicitly forbidden

- `backend/src/services/eventPublisher.js` (Batch D owns)
- `backend/src/services/eventBus.js` (Batch D owns)
- `backend/prisma/schema.prisma` (Batch F owns; Batch C must not
  add columns; default changes are Batch F's call)
- `frontend/src/store/**` (Batch E owns)
- All test files (out of scope; no edits)

---

## Batch D — Event Bus (envelope persistence, replay, sequence, wire)

### Purpose

Restore the invariant "every wire envelope corresponds to a
persisted `AgentEvent` row." Trim the discriminator union to
match the live producer surface. Repair SSE replay so legacy rows
and reconnecting clients see the same contract. Establish sequence
allocation transactional with `Task.create`. Bound in-process
subscriber / pending maps.

### Contained Repair IDs

R-001 (`pipeline_completed` persistence — coupled to R-041 in
Batch C), R-002 (orphan EventTypes), R-003 (SSE replay drops),
R-004 (CORS loopback — documentation only), R-012 (sequence
allocation non-transactional), R-018 (placeholder `commitSha`),
R-028 (`session_resumed` sequence leak), R-038 (eventBus /
gateBridge unbounded maps).

### Dependencies

- **Batch C step 2 (R-041)** must land first: the persistence
  step (R-001) must run on `releaseManager.submitReleaseDecision`,
  which is the canonical site only after the single-emitter
  invariant is established.
- **Batch B** R-042 (`gate` truth decision) gates the SSE
  replay policy for `gate_pending` rows (R-003 sub-case).

### Estimated risk

Low–Medium. Most items are additive (`AgentEvent.create` is
added; the discriminator shrinks; the sequence is repaired;
the SHA becomes real).

### Regression risk

- R-001: Low (additive).
- R-002: Low (trim is a no-op for current code paths).
- R-003: Medium. Synthesising envelopes for legacy rows changes
  the SSE wire for those rows; the FE reducer drops unknown
  types silently (no mapper for legacy types).
- R-004: Low (documentation only; no production risk).
- R-012: Medium. Sequence allocation non-transactional with
  `Task.create` — moving the call inside the transaction is
  low-risk; restoring atomicity is the fix.
- R-018: Low. Real SHA in envelope is additive.
- R-028: Medium. Coalescing by cursor can hide reconnect gaps
  for stale FE clients.
- R-038: Low. Bounded map (LRU) is additive.

### Files likely affected (read-only inventory)

- `backend/src/controllers/SdlcController.js` (R-001, R-003,
  R-028)
- `backend/src/services/releaseManager.js` (R-001, R-018)
- `backend/src/services/eventPublisher.js` (R-001, R-012, R-028)
- `backend/src/services/eventBus.js` (R-038)
- `backend/src/services/sequence.js` (R-012, R-028)
- `backend/src/services/gateBridge.js` (R-038)
- `backend/src/dto/eventEnvelope.js` (R-002, R-018)
- `backend/src/models/Task.js` (R-012)
- `backend/src/models/AgentEvent.js` (R-001, R-012, R-038)
- `backend/src/services/SdlcWorkflowService.js` (R-001 — Audit
  row pair)
- `backend/src/server.js` (R-004 documentation only)

### Files explicitly forbidden

- `backend/src/services/taskLifecycleService.js` (Batch C / F
  own)
- `backend/prisma/schema.prisma` (Batch F owns)
- `frontend/src/dto/event.ts` (Batch E owns; the FE DTO is
  trimmed by Batch E step 2)
- `frontend/src/store/eventMappers.ts` (Batch E owns)
- `frontend/src/store/useWorkflowStore.ts` (Batch E owns; the
  module-level dedup Sets are Batch E's concern)
- All test files (out of scope; no edits)

---

## Batch E — Frontend (state, reducers, store actions, DTO mirror)

### Purpose

Trim unused store actions; align the FE-store invariants with the
canonical envelope contract; remove orphan DTO types; surface
project-creation UI hooks; fix module-level dedup state
hygiene; align `pendingQuestions` listing scope with the lock
check; expose project description (or confirm dead column).

### Contained Repair IDs

R-010 (server-side session-start subscription — UX wiring), R-011
(folder-upload removal + project description UI), R-023
(module-level dedup Sets), R-032 (`pendingQuestions` FE listing
scope), R-046 (`useUiStore` / `useWorkflowStore` unused actions).

### Dependencies

- **Batch D step 2 (R-002)** must land first: the FE DTO
  trim mirrors the BE trim.
- R-032 (gate scope) couples to Batch C (the lock check is the
  reference; FE mirrors).

### Estimated risk

Low. The FE is read-only with respect to backend state; the
drifts in this batch are cosmetic / structural.

### Regression risk

- R-010: Low (UX wiring).
- R-011: Low (UI surface only).
- R-023: Low–Medium. Stale dedup entries mitigated by 1000-entry
  LRU.
- R-032: Low (FE listing aligns with the existing lock check).
- R-046: Low per method; aggregate Medium if FE compile fails.

### Files likely affected (read-only inventory)

- `frontend/src/store/useUiStore.ts` (R-046)
- `frontend/src/store/useWorkflowStore.ts` (R-023, R-046)
- `frontend/src/store/eventMappers.ts` (R-002 mirror, R-032)
- `frontend/src/services/sseClient.ts` (R-002 mirror, R-023
  dedup boundary)
- `frontend/src/dto/event.ts` (R-002 mirror)
- `frontend/src/services/api/sdlcApi.ts` (R-032)
- `frontend/src/services/api/types.ts` (R-002 mirror)
- `frontend/src/components/layout/dialogs/ImportProjectDialog.tsx`
  (R-011)
- `frontend/src/components/sdlc/**` (R-011, R-032, R-046)

### Files explicitly forbidden

- All backend files (Batches A, B, C, D, F, G own)
- All test files (out of scope)
- `frontend/src/services/sseClient.ts` envelope validation (R-002
  is purely a discriminator-narrowing edit; the structural check
  stays)

---

## Batch F — State / Persistence (DB schema, transition matrix)

### Purpose

Schema decisions for the DB layer (`Task.versionStatus` default).
State-machine matrix changes (`awaiting_gate → running`,
`PipelineSession.status` failure transitions). Capture the
governance that Batches B, C, and G depend on.

### Contained Repair IDs

R-044 (`Task.versionStatus` default), R-030 (matrix edit for
`awaiting_gate → running`), R-045 (matrix edit for `PipelineSession`
failure transitions — the matrix decision; code lands in Batch C).

(Note: R-030 is the canonical R-N for `recoverInterruptedGates`.
The matrix decision is Batch F; the code change that consumes the
decision is Batch C step 4.)

### Dependencies

- Batch F produces governance decisions.
- Batch B consumes R-044 (R-043 schema for `Task.observability`
  must be consistent with `versionStatus` semantics).
- Batch C consumes R-030 (matrix edit) and R-045 (matrix edit).
- Batch G consumes R-044 indirectly (audit-trail `reviewerId`).

### Estimated risk

Medium. The schema migration carries backfill risk for existing
rows; the matrix edits carry state-machine compliance risk.

### Regression risk

- R-044: Medium. Schema default change can flip freshly-created
  rows to `'committed'`. Migration must backfill or quarantine.
- R-030: Low if a matrix entry is added; Medium if a guard is
  added (defensive code).
- R-045: Medium. New `'failed'` state is additive.

### Files likely affected (read-only inventory)

- `backend/prisma/schema.prisma` (R-044 default + CHECK)
- `backend/src/services/taskLifecycleService.js` (R-030 matrix)
- `backend/src/models/Task.js` (R-044)
- A Prisma migration file (Phase 4 generates; this consolidation
  phase does not write migrations)

### Files explicitly forbidden

- All non-schema source files (Batches A–E, G own)
- All test files (out of scope)
- All prompt files under `backend/src/agents/prompts/`

---

## Batch G — RBAC / Auth (bypass removal)

### Purpose

Restore the RBAC layer that the inline bypass stub suppresses.
When real RBAC replaces the bypass, R-006, R-013, R-024
mechanically become meaningful.

### Contained Repair IDs

R-006 (MembershipService stub), R-013 (`HitlDecision.reviewerId`
always `'local-user-id'`), R-024 (`releaseGate.canDecide` always
`true`).

### Dependencies

- **External**: auth team's roadmap (Phase 3.5 NOT VERIFIED — NV-8).
- **Batch F**: R-044 schema default must be settled (audit
  trail semantics).
- **Batch B**: ownership ADRs for `reviewerId` (R-013) must be
  settled.

### Estimated risk

Critical. Removing the auth bypass without a real RBAC layer
is unsafe; replacing with a real layer is a one-shot operation.
Regression can break authentication for every route.

### Regression risk

- R-006: Critical. RBAC service + middleware + every route's
  RBAC branch.
- R-024: Critical. Coupled with R-006.
- R-013: High. Coupled with R-006.

### Files likely affected (read-only inventory)

- `backend/src/middleware/authMiddleware.js` (R-006)
- `backend/src/services/SdlcWorkflowService.js` (R-006, R-024)
- `backend/src/services/releaseManager.js` (R-006)
- `backend/src/services/workflowQueries.js` (R-006)
- A new `backend/src/services/membershipService.js` (R-006
  extraction; optional — could remain inline)

### Files explicitly forbidden

- All non-RBAC files (Batches A–F own)
- All test files (out of scope; Phase 4 may add RBAC tests but
  Batch G only enacts the replacement; new tests live in a
  separate PR)
- All prompt files

---

## Batch OBS-01 — Runtime Observability (carry canonical state through to the agent cards)

### Purpose

Restore the runtime visualization on the Dashboard and Agent Task
pages by carrying the canonical `Task.executionStatus` through the
SSE wire and into the FE projection that drives the agent cards.
Today every agent card stays dark/inactive for `running`,
`queued`, `completed`, `idle`, and `failed`; only `gate_pending`
renders correctly. This batch addresses that drift without
touching the canonical state machine itself.

### Why this batch

This issue spans three existing concerns:

- **Batch D** owns envelope wire shape — the BE half of R-047
  (carry `role: task.type` on lifecycle envelopes) is a wire-
  shape fix.
- **Batch E** owns FE store / DTO — the FE mappers and selector
  updates are FE concerns.
- **Batch B** owns ownership — `pipelinePhases[i].status`
  ownership and projection rules are governance.

No single existing batch fits. Creating OBS-01 keeps each
existing batch's responsibility clean and lets the visualization
fix land atomically (BE + FE + selector under one feature flag).

### Contained Repair IDs

- R-047 — Agent runtime visualization drift (the single
  registration for this batch).

Sub-IDs may emerge during the repair design if the BE / FE
divergence is split (e.g. R-047a for the BE wire change, R-047b
for the FE mapper change). Phase 4 records them.

### Specification documents (canonical)

- `docs/runtime-observability/05_CANONICAL_RUNTIME_STATE.md`
  — single source of truth for runtime visualization. Defines
  every runtime state (backend meaning, producer, consumer, UI
  meaning, badge, border, background, animation, progress
  indicator, icon, Dashboard rendering, Agent Task rendering,
  Inspector rendering) with `file:line` evidence. Includes the
  canonical mapping table at §3.1.
- `docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md`
  — per-stage checklist OBS-01.1 through OBS-01.8 with
  producer / transport / reducer / selector / view-model /
  Dashboard / Agent Task / Inspector / timeline / badge /
  colour / animation / regression tests / visual regression /
  acceptance criteria for every stage. Includes cross-cutting
  test gaps and a per-state acceptance matrix.
- `docs/runtime-observability/04_REPAIR_PROPOSAL.md` — canonical
  owner per state, 8-phase implementation order
  (OBS-01.1 through OBS-01.8), per-state acceptance criteria,
  risk classification table (Critical/High/Medium/Low), and
  per-phase rollback strategy with the
  `OBS_01_RUNTIME_OBSERVABILITY` feature flag.

### Required external decisions

| Decision | Why |
| -------- | --- |
| Where the canonical FE projection lives: `selectRuntimeExecution` reads `pipelinePhases[i].status` (recommended) vs. an additional `agentStates[i].status` channel | Affects whether R-047 must touch the selector or just the mapper |
| Whether to align `Task.status = 'running'` with `Task.executionStatus` in `agentDispatcher.runAgent` (subset of R-029 / DR-012) | Removes the `'processing'` value from the legacy field; required if `SdlcWorkflowService.getPipelineResponse` is to keep reading `Task.status` for the snapshot |

### Test gaps in scope

- A unit test asserting that a `task_started` envelope with
  `role: 'architecture-agent'` updates
  `pipelinePhases[ARCH].status === 'running'` on the FE store.
- A unit test asserting that a `task_completed` envelope with
  `role: 'dev-agent'` updates
  `pipelinePhases[DEV].status === 'completed'`.
- A manual integration verification that a fresh session shows
  the running agent with a blue border and spinning loader,
  the completed agent with a green border, and the
  awaiting-review agent with an amber chip.

### Per-repair design

See `docs/runtime-observability/04_REPAIR_PROPOSAL.md` for the
full per-drift design. Key elements:

- **Canonical owner**: `Task.executionStatus` (governed by
  `taskLifecycleService.TRANSITIONS`).
- **Canonical FE projection**:
  `session.pipelinePhases[i].status` is sourced from
  `Task.executionStatus` (via the SSE snapshot for initial
  state, and via per-event mapper updates for transitions).
- **Canonical envelope role**: `taskLifecycle.publishLifecycle`
  propagates `role: task.type`.
- **Wire-shape change**: additive only. The lifecycle envelope
  base gains a non-null `role` for the first time.

### Estimated risk

MEDIUM. The change is additive on the wire; the FE changes add
new mapper branches without removing existing ones. The enums
on the FE (`PhaseStatus.status` and `AgentState.status`) already
include the values (`'running'`, `'completed'`, `'failed'`,
`'skipped'`); no FE enum change is required.

### Regression risk

- LOW for the wire change (additive).
- LOW-MEDIUM for the FE mapper change (existing
  `awaiting_review` behaviour must not regress; verified by
  pre-existing tests in `frontend/tests/`).
- MEDIUM for the selector merge (an over-eager merge could
  promote an agent to `'completed'` prematurely; the merge must
  only fire when the agent's `agentStates[i].status` transitions
  via a task lifecycle envelope).
- MEDIUM for the `Task.status = 'processing'` alignment
  (subset of R-029). Any consumer that branches on the literal
  `'processing'` would silently change semantics.

### Files likely affected (read-only inventory)

- `backend/src/services/taskLifecycleService.js`
  (`publishLifecycle` propagates `role: task.type`).
- `backend/src/services/agentDispatcher.js`
  (`runAgent` writes `'running'` instead of `'processing'`).
- `backend/src/services/SdlcWorkflowService.js`
  (`getPipelineResponse` reads `phaseData.executionStatus`
  instead of `phaseData.status`).
- `backend/src/controllers/SdlcController.js`
  (optional: re-snapshot publisher on every state change).
- `frontend/src/store/eventMappers.ts`
  (every task-lifecycle mapper patches both `agentStates` and
  `pipelinePhases`; `mapSessionResumed` applies the snapshot
  payload).
- `frontend/src/store/workflowSelectors.ts`
  (extend `phaseForAgent` merge for `'running'`, `'completed'`,
  `'failed'`, `'skipped'`).
- `frontend/src/dto/event.ts`
  (optional: annotate `TaskLifecyclePayload.role` schema).
- `frontend/src/services/api/sdlcApi.ts` (no change; enums
  already include the values).
- `frontend/src/models/SessionState.ts` (no change; enums
  already include the values).
- `frontend/src/pages/SdlcDashboard/index.tsx` (no CSS change;
  the input `ps` simply starts carrying the right values).
- `frontend/src/pages/SdlcDashboard/OverviewPage.tsx` (no
  change).
- `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx`
  (no change).

### Files explicitly forbidden

- `backend/src/services/releaseManager.js` (Batches C / D / G
  own).
- `backend/src/services/gateBridge.js` (Batches B / C / D own;
  R-047 does NOT modify the gate path — the gate path already
  works).
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

## Batch cross-reference (R-N → Batch)

| Repair ID | Batch |
| --------- | ----- |
| R-001 | D (persistence step) — depends on Batch C R-041 |
| R-002 | D (trim) |
| R-003 | D (replay) |
| R-004 | D (CORS docs only) |
| R-005 | A |
| R-006 | G (Batch B captures the ADR) |
| R-007 | A (docs scrub) |
| R-008 | B |
| R-009 | C |
| R-010 | E |
| R-011 | E |
| R-012 | D |
| R-013 | G (Batch B captures the ADR) |
| R-014 | A (tooling) |
| R-015 | A (tooling) |
| R-016 | A (dead column) |
| R-017 | B |
| R-018 | D |
| R-019 | A (route docs) |
| R-020 | C (architecture) |
| R-021 | B |
| R-022 | A (config docs) |
| R-023 | E |
| R-024 | G (Batch B captures the ADR) |
| R-025 | A (test hygiene) |
| R-026 | B |
| R-027 | C |
| R-028 | D |
| R-029 | C |
| R-030 | F (matrix decision); C (code) |
| R-031 | C |
| R-032 | E (FE listing); C (lock-check semantics) |
| R-033 | C |
| R-034 | A (test scenarios) |
| R-035 | A |
| R-036 | A |
| R-037 | C (deferred; dormant) |
| R-038 | D |
| R-039 | A (cleanup) |
| R-040 | C |
| R-041 | C (single-emitter); B (PendingGate decision) |
| R-042 | B |
| R-043 | B |
| R-044 | F |
| R-045 | C (code); F (matrix decision) |
| R-046 | E |
| R-047 | OBS-01 (NEW) |

Every R-N belongs to exactly one primary batch (with the Batch B
↔ Batch G and Batch C ↔ Batch F couples documented, and the new
Batch OBS-01 for the runtime visualization fix).
