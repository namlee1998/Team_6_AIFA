# AIFA Notes - Ban do codebase hien tai

Tai lieu nay la ban do nhanh de doc va sua AIFA theo code hien tai.

## 1. Buc tranh tong the

AIFA gom ba service:

```text
frontend React
  -> backend Node.js / Express
      -> SQLite qua Prisma
      -> Python agents qua HTTP/SSE, hoac Claude Agent SDK chay local
      -> workspace/projects/<projectId>
```

Workflow chinh:

```text
Open/upload folder local
  -> PO
  -> UX (neu route co UI)
  -> DEV
  -> QA
  -> human QA review
  -> release decision
  -> final.md + qa-report.md + branch/commit/diff
```

Hai route worker duoc ho tro:

```text
PO -> UX -> DEV -> QA
PO -> DEV -> QA
```

## 2. File trung tam

### Backend control plane

| File | Trach nhiem |
| --- | --- |
| `backend/src/server.js` | Khoi dong Express, DB, stale-task sweeper va interrupted-gate recovery |
| `backend/src/routes/sdlc.js` | Khai bao SDLC API routes |
| `backend/src/controllers/SdlcController.js` | HTTP handlers, task SSE va release download |
| `backend/src/services/SdlcWorkflowService.js` | Orchestrator trung tam: task, validation, handoff, gate policy, workflow status va release |

### Execution, gate va safety

| File | Trach nhiem |
| --- | --- |
| `backend/src/services/AgentService.js` | Cau noi tu backend sang Python agents service |
| `backend/src/services/agentContract.js` | Agent I/O contract `agent-io.v3` va required output keys |
| `backend/src/agents/claudeCodeRunner.js` | Real local Claude Agent SDK runner, prompt, tool permission va output normalization |
| `backend/src/agents/mockClaudeCodeRunner.js` | Dien hanh vi mock qua cung interface `onGate` |
| `backend/src/agents/mockClaudeCodeScripts.js` | Script mock theo scenario va role |
| `backend/src/agents/claudePermissionDispatcher.js` | Dispatcher tool/question permission dung boi `onGate` |
| `backend/src/services/riskClassifier.js` | Phan loai tool action thanh `auto`, `approval`, `block` |
| `backend/src/services/gateBridge.js` | Pending gate, persist metadata, resolve, watchdog va subscriber |

### State, repo va release

| File | Trach nhiem |
| --- | --- |
| `backend/prisma/schema.prisma` | Schema cho Task, AgentEvent, AgentArtifact, HitlDecision va PendingGate |
| `backend/src/models/Task.js` | CRUD va mapping Task |
| `backend/src/models/AgentArtifact.js` | Luu artifact va danh dau `VALID`/`INVALID` |
| `backend/src/services/taskLifecycleService.js` | State machine va persisted AgentEvent |
| `backend/src/services/taskWorkerService.js` | Worker claim, heartbeat, timeout va stale-task recovery |
| `backend/src/services/repoService.js` | Clone/open/upload repo, git branch/commit/diff va path/secret safety |
| `backend/src/services/workflowReport.js` | Tao release bundle, `final.md` va `qa-report.md` |

### Frontend

| File | Trach nhiem |
| --- | --- |
| `frontend/src/App.tsx` | Router; `/sdlc` va `/sdlc/hitl` la UI chinh |
| `frontend/src/pages/SdlcDashboard/index.tsx` | UI chinh: open folder, upload, review, live gate, timeline va release |
| `frontend/src/services/api/sdlcApi.ts` | SDLC API client, upload, approvals, artifacts, timeline va SSE helper |
| `frontend/src/services/api/client.ts` | Axios base URL va error handling |

### Python agents

| File | Trach nhiem |
| --- | --- |
| `agents/main.py` | FastAPI agents service va SSE endpoint `/v1/agent/run` |
| `agents/src/schemas/aidlc.py` | Input/output Pydantic schemas |
| `agents/src/agents/po_agent.py` | Tao PRD, user stories, acceptance criteria va scope |
| `agents/src/agents/ux_agent.py` | Tao UX spec, user flow, wireframe va screens |
| `agents/src/agents/dev_agent.py` | Tao implementation plan, diff va sandbox evidence |
| `agents/src/agents/qa_agent.py` | Tao test cases, coverage matrix va QA report |
| `agents/src/utils/router.py` | Chon model/config cho tung agent |
| `agents/src/quality_gate/evaluator.py` | Python quality-gate evaluator |

## 3. Duong di cua mot request

Luot doc ngan nhat de hieu mot request:

```text
frontend/src/pages/SdlcDashboard/index.tsx
  -> frontend/src/services/api/sdlcApi.ts
  -> backend/src/routes/sdlc.js
  -> backend/src/controllers/SdlcController.js
  -> backend/src/services/SdlcWorkflowService.js
  -> Task / AgentArtifact / AgentEvent
```

Voi SDLC API truc tiep, controller goi `runPOAgent`, `runUXAgent`, `runDEVAgent`
hoac `runQAAgent`.

## 4. Diem re execution path

`SdlcWorkflowService._runAgent(task, context, userId)` la diem re:

```text
EXECUTION_PATH=claude-code
  -> _runClaudeCodePath
      -> USE_MOCK_CLAUDE_CODE=true  -> mockClaudeCodeRunner
      -> USE_MOCK_CLAUDE_CODE=false -> claudeCodeRunner (real Claude Agent SDK)

EXECUTION_PATH khac
  -> USE_MOCK_AGENTS=true -> _buildMockOutput
  -> USE_MOCK_AGENTS=false -> AgentService -> Python FastAPI agents
```

Real Claude runner khong con la stub. No dung `@anthropic-ai/claude-agent-sdk`,
gan `canUseTool` vao AIFA `onGate`, normalize output va kiem tra
`agent-io.v3`.

Moi execution path deu phai dua output vao `_saveAgentData`, sau do validate,
luu artifact va quyet dinh handoff.

## 5. Output contract va validation

Co hai contract can phan biet:

| Contract | Noi khai bao | Muc dich |
| --- | --- | --- |
| `agent-io.v3` | `backend/src/services/agentContract.js` | Required output keys chung cho mock/real runner |
| `gate-output.v4` | `SdlcWorkflowService.OUTPUT_CONTRACTS` | Validation chi tiet theo schema, semantic va risk |

Validation flow:

```text
agent output
  -> assertOutputConforms (tren cac real execution boundary)
  -> _saveAgentData
  -> _validateGateOutput
  -> AgentArtifact VALID / INVALID
  -> _evaluateGatePolicy
  -> auto approve hoac human review
```

Ham quan trong:

- `_validateGateOutput(task, output)`: kiem tra `OUTPUT_CONTRACTS`.
- `_threeLayerSummary(task, output)`: gom violation theo schema, semantic va risk.
- `_evaluateGatePolicy(task)`: ket hop confidence, validation, warning va gate mode.
- `_saveAgentData`: ghi file artifact, DB artifact, Task output va validation status.
- `_autoApproveSafeOutput`: commit output an toan va khoi dong downstream.

BLOCKER o bat ky layer nao se danh dau artifact `INVALID`, khong tao handoff va
khong chay downstream.

## 6. Task state va event

State machine nam trong `taskLifecycleService.js`:

```text
queued -> dispatched -> running -> awaiting_gate -> running -> completed
                              \-> failed / cancelled / timeout
```

`taskWorkerService.js`:

- Claim task bang `lockedBy`.
- Ghi heartbeat khi task dang chay.
- Khong tinh thoi gian human gate vao execution budget.
- Reclaim task bi stale sau crash/restart.

`AgentEvent` duoc persist voi sequence tang dan. SSE co the replay event dua
tren `Last-Event-ID` hoac `after_sequence`.

## 7. Gate va HITL

`_makeOnGate(taskId, role)` goi `claudePermissionDispatcher.dispatch`.

Tool/action flow:

```text
Claude tool/question
  -> claudePermissionDispatcher
  -> riskClassifier hoac question policy
  -> auto allow | block | gateBridge.requestGate
  -> human resolveApproval
  -> gateBridge.resolveGate
  -> Claude tiep tuc
```

- `riskClassifier.classifyAction`: tra `auto | approval | block`.
- `gateBridge.requestGate`: tao approval ID, persist `PendingGate`, chuyen task
  sang `awaiting_gate` va tra Promise dang cho.
- `resolveApproval`: validate request va danh thuc gate mot lan duy nhat.
- `_getPendingQuestionGate`: khoa pipeline khi dang co question gate.
- `submitStructuredDecision`: stage review co idempotency, optimistic lock,
  edit-approve, reject/rerun va escalation.
- `submitReleaseDecision`: final release gate danh cho owner/admin.

Pending gate metadata da persist, nhung Promise continuation cua live `onGate`
van o trong process. Khi backend restart:

1. Pending gate cu duoc danh dau `interrupted`.
2. `recoverInterruptedGates()` rebuild context va re-dispatch rieng stage bi
   gian doan.
3. Agent tao gate moi neu van can human.

Day la stage-level recovery, chua phai resume dung tai tool call cu.

## 8. Handoff va ordering

- `_nextAgentFor`: chon worker tiep theo; PO co the skip UX dua tren route.
- `_recordApprovedHandoff`: tao artifact `a2a_handoff.v1`.
- `_requireApprovedTask`: kiem tra source completed, committed, VALID, co handoff
  envelope va hash integrity.
- `_startNextAgentIfAvailable`: chi start downstream khi source hop le, khong co
  question gate/pending gate va chua ton tai downstream cung source.
- `_selectCurrentTaskChain`: chi chon task trong cung mot chain; QA cu khong
  duoc ghep voi DEV moi.

QA chi duoc tao tu dung DEV source da completed va committed.

## 9. SSE, polling va UI

Backend task SSE tai:

```text
GET /api/v1/sdlc/status/:task_id
```

No phat:

- `agent_event`
- `progress`
- `completed`
- `error`
- `gate_pending`
- `gate_resolved`
- heartbeat comment

UI chinh `SdlcDashboard` subscribe task SSE truc tiep qua
`GET /api/v1/sdlc/status/:task_id`. Workflow status tong hop duoc tai qua
`GET /api/v1/sdlc/workflow-status`. Timeline va artifact duoc tai khi nguoi dung mo.

## 10. Repo upload va release

Browser folder flow:

```text
AifaDemo showDirectoryPicker/input
  -> uploadRepoFolder
  -> POST /api/v1/sdlc/upload-repo
  -> repoService.prepareUploadedRepo
  -> workspace/projects/<projectId>/repo
```

Backend bo `.git` goc, chan path traversal, khoi tao git repo moi va khong tu
dong chay script trong uploaded repo.

Khi release duoc approve:

```text
submitReleaseDecision
  -> workflowReport.writeReleaseBundle
  -> final.md
  -> qa-report.md
  -> branch/commit/diff/release metadata
```

Release bundle duoc ghi vao repo copy tren server. Tren browser co File System
Access API, frontend giu `DirectoryHandle` voi quyen `readwrite`, tai
`final.md` tu backend va tao file ket qua co ten
`aifa-flow-<flowNo>-add-google-login.md` trong folder local. Frontend khong ghi
de file `final.md` local co san.

## 11. Thu tu doc de hieu code

Doc theo thu tu nay:

1. `docs/architecture.md`
2. `backend/prisma/schema.prisma`
3. `backend/src/server.js`
4. `backend/src/routes/sdlc.js`
5. `backend/src/controllers/SdlcController.js`
6. `backend/src/services/SdlcWorkflowService.js`
7. `backend/src/services/agentContract.js`
8. `backend/src/services/taskLifecycleService.js`
9. `backend/src/services/gateBridge.js`
10. `backend/src/agents/claudePermissionDispatcher.js`
11. `backend/src/agents/claudeCodeRunner.js`
12. `backend/src/services/repoService.js`
13. `backend/src/services/workflowReport.js`
14. `frontend/src/pages/SdlcDashboard/index.tsx`
15. `frontend/src/services/api/sdlcApi.ts`
16. `agents/main.py`
17. `agents/src/agents/po_agent.py`, `ux_agent.py`, `dev_agent.py`, `qa_agent.py`

## 12. Test quan trong

```powershell
cd backend
npm.cmd test -- --runInBand tests/integration/agent-contract.test.js
npm.cmd test -- --runInBand tests/integration/output-contract.test.js
npm.cmd test -- --runInBand tests/integration/aifa-gate.test.js
npm.cmd test -- --runInBand tests/integration/sdlc.handoff.test.js
npm.cmd test -- --runInBand tests/integration/task-lifecycle.test.js
npm.cmd test -- --runInBand tests/integration/claude-code-adapter.test.js
npm.cmd test -- --runInBand tests/integration/workflow-report.test.js
npm.cmd run demo:smoke

cd ../frontend
npm.cmd run build
npm.cmd test

cd ../agents
pytest tests/unit
```

## 13. Luu y khi sua

- Khong bo qua `agent-io.v3` va `gate-output.v4` cho bat ky execution path nao.
- Khong start downstream tu output chua completed, committed hoac dang INVALID.
- Khong start QA tu DEV cu hoac DEV dang con pending gate.
- Loi downstream khong duoc ghi de upstream completed/committed thanh failed.
- Khong tu dong chay script trong uploaded repo.
- Khong cho tool doc secret-like file hoac ghi ra ngoai repo.
- Khong mo rong quyen browser ngoai folder user da chon.
- Khi sua task lifecycle, gate hoac handoff, phai cap nhat test integration lien quan.
