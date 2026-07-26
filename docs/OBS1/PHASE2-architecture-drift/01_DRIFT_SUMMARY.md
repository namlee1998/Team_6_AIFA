# 01 — Drift Summary (Phase 2)

> **Status:** READ-ONLY drift analysis.
> Baseline: `docs/engineering-freeze/01–09.md` + `docs/engineering-audit/01–04.md`.
> No production-code, test, contract, or schema changes.
> Every drift item cited to a file:line or to a Phase-1 / freeze
> document section.

---

## 1. Current architecture (baseline)

Per `docs/engineering-freeze/01_SYSTEM_OVERVIEW.md` §7 and
`docs/engineering-freeze/04_AGENT_PIPELINE_BASELINE.md`:

```
run-architecture-agent ──► architecture-agent ──► po-agent ──► ux-agent
                                                              ▼
                                                       dev-agent ──► qa-agent
                                                                    ▼
                                                              FINAL_RELEASE
                                                                    ▼
                                                        pipeline_completed
```

Supporting invariants recorded in the freeze + audit:

- Single canonical envelope (`backend/src/dto/eventEnvelope.js:10-23`)
  allocated through `eventPublisher.publishEvent`
  (`eventPublisher.js:17-28`).
- Per-session monotonic sequence space, enforced by
  `sequenceService.next` (`sequence.js:42-49`) and the `@@unique([sessionId,
  sequence])` constraint on `AgentEvent` (`schema.prisma:121`).
- One SSE transport (`streamPipelineStatus`,
  `controllers/SdlcController.js:286-406`).
- One HITL gate contract per kind: `tool`, `question`, `output_review`,
  `release` (see `04_AGENT_PIPELINE_BASELINE.md` §8).
- One Task state machine (`taskLifecycleService.TRANSITIONS`,
  `taskLifecycleService.js:11-21`).
- One execution-path selection driven by `EXECUTION_PATH` env
  (`agentDispatcher.runAgent:306-474`).
- One pipeline re-architecture authority:
  `docs/fixbug/AUDIT_2026_07_09_FULL_PIPELINE.md §19`, referenced in
  releaseManager.js:106-191.

---

## 2. Observed architecture (drift surface)

The implementation has drifted from that baseline across seven axes.
Drift items are numbered with the prefix **DR-** and explained in the
per-axis docs (`02_FLOW_DRIFT` through `07_DEAD_ARCHITECTURE`); the
matrix in `08_DRIFT_MATRIX.md` carries the full list with severity and
owner.

### 2.1 Flow drift (Section 02)

The canonical chain is intact, but two repairs intended by
`AUDIT_2026_07_09_FULL_PIPELINE.md §19` (referenced as `§19.10` in the
freeze memory) were only partially landed. Specifically:

- The single-emitter-for-`pipeline_completed` invariant was
  established at the FINAL_RELEASE gate
  (`releaseManager.js:170-186`), but the wire-shape envelope was
  never persisted to `AgentEvent`. See `03_PIPELINE_GAPS.md G-1` and
  DR-007 (`03_CONTRACT_DRIFT.md`).
- The `recoverInterruptedGates` / `_resumeInterruptedTask` boot
  repair collides with `taskLifecycle.TRANSITIONS`. See
  `03_PIPELINE_GAPS.md G-4` and DR-014 (`05_STATE_DRIFT.md`).

### 2.2 Contract drift (Section 03)

Three contracts have drifted from the canonical pattern:

- **HTTP**: `MembershipService` and `HitlDecision.reviewerId` are
  populated by the inline bypass stub
  (`SdlcWorkflowService.js:20-31`). Every protected route therefore
  behaves as if the caller is `owner`. See freeze I-6, I-13 and
  `03_PIPELINE_GAPS.md G-16, G-17`.
- **SSE envelope**: `pipeline_completed` is published live but never
  persisted to `AgentEvent` (`releaseManager.js:173-186`; freeze
  I-1). The three declared EventTypes `pipeline_failed`,
  `task_resumed`, `agent_event` have no producers (`03_PIPELINE_GAPS.md
  G-2`).
- **PendingGate vs HitlDecision**: `kind='question'` decisions are
  recorded into a `HitlDecision` with `decision='CLARIFICATION'` and
  `action='answer'` (SdlcWorkflowService.js:381-396), in addition to
  resolving the in-memory gate via `gateBridge.resolveGate`. The
  `kind='release'` FINAL_RELEASE gate never creates a
  `PendingGate` row of its own (it is created in `requestGate({kind:'release'})`,
  see `gateBridge.js:51-83`); it only writes the eventual
  `HitlDecision` row at the moment of resolution. See
  `03_CONTRACT_DRIFT.md` §3 (PendingGate vs HitlDecision symmetry).

### 2.3 Ownership drift (Section 04)

The Phase-1 freeze established the architectural rule that exactly
one owner holds each "important object." Multiple objects violate this:

- **`featureRequest`**: persisted on `Task.observability.featureRequest`
  (orchestrator:107, 358) AND as an `AgentArtifact` of type
  `'feature_request'` via `_saveAgentData` (SdlcWorkflowService.js:1829,
  1940-1944). See `03_PIPELINE_GAPS.md G-15` and DR-008.
- **`claude_result` / CLI metadata**: written by
  `claudeCodeRunner.normalizeOutput` (claudeCodeRunner.js:307-313)
  into `output.observability` (which is then persisted to
  `Task.observability`). No consumer reads these keys. See freeze
  I-8 and DR-009.
- **`gate` truth**: in-memory `gateBridge.pending` (the live truth
  for SDK waits) and `PendingGate` DB rows (the durable truth) are
  written by the same `requestGate`/`resolveGate` pair but the
  in-memory map is consulted before the DB on `hasPending` (gateBridge.js:196).
  See `04_OWNERSHIP_DRIFT.md` §4 and DR-010.
- **`observability`**: written by `_saveAgentData` (SdlcWorkflowService.js:2011-2015)
  but also accessible via `requestContext.runWithContext` /
  `setContext` (middleware/requestContext.js:17-20). Two write sites.
  DR-011.

### 2.4 State drift (Section 05)

The Task state machine declared in
`taskLifecycleService.TRANSITIONS:11-21` is not the only state-bearing
field on `Task`. Co-existing with it:

- `Task.status` (legacy free-form string, written by 8 callers
  bypassing `taskLifecycle.transition`). See `03_PIPELINE_GAPS.md G-3`
  and DR-012.
- `Task.versionStatus` (draft → committed). `committed` is set by
  `Task.commitTask` (TaskModel.js:214-220); it is read on the
  source-predecessor gate by `_requireApprovedTask` (SdlcWorkflowService.js:1602-1604).
  The two fields coexist without an explicit transition map. DR-013.
- `Task.executionStatus` (the canonical machine). Conflicts with
  itself when `_resumeInterruptedTask` tries to drive
  `awaiting_gate → running`, which is NOT in `TRANSITIONS`. See
  `03_PIPELINE_GAPS.md G-4` and DR-014.
- `PipelineSession.status` (`'running' → 'awaiting_release' → 'completed'`).
  No `running → failed` transition is ever written. Failed sessions
  sit forever in `'running'`. See `02_STATE_MACHINE.md` §4.
- `PendingGate.status` (`'pending' → 'resolved' | 'rejected' | 'timed_out'
  | 'interrupted'`). `'interrupted'` has no exit transition. See
  `02_STATE_MACHINE.md` §5.
- `HitlDecision` is append-only. Multiple `action` values are
  decided by string equality only; `decision` and `action` can both
  encode "approve" in inconsistent ways (`'APPROVE'` vs `'approve'`).
  See freeze I-17.

### 2.5 Event drift (Section 06)

- `pipeline_completed` published live only (`releaseManager.js:173-186`).
  See freeze I-1.
- `'pipeline_failed' | 'task_resumed' | 'agent_event'` declared but
  never produced (`eventEnvelope.js:10-23`, freeze I-2).
- `session_started` / `session_resumed` snapshots from the SSE
  controller allocate a fresh sequence on every reconnect
  (`SdlcController.streamPipelineStatus:367`). See freeze I-29 and
  `03_PIPELINE_GAPS.md G-14`.
- Legacy `AgentEvent` rows lacking `envelope` are passed through
  `buildLegacyEnvelope` only when `type === 'gate_audit'`; other
  types silently fall through without a log line. See freeze I-3 and
  `03_PIPELINE_GAPS.md G-6`.

### 2.6 Dead architecture (Section 07)

- `authService.js`, `validation.js`, `agentParser.js` have **zero
  importers**. See freeze I-12, `03_PIPELINE_GAPS.md G-13`.
- `arch_runtime.js` and `backend/scripts/*.js` are unreachable. See
  freeze I-5, `03_PIPELINE_GAPS.md G-12`.
- `socketService.js` is fully removed (`git status` shows `D`).
- Many `/api/v1/documents|folders|tree|projects|sessions/*` routes
  are reachable through legacy paths but were re-cast by `freeze
  08` I-11 as "leave the routing layer thin."

### 2.7 Drift categories summary

| Category                                | Items                                                       |
| --------------------------------------- | ----------------------------------------------------------- |
| Flow                                    | DR-001 (release guard), DR-002 (chain ownership contradiction), DR-003 (gateBridge dual write) |
| Contract                                | DR-004 (HTTP `MembershipService` bypass), DR-005 (multi-payload `agentOutput`), DR-006 (`HitlDecision.action` typos), DR-007 (`pipeline_completed` not persisted) |
| Ownership                               | DR-008 (`featureRequest` duplicated), DR-009 (`cli_session_id` orphan writes), DR-010 (PendingGate dual truth), DR-011 (`observability` multi-owner) |
| State                                   | DR-012 (`Task.status` bypass), DR-013 (`versionStatus` ↔ `executionStatus` desync), DR-014 (`recoverInterruptedGates` illegal transition), DR-015 (`PipelineSession.status='running'` stuck) |
| Event                                   | DR-016 (live-only `pipeline_completed`), DR-017 (orphan discriminated union), DR-018 (session_resumed counter leak), DR-019 (legacy replay drops) |
| Dead                                    | DR-020 (`authService` dead), DR-021 (`agentParser` dead), DR-022 (`validation.js` dead), DR-023 (`arch_runtime.js` + scripts dead) |

---

## 3. Major drift categories (rolled up)

### 3.1 Ownership slippage

The single canonical envelope (Phase-0/Phase-1 contract) was
established, but several downstream objects silently accumulated
**two sources of truth**:

- `featureRequest`: `Task.observability.featureRequest` vs
  `AgentArtifact.content*` of type `feature_request`.
- `claude_result` observability: written but never read.
- `gate` truth: in-memory `pending` map vs `PendingGate` DB row.
- `PipelineSession.status`: only `running → awaiting_release →
  completed` transitions exist (no failure transitions).
- `pendingQuestions`: scoped per-session in `_requireApprovedTask`,
  project-scoped in `listAllInterventions`. See
  `03_PIPELINE_GAPS.md G-7`.

### 3.2 Asymmetric persistence

The single largest contract drift: the canonical wire envelope
exists, but the agreement "every wire envelope corresponds to a
persisted `AgentEvent` row" is violated by `pipeline_completed`.
This breaks SSE replay continuity
(`03_PIPELINE_GAPS.md G-1, G-14`).

### 3.3 Bypass-authority contamination

The auth bypass (`backend/src/middleware/authMiddleware.js`) and the
inline `MembershipService` stub (`SdlcWorkflowService.js:20-31`,
`releaseManager.js:33-38`) sit alongside real RBAC branches
(`releaseManager.js:42-44`, `SdlcWorkflowService.js:1212-1213`). The
RBC branches never fire as different values because the stub
returns `owner` for every call. The architecture as documented in
the freeze assumes a real RBAC layer that the implementation
silently does not have. (`03_PIPELINE_GAPS.md G-16, G-17`, freeze
I-6, I-13.)

### 3.4 Dead-architecture pollution

A handful of modules that were intended as live architecture are
unreachable (`authService`, `validation`, `agentParser`,
`arch_runtime.js`, `backend/scripts/*.js`). They live in source,
confuse static analysis, and increase attack surface.

### 3.5 Event-discriminator inflation

Three EventTypes in the discriminated union (`pipeline_failed`,
`task_resumed`, `agent_event`) have zero producers
(`dto/eventEnvelope.js:10-23`). TypeScript mirrors this in
`frontend/src/dto/event.ts:6-19`. The architecture's wire contract
overstates the producer surface.

---

## 4. Overall risk

The drift analysis surfaces **23 distinct drift items** (DR-001 …
DR-023 in `08_DRIFT_MATRIX.md`). Of those:

- **High-risk**: 4 items — DR-007, DR-014, DR-016, DR-019 directly
  cause user-visible behavior loss in normal operation.
- **Medium-risk**: 8 items — DR-002, DR-004, DR-006, DR-008, DR-010,
  DR-011, DR-012, DR-015 — invariant violations that do not break
  current behavior but expose soft spots.
- **Low-risk**: 11 items — dead architecture, cosmetic mismatches,
  orphan writers.

**Severity rating: HIGH.**

The architecture as documented is sound; the implementation as
written systematically violates the documented ownership and
persistence invariants. None of these drifts is currently
self-correcting. Phase 3 must address them in priority order.

---

## 5. Phase 3 readiness input

The drift items partition cleanly into four repair buckets (see
`09_PHASE3_PLAN.md`):

- **Bucket A — Safe**: DR-020, DR-021, DR-022, DR-023 (dead modules,
  no live behavior).
- **Bucket B — Needs Contract Review**: DR-005, DR-006, DR-007,
  DR-008, DR-009, DR-016, DR-017, DR-018, DR-019 (wire / persistence /
  ownership).
- **Bucket C — Needs Architecture Decision**: DR-002, DR-003,
  DR-010, DR-011 (multi-owner objects whose ownership must be
  decided before any code change).
- **Bucket D — High Regression Risk**: DR-001, DR-004, DR-012,
  DR-013, DR-014, DR-015 (state-machine / authorization changes that
  affect normal operation).

The full matrix (`08_DRIFT_MATRIX.md`) carries the per-item severity,
evidence, owner, and suggested repair phase for each drift.