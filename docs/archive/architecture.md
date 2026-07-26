# AIFA System Architecture

> Status: current implementation
> Related code map: [AIFA_NOTES.md](AIFA_NOTES.md)

## 1. Muc tieu he thong

AIFA la mot AI software factory co backend control plane dieu phoi cac worker:

- PO: phan tich yeu cau va tao PRD.
- UX: tao UX spec, user flow va wireframe.
- DEV: tao hoac sua code, thu thap sandbox/self-test evidence.
- QA: tao va danh gia test evidence, dua ra release recommendation.

He thong khong chi goi LLM theo thu tu. Backend con chiu trach nhiem:

- Luu task, artifact, event va human decision.
- Chon execution path cho worker.
- Validate output theo schema, semantic va risk.
- Tam dung tai tool gate, question gate va stage review.
- Bao dam handoff dung chain va dung output version.
- Quan ly repo copy, branch, commit, diff va release report.
- Phuc hoi task/gate o muc stage sau crash hoac restart.

## 2. Deployment topology

```text
Browser
  |
  | HTTP / multipart upload / polling
  v
Frontend - React + TypeScript + Vite
  |
  | /api/v1/*
  v
Backend - Node.js + Express
  |\
  | \---- Prisma ---- SQLite
  |
  |------ filesystem ---- workspace/projects/<projectId>
  |
  |------ Claude Agent SDK ---- local Claude Code runtime
  |
  \------ HTTP/SSE ---- Python Agents - FastAPI + LangChain
```

Ba service co the chay qua `docker-compose.yml`:

| Service | Port | Vai tro |
| --- | --- | --- |
| `frontend` | `5173` | UI va API client |
| `backend` | `3000` | Control plane, API, orchestrator va persistence |
| `agents` | `8001` | Python/LangChain worker runtime |

Real Claude Agent SDK runner nam trong backend process. Python agents la mot
service rieng va duoc backend goi qua HTTP/SSE.

## 3. Component architecture

### 3.1 Frontend

Entry points:

- `frontend/src/main.tsx`: khoi tao React.
- `frontend/src/App.tsx`: router; `/sdlc` va `/sdlc/hitl` la UI chinh.
- `frontend/src/pages/SdlcDashboard/index.tsx`: board hien tai.
- `frontend/src/services/api/sdlcApi.ts`: SDLC API client.

`SdlcDashboard` (trang chinh `/sdlc`):

- Mo folder bang File System Access API hoac file input fallback.
- Upload repo copy len backend.
- Hien stage review, pending tool/question gate va timeline.
- Resolve approval, retry flow va release decision.
- Tai `final.md` tu backend va tao file report moi trong folder local neu co
  quyen `readwrite`.

### 3.2 Backend API

Entry points:

- `backend/src/server.js`: khoi dong server, DB va recovery.
- `backend/src/routes/sdlc.js`: SDLC routes.
- `backend/src/controllers/SdlcController.js`: HTTP/SSE handlers.

Nhom API chinh:

```text
Repo/workers
  POST /api/v1/sdlc/upload-repo
  POST /api/v1/sdlc/run-intent-agent
  POST /api/v1/sdlc/run-po-agent
  POST /api/v1/sdlc/run-ux-agent
  POST /api/v1/sdlc/run-dev-agent
  POST /api/v1/sdlc/run-qa-agent

Task/gate
  GET  /api/v1/sdlc/tasks/:task_id
  GET  /api/v1/sdlc/tasks/:task_id/events
  GET  /api/v1/sdlc/status/:task_id
  POST /api/v1/sdlc/tasks/:task_id/decision
  POST /api/v1/sdlc/tasks/:task_id/cancel
  GET  /api/v1/sdlc/approvals
  POST /api/v1/sdlc/approvals/:approval_id

Workflow/release
  GET  /api/v1/sdlc/workflow-status
  GET  /api/v1/sdlc/workflow/:id/timeline
  GET  /api/v1/sdlc/projects/:project_id/artifacts
  POST /api/v1/sdlc/projects/:project_id/release-decision
  GET  /api/v1/sdlc/projects/:project_id/release-files/:file_name
```

### 3.3 Orchestrator

`backend/src/services/SdlcWorkflowService.js` la orchestrator trung tam.

Trach nhiem:

- Tao task cho tung stage.
- Build context tu approved upstream artifacts.
- Chon execution path.
- Chay worker va luu output.
- Validate artifact.
- Auto-approve output an toan hoac dung tai human review.
- Tao `a2a_handoff.v1`.
- Khoi dong worker tiep theo.
- Chon mot coherent task chain cho workflow status.
- Tong hop final review, audit, metrics va release.

Workflow phase khong duoc persist thanh mot field rieng. Backend suy ra phase
hien tai tu task chain, decision, gate va release state.

### 3.4 Runtime and worker control

Hai service tach trach nhiem runtime:

- `taskLifecycleService.js`: kiem soat state transition va ghi `AgentEvent`.
- `taskWorkerService.js`: claim task, heartbeat, execution timeout va stale-task
  recovery.

Task execution state:

```text
queued
  -> dispatched
  -> running
      -> awaiting_gate
          -> running
      -> completed
      -> failed
      -> cancelled
      -> timeout
```

Task co `lockedBy`, `heartbeatAt`, `attempt`, `startedAt` va `finishedAt`.
Human gate wait khong bi tinh vao execution-time budget.

## 4. Business workflow

### 4.1 Main flow

```text
Open/upload repo
        |
        v
PO Agent -- route has_ui=false --------------------+
  | route has_ui=true                              |
  v                                                |
UX Agent                                           |
  |                                                |
  +-------------------------> DEV Agent <-----------+
                                |
                                v
                         QA Agent + Quality Gate
                                |
                                v
                         Human QA Review
                                |
                                v
                       Owner/Admin Release Gate
                                |
                                v
             branch + commit/diff + final.md + qa-report.md
```

Optional `intent-agent` API van ton tai cho flow yeu cau co intent review, nhung
primary `/aifa` board hien khoi dong PO flow.

### 4.2 Ordering invariants

- PO route quyet dinh co chay UX hay khong.
- Downstream chi chay khi source task `completed` va `committed`.
- Source artifact khong duoc co status `INVALID`.
- Source phai co `a2a_handoff.v1` va output hash khop.
- Question gate khoa downstream cua project.
- QA chi chay tu dung DEV source va khi DEV khong con pending gate.
- Khong tao trung downstream task cho cung mot source task.
- Workflow status khong ghep QA cu voi DEV moi.
- Loi khoi dong downstream khong duoc doi upstream da committed thanh failed.

## 5. Execution architecture

### 5.1 Execution path selection

`SdlcWorkflowService._runAgent` chon adapter dua tren environment:

```text
EXECUTION_PATH=claude-code
  -> _runClaudeCodePath
      -> USE_MOCK_CLAUDE_CODE=true
           -> mockClaudeCodeRunner
      -> USE_MOCK_CLAUDE_CODE=false
           -> claudeCodeRunner
           -> @anthropic-ai/claude-agent-sdk query()

EXECUTION_PATH khac
  -> USE_MOCK_AGENTS=true
       -> deterministic _buildMockOutput
  -> USE_MOCK_AGENTS=false
       -> AgentService
       -> Python FastAPI /v1/agent/run
       -> LangChain worker
```

Tat ca execution paths ket thuc tai `_saveAgentData`; khong path nao duoc bo qua
artifact persistence va gate validation.

### 5.2 Real Claude Agent SDK path

```text
SdlcWorkflowService
  -> claudeCodeRunner.runAgent
  -> Agent SDK query()
  -> canUseTool
  -> AIFA onGate
  -> claudePermissionDispatcher
  -> riskClassifier / gateBridge
  -> normalized agent-io.v3 output
  -> _saveAgentData
```

`claudeCodeRunner.js` da la real runner, khong con la stub. Runner:

- Load prompt theo role.
- Chay Claude Agent SDK trong repo/sandbox working directory.
- Chuyen absolute tool path thanh repo-relative path cho risk classification.
- Gan `canUseTool` vao AIFA permission dispatcher.
- Retry mot so transient runtime/network failure.
- Parse va normalize final JSON.
- Kiem tra output theo `agent-io.v3`.

### 5.3 Python agents path

`AgentService.js` gui request toi `agents/main.py`.

```text
Backend AgentService
  -> POST agents:/v1/agent/run
  -> FastAPI parse Pydantic input
  -> model router
  -> PO / UX / DEV / QA LangChain worker
  -> SSE progress/completed/error
  -> backend parse completed output
```

Python DEV path co sandbox/local fallback logic rieng. Backend van la noi quyet
dinh artifact validity, handoff va release.

## 6. Contract and validation architecture

Co hai lop contract:

| Contract | Source of truth | Vai tro |
| --- | --- | --- |
| `agent-io.v3` | `backend/src/services/agentContract.js` | Required non-empty output keys cho moi agent |
| `gate-output.v4` | `SdlcWorkflowService.OUTPUT_CONTRACTS` | Rule chi tiet theo schema, semantic va risk |

Validation pipeline:

```text
Raw worker output
  -> agent-io.v3 conformance
  -> save files + AgentArtifact rows
  -> gate-output.v4 validation
      -> schema layer
      -> semantic layer
      -> risk layer
  -> artifact VALID / INVALID
  -> gate policy
  -> approved output
  -> a2a_handoff.v1
```

BLOCKER o bat ky layer nao:

- Danh dau artifact cua task la `INVALID`.
- Khong tao approved handoff.
- Khong khoi dong downstream.

Gate mode mac dinh:

| Stage | Mode |
| --- | --- |
| Intent | `strict_manual` |
| PO | `confidence_based` |
| UX | `confidence_based` |
| DEV | `confidence_based` |
| QA | `strict_manual` |

Confidence threshold cho auto-approval hien la `0.80`. Output chi auto-approve
khi validation PASS va khong co warning/risk issue can human.

## 7. Gate and HITL architecture

Co ba cap human interaction:

1. Tool/question gate trong luc agent dang chay.
2. Stage output review sau khi worker hoan tat.
3. Final release decision.

### 7.1 Tool and question gate

```text
Claude tool call / AskUserQuestion
  -> claudePermissionDispatcher
  -> read-only policy hoac riskClassifier
  -> auto allow | block | approval
  -> gateBridge.requestGate
  -> PendingGate persisted
  -> task awaiting_gate
  -> human resolveApproval
  -> gateBridge.resolveGate
  -> task running
  -> agent continues
```

Tool risk tiers:

- `auto`: cho phep va audit.
- `approval`: tam dung cho human.
- `block`: tu choi ngay.

Interactive tool/question gates duoc dieu khien boi
`CLAUDE_CODE_INTERACTIVE_GATES=true`.

### 7.2 Stage review

`submitStructuredDecision` ho tro:

- Idempotency bang `decision_id`.
- Optimistic locking bang `base_output_version`.
- `approve`.
- `edit_approve`.
- `reject` va rerun owning worker.
- Retry limit va escalation.

### 7.3 Final release gate

Release chi duoc approve khi QA chain va evidence dat dieu kien. Release
decision yeu cau reviewer role owner/admin.

## 8. Persistence architecture

State duoc chia thanh ba lop.

### 8.1 SQLite / Prisma

Model quan trong:

| Model | Noi dung |
| --- | --- |
| `Task` | Stage run, execution state, raw/approved output va worker lock |
| `AgentEvent` | Persisted ordered event stream |
| `AgentArtifact` | Artifact metadata, file reference, hash va VALID/INVALID |
| `HitlDecision` | Stage/release decisions va idempotency key |
| `PendingGate` | Persisted metadata cua tool/question gate |
| `Project` | Project info va ownership |
| `FeatureBacklog` | Backlog item va task linkage |

### 8.2 Filesystem workspace

```text
workspace/
  demo-board.json
  projects/
    <projectId>/
      repo/                 uploaded/cloned repo copy
      <taskId>/             generated artifact files
      release/              release files khi khong co repo
      sandbox/              runner sandbox data
```

`AgentArtifact` thuong luu metadata va `FILE:<path>`/file reference, con noi
dung artifact lon nam tren filesystem.

### 8.3 In-memory state

Mot so runtime state van o trong process:

- Live Promise continuation cua `gateBridge`.
- Gate subscribers.
- In-memory gate audit cache.
- Active task heartbeat timers.
- Demo review holds.

Vi vay restart khong the resume dung tai tool call cu.

## 9. Recovery and resilience

Backend startup:

```text
connect Prisma
  -> mark orphaned pending gates as interrupted
  -> sweep stale running/dispatched tasks
  -> start periodic stale-task sweeper
  -> recoverInterruptedGates
```

Interrupted gate recovery:

1. Pending gate metadata cu duoc danh dau `interrupted`.
2. Backend tim task dang `awaiting_gate`.
3. Rebuild context tu persisted task/artifact/repo data.
4. Re-dispatch rieng stage bi gian doan.
5. Agent co the tao gate moi.

Day la stage-level recovery. Live SDK/Promise continuation cua tool call cu
khong duoc khoi phuc.

Resilience khac:

- Atomic-ish worker claim bang `lockedBy`.
- Heartbeat va stale-task sweep.
- Execution timeout khong tinh human wait.
- Task cancel resolve pending gate de tranh treo.
- Persisted `AgentEvent` co sequence de SSE replay.

## 10. Event delivery and UI synchronization

### 10.1 Task SSE

Endpoint:

```text
GET /api/v1/sdlc/status/:task_id
```

Event:

- `agent_event`
- `progress`
- `completed`
- `error`
- `gate_pending`
- `gate_resolved`
- heartbeat comment

Persisted `AgentEvent` co the replay bang `Last-Event-ID` hoac
`after_sequence`.

### 10.2 Primary UI polling

Primary UI `/sdlc` su dung task SSE (`GET /api/v1/sdlc/status/:task_id`) de
cap nhat trang thai tung task. Board tong hop duoc tai qua
`GET /api/v1/sdlc/workflow-status`. Timeline va artifact duoc tai khi user mo.

## 11. Repo and release architecture

### 11.1 Browser folder upload

```text
showDirectoryPicker / file input
  -> multipart files[] + paths[]
  -> SdlcController.uploadRepo
  -> repoService.prepareUploadedRepo
  -> workspace/projects/<projectId>/repo
  -> git init + import commit
```

Backend:

- Bo qua `.git` goc.
- Chan path traversal.
- Khong tu dong chay script trong uploaded repo.
- Flag secret-like files.
- Tao git repo va working branch rieng.

### 11.2 Release bundle

```text
Owner/admin APPROVE
  -> submitReleaseDecision
  -> workflowReport.writeReleaseBundle
  -> final.md
  -> qa-report.md
  -> branch/commit/diff/release metadata
```

Backend ghi release bundle vao repo copy tren server hoac thu muc release cua
project. Frontend co the tai `final.md` va tao mot report file moi trong folder
local da duoc user cap quyen; frontend khong ghi de `final.md` local co san.

## 12. Security boundaries

- Khong co yeu cau xac thuc nguoi dung; he thong chay o che do single-user local.
- Project action khong con co membership/role check; moi hanh dong deu duoc phep.
- Final release chi yeu cau workflow QA da completed.
- Uploaded repo la ban copy tren server.
- Khong tu dong chay script trong uploaded repo.
- Secret-like path bi chan/flag.
- Tool ghi ra ngoai repo bi block.
- Push thang vao main va mass delete bi block.
- Browser chi co quyen trong folder user da chon.
- Real runner chi duoc thao tac qua allowed tools va permission dispatcher.

## 13. Important environment switches

```env
# Chon execution adapter
EXECUTION_PATH=claude-code

# Trong claude-code path: mock hay real Claude Agent SDK
USE_MOCK_CLAUDE_CODE=false

# Trong non-claude-code path: mock output hay Python agents
USE_MOCK_AGENTS=false

# Hien tool/question gate tren UI
CLAUDE_CODE_INTERACTIVE_GATES=true

# Gioi han workflow dong thoi
MAX_PARALLEL_WORKFLOWS=3

# Timeout gate va worker heartbeat
GATE_TIMEOUT_MS=600000
TASK_HEARTBEAT_MS=15000
TASK_HEARTBEAT_STALE_MS=60000
```

Gia tri thuc te duoc doc tu cac file `.env`; block tren mo ta cac switch kien
truc quan trong, khong phai mot cau hinh bat buoc duy nhat.

## 14. Current limitations

- `SdlcWorkflowService.js` dang gom nhieu trach nhiem va la diem phuc tap lon
  nhat cua backend.
- Live gate continuation van phu thuoc Promise trong backend process.
- Restart chi re-dispatch stage, khong resume dung tool call/SDK session cu.
- Primary UI dung polling thay vi task SSE.
- Demo board va review holds co mot phan state in-memory/file-based.
- SQLite duoc harden bang WAL va mot connection, nhung khong phai persistence
  phu hop cho scale ngang nhieu backend instance.
- Python worker path va Claude Agent SDK path co logic execution khac nhau; backend
  contract/validation la lop giu chung hanh vi.
- Uploaded repo scripts khong duoc tu dong chay; evidence co the den tu mock,
  sandbox hoac runner tuy execution path.

## 15. Architecture reading path

De doc kien truc tu tong quan den chi tiet:

1. `docs/AIFA_NOTES.md`
2. `backend/prisma/schema.prisma`
3. `backend/src/server.js`
4. `backend/src/services/SdlcWorkflowService.js`
5. `backend/src/services/taskLifecycleService.js`
6. `backend/src/services/taskWorkerService.js`
7. `backend/src/services/agentContract.js`
8. `backend/src/agents/claudePermissionDispatcher.js`
9. `backend/src/services/gateBridge.js`
10. `backend/src/agents/claudeCodeRunner.js`
11. `backend/src/services/repoService.js`
12. `backend/src/services/workflowReport.js`
13. `frontend/src/pages/SdlcDashboard/index.tsx`
14. `agents/main.py`



Add Session model + Task.sessionId to prisma schema, push schema

Add Task.findLatestBySession + repoService session-aware paths/copy

Rework SdlcWorkflowService run*Agent/getPipelineResponse/_countActiveWorkflows to be session-scoped

Remove mock delay, parallelize artifact resolution

Update SdlcController/routes for sessions (list sessions, session-scoped release/final-review)

Update workflowReport.js to write release bundle into uploaded-folder subfolder

Remove Penpot service/docker-compose/UI references

Rename sandbox_result/sandboxDir to build_result/workspace across backend+frontend

Refactor useSdlcStore to multi-session map + fix redundant polling bug

Update SdlcDashboard UI to render 4 session cards with distinct status colors

Update FeatureRequestChatbox + sdlcApi.ts for session-based start/list

Fix claudeCodeRunner retry backoff to fail fast on non-transient errors

Run backend tests + frontend typecheck, manual verification