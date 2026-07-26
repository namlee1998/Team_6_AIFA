# 01 — Master Backlog

> **Status:** CONSOLIDATION ONLY. No production code, no tests, no
> contracts, no schema, no documentation outside this directory
> were modified.
>
> Every confirmed issue from
> `docs/engineering-freeze/08_CURRENT_KNOWN_ISSUES.md` (Phase 0,
> I-1 .. I-30),
> `docs/engineering-audit/03_PIPELINE_GAPS.md` (Phase 1, G-1 .. G-20),
> `docs/architecture-drift/08_DRIFT_MATRIX.md` (Phase 2,
> DR-001 .. DR-029), and
> `docs/repair-design/02_REPAIR_BATCHES.md` (Phase 3, Batches A–G)
> is captured exactly once as **R-NNN**.
>
> Duplicate findings across phases have been merged.
> Conflicting findings are recorded in
> `_engineering_conflicts.md` (sibling document in this directory).
>
> Source-of-truth ordering (per `.claude/CLAUDE.md`):
> `PROJECT_CONSTITUTION.md` > `AIFA_V3_FROZEN_SPEC_DRAFT.md` >
> `AUDIT_2026_07_09_FULL_PIPELINE.md §19` > current implementation.
> The implementation is NOT automatically correct when it differs
> from the spec.

---

## Master table

| Repair ID | Severity | Category | Root cause (1 line) | Impact | Current status | Source reports | Proposed batch |
| --------- | -------- | -------- | ------------------- | ------ | -------------- | -------------- | -------------- |
| R-001 | Critical | Event Bus / Persistence | `pipeline_completed` envelope is published live but never persisted to `AgentEvent` — the only canonical event type with asymmetric persistence. | SSE reconnect and `getAuditTrail` miss the terminal event; audit-trail timeline has a hole at completion. | OPEN (acknowledged in Phase 0 I-1, Phase 1 G-1, Phase 2 DR-007/DR-016, Phase 3 Batch D step 1) | I-1, G-1, DR-007, DR-016 | Batch D |
| R-002 | Medium | Event Bus / Discriminator | `pipeline_failed`, `task_resumed`, `agent_event` declared in `EventType` union but no producer exists in source. | Discriminated union overstates live surface; FE TS mirror inherits the inflation; future producers must re-introduce deliberately. | OPEN | I-2, G-2, DR-017 | Batch D |
| R-003 | High | Event Bus / Replay | SSE replay silently drops legacy `AgentEvent` rows that lack `envelope` (only `gate_audit` is rebuilt); rows with neither `envelope` nor `payload` are dropped with no log. | History truncates silently on reconnect; legacy data invisible to consumers. | OPEN | I-3, G-6, DR-019 | Batch D |
| R-004 | Low | Security / CORS | `isLocalDevOrigin` regex accepts any loopback port in non-production, not just 5173/3000. | Any local listener (sidecar, spoofed extension) inherits FE credentials in dev. No production risk. | OPEN | I-4 | Batch D (documentation only) |
| R-005 | Low | Dead Code / Drift | `backend/arch_runtime.js` is an orphan script with no `package.json` entry and no router reference. | Drift only; runner signature compatible but script is dead. | OPEN | I-5, G-12, DR-023 | Batch A |
| R-006 | High | Contract / RBAC | Inline `MembershipService` stub at `SdlcWorkflowService.js:20-31` and `releaseManager.js:33-38` returns `{role:'owner'}` for every call; `authMiddleware.js:1-10` hardcodes `req.user.id='local-user-id'`. | Every RBAC branch (`['owner','admin'].includes(role)`) never narrows; `releaseGate.canDecide` is always true; the architecture's RBAC layer is structurally absent. | OPEN | I-6, I-13, G-16, G-17, DR-004, DR-025, DR-026 | Batch G |
| R-007 | Low | Dead Code / Drift | `socketService.js` is fully deleted (`git status` shows `D`); no current source imports it. | Docs / commit history may still reference socket.io; no runtime impact. | OPEN | I-7, LF-2 | Batch A (docs scrub only) |
| R-008 | Medium | Ownership / Observability | `claudeCodeRunner.normalizeOutput:307-313` writes `cli_session_id` and `cli_total_cost_usd` into `output.observability` (cascading to `Task.observability`); no consumer reads these keys. | Data is produced but never consumed. | OPEN | I-8, DR-009 | Batch B |
| R-009 | Medium | Persistence / Sequence | Pre-session-bound (legacy) `Task.create` writes an `AgentEvent` row with `sessionId=null` and hardcoded `sequence:1`; replay (`AgentEvent.list({sessionId})`) skips these rows entirely. | Legacy rows accumulate but never surface to consumers; orphan data. | OPEN | I-9, G-10 | Batch C |
| R-010 | Low | Runtime / Subscription | No server-side session-start subscription after the Socket.IO → SSE migration; SSE delivery is client-driven (must open `/sdlc/build?sessionId=…` before kickoff). | Functional: users who don't open the dashboard never see live state. Not a code bug. | OPEN | I-10 | Batch E (UX docs / wiring) |
| R-011 | Low | UI / Backend Wiring | Folder-upload flow was removed (HTTP 410 on `/sdlc/upload-repo`); no replacement project-creation UI is wired. The `Project.description` column is fillable from `ProjectController` but no UI surface exposes it. | UI may depend on removed dialogs. | OPEN | I-11, I-16 | Batch E (frontend) |
| R-012 | Medium | Persistence / Sequence | `eventPublisher.publishEvent:17-28` allocates `sequenceService.next` BEFORE `prisma.$transaction` writes `Task` + `AgentEvent`. A rolled-back transaction (e.g. P2003 FK) consumes a sequence but writes no row; subsequent `AgentEvent.list` sees a gap. | Per-session sequence counter drifts on rolled-back transactions. Currently observable, not load-tested. | OPEN | I-12 | Batch D (sequencing) |
| R-013 | High | Ownership / Audit | `HitlDecision.reviewerId` is set to `user?.id || null`; with `authMiddleware` hardcoding `req.user.id='local-user-id'`, every audit row carries the same reviewer. | Audit trail cannot distinguish reviewers; multi-user / RBAC enforcement impossible from the row alone. Coupled with R-006. | OPEN | I-13, G-16, DR-026 | Batch G |
| R-014 | Low | Tooling | `prettier` / `eslint` coverage inconsistent; only FE has `eslint.config.js`; no CI lint pipeline; `lint-results.txt` is a historical artifact. | Style drift; lint noisy only at FE boundary. | OPEN | I-14 | Batch A (tooling clean-up) |
| R-015 | Low | Tooling | `backend/package.json` lacks `start`, `lint`, `db:push`; `frontend/package.json` has only `dev/test/build/typecheck`; no top-level orchestration script. | Manual orchestration required to run the full stack. | OPEN | I-15 | Batch A (tooling) |
| R-016 | Low | Dead Column | `Project.description String?` is written but no agent prompt reads it. | Dead column. | OPEN | I-16 | Batch A / Batch B (no consumer; can drop or wire) |
| R-017 | Medium | Contract / Type Safety | `HitlDecision.action String?` (schema.prisma:209) has no enum and no check constraint; consumers in `getAuditTrail`, `decisionState`, `getWorkflowMetrics`, `agentDispatcher` branch on strings. | Typos on producer side persist; consumers silently ignore unknown values. | OPEN | I-17, DR-006 | Batch B |
| R-018 | Low | Contract / Wire | `releaseManager.submitReleaseDecision:178-184` writes `pipeline_completed.qaResult.commitSha = 'see session.repoInfo'` — a literal placeholder string. | The actual release commit SHA is not carried in the envelope. | OPEN | I-18, DR-029 | Batch D |
| R-019 | Low | Routing / Namespacing | `/sessions/:page` (SessionStateController) and `/sdlc/sessions/:session_id/...` (SdlcController) share a conceptual prefix; mount order makes the names distinct at runtime, but the overlap is observable. | No collision. Conceptual-only drift. | OPEN | I-19 | Batch A (route docs) |
| R-020 | Medium | Runtime / Scaling | `_runAgent` always calls `taskWorker.beginRun(task.id, …)` regardless of `EXECUTION_PATH`. The per-task worker lock is per-process. | Horizontal scaling is unimplemented; multi-instance deployment races on the per-task lock. | OPEN | I-20 | Batch C (architecture) |
| R-021 | Medium | Ownership / Duplication | `featureRequest` is persisted in two durable locations: `Task.observability.featureRequest` (orchestrator:107, 358) and as `AgentArtifact` of type `'feature_request'` (SdlcWorkflowService.js:1829, 1940-1944). `feature_request` artifact is also re-written by every agent whose `artifactTypes` list contains it. | Two sources of truth for the same input string; rewrite tools could desync. | OPEN | I-21, I-30, G-15, DR-008 | Batch B |
| R-022 | Low | Operations / Config | `USE_MOCK_AGENTS`, `USE_MOCK_CLAUDE_CODE`, `MOCK_SCENARIO` are three flags for overlapping concerns. | Operationally confusing. | OPEN | I-23 | Batch A (config docs) |
| R-023 | Medium | Frontend / Store | `useWorkflowStore` uses module-level `seenEnvelopeIds` Set + `lastSeenSequenceBySession` Map + `sseUnsubscribeFns` Map; these survive across React unmount/remount; full page reload re-creates them fresh. | Stale dedup entries can include previous user-session envelopes (LRU 1000 mitigates). | OPEN | I-24 | Batch E |
| R-024 | Medium | Contract / RBAC | `SdlcWorkflowService.js:1212-1213` returns `canDecide: ['owner','admin'].includes(membership?.role)`; combined with R-006, `canDecide` is always `true`. | UI sees always-true; the role-based branch never narrows. | OPEN | I-25, G-17, DR-025 | Batch G |
| R-025 | Low | Test Hygiene | `Sentry.init` runs at module load time in `server.js:21-31`; `require.main === module` guard is at the bottom. | Tests that `require('app')` without running `startServer()` trigger Sentry init (no-op when DSN=''). | OPEN | I-26 | Batch A (test hygiene) |
| R-026 | Medium | Contract / Wire | `Task.agentOutput` (SdlcWorkflowService.js:2025-2034) stores the full `completedData` including runner-internal metadata (`token_usage`, `observability`, `cli_session_id`, `feature_request`); shape differs between mock and claude-code runners. | FE reducers must accept runner-specific keys; mock vs real diverges. | OPEN | I-27, G-8, DR-005 | Batch B |
| R-027 | Low | State / Phase Derivation | `deriveCurrentPhase` in `workflowHelpers.js:237-262` returns `'BACKLOG'` when ARCH is approved but no PO task exists. | Phase string confusion; documented comment in `SdlcWorkflowService.js:1106-1109`. | OPEN | I-28 | Batch C (small) |
| R-028 | Low | Event Bus / Sequence | `SdlcController.streamPipelineStatus:313-378` calls `publishEvent(snapshotType, …)` on every reconnect; `publishEvent` always allocates a fresh sequence via `sequenceService.next`. | Sequence counter leaks by 1 per reconnect. Idempotency unaffected (per `Last-Event-ID`). | OPEN | I-29, G-14, DR-018 | Batch D |
| R-029 | High | State Machine | 8 callers mutate `Task.status` directly via `Task.update({status:…})` outside `taskLifecycle.transition`; `Task.status` and `Task.executionStatus` can disagree; the literal `'PENDING_TOOL_APPROVAL'` (legacy langchain path) is not in any documented state set. | Parallel state fields; state machine only governs `executionStatus`. | OPEN | G-3, DR-012 | Batch C / Batch F |
| R-030 | Critical | State Machine / Boot Recovery | `SdlcWorkflowService._resumeInterruptedTask:1777-1784` calls `_runAgent`, which drives `agentDispatcher.runAgent` → `taskLifecycle.transition(taskId, 'running')`. The matrix (`taskLifecycleService.js:11-21`) does not allow `awaiting_gate → running`. The call to `transition` (not `transitionIfPresent`) throws and is swallowed at `recoverInterruptedGates:1794`. | Every boot with an `awaiting_gate` task fails to resume; the human is never re-prompted. | OPEN | G-4, DR-014 | Batch F (matrix decision) + Batch C |
| R-031 | Medium | Gate / Race | `gateBridge.resolveGate:154-194` consults in-memory `pending.get(approvalId)` first; racing callers can both proceed to `pending.delete` (idempotent) and `PendingGate.resolve` (only first matches the `where status:'pending'`). The second caller still publishes a second `gate_resolved` envelope. | Under racing HTTP requests for the same `approvalId`, two `gate_resolved` envelopes publish. Idempotency is per `envelope.id`. | OPEN | G-5 | Batch C |
| R-032 | Medium | Gate / Scope | `_requireApprovedTask` (SdlcWorkflowService.js:1580-1618) passes a session-scoped `taskIds` to `getPendingQuestionGate`; FE-facing `listAllInterventions` (controller:607-675) lists project-wide; `listPendingApprovals` (controller:240-254) is task/project scoped. | Lock check is correctly session-scoped; FE dashboard lists pending questions from sibling sessions. | OPEN | G-7 | Batch E / Batch C |
| R-033 | Medium | Git / Repo | `repoService.commitAndPushOnApprove` (line 487-566) returns with `result.reason = 'commit failed'` on commit error and swallows push errors silently via `try/catch`. The caller `resolveOutputReviewGate:506-520` does not branch on `result.reason`. | Pipeline proceeds regardless of commit failure. | OPEN | G-9 | Batch C |
| R-034 | Low | Mock / Testing | `MOCK_SCENARIO_PROFILES` is a single-entry map (`happy_path` only); non-`happy_path` values fall through to `happy_path`. | Mock runner always produces a passing scenario; failure-path testing requires real runner. | OPEN | G-11 | Batch A (test scenarios) |
| R-035 | Low | Dead Code | `backend/src/utils/agentParser.js` has zero importers. | No runtime impact; dormant. | OPEN | G-13, DR-021 | Batch A |
| R-036 | Low | Dead Code | `backend/src/middleware/validation.js` has zero importers. | No runtime impact; dormant. | OPEN | G-13, DR-022 | Batch A |
| R-037 | Low | Runtime / Coverage | `archAskEnforcer.ENFORCED_ROLES` (`archAskEnforcer.js:28-35`) does not include `intent-agent` even though `sdlcConstants.AGENT_GATES` includes it. | Dormant on current orchestrator (no `runIntentAgent`). | OPEN | G-18 | Batch C (deferred) |
| R-038 | Medium | Runtime / Memory | `eventBus.sessionSubscribers`, `eventBus.projectSubscribers`, and `gateBridge.pending` are unbounded in-process Maps. | Long-running processes accumulate listeners and pending records. | OPEN | G-19 | Batch D |
| R-039 | Low | Dead Architecture | `agents/sandbox/` is referenced only by `agents/Dockerfile`; no current runtime path uses it. | No current impact. | OPEN | G-20 | Batch A (cleanup / docs) |
| R-040 | High | Pipeline / Legacy Path | `SdlcWorkflowService.submitGateDecision:185-231` (`POST /sdlc/tasks/:task_id/gate-decision`, routes/sdlc.js:35) writes `HitlDecision` without `decisionId`, does not call `_recordApprovedHandoff` / `_startNextAgentIfAvailable`, and on `REQUEST_CHANGES` calls `_rerunOwningWorker` directly. Canonical path is `submitStructuredDecision`. | Legacy path can approve without advancing the chain; rework bypasses structured HITL. | OPEN | DR-001, DR-024, LF-1 | Batch C |
| R-041 | High | Pipeline / Release Flow | `releaseManager.submitReleaseDecision:170-186` is the §19.4 A.3 single emitter for `pipeline_completed`, but the persistence step was missed (live only — see R-001). The `PendingGate` row for `kind='release'` (SdlcWorkflowService.js:559-577) is created but never explicitly resolved (releaseManager writes `HitlDecision` directly without calling `gateBridge.resolveGate`). | Asymmetric persistence (R-001) + dual durable record for FINAL_RELEASE. | OPEN | DR-002, DR-003 | Batch C / Batch D |
| R-042 | High | Ownership / Gate Truth | `gateBridge.requestGate:51-83` writes both an in-memory `pending` Map entry AND a `PendingGate` DB row. After backend restart, only the DB row survives; the in-memory `hasPending` (gateBridge.js:196) returns `false`. For `kind='release'`, the in-memory entry is created but never awaited (no SDK is paused). | Dual truth. Recovery path uses `findPersisted` but live path uses in-memory. | OPEN | DR-010 | Batch B |
| R-043 | Medium | Ownership / Observability | `Task.observability` (schema.prisma:106) is `String?` JSON. Five writers: `workflowOrchestrator.runArchitectureAgent:107`, `runPOAgent:358`, `SdlcWorkflowService._saveAgentData:2011-2015`, `agentDispatcher.markTaskFailed:514-528`, and (scope-correctly) `middleware/requestContext.js:17-20`. No schema; last-write-wins on JSON merge. | Multiple writers race on the JSON blob. | OPEN | DR-011 | Batch B |
| R-044 | High | State / DB Schema | `Task.versionStatus` (schema.prisma:75) defaults to `'committed'` (footgun). New tasks via `Task.create` overwrite to `'draft'`; the predecessor check `_requireApprovedTask:1602-1604` reads `versionStatus === 'committed'`. If any path bypasses `Task.create` and the column is left at default, the invariant flips. | Schema-default footgun; `versionStatus` writes are co-managed by `Task.commitTask` and structured-HITL paths (SdlcWorkflowService.js:321, 495); the two paths converge on `versionStatus` but diverge on `outputVersion`. | OPEN | DR-013 | Batch F |
| R-045 | Medium | State / Session | `PipelineSession.status` only writes `'running'` (initial), `'awaiting_release'` (after QA approve), `'completed'` (release approve). No `running → failed` or `running → cancelled` transitions. | A session whose tasks all fail/cancel stays `'running'` forever, inflating `countActive`. | OPEN | DR-015 | Batch C |
| R-046 | Low | Frontend / Store Actions | `useUiStore` defines `toggleSidebar`, `setSidebarCollapsed`, `setSelectedAgentKey`, `openAgentDetailDrawer`, `closeAgentDetailDrawer`, `openReleaseDialog`, `closeReleaseDialog`, `resetUi` with no consumers; `useWorkflowStore.cleanupSession` and `resetAll` are unused. | Dead store actions. | OPEN | DR-027, DR-028, USA-1..USA-6 | Batch E |
| R-047 | High | Runtime Observability | The agent cards on the Dashboard and Agent Task pages do not reflect runtime state. `taskLifecycle.publishLifecycle` (`taskLifecycleService.js:88-92`) emits `task_started/completed/failed/interrupted/resumed` envelopes with `role: null`; FE `mapTaskStarted/completed/failed/interrupted/resumed` (`eventMappers.ts:215-292`) call `inferAgentKey(env.role)` which returns null and the mappers early-return without updating `agentStates`. The visible card border/chip/dot/glyph all read `runtime.phases[i].status` which is sourced from `session.pipelinePhases` — updated ONLY by `mapSessionStarted` (line 199-208) from the SSE connect-time snapshot. After SSE connect, `pipelinePhases` is frozen. Only `gate_pending` works because `gateBridge.requestGate:124` propagates `role` AND the FE mapper reads `payload.gate.role`. | All five agent cards show dark/inactive state for `running`/`queued`/`completed`/`idle`/`failed`; only `gate_pending` renders the yellow border. User cannot visually understand pipeline progress. | OPEN | D-1, D-2, D-3, D-7, D-8, D-9 (this analysis); also R-021, R-023, R-026, R-029, R-046 (related but distinct) | **Batch OBS-01 (NEW)** |

**Specification documents:**

- `docs/runtime-observability/05_CANONICAL_RUNTIME_STATE.md`
  (canonical state spec; mapping table for every runtime state).
- `docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md`
  (per-stage checklist OBS-01.1 through OBS-01.8).
- `docs/runtime-observability/04_REPAIR_PROPOSAL.md`
  (expanded with canonical-ownership rule, 8-phase implementation
  order, per-state acceptance criteria, risk assessment,
  rollback plan).

---

## Roll-up

| Severity | Count | Repair IDs |
| -------- | ----- | ---------- |
| Critical | 2 | R-001, R-030 |
| High | 10 | R-003, R-006, R-013, R-029, R-040, R-041, R-042, R-044, **R-047**, (and R-024 medium) |
| Medium | 18 | R-002, R-008, R-009, R-012, R-017, R-020, R-023, R-026, R-031, R-032, R-033, R-038, R-043, R-045, R-021, R-024 |
| Low | 17 | R-004, R-005, R-007, R-010, R-011, R-014, R-015, R-016, R-018, R-019, R-022, R-025, R-027, R-028, R-034, R-035, R-036, R-037, R-039, R-046 |

Total confirmed issues: **47**. Every I-N, G-N, and DR-N from the
source documents maps to exactly one R-N above, plus R-047 added
by `docs/runtime-observability/03_DRIFT_ANALYSIS.md`. The four
Phase 0–3 documents contain overlapping observations (especially
R-001, R-006, R-021, R-024, R-028), each merged with all source
citations preserved in the Source reports column.

---

## NOT VERIFIED (carried forward from source reports)

These source-report "NOT VERIFIED" flags remain unresolved by
Phase 3.5 consolidation; they are surfaced for Phase 4 (controlled
implementation) to confirm or refute before code changes land.

- **NV-1** (Phase 1 G-4) — Whether `_resumeInterruptedTask`'s
  illegal transition is actually surfaced to `recoverInterruptedGates`'s
  caller or fully swallowed by the `.catch` block.
  (`SdlcWorkflowService.js:1782, 1794`.)
- **NV-2** (Phase 1 G-6) — Whether legacy `AgentEvent` rows exist
  in `backend/prisma/dev.db`. (DB not inspected during read-only
  audit.)
- **NV-3** (Phase 1 G-10) — Whether the `sessionId=null` legacy
  branch is reachable on the current claude-code / mock paths.
- **NV-4** (Phase 2 §02) — Whether `validation.js`,
  `authService.js`, `agentParser.js` are reachable via any
  historical test setup.
- **NV-5** (Phase 2 §05 HT-1) — Whether the `transition` failure
  from HT-1 is logged at Sentry vs. silently lost.
- **NV-6** (Phase 2 §10) — Whether `PipelineSession.status` ever
  transitions back from `'awaiting_release'` to `'running'` after a
  release REJECT.
- **NV-7** (Phase 3 §11) — Whether any pre-existing tests rely on
  the legacy `submitGateDecision` wire shape.
- **NV-8** (Phase 3 §11) — Whether the auth team's roadmap has a
  real RBAC commitment.
- **NV-9** (Phase 3 §11) — Whether the production data migration
  for `versionStatus` (R-044) has a backfill story.
- **NV-10** (Phase 3 §11) — Whether the deployment target supports
  canary deploys (Batch G).
