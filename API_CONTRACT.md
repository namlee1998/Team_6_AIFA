# SDLC Multi-AI Agent - API Contract

Tài liệu này định nghĩa "giao kèo" (Contract) giữa Frontend và Backend cho quy trình SDLC. Backend cam kết tuân thủ chính xác các schema Response này. Frontend cam kết truyền đúng Payload.

---

## 1. Agent Execution (Khởi chạy Quy trình)

### 1.1. Khởi chạy luồng PO (Product Owner)
**Endpoint:** `POST /api/v1/sdlc/run-po-agent`  
**Description:** Kích hoạt luồng SDLC bắt đầu từ PO Agent phân tích yêu cầu.

**Request Body (Frontend gửi):**
```json
{
  "project_id": "string (UUID)",
  "request": "string (Tính năng cần phát triển)",
  "repo_url": "string (Optional - Link Github)",
  "repo_path": "string (Optional - Path thư mục local nếu upload)",
  "branch": "string (Optional - Mặc định 'main')"
}
```

**Response (Backend trả về - 200 OK):**
```json
{
  "success": true,
  "data": {
    "workflowId": "string (UUID của pipeline)",
    "status": "running"
  }
}
```

---

## 2. HITL / Gates (Can thiệp & Phê duyệt)

### 2.1. Lấy danh sách cổng chờ duyệt (Pending Gates)
**Endpoint:** `GET /api/v1/sdlc/approvals?task_id={taskId}`  
**Description:** Lấy danh sách các quyết định đang chờ con người duyệt (Approve/Reject).

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "approvalId": "string",
      "taskId": "string",
      "role": "PO | UX | DEV | QA",
      "kind": "tool | question",
      "payload": {
        "reason": "string (Lý do cần duyệt)",
        "diff": "string (Mã nguồn thay đổi, nếu có)",
        "questions": ["Câu hỏi 1", "Câu hỏi 2"]
      },
      "createdAt": "2026-06-15T00:00:00Z"
    }
  ]
}
```

### 2.2. Phê duyệt quyết định
**Endpoint:** `POST /api/v1/sdlc/approvals/:approval_id`  
**Description:** Con người gửi quyết định cho Agent để đi tiếp hoặc sửa lại.

**Request Body:**
```json
{
  "action": "approve | reject",
  "comment": "string (Optional - Ghi chú hoặc lời nhắc cho Agent)"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "status": "resolved"
  }
}
```

---

## 3. Real-time Status & Observability

### 3.1. Server-Sent Events (SSE) Stream
**Endpoint:** `GET /api/v1/sdlc/stream/:workflowId`  
**Description:** Mở kết nối SSE một chiều từ Server về Client để cập nhật trạng thái Agent.

**SSE Format:**
```text
event: status_update
data: {
  "workflowId": "string",
  "status": "running | gate_pending | completed | failed",
  "pipelinePhases": [
    {
      "agent": "PO",
      "status": "completed",
      "duration": "1m 15s"
    }
  ]
}

event: gate_pending
data: {
  "approvalId": "string",
  "role": "DEV",
  "payload": { ... }
}
```

### 3.2. Lịch sử Pipeline (Audit Trail)
**Endpoint:** `GET /api/v1/sdlc/audit-trail/:project_id`  
**Description:** Lấy lịch sử hành động của toàn bộ Agent trong dự án.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "timestamp": "2026-06-15T12:00:00Z",
        "actor": "PO",
        "action": "Generated requirements.md",
        "status": "ok",
        "severity": "info"
      }
    ]
  }
}
```

---

## 4. Báo cáo Tình trạng Hệ thống (Health Check)
**Endpoint:** `GET /api/v1/sdlc/dev/health`  
**Description:** Kiểm tra trạng thái của các API Key AI (OpenAI, Anthropic) và Database.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "db": {
      "status": "ok",
      "projectCount": 5
    },
    "env": {
      "OPENAI_API_KEY": true,
      "ANTHROPIC_API_KEY": true,
      "DATABASE_URL": true
    },
    "timestamp": "2026-06-15T12:05:00Z"
  }
}
```
