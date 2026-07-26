# 01 — System Overview (Frozen Baseline)

> **Status:** OBSERVATION ONLY.
> No code changes. No design judgment.
> Source: current `HEAD` on branch `namw6`, captured 2026-07-15.

This document is a factual snapshot of what the repository currently contains
and how it currently operates. It does not describe intent or correctness.

---

## 1. Repository shape

The repository is a **multi-package autonomous SDLC factory** ("AIFA").

Top-level layout (relevant folders only):

| Path                | Contents                                                    |
| ------------------- | ----------------------------------------------------------- |
| `backend/`          | Node.js (Express + Prisma + SQLite) HTTP/SSE service        |
| `agents/`           | Python (LangChain + A2A / FastAPI) Agent server             |
| `frontend/`         | React (Vite + Zustand + react-i18next) dashboard            |
| `workspace/`        | On-disk per-project / per-session cloned repositories       |
| `mock-data/`        | Static deterministic mock agent outputs (loaded by backend) |
| `public/`           | Static UX-preview SVGs                                      |
| `docs/`             | Specification, plans, fixbug audits, AIFA historical notes  |

Workspace, mock-data, public, and docs exist alongside the three runnable
packages. The backend and the agents service are independently deployable.

---

## 2. Major modules (backend)

Source root: `backend/src/`

### 2.1 HTTP / entry layer
- `server.js` — composition root. Loads Sentry, CORS, request-context, mounts
  `/api/v1` routes, mounts static `/ux-previews` and `/uploads`, registers
  error handler, and on boot connects to Prisma, runs `gateBridge.markOrphanedPendingInterrupted()`,
  reclaims tasks via `taskWorker.sweepStale()`, starts the sweeper interval,
  and calls `SdlcWorkflowService.recoverInterruptedGates()`.
- `config/` — `database.js` (Prisma + SQLite WAL setup), `environment.js`
  (PORT / FRONTEND_URL / NODE_ENV), `agents.js` (Python agent URL helpers),
  `qualityGateRules.js`, `logger.js`.
- `routes/` — see `docs/engineering-freeze/05_HTTP_ENDPOINT_INVENTORY.md`.
- `middleware/` — `authMiddleware.js` (local-dummy auth bypass), `errorHandler.js`
  (ApiError + Sentry), `logger.js` (request log), `requestContext.js`
  (AsyncLocalStorage `requestId`), `validation.js`.
- `controllers/` — HTTP adapter layer. `SdlcController.js` is the largest and
  delegates almost everything to `SdlcWorkflowService`.

### 2.2 Services (business logic)
- `SdlcWorkflowService.js` — central orchestrator (class, ~2200 lines). Owns
  HITL decision paths, retry / escalation, terminal `pipeline_completed`,
  session-scoped repo lookup, gate-audit in-memory cache, and recovery of
  interrupted tasks on boot.
- `workflowOrchestrator.js` — pure orchestrator helpers used by
  `SdlcWorkflowService`. Functions: `runArchitectureAgent`, `runPOAgent`,
  `runUXAgent`, `runDEVAgent`, `runQAAgent`, `startNextAgentIfAvailable`,
  `requireUpstreamArtifact`. Each accepts a `deps` object so the orchestrator
  does not depend on the service instance.
- `agentDispatcher.js` — execution plumbing. `buildMockOutput`,
  `runClaudeCodePath`, `runAgent` (selects execution path by
  `EXECUTION_PATH` env: `codex` / `claude-code` / mock), `markTaskFailed`,
  `handleTaskTimeout`.
- `agentContract.js` — small shared I/O boundary. Defines
  `AGENT_CONTRACT_VERSION = 'agent-io.v5'`, `REQUIRED_OUTPUT_KEYS` per role,
  `assertOutputConforms`, `assertProjectDefinitionConforms`,
  `normalizeClarificationQuestions`.
- `gateBridge.js` — in-memory pending-gate registry plus `PendingGate`
  persistence. Public surface: `requestGate`, `resolveGate`, `hasPending`,
  `getPending`, `listPending`, `listInterrupted`, `findPersisted`,
  `markOrphanedPendingInterrupted`. Persists `PendingGate` rows; transitions
  task via `taskLifecycle.transitionIfPresent`.
- `gateManager.js` — pure validation helpers: `validateGateOutput`,
  `evaluateGatePolicy`, `threeLayerSummary`, `getPendingQuestionGate`,
  `layerOf`. Reads from `OUTPUT_CONTRACTS`.
- `taskLifecycleService.js` — execution state machine. `transition`,
  `transitionIfPresent`, `record`. Owns the per-task state machine
  (`queued / dispatched / running / awaiting_gate / completed / failed /
  cancelled / timeout`). Allocates the canonical envelope via
  `publishEvent` and persists it as `AgentEvent` in the same DB transaction.
- `taskWorkerService.js` — per-process worker primitives. `beginRun`,
  `endRun`, `claim`, `heartbeat`, `release`, `pauseBudget`, `resumeBudget`,
  `sweepStale`, `startSweeper`. Gate-aware budget (paused during human
  gates). `sweepStale` reclaims tasks with expired heartbeats.
- `eventBus.js` — pure pub/sub transport (session + project scopes).
- `eventPublisher.js` — facade that allocates a sequence, calls
  `createEnvelope`, and publishes via `eventBus`. The single entry point
  producers may use.
- `sequence.js` — per-session monotonic counter, seeded from the highest
  `AgentEvent.sequence` for the session on first allocation.
- `dto/eventEnvelope.js` — pure envelope builder.
- `repoService.js` — repo cloning, path resolution, git plumbing
  (`execFile` with arg arrays), `validateRepoUrl`, secret-pattern scanning,
  `assertRepoSafe`, `commitAndPushOnApprove`, `getSessionRepoInfo`.
- `repoIndexService.js` — shallow directory-tree index for the
  Architecture Agent. Cached per (path, revision, mtime).
- `scopeResolver.js` — pure: `(repoIndex, featureRequest) → scopeHints`
  (languageHint, targetFolders, ignoreGlobs, confidence).
- `releaseManager.js` — `submitReleaseDecision`, `buildReleaseEvidenceSummary`.
  Pure packaging + publishing on APPROVE (writes `final.md`, `qa-report.md`,
  `audit-trail.json` into `sessions/<slug>-<shortId>/` inside the user's repo,
  commits, pushes best-effort, flips session to `completed`, emits
  `pipeline_completed`).
- `artifactManager.js` — `buildContextFromArtifacts`, `writeArtifactToFile`,
  `recordApprovedHandoff`.
- `workflowReport.js` — release-bundle writer (`final.md` ten sections per
  spec §13, `qa-report.md`, `audit-trail.json`, `findPreviousBundle`,
  `removeGitTracked`).
- `workflowQueries.js` — read-only query helpers and shared utilities
  (`contentHash`, `resolveArtifactContent`, `buildTaskResult`,
  `formatArtifactForClient`).
- `workflowReport.js`, `workflowHelpers.js`, `riskClassifier.js` — small
  pure helpers.
- `archAskEnforcer.js` — orchestrator for mandatory AskUserQuestion
  enforcement loop. Applies to every role in `ENFORCED_ROLES`
  (`architecture-agent`, `po-agent`, `ux-agent`, `dev-agent`, `qa-agent`).
  Re-runs the runner up to `ASK_RETRY_CAPS_BY_ROLE[role]` times if
  BLOCKER violations remain after a run that did NOT call
  `AskUserQuestion`.
- `qaGate.js` — shared `qaGatePassed(task)` helper used by both the
  output-review resolver and the release manager.
- `toGateType.js` — `(role, kind) → GateType` mapping. Per-role `*_OUTPUT_REVIEW`
  for output-review, `*_CLARIFY` for question, `DEV_FILE_GATE` for tool
  on dev, `FINAL_RELEASE` for release.
- `sdlcConstants.js` — single source of truth for SDLC constants:
  `AGENT_GATES`, `OUTPUT_REVIEW_GATE_TYPE`, `CLARIFY_GATE_TYPE`,
  `NEXT_AGENT`, `NODE_TARGET`, `REWORK_TARGETS`, `GATE_MODE`,
  `DEFAULT_GATE_MODE`, `GATE_CONFIG` (incl. `AUTO_APPROVE_CONFIDENCE=0.8`,
  `BLOCKING_SEVERITY`, `RELEASE_BLOCKING_SEVERITIES`), `OUTPUT_CONTRACT_VERSION`
  (`gate-output.v5`), `OUTPUT_CONTRACTS`, retry caps, etc.
- `AgentService.js` — thin HTTP bridge to the Python agents service
  (`runAgent`, `routeRework`, `resolveUnknowns`, `getStreamWebSocketUrl`).
- `QualityGateService.js` — QA quality gate scoring/complexity/rules engine.
  Used by `SdlcWorkflowService._saveAgentData` only for `qa-agent` tasks.
- `authService.js` — standalone password hashing/session helpers (NOT wired
  into any route).

### 2.3 Agents (local runner layer)
- `agents/claudeCodeRunner.js` — local Claude Agent SDK adapter (uses local
  `claude login`). Builds role prompt from `prompts/<role>.prompt.md`,
  wires `canUseTool` through `claudePermissionDispatcher.dispatch`, parses
  fenced JSON, enforces `agent-io.v5` contract, supports transient-error
  retries and a `repairRawOutput` fallback. Also routes to mock output when
  `USE_MOCK_CLAUDE_CODE=true`.
- `agents/codexRunner.js` — Codex CLI adapter. Same envelope shape as
  claude-code but built around `child_process.spawn`.
- `agents/claudePermissionDispatcher.js` — Claude SDK `canUseTool` callback
  dispatcher. Returns `allow` / `deny` / `updatedInput` based on
  `riskClassifier.classifyAction`. Persists `gate_pending` via
  `gateBridge.requestGate`.

### 2.4 Models
- `models/Task.js`, `AgentArtifact.js`, `AgentEvent.js`, `HitlDecision.js`,
  `PendingGate.js`, `PipelineSession.js`, `Project.js`, `Document.js`,
  `Folder.js`, `Testcase.js`, `SessionState.js`, `FeatureBacklog.js`.
  All Prisma-backed, all defined under `backend/prisma/schema.prisma`.

---

## 3. Major modules (agents / Python)

Source root: `agents/` (top-level) and `agents/src/`.

- `agents/main.py` — FastAPI entry. Exposes `/v1/agent/run`,
  `/v1/agent/resume`, `/v1/agent/route-rework`, and likely SSE streaming
  endpoints. (Path / imports reviewed indirectly through
  `backend/src/services/AgentService.js` and `agents/src/workflows/main_pipeline.py`.)
- `agents/src/agents/` — role implementations:
  `architecture/intent_agent.py`, `po_agent.py`, `ux_agent.py`,
  `dev_agent.py`, `qa_agent.py`. (Note: the repository's tree shows
  `intent_agent.py`, `po_agent.py`, `ux_agent.py`, `dev_agent.py`,
  `qa_agent.py` — there is **no** `architecture_agent.py` module, only
  `intent_agent.py`.)
- `agents/src/workflows/main_pipeline.py` — orchestrator that the HTTP
  server invokes. The README in this folder explicitly forbids `agent_1`,
  `agent_2`, `agent_3` (legacy).
- `agents/src/quality_gate/` — `evaluator.py` + `rules.py`.
- `agents/src/routing/rework.py` — feedback-routing helpers.
- `agents/src/mcp/` — MCP client (`tool_registry`, `tool_policy`,
  `mcp_client`, `mocks/`).
- `agents/src/prompts/` — `agent_1.txt`, `agent_2.txt`, `agent_3.txt`
  (legacy hard-coded prompts — see "Current Known Issues" later).
- `agents/src/schemas/aidlc.py` — AIDLC schema mirror.
- `agents/src/utils/llm_factory.py`, `router.py` — LLM factory and routing
  helper (hybrid LLM router per `_get_llm(model_config)`).
- `agents/src/tools/dev_tools.py`, `sandbox.py`.
- `agents/src/observability.py`.

---

## 4. Major modules (frontend)

Source root: `frontend/src/`

### 4.1 Routing & shell
- `App.tsx` — React Router. Single protected route group: `/sdlc/*` →
  `AppShell`. Every other path (`/`, `/auth`, `/admin/*`, `/upgrade`,
  `/app/*`) is redirected to `/sdlc`. `ProtectedRoute` is a pass-through.
- `pages/NotFound` — fallback 404 page.
- `pages/SdlcDashboard` — the only concrete page (lazy-loaded).
- `components/layout/AppShell.tsx` + `AppSidebar.tsx` + `AppTopBar.tsx` —
  application chrome.
- `components/layout/dialogs/FeatureRequestProjectDialog.tsx` +
  `ImportProjectDialog.tsx` — start-of-flow dialogs.

### 4.2 Stores
- `store/useWorkflowStore.ts` — the SOLE workflow store. Backed by SSE.
  Holds `sessions` map (per-session `SessionState`), `sseConnections`,
  `sseAbortControllers`. HTTP commands are pure (no local mutation after
  success; the backend SSE is authoritative). Per-session reconnect cursor
  via `lastSeenSequenceBySession`; envelope-id dedup with bounded LRU.
- `store/useUiStore.ts` — UI-only state.
- `store/eventMappers.ts` — envelope → `SessionState` patch dispatch
  (per-event-type business mapping).
- `store/workflowSelectors.ts` — selector helpers.

### 4.3 Services
- `services/api/sdlcApi.ts` — typed HTTP client for the SDLC surface.
- `services/api/sdlcLegacy.ts` — legacy / compatibility aliases.
- `services/api/client.ts` — base URL, axios instance.
- `services/api/types.ts` — wire types for `PhaseStatus`, `GateItem`,
  `QAResult`, `AuditEntry`, `PipelineResponse`, `GateType`, etc.
- `services/sseClient.ts` — single canonical SSE transport. Parses
  `data:` frames, validates against `isEnvelope`, calls `onEnvelope`.
- `services/api.ts` — legacy stub re-exporting `api/sdlcApi`.
- `services/api/documentsApi.ts`, `testScenariosApi.ts`, `yamlApi.ts` —
  legacy document / test-scenario / YAML helpers.

### 4.4 DTO / models
- `dto/event.ts` — TypeScript mirror of backend's canonical `EventEnvelope`.
  Exports `EventType`, `GateType`, payload interfaces, and `isEnvelope`.
- `models/SessionState.ts` — per-session store shape (`agentStates`,
  `pipelinePhases`, `pendingGates`, `gateHistory`, `auditLog`,
  `runtimeEvents`, `qaResult`, `releaseStatus`, `repoInfo`,
  `featureRequest`, `repoUrl`).
- `hooks/useApi.ts`, `hooks/useApiActions.ts` — fetch helpers.
- `lib/testScenarioHelpers.ts`, `lib/yamlExportHelpers.ts`, `lib/utils.ts`.
- `i18n.ts`, `theme/`, `locales/`, `index.css`.

### 4.5 Tests
- `frontend/tests/` — Vitest tests for `OverviewPage`, `SdlcDashboard`,
  `App.notFound`, and helper modules.

---

## 5. Backend architecture

### 5.1 Request flow

```
HTTP request
   │
   ▼
server.js  (CORS, json, request-context, request-log)
   │
   ▼
middleware/authMiddleware.js (local-dummy bypass)
   │
   ▼
routes/*.js (mount at /api/v1)
   │
   ▼
controllers/*.js (transport validation, response shape)
   │
   ▼
services/*.js (business logic)
   │   ├──► eventPublisher.publishEvent → eventBus.publish → in-process subscribers
   │   │      (SSE controllers subscribe via eventBus.subscribe / subscribeProject)
   │   │
   │   ├──► models/*.js (Prisma)
   │   │
   │   └──► gateBridge.requestGate → in-memory + PendingGate persist + lifecycle transition
```

### 5.2 Background work
- `taskWorker.startSweeper()` — periodic reclaim of tasks whose heartbeat
  has expired.
- `gateBridge.markOrphanedPendingInterrupted()` — on boot, mark every
  `pending` gate as `interrupted` so the FE can show a re-trigger CTA.
- `SdlcWorkflowService.recoverInterruptedGates()` — on boot, re-dispatch
  every task in `executionStatus='awaiting_gate'` so the runner re-enters
  and the agent re-prompts the human for a fresh gate.
- `jobs/batchJob.startBatchJobs()` — no-op in single-user mode
  (`console.log('[BatchJob] Batch jobs disabled…')`).

### 5.3 External dependencies
- Sentry (`@sentry/node` + `@sentry/profiling-node`) — initialised in
  `server.js`.
- Python agents service via `AgentService.js` (only when
  `EXECUTION_PATH=langchain` and `USE_MOCK_AGENTS!=true`).
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) via
  `agents/claudeCodeRunner.js` (only when `EXECUTION_PATH=claude-code`).
- Codex CLI via `agents/codexRunner.js` (only when `EXECUTION_PATH=codex`).
- Local `git` via `repoService.git()` for every repo operation.

---

## 6. Frontend architecture

### 6.1 Runtime data path

```
User action (e.g. "start pipeline")
   │
   ▼
useWorkflowStore.startPipeline  → sdlcApi.startPipeline (HTTP POST)
   │
   ▼
backend SdlcController.runArchitectureAgent
   │
   ▼
backend SdlcWorkflowService.runArchitectureAgent
   │
   ▼
backend workflowOrchestrator.runArchitectureAgent
   │  - creates PipelineSession + Task
   │  - clones / prepares repo
   │  - publishes canonical envelope via eventPublisher
   │  - dispatches _runAgent in background
   │
   ▼
Frontend subscribes to /sdlc/stream/:sessionId
   (useWorkflowStore._subscribeSession)
   │
   ▼
SSE pushes canonical EventEnvelope frames
   │
   ▼
applyEnvelope (eventMappers.ts) patches the per-session SessionState
```

The store comment is explicit: "HTTP commands — DO NOT mutate local state on
success; the backend SSE emits the resulting state change."

### 6.2 SSE transport

`frontend/src/services/sseClient.ts` parses SSE frames with explicit
`data:` line buffering and validates every parsed JSON object against
`isEnvelope` from `dto/event.ts`. Reconnect cursor is the last seen
`envelope.sequence` per session, sent via the `Last-Event-ID` header.

### 6.3 State
- One Zustand store for workflow data, one for UI-only state.
- `useWorkflowStore` is the only source of session state. Pages subscribe
  to slices; no component owns derived data.
- Replay dedup is per-envelope-id, bounded to 1000 entries.

---

## 7. Pipeline overview (current chain)

The canonical chain documented in source:

```
run-architecture-agent ──► architecture-agent
                                  │ APPROVE
                                  ▼
                              po-agent      (auto-advance via startNextAgentIfAvailable)
                                  │ APPROVE
                                  ▼
                              ux-agent      (auto-advance)
                                  │ APPROVE
                                  ▼
                              dev-agent     (auto-advance)
                                  │ APPROVE
                                  ▼
                              qa-agent      (auto-advance)
                                  │ APPROVE
                                  ▼
                            FINAL_RELEASE   (releaseManager.submitReleaseDecision)
                                  │ APPROVE
                                  ▼
                            pipeline_completed
```

PO/UX/DEV/QA all surface an `output_review` gate after their agent finishes
(`SdlcWorkflowService._saveAgentData`). A human decision via
`POST /sdlc/output-review/:approval_id` either:
- approve → commit output, mark `VALID`, record `a2a_handoff` artifact,
  then `startNextAgentIfAvailable` fires the next agent (or creates the
  FINAL_RELEASE gate after QA), or
- reject → `_handleGateRejection` re-runs the same agent with the human's
  reason as `feedbackPrompt` (capped by `MAX_RETRY_PER_STEP=3`; on
  exhaustion returns `escalation_required` instead of re-running).

Independent of `output_review`, every agent's `claudeCodeRunner` builds an
`onGate` callback through `claudePermissionDispatcher.dispatch`. Inside the
runner this can produce two extra gate kinds:
- `tool` (DEV's Write/Edit/Bash, classified by `riskClassifier`) — paused
  for a human via `gateBridge.requestGate(kind='tool')`, resolved through
  `POST /sdlc/approvals/:approval_id`.
- `question` (Claude's `AskUserQuestion`) — paused via
  `gateBridge.requestGate(kind='question')`, resolved in-place
  (`resolveGate` resumes the SAME Claude execution with `updatedInput.answers`;
  see `claudePermissionDispatcher.handleQuestion` + `SdlcWorkflowService.resolveApproval`
  question branch).

### 7.1 Entry points
- `POST /api/v1/sdlc/run-architecture-agent` is the only canonical entry.
  Returns `{ task_id, session_id, status, type }`.
- `POST /api/v1/sdlc/run-po-agent`, `POST /sdlc/upload-repo` both return
  HTTP 410 with explicit "removed" codes (`PO_AGENT_ENTRY_REMOVED`,
  `UPLOAD_REPO_REMOVED`).

### 7.2 Final release
- After QA `output_review` approve, if QA gate passes and session has a
  cloned repo, `SdlcWorkflowService.resolveOutputReviewGate` flips the
  session to `awaiting_release`, builds release evidence via
  `releaseManager.buildReleaseEvidenceSummary`, and calls
  `gateBridge.requestGate(kind='release')`.
- Human decision lands at `POST /sdlc/sessions/:session_id/release-decision`.
  On APPROVE, `releaseManager.submitReleaseDecision` deletes any previous
  bundle, writes `final.md` + `qa-report.md` + `audit-trail.json`,
  commits, pushes best-effort, sets `PipelineSession.status='completed'`,
  publishes `pipeline_completed`.

---

## 8. Event architecture

Single canonical envelope, single transport. See
`docs/engineering-freeze/06_EVENT_INVENTORY.md` for the full inventory.

Key invariants (source citations):
- The envelope DTO is **pure** — `createEnvelope` in
  `backend/src/dto/eventEnvelope.js` is the only constructor and never
  imports IO. Producers must use `eventPublisher.publishEvent`.
- One per-session sequence space (`backend/src/services/sequence.js`).
  `AgentEvent.sequence` carries a unique constraint
  (`@@unique([sessionId, sequence])` in `schema.prisma`).
- EventBus subscription is in-process only (`eventBus.js`). No external
  pub/sub. SSE writer subscribes via `eventBus.subscribeProject`; legacy
  per-session subscribers still exist (`subscribe`) for the older
  per-session SSE path that has been deprecated but is referenced in tests.
- SSE: `GET /api/v1/sdlc/stream/:sessionId` is the canonical transport
  (`SdlcController.streamPipelineStatus`). `GET /sdlc/status/:task_id`
  returns 410 (`STREAM_STATUS_DEPRECATED`).

---

## 9. Persistence architecture

- Single SQLite database file (provider `sqlite`,
  `DATABASE_URL` env, default `file:./dev.db`).
- WAL journal mode + `connection_limit=1` to serialize writers
  (`backend/src/config/database.js`).
- Prisma client with `transactionOptions: { timeout: 20000, maxWait: 20000 }`.
- Core tables: `Project`, `PipelineSession`, `Task`, `AgentArtifact`,
  `AgentEvent`, `Document`, `Folder`, `Testcase`, `SessionState`,
  `HitlDecision`, `PendingGate`, `FeatureBacklog`.
- The only non-trivial relations:
  - `PipelineSession.tasks` ← `Task.sessionId`
  - `Task.artifacts`, `Task.events` ← cascades on task delete
  - `AgentEvent` carries both `payload` (legacy) and `envelope` (canonical
    EventEnvelope JSON). Replay in `streamPipelineStatus` prefers
    `envelope`; legacy rows fall back to `buildLegacyEnvelope`.
- Artifact content for string fields is stored as a `FILE:<path>` reference
  (`contentText`), and `resolveArtifactContent` reads the actual file from
  `WORKSPACE_DIR/<projectId>/<taskId>/<artifactType>.<ext>`. JSON-object
  fields use `contentJson` directly or a `file_path` inside it.

---

## 10. Workspace and repositories

- Canonical uploaded repo (legacy): `workspace/projects/<projectId>/repo/`.
- Per-session working copy:
  `workspace/projects/<projectId>/sessions/<sessionId>/repo/`.
- Each session cuts its own working branch `aifa/<slug>` (default `main` as
  the base branch).
- Per-agent checkpoint commits are written on every
  `resolveOutputReviewGate` approve via
  `repoService.commitAndPushOnApprove` (`add` + `commit` mandatory;
  `push` best-effort).
- Final bundle is written into the per-session working copy at
  `sessions/<slug>-<shortId>/` (legacy nested sessions folder convention).

---

## 11. Configuration and env switches

Observed environment variables (`backend/src/config/environment.js` and
scattered `process.env.X` reads):

| Env var                       | Purpose                                              | Default                              |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------ |
| `PORT`                        | HTTP listen port                                     | (unset → express default)            |
| `NODE_ENV`                    | `development` enables request logger; controls test  | (unset)                              |
| `FRONTEND_URL`                | CORS allow-list (comma-separated)                    | (unset)                              |
| `DATABASE_URL`                | SQLite file URL (`file:./dev.db`)                    | (unset → Prisma default)             |
| `AGENTS_BASE_URL`             | Python agents base URL                               | `http://127.0.0.1:8001`              |
| `SENTRY_DSN`                  | Sentry DSN                                           | empty (Sentry disabled)              |
| `EXECUTION_PATH`              | `langchain` / `claude-code` / `codex`                | `langchain`                          |
| `USE_MOCK_AGENTS`             | When `true`, `_runAgent` returns mock output         | (unset)                              |
| `USE_MOCK_CLAUDE_CODE`        | Short-circuits claude-code runner to mock            | (unset)                              |
| `AUTO_APPROVE_TOOLS`          | Sent to Python agents as `auto_approve: true`        | (unset)                              |
| `MOCK_SCENARIO`               | Scenario selector (UI-only)                          | `happy_path`                         |
| `CLAUDE_CODE_INTERACTIVE_GATES` | When `true`, `canUseTool` actually pauses for HITL | (unset → false → non-interactive)    |
| `CLAUDE_CODE_TIMEOUT_MS`      | Default SDK run timeout                              | `30 * 60 * 1000` (30 min)            |
| `CLAUDE_CODE_MAX_TURNS`       | Global max turns                                     | `200`                                |
| `CLAUDE_CODE_<STAGE>_MAX_TURNS` | Per-role max turns override                        | per `ROLE_MAX_TURNS` map             |
| `CLAUDE_CODE_<STAGE>_TIMEOUT_MS` | Per-role timeout override                         | unset                                |
| `CLAUDE_CODE_MODEL`           | SDK `model` override                                 | unset                                |
| `CODEX_TIMEOUT_MS`            | Codex CLI default timeout                            | `30 * 60 * 1000`                     |
| `TOOL_PERMISSION_TIMEOUT_MS`  | Tool-gate timeout                                    | `GATE_TIMEOUT_MS`                    |
| `CLARIFYING_QUESTION_TIMEOUT_MS` | Question-gate timeout                             | `GATE_TIMEOUT_MS`                    |
| `GATE_TIMEOUT_MS`             | Generic gate timeout                                 | `600000` (10 min)                    |
| `TASK_HEARTBEAT_MS`           | Heartbeat interval                                   | `15000`                              |
| `TASK_HEARTBEAT_STALE_MS`     | Stale-sweep cutoff                                   | `60000`                              |
| `MAX_PARALLEL_WORKFLOWS`      | Max concurrent sessions                              | `4`                                  |
| `SESSION_SECRET`              | Cookie signing key (legacy auth)                     | `dev-insecure-secret-change-me`      |
| `GH_TOKEN`                    | Optional push credential for release bundle          | unset                                |
| `DEMO_EMAIL` / `DEMO_PASSWORD`| Default `authService.seedUser` credentials           | `demo@example.com` / `password123`   |

---

## 12. Tests

- Backend: Jest (`backend/jest.config.js`). Integration suite under
  `backend/tests/integration/` (24 test files, listed in
  `docs/engineering-freeze/02_DIRECTORY_MAP.md`). Setup:
  `backend/tests/setupEnv.js`.
- Frontend: Vitest (`frontend/tests/`, 6 test files). Setup:
  `frontend/tests/setup.ts`.
- Python agents: `agents/tests/` (small folder).

---

## 13. Source-of-truth docs referenced by code

The codebase explicitly references these documents in source comments
(citations recorded verbatim):

| Doc                                              | Referenced in                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `docs/architecture/A2A_PIPELINE_REDESIGN.md`     | `backend/src/services/agentDispatcher.js`, `artifactManager.js`, `workflowOrchestrator.js` |
| `docs/SPEC.md` (frozen spec, 2026-07-06)         | multiple                                                                                   |
| `docs/fixbug/AUDIT_2026_07_09_FULL_PIPELINE.md` §19 | `backend/src/services/releaseManager.js`, `SdlcWorkflowService.js`                       |
| `UPGRADE_TO_SINGLE_USER.md` (project root)       | `CLAUDE.md`                                                                                |
| `agents-dev.stderr.log` / `backend-dev.*` / etc.  | historical run logs (not source)                                                          |

> The CLAUDE.md "AIFA Specification Guardian" mandates priority order
> `PROJECT_CONSTITUTION.md > AIFA_V3_FROZEN_SPEC_DRAFT.md > approved
> migrations > current implementation > historical discussions`. Neither
> `PROJECT_CONSTITUTION.md` nor `AIFA_V3_FROZEN_SPEC_DRAFT.md` was
> observed in `docs/` at the time of writing — they are referenced in
> `.claude/CLAUDE.md` only.

---

## 14. Observation checklist

The remaining documents in this freeze package document:

- `02_DIRECTORY_MAP.md` — folder tree with role tags.
- `03_RUNTIME_ENTRYPOINTS.md` — every HTTP/SSE/cron/CLI/agent-dispatch
  entrypoint with caller + callee.
- `04_AGENT_PIPELINE_BASELINE.md` — the real chain as implemented,
  per stage.
- `05_HTTP_ENDPOINT_INVENTORY.md` — every SDLC-related endpoint.
- `06_EVENT_INVENTORY.md` — every published event type with producer +
  consumers.
- `07_DATABASE_ENTITY_MAP.md` — entity-relationship map.
- `08_CURRENT_KNOWN_ISSUES.md` — observable structural issues (no new
  bug hunting).
- `09_PHASE1_PLAN.md` — Phase-1 audit plan only (no implementation).