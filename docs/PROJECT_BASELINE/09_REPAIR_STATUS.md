# 09 — Repair Status

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document.
> **Source of truth:** All OBS phase verification reports
> (OBS-1..OBS-9), the OBS-1 master repair backlog
> (`docs/OBS1/PHASE3-repair-backlog/01_MASTER_BACKLOG.md`).

---

## Status Legend

- **CLOSED** — drift or repair landed; verified; frozen.
- **DEFERRED** — drift or repair explicitly carried forward to a
  future OBS phase, with a documented owner and blocking dependency.
- **REJECTED** — drift or repair filed but determined to be either
  a non-issue, a dormant feature, or otherwise out of scope.
- **OPEN** — drift or repair filed and not yet closed or deferred.
  No OPEN items remain.

---

## OBS-1 Repair Roll-Up

| Repair ID | Severity | Status | Notes |
| --------- | :------: | :----: | ----- |
| R-01 (D-1) | Critical | CLOSED | OBS-01.10 R-25 — `SdlcWorkflowService.toPhaseStatus` reads `Task.executionStatus`. |
| R-02 (D-7..D-9) | High | CLOSED | OBS-01.10 R-24 — `taskLifecycle.publishLifecycle` emits `role: task.type`. |
| R-03 | Low | CLOSED | OBS-01.10 R-23 — per-event lifecycle mappers patch `pipelinePhases`. |
| R-04 | Low | CLOSED | OBS-01.10 R-15 — `SessionRail.PHASE_DOT_COLORS` removed. |
| R-15 | Low | CLOSED | SessionRail local colour map removed (R-15). |

---

## OBS-2 Workflow Drifts

| Drift | Severity | Status | Notes |
| ----- | :------: | :----: | ----- |
| D-W1 | High | CLOSED | Patch W-B — `submitGateDecision`. |
| D-W2 | High | CLOSED | Patch W-B — `submitStructuredDecision`. |
| D-W3 | High | CLOSED | Patch W-B — `_requireApprovedTask`. |
| D-W4 | High | CLOSED | Patch W-D — `mapPhase.status`. |
| D-W5 | Critical | CLOSED | Patch W-A — `deriveCurrentPhase`. |
| D-W6 | High | CLOSED | Patch W-C — `getFinalReviewPacket.phases`. |
| D-W7 | Medium | CLOSED | Patch W-E — `workflowOrchestrator` dedup. |
| D-W8 | Medium | CLOSED | Patch W-F — chain-advance guard. |
| D-W9 | High | DEFERRED | OBS-AGENT scope — `agentDispatcher.js:442` legacy `PENDING_TOOL_APPROVAL` write. **Owner:** OBS-AGENT. **Blocking dependency:** `SdlcWorkflowService.resumeTask` / `getPendingToolApprovals` reads legacy. Filed as D-A2 in OBS-3. |
| D-W10 | High | CLOSED | Patch W-D — `mapPhase.status` (same as D-W4). |

---

## OBS-3 Agent Drifts

| Drift | Severity | Status | Notes |
| ----- | :------: | :----: | ----- |
| D-A1 | High | CLOSED | Patch AG-D — removed legacy `'processing'` write. |
| D-A2 | High | DEFERRED | **Owner:** OBS-AGENT. **Blocking dependency:** OBS-02 contract amendment required for `PENDING_TOOL_APPROVAL` → canonical gate. Same as OBS-2 D-W9. |
| D-A3 | Medium | CLOSED | Patch AG-E — double-mark race guard (`terminalHandled` flag). |
| D-A4 | Low | REJECTED | Legacy `status` check in `markTaskFailed:485` is defensible — canonical check at line 491 covers the same case. |
| D-A5 | High | CLOSED | Patch AG-B — `handleTaskTimeout` writes `'timeout'`. |
| D-A6 | Medium | DEFERRED | **Owner:** OBS-AGENT. **Blocking dependency:** codex path is dormant (`EXECUTION_PATH=claude-code` is canonical per OBS-9). Multi-checkpoint emission in codexRunner is a larger change. |
| D-A7 | Low | REJECTED | `gateClock` and `toolCalls` propagation verified — false alarm. |
| D-A8 | Low | REJECTED | `gateClock` IS used at line 433/439. |
| D-A9 | Low | REJECTED | Non-validated roles bypass — intentional design. |
| D-A10 | Medium | CLOSED | Patch AG-G — legacy LangChain path documented. |
| D-A11 | None | REJECTED | `toolCalls` propagation verified. |
| D-A12 | None | REJECTED | `gateClock` IS used. |
| D-A13 | High | CLOSED | Patch AG-C — `sweepStale` writes correct terminal. |
| D-A14 | Low | REJECTED | Silent SSE chunk parse failures — intentional. |

---

## OBS-4 Observability Drifts

| Drift | Severity | Status | Notes |
| ----- | :------: | :----: | ----- |
| D-O1 | High | CLOSED | Patch O-A — `agentDispatcher` logger coverage. |
| D-O2 | High | DEFERRED | **Owner:** OBS-01 amendment. **Blocking dependency:** SSE envelope `requestId` touches OBS-01 frozen wire shape. |
| D-O3 | Medium | CLOSED | Patch O-G — `runtime_log` persisted to FE timeline. |
| D-O4 | High | DEFERRED | **Owner:** OBS-02 amendment. **Blocking dependency:** `SdlcWorkflowService._saveAgentData` + `_recordApprovedHandoff` parts touch OBS-02 frozen `SdlcWorkflowService`. Partial Patch O-B (gateBridge) landed. |
| D-O5 | Medium | DEFERRED | **Owner:** OBS-02 amendment. **Blocking dependency:** gate audit in-memory only; touches OBS-02 frozen `SdlcWorkflowService`. |
| D-O6 | High | CLOSED | Patch O-C — Sentry DSN guard. |
| D-O7 | Medium | CLOSED | Patch O-C — Sentry sample rate env-driven. |
| D-O8 | Medium | CLOSED | Patch O-D — `sseClient` consolidated logger helper. |
| D-O9 | Medium | CLOSED | Same as D-O3. |
| D-O10 | Medium | DEFERRED | **Owner:** OBS-01 amendment. **Blocking dependency:** `taskLifecycleService` silent — touches OBS-01 frozen surface. |
| D-O11 | Low | REJECTED | `AgentService` legacy LangChain — dormant per OBS-3 D-A10. |
| D-O12 | Medium | DEFERRED | **Owner:** OBS-AGENT. **Blocking dependency:** `claudeCodeRunner` silent — agent subsystem scope. |
| D-O13 | Low | CLOSED | Patch O-E — `errorHandler` logger. |
| D-O14 | Medium | DEFERRED | **Owner:** future OBS. **Blocking dependency:** no metrics endpoint — requires new controller method + Prometheus format. Larger than other patches. |
| D-O15 | Low | CLOSED | Patch O-F — `archAskEnforcer` debug log. |

---

## OBS-5 HITL Drifts

| Drift | Severity | Status | Notes |
| ----- | :------: | :----: | ----- |
| D-1 | Critical | CLOSED | Patch H-A — `releaseManager` calls `gateBridge.resolveGate`. |
| D-2 | Critical | CLOSED | Patch H-A — `gate_resolved` envelope fires on every release decision. |
| D-3 | High | CLOSED | Patch H-D — `getAllInterventions` dispatches via `toGateType(role, kind)`. |
| D-4 | High | DEFERRED | **Owner:** OBS-AGENT. **Blocking dependency:** `_resumeAgentStream` legacy tool-gate re-attach path uses `Task.status === 'PENDING_TOOL_APPROVAL'` and does NOT publish `gate_pending`. The agentServer contract must change to publish `gate_pending` envelopes whenever it returns `requires_action`. |
| D-5 | High | CLOSED | Patch H-E — `resolveApproval` refuses output_review / release with HTTP 400. |
| D-6 | High | CLOSED | Patch H-C — `submitStructuredDecision` resolves in-memory output_review gate. |
| D-7 | High | CLOSED | Patch H-C — `submitGateDecision` resolves in-memory output_review gate. |
| D-8 | High | CLOSED | Same as D-1. |
| D-9 | Medium | DEFERRED | **Owner:** OBS-6 amendment. **Blocking dependency:** narrow audit-race window — true `prisma.$transaction` across `HitlDecision.create` + `gateBridge.resolveGate` requires restructuring `PendingGate.resolve` to live in the model layer. Patch H-F narrows the window (write HitlDecision before resolveGate). |
| D-10 | Medium | CLOSED | Patch H-G — output_review / release get `ttl=0`. |
| D-11 | Medium | CLOSED | Patch H-D — `release` gate payload now passes through `evidence` + `repoContext`. |
| D-12 | Medium | CLOSED | Patch H-I — `codexRunner` writes `HitlDecision` audit row. |
| D-13 | Medium | CLOSED | Patch H-H — stable decisionId keyed on `(sessionId, gateId)`. |
| D-14 | Medium | CLOSED | Patch H-J — ordering invariant documented. |
| D-15 | Low | CLOSED | Patch H-K — `PendingGate.create` UPSERT guard. |
| D-16 | Low | CLOSED | Patch H-C — `_handleGateRejection` resolves in-memory output_review gate. |
| D-17 | Low | CLOSED | Same as D-1. |
| D-18 | Low | CLOSED | Patch H-B — release gate uses sentinel taskId `release-<sessionId>`. |

---

## OBS-6 UI Drifts

| Drift | Severity | Status | Notes |
| ----- | :------: | :----: | ----- |
| D-U1 | Critical | CLOSED | Patch U-A — `skipped.background` foreground `/40`. |
| D-U2 | High | CLOSED | Patch U-G — `gate_pending` amber-300 + Clock; `awaiting_review` amber-200 + AlertCircle. |
| D-U3 | High | CLOSED | Patch U-B — `SESSION_STATUS_VISUAL.awaiting_release` indigo. |
| D-U4 | High | CLOSED | Patch U-C — 3 session-status pills route through `SESSION_STATUS_VISUAL`. |
| D-U5 | High | CLOSED | Patch U-D — `CONNECTION_VISUAL` consumed by 3 surfaces. |
| D-U6 | High | CLOSED | Patch U-F — `HISTORY_DECISION_VISUAL.answer` cyan. |
| D-U7 | High | CLOSED | Patch U-E — `GATE_TYPE_VISUAL` keyed on `gate.kind`. |
| D-U8 | Medium | CLOSED | Patch U-H — `OUTPUT_REVIEW_VISUAL`. |
| D-U9 | Medium | CLOSED | Patch U-I — `QUESTION_VISUAL`. |
| D-U10 | Medium | CLOSED | Patch U-J — `TOOL_GATE_VISUAL`. |
| D-U11 | Medium | CLOSED | Patch U-K — `<ApproveRejectButtons>` shared. |
| D-U12 | Medium | CLOSED | Patch U-C — `OverviewPage.SessionStatusIcon`. |
| D-U13 | Medium | CLOSED | Patch U-D — `connecting`/`connected` use `animate-pulse`. |
| D-U14 | Medium | CLOSED | Patch U-L — `<ActionSpinner>` shared. |
| D-U15 | Medium | CLOSED | Patch U-M — `deriveAgentRuntimeState` delegates. |
| D-U16 | Low | CLOSED | Patch U-Q — per-agent icon colour is decorative; no code change. |
| D-U17 | Low | CLOSED | Patch U-P — `splitRunningTasks` extracted. |
| D-U18 | Low | CLOSED | Patch U-N — `phaseStatusFor` routes through selector. |
| D-U19 | Low | CLOSED | Patch U-O — `mapGateResolved` clears `pendingReleaseGateId`. |
| D-U20 | Low | DEFERRED | **Owner:** future OBS. **Blocking dependency:** `OverviewPage.SessionMonitorCard` reads `agentStates[runningAgent].currentAction` directly — per-event detail, not a runtime visual; acceptable in `OverviewPage`. |

---

## OBS-7 Document Drifts

| Drift | Severity | Status | Notes |
| ----- | :------: | :----: | ----- |
| D-D1 | Critical | CLOSED | Patch D-A — kitchen-sink split into 4 domain files. |
| D-D2 | Critical | CLOSED | Patch D-B — upload response full envelope. |
| D-D3 | Critical | CLOSED | Patch D-C — single Prisma update per move. |
| D-D4 | High | CLOSED | Patch D-D — `DocumentService.updateStatus` deleted. |
| D-D5 | High | CLOSED | Patch D-D — `DocumentModel.update` deleted. |
| D-D6 | High | CLOSED | Patch D-E — FE status enum narrowed. |
| D-D7 | High | CLOSED | Patch D-F — `docMgmtPreviewCache` cleared on project switch. |
| D-D8 | High | CLOSED | Patch D-G — `listDocuments` null/undefined → empty. |
| D-D9 | High | CLOSED | Patch D-H — Multer cap reads `MAX_FILE_SIZE`. |
| D-D10 | High | CLOSED | Patch D-I — `detectFileKind` helper. |
| D-D11 | Medium | CLOSED | Patch D-J — path-traversal 403. |
| D-D12 | Medium | CLOSED | Patch D-K — `getPreviewUrl` one DB read. |
| D-D13 | Medium | CLOSED | Patch D-L — `upsertDocument` dedup. |
| D-D14 | Medium | CLOSED | Patch D-M — `useApiActions` narrowed. |
| D-D15 | Medium | CLOSED | Patch D-N — rename collision 409. |
| D-D16 | Medium | CLOSED | Patch D-O — extension from mime. |
| D-D17 | Medium | DEFERRED | **Owner:** future OBS. **Blocking dependency:** multi-tenant signed-URL work; auth is single-user today per `CLAUDE.md §4`. Multi-tenant auth is a larger workstream. |
| D-D18 | Medium | CLOSED | Patch D-Q — DB row first, file second; cleanup on failure. |
| D-D19 | Medium | CLOSED | Patch D-R — 6 new tests. |
| D-D20 | Low | CLOSED | Same as D-D1. |
| D-D21 | Low | CLOSED | Same as D-D6. |
| D-D22 | Low | REJECTED | `DocPreviewCacheItem` already declared at `useAppStore.ts:9`. |
| D-D23 | Low | CLOSED | Patch D-T — Prisma index added. |
| D-D24 | Low | CLOSED | Patch D-U — EXDEV fallback. |
| D-D25 | Low | CLOSED | Patch D-V — binary 415. |

---

## OBS-8 Demo Drifts

| Drift | Severity | Status | Notes |
| ----- | :------: | :----: | ----- |
| D-X1 | Critical | CLOSED | 4 `/demo/*` routes + `demoBoardService.js` deleted. |
| D-X2 | Critical | CLOSED | Patch D-A. |
| D-X3 | Critical | CLOSED | Patch D-B — `getMockScenario` real env. |
| D-X4 | Critical | CLOSED | Patch D-C — missing-dir `mock-data` loader removed. |
| D-X5 | Critical | CLOSED | Patch D-D — dead scenario helpers deleted. |
| D-X6 | High | CLOSED | `process.env.MOCK_SCENARIO` honored at `SdlcController.js:625`. |
| D-X7 | High | REJECTED | Only one profile exists; no FE selector; drift moot once FE cleaned. |
| D-X8 | High | CLOSED | Patch D-E — env flags declared. |
| D-X9 | High | CLOSED | Patch D-F — FE wrappers removed. |
| D-X10 | High | CLOSED | Patch D-F — stale comments removed. |
| D-X11 | High | CLOSED | Patch D-F — `sideEffects: false` added. |
| D-X12 | Medium | CLOSED | Patch D-F — `BOARD_TIMEOUT_MS` removed. |
| D-X13 | Medium | CLOSED | Service deleted → drift implied gone. |
| D-X14 | Medium | CLOSED | Service deleted. |
| D-X15 | Medium | CLOSED | FE union `mode` removed with `DemoBoard`. |
| D-X16 | Medium | CLOSED | Patch D-G — `normalizeForVagueCheck`. |
| D-X17 | Medium | CLOSED | Patch D-H — comment rewritten. |
| D-X18 | Medium | CLOSED | Patch D-H — `EXECUTION_PATH=mock` claim removed. |
| D-X19 | Medium | CLOSED | `MOCK_REVIEW_STAGES` deleted. |
| D-X20 | Low | CLOSED | Patch D-C / D-H — docstring updated. |
| D-X21 | Low | CLOSED | `mock-data` reference removed from `agentDispatcher.js`. |
| D-X22 | Low | CLOSED | FE type/runtime shape mismatch removed. |
| D-X23 | Low | CLOSED | `mode` union removed with `DemoBoard`. |
| D-X24 | Low | CLOSED | `BOARD_TIMEOUT_MS` removed. |
| D-X25 | Low | CLOSED | Patch D-I — `_demoFlags.js`. |
| D-X26 | Low | CLOSED | Patch D-J — named imports. |
| extra-1 | Low | CLOSED | Controller-local `DEFAULT_MOCK_SCENARIO` literal removed. |

---

## OBS-9 Integration Drifts

| Drift | Severity | Status | Notes |
| ----- | :------: | :----: | ----- |
| I-X1 | Critical | CLOSED | `EXECUTION_PATH=claude-code` aligned. |
| I-X2 | Critical | CLOSED | `AGENTS_BASE_URL` removed from BE env. |
| I-X3 | Critical | CLOSED | `realClaudeCodeSmoke.js` provides end-to-end verification. |
| I-X4 | High | CLOSED | Comment updated; `MOCK_SCENARIO` not relied on. |
| I-X5 | High | CLOSED | 3 dead imports removed. |
| I-X6 | High | CLOSED | `EXECUTION_PATH` getter removed. |
| I-X7 | High | CLOSED | Comment-only "INTENTIONAL" marker. |
| I-X8 | High | CLOSED | `executeGitAction` returns canonical envelope. |
| I-X9 | High | CLOSED | `sdlcLegacy.ts` deleted. |
| I-X10 | Medium | DEFERRED | **Owner:** future OBS. **Blocking dependency:** barrel `api.ts` still re-exports 6 sub-files with zero consumers; trimming requires per-consumer audit. |
| I-X11 | Medium | CLOSED | `useAppStore.sseAbort` removed. |
| I-X12 | Medium | CLOSED | Three `import type * as api` → named imports. |
| I-X13 | Medium | CLOSED | `intent-agent` removed from 4 `sdlcConstants` tables. |
| I-X14 | Medium | CLOSED | `ARCHITECTURE_GATE`, `ARCH_OUTPUT_REVIEW` removed. |
| I-X15 | Medium | CLOSED | `architecture-agent` added to `AGENT_POLICY`. |
| I-X16 | Medium | REJECTED | Dev-only legacy `/dev/tasks/...approve-tool` route; OBS-8 deliberately kept. |
| I-X17 | Medium | CLOSED | `socket.io-client` removed. |
| I-X18 | Medium | CLOSED | `GEMINI_API_KEY` define removed. |
| I-X19 | Low | REJECTED | Cosmetic — `ARCH_MAX_ASK_RETRIES=3` chain is correct. |
| I-X20 | Low | DEFERRED | **Owner:** future OBS. **Blocking dependency:** 3 dead event types in `eventEnvelope.js` — contract-level change to OBS-01 frozen wire shape. |
| I-X21 | Low | CLOSED | "real SDK is default" comment tightened. |
| I-X22 | Low | CLOSED | `~/.codex/config.toml` mount removed. |
| I-X23 | Low | DEFERRED | **Owner:** future OBS-10. **Blocking dependency:** whitelist trim requires `agentContract.REQUIRED_OUTPUT_KEYS` audit (30+ keys per role). |
| I-X24 | Low | DEFERRED | **Owner:** future i18n OBS. **Blocking dependency:** locale bundle cleanup touches live translations; `chatbox.*` gap is harmless (fallback literals work). |
| I-X25 | Low | REJECTED | `docs/PROGRESS.md` already removed. |
| I-X26 | Low | REJECTED | `AgentService.routeRework` is the only legacy wire; kept per project history. |

---

## Master Repair Roll-Up (R-001 .. R-047)

The OBS-1 master repair backlog
(`docs/OBS1/PHASE3-repair-backlog/01_MASTER_BACKLOG.md`) catalogues
47 issues. Their frozen-status roll-up:

| Status | Count | Repair IDs |
| :----: | :---: | ---------- |
| CLOSED (frozen by OBS-1..OBS-9) | 32 | R-002, R-003, R-005, R-007, R-008, R-009, R-014, R-015, R-016, R-017, R-018, R-019, R-020, R-021, R-022, R-023, R-025, R-026, R-027, R-028, R-029, R-031, R-032, R-033, R-034, R-035, R-036, R-037, R-038, R-039, R-040, R-043, R-045, R-046 |
| CLOSED with documented limitations | 5 | R-004 (dev-only, no production risk), R-010 (functional; client-driven), R-011 (UI surface removed), R-024 (RBAC stub — auth bypassed per CLAUDE.md §4), R-044 (`versionStatus` schema default; mirrors R-25 for `executionStatus`) |
| CLOSED / frozen in OBS-1 + OBS-5 | 3 | R-006 (auth bypassed), R-013 (reviewerId is dummy local user), R-042 (in-memory + DB row; `findPersisted` recovery) |
| CLOSED with PR release path hardening | 1 | R-041 (`pipeline_completed` is owned by `releaseManager.submitReleaseDecision` APPROVE branch; `gate_resolved` belt-and-suspenders fallback per OBS-5 H-A) |
| CLOSED with mirror to FE | 2 | R-001 (`pipeline_completed` persists via `gate_resolved` path), R-012 (sequence leak on rolled-back transaction — never observed in production) |
| DEFERRED | 0 | None remain deferred at the OBS-1 R-NNN level (R-NNN items below CLOSED threshold are now superseded by OBS-2..OBS-9 drift IDs) |

---

## Deferred Drift Roll-Up (current)

| Drift | Owner | Blocking dependency |
| ----- | ----- | ------------------- |
| D-W9 / D-A2 | OBS-AGENT | `PENDING_TOOL_APPROVAL` legacy write at `agentDispatcher.js:441-443` requires OBS-02 amendment to `SdlcWorkflowService.resumeTask` / `getPendingToolApprovals`. |
| D-A6 | OBS-AGENT | codex path rich-runtime wire; codex path is dormant (`EXECUTION_PATH=claude-code` is canonical per OBS-9). |
| D-O2 | OBS-01 amendment | SSE envelope `requestId` — touches OBS-01 frozen wire shape. |
| D-O4 (partial) | OBS-02 amendment | `SdlcWorkflowService._saveAgentData` + `_recordApprovedHandoff` parts. |
| D-O5 | OBS-02 amendment | Gate audit in-memory only. |
| D-O10 | OBS-01 amendment | `taskLifecycleService` silent — touches OBS-01 frozen surface. |
| D-O12 | OBS-AGENT | `claudeCodeRunner` silent — agent subsystem scope. |
| D-O14 | future OBS | No metrics endpoint — larger workstream. |
| D-4 | OBS-AGENT | `_resumeAgentStream` legacy tool-gate re-attach path; agentServer contract must change. |
| D-9 | OBS-6 amendment | Narrow audit-race window — true `prisma.$transaction` requires restructuring `PendingGate.resolve`. |
| D-U20 | future OBS | `OverviewPage.SessionMonitorCard.currentAction` reads direct; per-event detail. |
| D-D17 | future OBS | Multi-tenant signed-URL — single-user auth per `CLAUDE.md §4`. |
| I-X10 | future OBS | Barrel `api.ts` re-exports 6 sub-files with zero consumers. |
| I-X20 | future OBS | 3 dead event types in `eventEnvelope.js` — contract-level change. |
| I-X23 | future OBS-10 | `_saveAgentData` whitelist trim. |
| I-X24 | future i18n OBS | Locale bundle cleanup. |

End of Repair Status.
