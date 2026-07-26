# 07 — Dead Architecture (Phase 2)

> **Status:** READ-ONLY. Inventory of legacy flows, dead endpoints,
> unused services, unused store actions, unused DTOs, duplicate
> responsibilities. No recommendations to delete.
>
> "Dead" here means "no current source path exercises this code." It
> does NOT mean "remove" — Phase 3 must decide on each item.

---

## 1. Legacy flows

### LF-1 — `submitGateDecision` legacy path

`POST /api/v1/sdlc/tasks/:task_id/gate-decision`
(`backend/src/routes/sdlc.js:35` →
`controllers/SdlcController.submitGateDecision:151-178` →
`SdlcWorkflowService.submitGateDecision:185-231`).

The canonical path is `submitStructuredDecision`
(`POST /tasks/:task_id/decision`, routes/sdlc.js:37,
`SdlcWorkflowService.submitStructuredDecision:264-336`). The legacy
path:

- does NOT carry `decisionId` (no idempotency).
- does NOT call `_recordApprovedHandoff`.
- does NOT call `_startNextAgentIfAvailable`.
- on `REQUEST_CHANGES` calls `_rerunOwningWorker` directly,
  bypassing structured HITL.

The legacy path is reachable and exercised by
`backend/tests/integration/sdlc.handoff.test.js`.

**Evidence**:
- `backend/src/routes/sdlc.js:35`
- `backend/src/controllers/SdlcController.js:151-178`
- `backend/src/services/SdlcWorkflowService.js:185-231`
- `backend/tests/integration/sdlc.handoff.test.js`

**Drift category**: legacy flow.

---

### LF-2 — `socketService.js` deletion

`backend/src/services/socketService.js` is **deleted** (`git status`
shows `D backend/src/services/socketService.js`). No current source
imports it. The transport is SSE only.

**Evidence**: `git status --short` (`D backend/src/services/socketService.js`).

**Drift category**: legacy flow.

---

### LF-3 — `_resumeAgentStream` legacy langchain path

`SdlcWorkflowService._resumeAgentStream:1387-1461` handles
`requires_action` from the OLD Python `AgentService.runAgent` SSE
stream. It writes `status:'PENDING_TOOL_APPROVAL'`
(SdlcWorkflowService.js:1440-1444) and posts to
`/v1/agent/resume` on the Python service. This path is reachable
ONLY when `EXECUTION_PATH=langchain` and `USE_MOCK_AGENTS!=true`
and `USE_MOCK_CLAUDE_CODE!=true`. The default path
(`EXECUTION_PATH=claude-code` with `USE_MOCK_CLAUDE_CODE=true`)
does not go through it.

**Evidence**:
- `backend/src/services/SdlcWorkflowService.js:1387-1461`
- `backend/src/services/agentDispatcher.js:432-471` (the
  `real agent path` SSE consumer).
- `backend/src/services/AgentService.js` (legacy HTTP bridge).

**Drift category**: legacy flow.

---

### LF-4 — `_resumeTask` / `approveToolCall`

`SdlcWorkflowService.resumeTask:1349-1364` and
`SdlcController.approveToolCall:581-595` implement the legacy
"approve tool" path that maps to `_resumeAgentStream`. Same
provenance as LF-3.

**Evidence**:
- `backend/src/services/SdlcWorkflowService.js:1349-1364`
- `backend/src/controllers/SdlcController.js:581-595`

**Drift category**: legacy flow.

---

## 2. Dead endpoints

### DE-1 — `POST /api/v1/sdlc/upload-repo`

Returns **410** `UPLOAD_REPO_REMOVED` (`SdlcController.uploadRepo:89-95`).
The folder-upload flow was removed per AIFA v2.1 §4. Still routed
(`routes/sdlc.js:25`).

**Evidence**: `backend/src/controllers/SdlcController.js:89-95`.

---

### DE-2 — `POST /api/v1/sdlc/run-po-agent`

Returns **410** `PO_AGENT_ENTRY_REMOVED` (`SdlcController.runPOAgent:76-82`).
PO is reached only via auto-advance. Still routed
(`routes/sdlc.js:28`).

**Evidence**: `backend/src/controllers/SdlcController.js:76-82`.

---

### DE-3 — `GET /api/v1/sdlc/status/:task_id`

Returns **410** `STREAM_STATUS_DEPRECATED`
(`SdlcController.streamStatus:453-462`). The canonical SSE
transport is `GET /sdlc/stream/:sessionId`. Still routed
(`routes/sdlc.js:58`).

**Evidence**: `backend/src/controllers/SdlcController.js:453-462`.

---

### DE-4 — Legacy `/api/v1/documents|folders|tree|projects|sessions/*`

These endpoints are reachable but NOT used by the SDLC pipeline. They
support the legacy "upload folder" flow that was removed (DE-1).

Specifically:
- `GET/POST/PATCH/DELETE /api/v1/projects`
- `GET/POST/PATCH/DELETE /api/v1/folders`
- `GET/POST/PATCH/DELETE/... /api/v1/documents`
- `GET /api/v1/tree`
- `GET/POST/DELETE /api/v1/sessions/:page`

The "no-op" claim: they are reachable via the legacy controllers but
the SDLC pipeline does not call them (it goes through
`SdlcWorkflowService` and `repoService` directly).

**Evidence**:
- `backend/src/routes/projects.js`
- `backend/src/routes/folders.js`
- `backend/src/routes/documents.js`
- `backend/src/routes/tree.js`
- `backend/src/routes/sessions.js`

**Drift category**: dead endpoints.

---

## 3. Unused services

### US-1 — `backend/src/services/authService.js`

A standalone password hashing / session helpers module. **Zero
importers** in current source. The router-level auth is the inline
stub at `backend/src/middleware/authMiddleware.js:1-10`.

**Evidence**:
- `grep -rn 'authService' backend/src` — only the file itself.
- `backend/src/middleware/authMiddleware.js:1-10` (bypass stub).

**Drift category**: unused service.

---

### US-2 — `backend/src/services/QualityGateService.js`

Used only by `SdlcWorkflowService._saveAgentData:1892-1903`. The
service is invoked only for `qa-agent` tasks. The exported surface
includes `evaluate(...)`; other helpers are not used externally.

**Evidence**:
- `grep -rn 'QualityGateService' backend/src` — only
  `SdlcWorkflowService.js`.
- `backend/src/services/SdlcWorkflowService.js:1892-1903`.

**Drift category**: dependency between two services only.

---

### US-3 — `backend/src/services/AgentService.js`

The HTTP bridge to the Python agents service. Reachable only when
`EXECUTION_PATH=langchain` and the user has NOT set
`USE_MOCK_AGENTS=true` and NOT set `USE_MOCK_CLAUDE_CODE=true`.
For the canonical paths (mock + claude-code), `AgentService` is
not loaded.

**Evidence**:
- `backend/src/services/AgentService.js`
- `backend/src/services/agentDispatcher.js:400-474`
  (`AgentService.runAgent` only on the langchain path).

**Drift category**: legacy bridge; not unused outright.

---

### US-4 — `backend/src/services/TreeService.js`, `ProjectService.js`,
`FolderService.js`, `DocumentService.js`, `SessionStateService.js`,
`demoBoardService.js`

Reachable through the legacy controllers (DE-4). Not on the SDLC
hot path.

**Evidence**: route map in `freeze 02_DIRECTORY_MAP.md §3-7`.

**Drift category**: legacy services.

---

## 4. Unused store actions (FE)

### USA-1 — `useUiStore.toggleSidebar` and `useUiStore.setSidebarCollapsed`

Defined in `useUiStore.ts:39, 51, 52` but `grep` shows no
read-side import of these actions in any reviewed component. Only
the `sidebarCollapsed` field is read.

**Evidence**:
- `frontend/src/store/useUiStore.ts:39, 51-52`
- `grep -rn 'toggleSidebar\|setSidebarCollapsed' frontend/src` —
  no consumers found.

**Drift category**: unused store action.

---

### USA-2 — `useUiStore.openAgentDetailDrawer` and
`useUiStore.closeAgentDetailDrawer`

Defined but no consumers in the reviewed source.

**Evidence**:
- `frontend/src/store/useUiStore.ts:54-55`
- `grep` returns no consumers.

**Drift category**: unused store action.

---

### USA-3 — `useUiStore.setSelectedAgentKey`

Defined but only `InspectorPanel` and `SessionRail` reference
`selectedAgentKey`; `setSelectedAgentKey` itself is not referenced.

**Evidence**:
- `frontend/src/store/useUiStore.ts:43, 50`
- `grep -rn 'setSelectedAgentKey' frontend/src` — no consumers.

**Drift category**: unused store action.

---

### USA-4 — `useUiStore.openReleaseDialog` and `useUiStore.closeReleaseDialog`

Defined but `releaseStatus` is read by the SdlcDashboard; the
dialog-open action is not referenced.

**Evidence**:
- `frontend/src/store/useUiStore.ts:56-57`
- `grep -rn 'openReleaseDialog\|closeReleaseDialog' frontend/src`
  — no consumers.

**Drift category**: unused store action.

---

### USA-5 — `useUiStore.resetUi`

Defined but no consumers in reviewed source.

**Evidence**:
- `frontend/src/store/useUiStore.ts:58, 79`
- `grep -rn 'resetUi' frontend/src` — no consumers.

**Drift category**: unused store action.

---

### USA-6 — `useWorkflowStore.cleanupSession` and `useWorkflowStore.resetAll`

`cleanupSession` and `resetAll` are defined in
`useWorkflowStore.ts:48-49`. `grep` shows no consumers in the
reviewed source.

**Evidence**:
- `frontend/src/store/useWorkflowStore.ts:48-49, 224-249`
- `grep -rn 'cleanupSession\|resetAll' frontend/src` — no
  consumers.

**Drift category**: unused store action.

---

## 5. Unused DTOs

### UDT-1 — `frontend/src/dto/event.ts:118` `PipelineFailedPayload`

Defined but the type discriminator `pipeline_failed` is never
produced (DR-017). The TS mirror has the same drift as the BE.

**Evidence**:
- `frontend/src/dto/event.ts:6-19, 118`
- `backend/src/dto/eventEnvelope.js:12` (BE side).

**Drift category**: orphan type.

---

### UDT-2 — `frontend/src/dto/event.ts: AgentEventPayload`

Same — see DR-017.

---

### UDT-3 — `frontend/src/services/api/types.ts` legacy types

Several types in `types.ts` (`sdlcLegacy.ts`) are reachable but the
canonical API surface is in `sdlcApi.ts`. NOT VERIFIED which types
are dead.

---

## 6. Duplicate responsibilities

### DRP-1 — Three frontend stores

`useAppStore`, `useUiStore`, `useWorkflowStore`. The split:

- `useWorkflowStore` — workflow data, SSE-driven.
- `useUiStore` — UI presentation (active session, selected tab,
  modal visibility).
- `useAppStore` — project list, current project.

These are NOT redundant. They are split by concern. But several
fields overlap (`activeSessionId` in `useUiStore` vs
`useWorkflowStore`; `currentProjectId` in `useAppStore` vs
`useWorkflowStore`).

**Evidence**:
- `frontend/src/store/useUiStore.ts`
- `frontend/src/store/useAppStore.ts`
- `frontend/src/store/useWorkflowStore.ts`

**Drift category**: candidate overlap.

---

### DRP-2 — `_recordApprovedHandoff` exists in two files

`SdlcWorkflowService._recordApprovedHandoff` (SdlcWorkflowService.js:1638-1643)
is a thin wrapper. The actual implementation lives in
`artifactManager.recordApprovedHandoff`
(`backend/src/services/artifactManager.js:83-143`). The wrapper
just passes `nextAgentFn` and `writeFileFn` callbacks.

The wrapper exists for `this`-binding reasons. Not redundant.

**Evidence**:
- `backend/src/services/SdlcWorkflowService.js:1638-1643`
- `backend/src/services/artifactManager.js:83-143`

**Drift category**: thin wrapper; not drift.

---

### DRP-3 — `gateBridge.requestGate` writes both in-memory map and DB row

Already documented (DR-010). Same dual-write pattern in
`gateBridge.resolveGate`. Not redundant — both writes are required.

**Drift category**: dual truth (already covered).

---

### DRP-4 — Two quality-gate evaluators

`gateManager.validateGateOutput` (gateManager.js:23-44) — runs the
`OUTPUT_CONTRACTS` rules; called by `_validateGateOutput`.

`QualityGateService.evaluate` (services/QualityGateService.js) — runs
a separate scoring engine; called by `_saveAgentData` for `qa-agent`
only.

The two are called for different purposes: the first is a per-role
schema/risk validator; the second is a QA-specific scoring engine.

**Evidence**:
- `backend/src/services/gateManager.js:23-44`
- `backend/src/services/QualityGateService.js`

**Drift category**: separate concerns.

---

## 7. Files at backend root that are unreachable

### FA-1 — `backend/arch_runtime.js`

`arch_runtime.js` (1638 bytes) is a top-level script that invokes
`claudeCodeRunner.runAgent` against a hand-coded feature request.
Not referenced in `package.json` `scripts`. Not a router
entrypoint. Imports `./src/agents/claudeCodeRunner`.

**Evidence**:
- `backend/arch_runtime.js`
- `grep 'arch_runtime' backend/package.json` — none.

**Drift category**: dead root script.

---

### FA-2 — `backend/scripts/cancelTimeoutSmoke.js`,
`realRunnerSmoke.js`, `resumeGateSmoke.js`, `spikeClaudeAgentSdk.js`,
`sseReplaySmoke.js`, `staleWorkerSmoke.js`

Six smoke scripts in `backend/scripts/`. Of these, only
`demoSmokeClaudeCode.js` is wired (`npm run demo:smoke`).

**Evidence**:
- `backend/package.json:9-10` (only `demo:smoke` and `demo:smoke:cc`).
- `backend/scripts/`.

**Drift category**: dead scripts.

---

## 8. NOT VERIFIED

The following could not be fully confirmed:

- Whether `useAppStore.resetAll` is reachable from any UI flow.
- Whether the legacy `/api/v1/documents|folders|tree|projects|sessions/*`
  endpoints receive traffic in production. Without runtime traces
  this is unverified.
- Whether `sdlcLegacy.ts` re-exports are used by any FE component.
- Whether `_recordGateAudit`'s envelopes reach a debug FE viewer.
- Whether `frontend/src/store/workflowSelectors.ts` is consumed by
  any current page (the file exists; the selectors may be dead).