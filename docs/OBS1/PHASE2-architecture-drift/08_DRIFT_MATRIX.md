# 08 — Drift Matrix (Phase 2)

> **Status:** READ-ONLY summary. The full evidence for each row lives
> in `02_FLOW_DRIFT.md`, `03_CONTRACT_DRIFT.md`,
> `04_OWNERSHIP_DRIFT.md`, `05_STATE_DRIFT.md`, `06_EVENT_DRIFT.md`,
> `07_DEAD_ARCHITECTURE.md`.

Severity scale (purely advisory):

- **Critical** — observable user-visible behaviour loss in normal
  operation today.
- **High** — invariant violation that the architecture documents but
  the runtime silently fails to enforce.
- **Medium** — drift that does not break current operation but
  exposes a soft spot.
- **Low** — dead code, orphan types, cosmetic mismatches.

| ID       | Component                                            | Drift Category        | Severity  | Impact                                                                                          | Evidence                                                                                                                  | Owner                                                      | Suggested Phase |
| -------- | ---------------------------------------------------- | --------------------- | --------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------- |
| DR-001   | Release Flow (chain ownership contradiction)         | Flow Drift            | High      | Two `output_review`-style gates; legacy path never advances the chain                            | `SdlcWorkflowService.js:185-231` vs `:466-591`                                                                          | `SdlcWorkflowService.submitGateDecision` (legacy); `resolveOutputReviewGate` (canonical) | Phase 4 (Bucket C)    |
| DR-002   | Release Flow (single emitter established, asymmetric) | Flow Drift            | High      | `pipeline_completed` live-only; replay and audit-trail miss terminal event                       | `releaseManager.js:170-186`; `eventPublisher.js:17-28`                                                                  | `releaseManager.submitReleaseDecision`                       | Phase 3 (Bucket B)    |
| DR-003   | PendingGate dual write (release path)                | Flow Drift            | Medium    | DB row left dangling after release; `kind='release'` creates redundant durable record            | `gateBridge.js:51-83, 154-194`; `releaseManager.js:106-194`                                                              | `gateBridge.requestGate` + `releaseManager`                  | Phase 4 (Bucket C)    |
| DR-004   | HTTP `MembershipService` bypass                       | Contract Drift        | High      | RBAC branches never narrow; `releaseGate.canDecide` always `true`                                | `SdlcWorkflowService.js:20-31`; `releaseManager.js:33-38`                                                                | `SdlcWorkflowService`, `releaseManager` (inline stubs)        | Phase 3 (Bucket D)    |
| DR-005   | `agentOutput` payload shape not stable                | Contract Drift        | Medium    | FE reducers must accept runner-specific metadata; mock vs real differ                            | `SdlcWorkflowService.js:2025-2034`; `agentContract.js:24-46`; `claudeCodeRunner.js:307-313`                                | `_saveAgentData`, `claudeCodeRunner`, `buildMockOutput`       | Phase 4 (Bucket B)    |
| DR-006   | `HitlDecision.action` / `decision` string typos       | Contract Drift        | Medium    | Stringly-typed; no DB constraint; consumers branch on equality only                              | `schema.prisma:209`; `SdlcWorkflowService.js:776-784`; `workflowQueries.js:187-213`                                       | All `HitlDecision.create` callers                            | Phase 3 (Bucket B)    |
| DR-007   | `pipeline_completed` envelope not persisted           | Contract Drift        | Critical  | SSE replay misses terminal event; `getAuditTrail` missing terminal phase                          | `releaseManager.js:170-186`; `eventPublisher.js:17-28`; `AgentEvent.js:21-41`                                            | `releaseManager.submitReleaseDecision`                       | Phase 3 (Bucket B)    |
| DR-008   | `featureRequest` dual storage                         | Ownership Drift       | Medium    | Two durable owners; rewrite tools could desync                                                  | `orchestrator.js:107, 358`; `SdlcWorkflowService.js:1829, 1940-1944`                                                   | `workflowOrchestrator`, `_saveAgentData`                    | Phase 3 (Bucket B)    |
| DR-009   | `cli_session_id` / `cli_total_cost_usd` orphan writes  | Ownership Drift       | Medium    | No consumer; data is produced but never read                                                    | `claudeCodeRunner.js:307-313`                                                                                            | `claudeCodeRunner.normalizeOutput`                          | Phase 3 (Bucket B)    |
| DR-010   | PendingGate dual truth                               | Ownership Drift       | High      | In-memory map vs DB row; `kind='release'` is structurally redundant                              | `gateBridge.js:28, 51-83, 154-194`                                                                                       | `gateBridge`, `releaseManager`                              | Phase 4 (Bucket C)    |
| DR-011   | `Task.observability` multi-owner                      | Ownership Drift       | Medium    | Five writers; JSON merge; last-write-wins                                                       | `orchestrator.js:104-108, 356-361`; `SdlcWorkflowService.js:2011-2015`; `agentDispatcher.js:514-528`                      | Multiple                                                  | Phase 4 (Bucket C)    |
| DR-012   | `Task.status` bypass of state machine                 | State Drift           | High      | 8 direct writers; state machine only governs `executionStatus`                                    | `agentDispatcher.js:312`; `SdlcWorkflowService.js:2026`; `markTaskFailed:535`; `handleTaskTimeout:562`; `cancelTask:1718`; `sweepStale:160` | Multiple                                                  | Phase 3 (Bucket D)    |
| DR-013   | `versionStatus` ↔ `executionStatus` desync            | State Drift           | High      | Independent writes; default `'committed'` is a footgun                                         | `SdlcWorkflowService.js:321, 495`; `Task.commitTask:214-220`; `schema.prisma:75`                                         | Multiple                                                  | Phase 3 (Bucket D)    |
| DR-014   | `recoverInterruptedGates` illegal transition          | State Drift           | Critical  | Every boot with `awaiting_gate` task throws inside `_runAgent`; user is never re-prompted         | `SdlcWorkflowService.js:1777-1784, 1787-1798`; `agentDispatcher.js:312-316`; `taskLifecycleService.js:11-21`               | `SdlcWorkflowService.recoverInterruptedGates`               | Phase 3 (Bucket D)    |
| DR-015   | `PipelineSession.status='running'` stuck              | State Drift           | Medium    | No failure path; stuck sessions inflate `countActive` until manual cleanup                       | `SdlcWorkflowService.js:558`; `releaseManager.js:168`; `PipelineSession.js:48-59`                                        | Multiple                                                  | Phase 3 (Bucket D)    |
| DR-016   | `pipeline_completed` persistence asymmetry            | Event Drift           | Critical  | Reconnect / audit-trail / dashboard miss terminal event                                          | `releaseManager.js:170-186`                                                                                             | `releaseManager.submitReleaseDecision`                       | Phase 3 (Bucket B)    |
| DR-017   | Three EventTypes have no producer                     | Event Drift           | Medium    | Discriminated union overstates surface; dormant on FE side                                       | `eventEnvelope.js:10-23`; `frontend/dto/event.ts:6-19`                                                                   | None                                                      | Phase 4 (Bucket B)    |
| DR-018   | `session_resumed` allocates sequence per reconnect    | Event Drift           | Low       | Counter leaks; idempotency unaffected                                                            | `SdlcController.streamPipelineStatus:367`                                                                              | `SdlcController.streamPipelineStatus`                       | Phase 4 (Bucket B)    |
| DR-019   | SSE replay drops legacy / non-canonical rows         | Event Drift           | High      | History truncates silently; legacy data invisible                                               | `SdlcController.js:340-357`                                                                                             | `SdlcController.streamPipelineStatus`                       | Phase 3 (Bucket B)    |
| DR-020   | `authService.js` dead                                | Dead Architecture     | Low       | Dormant; dormant dependencies increase attack surface                                            | `grep -rn 'authService' backend/src`                                                                                     | `backend/src/services/authService.js`                       | Phase 5 (Bucket A)    |
| DR-021   | `agentParser.js` dead                                | Dead Architecture     | Low       | Dormant                                                                                            | `grep -rn 'agentParser' backend/src`                                                                                     | `backend/src/utils/agentParser.js`                          | Phase 5 (Bucket A)    |
| DR-022   | `validation.js` dead                                 | Dead Architecture     | Low       | Dormant                                                                                            | `grep -rn 'validation' backend/src`                                                                                      | `backend/src/middleware/validation.js`                      | Phase 5 (Bucket A)    |
| DR-023   | `arch_runtime.js` + 5 scripts dead                    | Dead Architecture     | Low       | Drift; never run                                                                                  | `backend/arch_runtime.js`; `backend/scripts/{cancelTimeoutSmoke,realRunnerSmoke,resumeGateSmoke,spikeClaudeAgentSdk,sseReplaySmoke,staleWorkerSmoke}.js` | `backend/arch_runtime.js`, `backend/scripts/*.js` | Phase 5 (Bucket A)    |
| DR-024   | Legacy `submitGateDecision` path active              | Dead / Legacy Flow    | Medium    | Reachable; no `decisionId`; bypasses structured HITL                                            | `routes/sdlc.js:35`; `SdlcController.js:151-178`; `SdlcWorkflowService.js:185-231`                                        | `SdlcWorkflowService.submitGateDecision`                    | Phase 4 (Bucket C)    |
| DR-025   | `releaseGate.canDecide` always `true`                 | Contract Drift        | Medium    | RBAC dead branch under bypass                                                                     | `SdlcWorkflowService.js:1212-1213`                                                                                      | `SdlcWorkflowService.getWorkflowStatus`                     | Phase 3 (Bucket D)    |
| DR-026   | `HitlDecision.reviewerId` always `'local-user-id'`    | Ownership Drift       | Medium    | Audit trail cannot distinguish reviewers                                                          | `authMiddleware.js:1-10`; multiple create sites                                                                         | All `HitlDecision.create` callers                            | Phase 3 (Bucket D)    |
| DR-027   | `useUiStore` actions unused (toggleSidebar, etc.)    | Dead Architecture     | Low       | Dead store actions                                                                                | `useUiStore.ts:39, 51-58, 79`; `grep` returns no consumers                                                              | `frontend/src/store/useUiStore.ts`                          | Phase 5 (Bucket A)    |
| DR-028   | `useWorkflowStore.cleanupSession`, `resetAll` unused  | Dead Architecture     | Low       | Dead store actions                                                                                | `useWorkflowStore.ts:48-49, 224-249`                                                                                   | `frontend/src/store/useWorkflowStore.ts`                    | Phase 5 (Bucket A)    |
| DR-029   | `quality_summary.coverage_percentage` placeholder     | Contract Drift        | Low       | `commitSha: 'see session.repoInfo'` literal in `pipeline_completed` payload                     | `releaseManager.js:178-184`                                                                                             | `releaseManager.submitReleaseDecision`                       | Phase 4 (Bucket B)    |

---

## Risk roll-up

- **Critical**: 3 (DR-007, DR-014, DR-016 — all impact normal user
  operation).
- **High**: 6 (DR-001, DR-002, DR-004, DR-010, DR-012, DR-013,
  DR-019). DR-019 is on the wire continuity boundary.
- **Medium**: 12.
- **Low**: 8.

Total: **29 drift items**. After deduplication of those fully
covered by `03_PIPELINE_GAPS.md` (Phase-1 audit), the unique items
introduced by Phase 2 are:

- DR-001 (release-flow legacy path), DR-002 (release-flow asymmetry),
  DR-003 (PendingGate dual write on release), DR-005, DR-008, DR-009,
  DR-010, DR-011, DR-013, DR-015, DR-017, DR-018, DR-019, DR-024,
  DR-025, DR-026, DR-027, DR-028, DR-029.

23 unique items.

---

## Suggested repair phase order

Bucket assignments:

- **Bucket A — Safe** (DR-020, DR-021, DR-022, DR-023, DR-027, DR-028):
  delete or quarantine. No live behaviour changes. Phase 5 (cleanup).
- **Bucket B — Needs Contract Review** (DR-005, DR-006, DR-007,
  DR-008, DR-009, DR-016, DR-017, DR-018, DR-019, DR-029): requires
  Phase-3 contract decisions. Phase 3 first.
- **Bucket C — Needs Architecture Decision** (DR-002, DR-003, DR-010,
  DR-011, DR-001, DR-024): requires ownership consensus. Phase 4
  after Phase 3.
- **Bucket D — High Regression Risk** (DR-004, DR-012, DR-013, DR-014,
  DR-015, DR-025, DR-026): state-machine / authorization changes.
  Phase 3 with rollback plan; the auth bypass means most of these
  cannot be observed in dev.

The matrix's "Suggested Phase" column reflects this. Phase 3 may
re-prioritise.