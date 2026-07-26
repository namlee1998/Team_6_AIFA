# Luồng Hoạt Động Của AIFA

> Tài liệu mô tả chi tiết luồng hoạt động end‑to‑end của AIFA — từ khi người dùng gửi feature request cho đến khi pipeline hoàn tất và release.

---

## 1. Tổng Quan Kiến Trúc

AIFA gồm 3 service chính:

```
Trình duyệt (React + Vite :5173)
    │
    ├── /api/v1/* ──────────────────────────────────┐
    │                                                 │
    ▼                                                 ▼
Backend (Node.js + Express :3000) ──── Prisma ──── SQLite
    │                                                 │
    ├── Claude Agent SDK (local Claude Code)          │
    │                                                 │
    └── HTTP/SSE ──── Python Agents (FastAPI :8001)   │
                                                     │
                                          workspace/projects/<id>/
```

| Service | Port | Vai trò |
|---------|------|---------|
| Frontend | 5173 | UI dashboard, hiển thị pipeline, intervention center |
| Backend | 3000 | Control plane, orchestrator, persistence, SSE streaming |
| Agents | 8001 | Python/LangChain worker (PO, UX, DEV, QA) |

---

## 2. User Flow Tổng Thể

### 2.1 Bắt đầu: Tạo Project và Feature Request

```
User ──[New Feature Request]──→ AppSidebar
  │                                │
  │  Chọn project hoặc tạo mới     │
  │                                ▼
  │                   FeatureRequestProjectDialog
  │                                │
  │  Nhập tên feature              │
  │  (vd: "add google login")      │
  │                                ▼
  │                   Navigate to /sdlc/build?focusRequest=true
  │                                │
  │                                ▼
  │                   FeatureRequestChatbox
  │                                │
  │  Nhập mô tả chi tiết           │
  │  hoặc "Send directly to PO"    │
  │                                ▼
  │                   sdlcApi.startPipeline()
  │                   POST /api/v1/sdlc/run-po-agent
```

### 2.2 Landing Page

- **Route `/sdlc`**: Hiển thị **Intervention Center** (HitlDashboard) — Kanban board liệt kê tất cả các gate đang chờ xử lý trên toàn bộ project.
- **Route `/sdlc/build`**: Hiển thị **Build Dashboard** — 4 cột agent task grid (PO, UX, DEV, QA).
- **Route `/sdlc/audit`**: Audit trail chi tiết.
- **Route `/sdlc/agents`**: Agent runtime status.
- **Route `/sdlc/debug`**: Developer diagnostics.

---

## 3. SDLC Pipeline chi tiết

### 3.1 Agent Chain

```
intent-agent ──→ po-agent ──→ ux-agent ──→ dev-agent ──→ qa-agent ──→ FINAL_REVIEW ──→ RELEASED
                                 │
                                 └── (UX bị skip nếu route = BACKEND)
```

Mỗi agent nhận đầu vào từ agent trước thông qua cơ chế **A2A Handoff** — một envelope JSON chứa artifact hash, contract, và integrity check.

### 3.2 Phase State Machine

```
BACKLOG
  │
  ▼
PO_RUNNING ──→ PO_REVIEW ──→ UX_RUNNING ──→ UX_REVIEW ──→ DEV_RUNNING ──→ DEV_REVIEW
  │               │              │               │              │               │
  ▼               ▼              ▼               ▼              ▼               ▼
PO_FAILED     (gate)        UX_FAILED       (gate)        DEV_FAILED       (gate)
  │               │              │               │              │               │
  │               ▼              │               ▼              │               ▼
  │           (approved)        │           (approved)        │           (approved)
  │               │              │               │              │               │
  └───────────────┴──────────────┴───────────────┴──────────────┴───────────────┘
                                                                                │
                                                                                ▼
                                                                          QA_RUNNING
                                                                                │
                                                                                ▼
                                                                          QA_REVIEW ──→ FINAL_REVIEW ──→ RELEASED
                                                                             │              │
                                                                             ▼              ▼
                                                                          QA_FAILED    RELEASE_REJECTED
```

### 3.3 Chi tiết từng phase

#### Phase 1: Intent Agent
- **Đầu vào**: Feature request text (raw từ người dùng)
- **Xử lý**: LLM phân tích yêu cầu, đặt giả định (AI Assumptions)
- **Đầu ra**: `intent_assumptions.md`, `clarifying_questions`
- **Gate mode**: `strict_manual` — luôn cần human review

#### Phase 2: PO Agent (Product Owner)
- **Đầu vào**: Intent assumptions + Project context (repo files)
- **Xử lý**:
  1. Gọi MCP `docs.search` để tra cứu tài liệu
  2. LLM sinh PRD, User Stories, Acceptance Criteria
  3. Gọi MCP `confluence.write` để đăng PRD
- **Đầu ra**: `POAgentOutput` (PRD, user_stories, acceptance_criteria, scope)
- **Gate mode**: `confidence_based` — tự động approve nếu confidence ≥ 0.8

#### Phase 3: UX Agent (UI/UX Designer)
- **Đầu vào**: PRD + User Stories từ PO
- **Xử lý**: LLM sinh UX spec, user flow, wireframe spec
- **Đầu ra**: `UXAgentOutput` (ux_spec, user_flow, wireframe_spec, screens)
- **Lưu ý**: Phase này bị **skip** nếu PO classify feature là backend-only

#### Phase 4: DEV Agent (Developer)
- **Đầu vào**: PRD + UX spec (nếu có) + Repo code
- **Xử lý**:
  1. LLM sinh implementation plan và unified git diff
  2. **Sandbox Gate (G3)**: Áp dụng patch vào git worktree, chạy test
     - Nếu sandbox pass → tiếp tục
     - Nếu sandbox fail → retry tối đa 2 lần, sau đó proceed với cảnh báo
- **Đầu ra**: `DEVAgentOutput` (implementation_plan, mock_code_diff, risk_assessment)
- **Risk classification**: Path-based (auth/security → approval required, test/docs → auto)

#### Phase 5: QA Agent (Quality Assurance)
- **Đầu vào**: Tất cả artifact từ các phase trước
- **Xử lý**: LLM sinh test cases, QA report, AC coverage matrix, security findings
- **Đầu ra**: `QAAgentOutput` (test_cases, qa_report, release_recommendation)

#### Phase 6: Quality Gate (G4)
- **Đầu vào**: QA output
- **Xử lý**: Evaluator chạy trên task complexity classification:
  | Complexity | Tiêu chí | Min TC | Coverage | Score để PASS |
  |------------|----------|--------|----------|---------------|
  | Small | ≤3 AC, không sensitive | 5 | 80% | ≥70 |
  | Medium | 4-8 AC hoặc sensitive domain | 15 | 90% | ≥80 |
  | Large | >8 AC hoặc integration/migration | 15 | 95% | ≥90 |
- **Đầu ra**: `QualityGateResult` (score, recommendation: PASS/HOLD/REWORK)

#### Phase 7: Final Release
- **Đầu vào**: QA gate pass + all artifacts
- **Human decision**: Approve hoặc Reject release
- **Đầu ra**: `RELEASED` hoặc `RELEASE_REJECTED`

---

## 4. Human-in-the-Loop (HITL)

### 4.1 Ba loại Gate

| Gate type | Mục đích | Xuất hiện ở |
|-----------|----------|-------------|
| `DEV_FILE_GATE` | Security — file nguy hiểm bị modify | DEV phase |
| `PO_CLARIFY` | PO cần clarification từ human | PO phase |
| `FINAL_RELEASE` | Approve/reject release cuối | Final phase |

### 4.2 Ba chế độ Gate Mode

```typescript
GATE_MODE = {
  STRICT_MANUAL: 'strict_manual',     // Luôn chờ human
  CONFIDENCE: 'confidence_based',     // Chỉ dừng khi low confidence
  AUTO_SAFE: 'auto_approve_safe',     // Tự động approve nếu an toàn
}
```

### 4.3 Luồng HITL từ Frontend

```
Backend phát hiện gate condition
        │
        ▼
  SSE event: gate_pending
        │
        ▼
  useSdlcStore.pendingGates += newGate
  useHitlStore.interventions += newItem
        │
        ├──→ HitlDashboard (/sdlc)
        │      ├── Kanban column: Security Gates / PO Clarifications / Release Approvals
        │      ├── User click "Approve" → resolveGate(id, 'approve')
        │      ├── User click "Reject" → resolveGate(id, 'reject')
        │      ├── User click "Review" → navigate to /sdlc/build?highlightGate=<id>
        │      └── Poll interval: 30 giây
        │
        └──→ SdlcDashboard (/sdlc/build)
               └── Hiển thị gate_pending status trên agent column
```

### 4.4 Xử lý decision ở Backend

```
resolveGate(gateId, action, comment?)
        │
        ▼
  gateBridge.resolveGate()
        │
        ├── APPROVE → commit task, record handoff, start next agent
        ├── REJECT → _rerunOwningWorker() (chạy lại agent với feedback)
        └── REQUEST_CHANGES → tương tự REJECT
```

---

## 5. SSE Streaming

### 5.1 Backend → Frontend

Hai endpoint SSE:

| Endpoint | Mục đích |
|----------|----------|
| `GET /api/v1/sdlc/stream/:workflowId` | Pipeline-level stream (tổng hợp tất cả phase) |
| `GET /api/v1/sdlc/status/:task_id` | Task-level stream (single agent) |

**Event types (pipeline stream):**

```
event: progress
data: {"status": "po_running", "pipelinePhases": [...], "auditLog": [...]}

event: gate_pending
data: {"gateId": "...", "type": "DEV_FILE_GATE", ...}

event: gate_resolved
data: {"gateId": "...", "resolution": "approved"}

event: completed
data: {"status": "qa_complete", "qaResult": {...}}

event: error
data: {"message": "..."}
```

**Cơ chế**: Frontend dùng `fetch()` + `ReadableStream` tự parse SSE (không dùng EventSource). Có fallback polling 4 giây nếu SSE bị lỗi.

### 5.2 Backend → Python Agents

```
POST /v1/agent/run
Content-Type: application/json

Response: text/event-stream

event: progress
data: {"step": "po_agent", "token": "đang phân tích..."}

event: completed
data: {"prd": "...", "user_stories": [...], ...}

event: error
data: {"message": "..."}
```

Mỗi agent stream token-level qua `astream_events` (LangChain v2). DEV Agent có sandbox execution embedded trong stream loop.

---

## 6. Mock Mode

### 6.1 Backend Mock

```
backend/.env
USE_MOCK_AGENTS=true
MOCK_LOW_CONFIDENCE_STAGE=dev-agent   # optional: simulate low confidence ở stage nào
```

Khi `USE_MOCK_AGENTS=true`, backend không gọi Python agents mà dùng `_buildMockOutput()` — đọc từ `mock-data/` và simulate artifact + gate.

### 6.2 Frontend Mock

```
frontend/.env
VITE_USE_MOCK=true
```

Khi bật, frontend tự mock API response — chạy hoàn toàn client-side, không cần backend.

### 6.3 Agent Mock (MCP)

Tất cả MCP tools (Confluence, Jira, Penpot, TestRail) đều có mock implementation trong `agents/src/mcp/mocks/` — thao tác trên local filesystem thay vì gọi service thật.

### 6.4 Sandbox Mock

```env
AGENT_REAL_SANDBOX=false   # default: chỉ validate format diff, không chạy test thật
AGENT_REAL_SANDBOX=true    # chạy sandbox thật (git worktree + test command)
```

---

## 7. Task Execution State Machine

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    v                                     │
queued → dispatched → running → awaiting_gate ───────────┘
                    │   │          │
                    │   │          ├── completed ──→ gate evaluation
                    │   │          │                    │
                    │   │          │          auto-approve / human approve
                    │   │          │                    │
                    │   │          │              committed + handoff
                    │   │          │                    │
                    │   │          │           _startNextAgentIfAvailable
                    │   │          │
                    │   │          └── failed / cancelled / timeout
                    │   │
                    │   └──→ completed (no gate)
                    │
                    └──→ failed ──→ backlog status = TODO
```

---

## 8. Quality Gate (G4) Evaluation Flow

```
QA Agent output
        │
        ▼
  Classify complexity (small/medium/large)
        │
        ▼
  Evaluate hard rules:
    ├── Count test types (happy/negative/edge/security)
    ├── Compute AC coverage %
    ├── Run async checks (security scan + static analysis)
    │   └── Chỉ chạy cho medium/large tasks
    ├── Detect violations
    └── Compute weighted score (0-100)
        │
        ▼
  Score ≥ threshold?
    ├── YES → PASS → release pipeline tiếp
    └── NO → HOLD/REWORK → human review
```

---

## 9. Sơ đồ Sequence (End-to-End)

```
User            Frontend              Backend           Python Agents
 │                  │                    │                    │
 │ feature request  │                    │                    │
 │─────────────────→│                    │                    │
 │                  │ POST /run-po-agent │                    │
 │                  │───────────────────→│                    │
 │                  │                    │ Create Task (PO)   │
 │                  │                    │───────────────────→│
 │                  │                    │  SSE: progress     │
 │                  │                    │←───────────────────│
 │                  │                    │  SSE: completed    │
 │                  │                    │←───────────────────│
 │                  │                    │                    │
 │                  │  SSE: gate_pending │                    │
 │                  │←───────────────────│                    │
 │                  │                    │                    │
 │  HitlDashboard   │                    │                    │
 │←─────────────────│                    │                    │
 │                  │                    │                    │
 │  Approve gate    │                    │                    │
 │─────────────────→│ POST /approvals    │                    │
 │                  │───────────────────→│                    │
 │                  │                    │ record handoff     │
 │                  │                    │ start UX agent     │
 │                  │                    │───────────────────→│
 │                  │                    │  ... (lặp lại)     │
 │                  │                    │←───────────────────│
 │                  │                    │                    │
 │  ... tiếp tục cho DEV, QA ...         │                    │
 │                  │                    │                    │
 │                  │  SSE: gate_pending │                    │
 │                  │←───────────────────│ (FINAL_RELEASE)    │
 │  Approve release │                    │                    │
 │─────────────────→│ POST /release-decision                  │
 │                  │───────────────────→│                    │
 │                  │                    │                    │
 │                  │  status: RELEASED  │                    │
 │                  │←───────────────────│                    │
```

---

## 10. File & Code Map

| Thành phần | File | Vai trò |
|------------|------|---------|
| **Frontend** | | |
| Dashboard | `frontend/src/pages/SdlcDashboard/index.tsx` | Build dashboard (agent task grid) |
| Interventions | `frontend/src/pages/SdlcDashboard/HitlDashboard.tsx` | Intervention Center (Kanban) |
| SDLC Store | `frontend/src/store/useSdlcStore.ts` | Pipeline state, polling, SSE |
| HITL Store | `frontend/src/store/useHitlStore.ts` | Global intervention state |
| API client | `frontend/src/services/api/sdlcApi.ts` | Tất cả SDLC API calls + SSE |
| **Backend** | | |
| Orchestrator | `backend/src/services/SdlcWorkflowService.js` | Central orchestrator (3270 lines) |
| Controller | `backend/src/controllers/SdlcController.js` | HTTP/SSE adapter |
| Gate bridge | `backend/src/services/gateBridge.js` | In-memory gate wait/resume |
| Task lifecycle | `backend/src/services/taskLifecycleService.js` | State transitions |
| Quality gate | `backend/src/services/QualityGateService.js` | QA gate evaluation |
| Risk classifier | `backend/src/services/riskClassifier.js` | Path-based risk tiers |
| Routes | `backend/src/routes/sdlc.js` | Tất cả SDLC endpoints |
| **Python Agents** | | |
| Entry point | `agents/main.py` | FastAPI + SSE streaming |
| PO Agent | `agents/src/agents/po_agent.py` | PRD generation |
| UX Agent | `agents/src/agents/ux_agent.py` | UX spec + wireframes |
| DEV Agent | `agents/src/agents/dev_agent.py` | Code + sandbox |
| QA Agent | `agents/src/agents/qa_agent.py` | Test cases + release rec |
| Pipeline graph | `agents/src/workflows/main_pipeline.py` | LangGraph state machine |
| Quality evaluator | `agents/src/quality_gate/evaluator.py` | Gate score & violations |
| Hybrid router | `agents/src/utils/router.py` | Per-agent model selection |

---

## 11. Môi trường Chạy

### Development (3 terminal)

```powershell
# Terminal 1 — Agents
cd agents && python main.py

# Terminal 2 — Backend
cd backend && npm run dev

# Terminal 3 — Frontend
cd frontend && npm run dev
```

### Quick Demo

| Bước | Hành động | Kết quả |
|------|-----------|---------|
| 1 | Tạo project (nút `+` trong sidebar) | Project created |
| 2 | Click **New Feature Request** | FeatureRequestChatbox hiện ra |
| 3 | Nhập feature name + "Send directly to PO" | Pipeline bắt đầu chạy |
| 4 | Theo dõi PO → UX → DEV → QA tự động | Agent task grid cập nhật real-time |
| 5 | Tại QA: review output, Approve | Gate resolved, chuyển sang Final |
| 6 | Tại Final Release: Approve release | Status = `RELEASED` |

### Test Low Confidence

Set `MOCK_LOW_CONFIDENCE_STAGE` trong `backend/.env`:

```env
MOCK_LOW_CONFIDENCE_STAGE=po-agent   # hoặc ux-agent, dev-agent
```

Pipeline sẽ dừng ở stage đó và chờ human approve.
