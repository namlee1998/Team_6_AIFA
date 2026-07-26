# Tài liệu Luồng Hoạt Động SDLC Agent Pipeline

UI sẽ nhận các event như:

- `progress`
- `gate_pending`
- `gate_resolved`
- `completed`

Store ở `useSdlcStore.ts` cập nhật trạng thái cho dashboard.

---

## 1) Nếu có gate thì user approve/reject

Khi agent hoàn tất, hệ thống tạo gate review.  
User bấm approve/reject trên UI, frontend gọi:

- `POST /sdlc/approvals/...` hoặc `POST /sdlc/tasks/:task_id/gate-decision`

Backend xử lý ở controller/service:

- Lưu decision vào DB
- Commit task (`versionStatus='committed'`)
- Ghi handoff artifact
- Nếu có next phase thì tự start phase tiếp theo

Ví dụ:

- PO approve → tự chạy UX
- UX approve → tự chạy DEV
- DEV approve → tự chạy QA

---

## 10) Repeat cho từng phase và kết thúc

Quy trình lặp lại theo cùng template:

- Tạo task mới cho phase tiếp theo
- Gọi agent tương ứng
- Lưu artifact
- Tạo gate mới

Cuối cùng ở QA:

- Nếu user approve final release, workflow kết thúc
- Frontend nhận event `completed`
- UI chuyển sang trạng thái final (show release artifacts / export / review)

---

## Tóm tắt call chain chính

- **UI:** `startPipeline()`
- **API:** `POST /sdlc/run-po-agent`
- **Controller:** `runPOAgent()`
- **Service:** `SdlcWorkflowService.runPOAgent()`
- **Service:** `_runAgent()`
- **Service:** `AgentService.runAgent()`
- **Python:** agent runtime stream SSE
- **Service:** `_saveAgentData()`
- **DB + filesystem:** persist artifact
- **Frontend:** receive SSE/polling update
- **Human gate decision**
- **Next agent starts**
- **Repeat until QA release**

---

# Luồng B: User upload repo từ frontend

### B.1) User upload repo từ frontend

Frontend gọi API qua `sdlcApi.ts`, thường là hàm liên quan tới upload repo.

Request đi tới: `sdlc.js`  
Endpoint:

```http
POST /api/v1/sdlc/upload-repo
```

Body có:

- `project_id`
- `paths[]` (đường dẫn tương đối của file)
- multipart file payload

### 2) Controller nhận request

Trong `SdlcController.js`, hàm `uploadRepo()` làm:

- Đọc `project_id`
- Đọc `req.files`
- Đọc `paths`
- Build entries gồm `{ relativePath, buffer }`
- Gọi `repoService.prepareUploadedRepo(...)`

Kết quả trả về:

- `repo_path`
- `base_branch`
- `file_count`

> [!NOTE]  
> Đây là bước “repo đã được đưa vào backend workspace”, nhưng vẫn chưa tạo session chạy agent.

### 1) Repo service chuẩn hóa repo upload

Đây là phần cốt lõi của luồng b, nằm ở `repoService.js`.

Hàm quan trọng là `prepareUploadedRepo(...)`:

- Xóa thư mục project repo cũ nếu có
- Tạo lại thư mục project repo
- Viết từng file upload vào đúng vị trí
- `git init`
- Config git user
- Commit ban đầu để repo có history

Log bạn thấy đúng là:

```text
session repo prepared from canonical upload
```

### 5) Session được lưu vào DB

Trong `runPOAgent()` của `SdlcWorkflowService.js`, backend sẽ:

- Tạo `PipelineSession`
- Gắn `repoPath`, `workingBranch`, `baseBranch`
- Tạo `Task` cho PO phase

---

# Luồng C: Chạy pipeline thực tế

### C.1) Luồng c bắt đầu từ đâu

Luồng c không bắt đầu bằng upload repo nữa.  
Nó bắt đầu sau khi repo/session đã sẵn sàng.

Nói cách khác:

- **Luồng b:** chuẩn bị repo + session
- **Luồng c:** dùng repo/session đó để chạy pipeline thật

### 2) Từ UI, user kích hoạt phase đầu tiên

Frontend có thể gọi:

- `POST /api/v1/sdlc/run-po-agent`
- Hoặc `POST /api/v1/sdlc/run-ux-agent`
- Hoặc `POST /api/v1/sdlc/run-dev-agent`
- Hoặc `POST /api/v1/sdlc/run-qa-agent`

Các route này nằm ở `sdlc.js`.  
Controller tương ứng ở `SdlcController.js` sẽ validate và gọi service phù hợp.

### 1) Service tạo task và context cho phase

Với PO, logic chính nằm ở `runPOAgent()` trong `SdlcWorkflowService.js`.

Mỗi phase làm 3 việc cơ bản:

1. Lấy source artifacts / nguồn dữ liệu
2. Tạo task mới với `status='pending'`
3. Build context cho agent

Ví dụ:

- `runUXAgent()` cần source từ approved PO task
- `runDEVAgent()` cần source từ approved UX hoặc PO
- `runQAAgent()` cần source từ approved DEV

### 4) `_runAgent()` chạy thật

Sau khi task được tạo, code gọi `_runAgent(task, context, userId)`.

Hàm này ở `SdlcWorkflowService.js` làm:

- Task chuyển `pending` → `processing`
- `taskWorker.beginRun(...)` bắt đầu lock/heartbeat
- Gọi `AgentService.runAgent(...)`
- Nhận stream SSE từ agent runtime

Nói ngắn gọn:

- Task đang chạy
- Worker lock được giữ
- Agent nhận repo/session/context để xử lý

### 5) Agent hoàn thành thì `_saveAgentData()` lưu output

Khi agent trả output, `_runAgent()` gọi `_saveAgentData()`.  
Đây là phần cực kỳ quan trọng trong luồng c.

Trong `_saveAgentData()`:

- Lưu artifact theo từng loại (`prd`, `ux_spec`, `implementation_plan`, `test_cases`, ...)
- Write file ra filesystem
- Upsert vào `AgentArtifact`
- Update task thành completed
- Ghi `taskLifecycle.transition(..., 'completed')`

Ngoài ra:

- Nếu là QA, nó còn chạy `QualityGateService.evaluate(...)`

### 6) Sau khi output hoàn thành, hệ thống tạo review gate

Sau khi task `completed`, code kiểm tra output và tạo gate review nếu cần:

- `clarification_questions` → tạo question gate
- Output invalid / cần reviewer → tạo `output_review` gate

Gate này được tạo bằng `gateBridge.requestGate(...)` trong `gateBridge.js`.

Ý nghĩa:

- Agent xong chưa tự động chuyển tiếp
- Phải có người review trước

### 7) Approve / reject quyết định phase tiếp theo

Khi user approve hoặc reject, backend xử lý qua:

- `resolveOutputReviewGate(...)` nếu là output-review gate
- Hoặc `submitGateDecision(...)` nếu là legacy gate

**Nếu approve:**

- Task được committed
- `approvedOutput` được lưu
- `_recordApprovedHandoff(...)` tạo handoff artifact
- `_startNextAgentIfAvailable(...)` chạy phase tiếp theo

**Nếu reject:**

- Hệ thống rerun cùng phase với feedback
- Hoặc escalate nếu vượt ngưỡng retry

### 8) `_startNextAgentIfAvailable()` là “điểm nối” của pipeline

Hàm này ở `SdlcWorkflowService.js` rất quan trọng.

Nó kiểm tra:

- Task hiện tại có phải completed và `versionStatus='committed'`
- Không có pending gate đang chờ
- Phase tiếp theo có tồn tại hay không

**Nếu có:**

- `runUXAgent`
- `runDEVAgent`
- `runQAAgent`

**Nếu không:**

- Pipeline kết thúc hoặc chuyển sang release review

### 9) Frontend theo dõi pipeline bằng SSE/polling

Frontend dùng `sdlcApi.ts` để:

- Subscribe pipeline stream
- Cập nhật progress
- Nhận `gate_pending`
- Nhận final completed

Store ở `useSdlcStore.ts` cập nhật UI theo từng phase.

---

# Luồng D: Backend → Agent runtime

Đây là đường đi từ Node backend sang Python agent server, rồi quay lại để backend lưu kết quả.

### 1) Backend chuẩn bị request

Trong `SdlcWorkflowService.js`, `_runAgent()` sẽ:

- Đổi task sang `processing` / `running`
- Gọi `AgentService.runAgent(...)`
- Đưa vào payload gồm:
  - `sessionId` = `task.id`
  - `nodeTarget` = `po_agent` | `ux_agent` | `dev_agent` | `qa_agent`
  - context (PRD, UX spec, repo context, feedback, v.v.)

### 2) Backend gửi HTTP stream đến Python

`AgentService.runAgent()` ở `AgentService.js` dùng `axios.post(...)` đến endpoint `/v1/agent/run` của Python service, với `responseType: 'stream'`.

Payload chính gồm:

- `session_id`
- `node_target`
- `context`
- `user_id`
- `project_id`
- `source_run_id`
- `auto_approve`

### 3) Python runtime nhận và phân luồng

Trong `main.py`:

- Endpoint `/v1/agent/run` đọc request
- `_parse_agent_input()` chuyển context thành đúng schema cho từng agent
- `_stream_agent()` dispatch sang đúng node:
  - `po_agent`
  - `ux_agent`
  - `dev_agent`
  - `qa_agent`
- Server trả về SSE events:
  - `progress`
  - `completed`
  - `requires_action`
  - `error`

### 4) Backend đọc stream và xử lý

Ở `_runAgent()` trong `SdlcWorkflowService.js`, backend lắng nghe stream:

- Nếu event là `completed` → lấy `completedData`
- Nếu event là `requires_action` → đánh dấu task `PENDING_TOOL_APPROVAL`
- Nếu event là `error` → fail task

Sau đó backend gọi `assertOutputConforms(...)` để kiểm tra output có đủ contract không.

### 1) Lưu artifact và tạo gate review

Nếu hợp lệ, `_saveAgentData()` trong `SdlcWorkflowService.js` sẽ:

- Lưu artifact vào DB/file
- Cập nhật task thành completed
- Gọi `taskLifecycle.transition(..., 'completed')`
- Tạo output review gate qua `gateBridge.requestGate(...)`

> [!IMPORTANT]  
> Đây là chỗ quan trọng: output review gate là “đã hoàn thành rồi, cần người approve”, nên nó không nên kéo task quay lại chạy nữa.

---

# Luồng F: Claude Code path (optional)

Đây là path thay thế cho flow D: thay vì backend gọi Python SSE agent, backend có thể chọn chạy trực tiếp qua Claude Code SDK local nếu biến môi trường `EXECUTION_PATH=claude-code`.

### 1) Backend chọn đúng runner

Trong `SdlcWorkflowService.js`, `_runAgent()` kiểm tra:

- Nếu `EXECUTION_PATH() === 'claude-code'` → thì gọi `_runClaudeCodePath(task, context)`
- Còn không thì dùng path LangChain/Python cũ

### 2) Tạo callback gate cho tool/question

`_runClaudeCodePath()` tạo `onGate` bằng `_makeOnGate(...)` và truyền vào runner.

Cái này rất quan trọng vì Claude Code có thể muốn:

- Ghi file / sửa file
- Chạy bash
- Hỏi câu hỏi cho user

Các hành động này không được tự động approve hết; backend dùng `gateBridge` để tạo approval gate, giống như flow trước.

### 1) Claude runner build prompt và chạy SDK

Trong `claudeCodeRunner.js`:

- `buildPrompt()` tạo prompt theo role (`po-agent`, `ux-agent`, `dev-agent`, `qa-agent`)
- Prompt yêu cầu output phải là JSON đúng contract
- `query()` chạy local Claude SDK
- `makeCanUseTool()` map tool calls sang AIFA gate:
  - Write / Edit / Bash → tool gate
  - AskUserQuestion → question gate

### 4) Xử lý approval khi tool cần human

Nếu Claude muốn dùng tool và bị gate chặn:

- Backend mở pending gate qua `gateBridge.js`
- UI hiện approval
- Người dùng approve/reject
- Runner tiếp tục chạy

> [!NOTE]  
> Điểm khác với flow D là ở đây runner đang chạy trực tiếp trong backend process, chứ không qua HTTP SSE riêng.

### 1) Parse và normalize output

Sau khi kết thúc, runner:

- Parse JSON từ output
- Nếu output bị lẫn/broken thì thử repair
- `normalizeOutput()` ép đúng schema và kiểm tra contract
- Trả về object chuẩn để backend gọi `_saveAgentData()`

### 6) Sau đó pipeline vẫn đi như bình thường

Khi `completedData` có được, backend lại dùng cùng flow lưu artifact và tạo output review gate như các path khác.
