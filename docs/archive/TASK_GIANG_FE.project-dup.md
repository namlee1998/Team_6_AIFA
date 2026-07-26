# 🎯 Task Assignment: Giang — Frontend Lead & Project Manager

> **Vai trò:** Frontend Development + Quản lý dự án
> **Phases chịu trách nhiệm:** Phase 3 (FE) + Phase 4 (docs) + quản lý tổng
> **Tham chiếu:** [AIFA_INTEGRATION_PLAN.md](./AIFA_INTEGRATION_PLAN.md)

---

## Tổng Quan Công Việc

```
Day 1-2: Setup FE + Mock API + Update RepoInput + GatePanel
Day 3-4: PipelineStepper update + DiffViewer + AuditLog + FinalApproval
Day 5:   Integrate FE ↔ Backend (Minh) + SSE connection
Day 6:   E2E test + fix bugs
Day 7:   Docs + cleanup + review toàn bộ

Song song: Quản lý tiến độ team (Minh, Nam)
```

---

## Phase 3: Frontend — 1 Màn Tối Giản (AIFA v3 §8)

### Day 1-2: Foundation + RepoInput + GatePanel

- [x] **Setup mock API layer**
  - File: `frontend/src/services/api/sdlcApi.ts`
  - Tạo biến `VITE_USE_MOCK=true` trong `.env.development`
  - Mock data cho AIFA endpoints:
    ```typescript
    POST /api/v1/sdlc/run-po-agent     → { workflowId, status }
    GET  /api/v1/sdlc/pipeline/:id     → { status, routeType, pipelinePhases, pendingGates, auditLog }
    POST /api/v1/sdlc/approvals/:id    → { success }
    POST /api/v1/sdlc/projects/:id/release-decision → { success, branch, finalMd }
    ```
  - Mock data cover: REPO_CLONING, PO_RUNNING, DEV_FILE_GATE, SANDBOX_TESTING, QA_GATE, FINAL_APPROVAL

- [x] **Update Zustand store**
  - File: `frontend/src/store/useSdlcStore.ts`
  - State mới theo AIFA:
    ```typescript
    interface SdlcState {
      // Input
      repoUrl: string;
      featureRequest: string;           // 🆕 "add google login"

      // Pipeline
      workflowId: string | null;
      routeType: 'UI' | 'BACKEND' | 'ANALYSIS' | 'FULLSTACK' | null;
      pipelinePhases: PhaseStatus[];    // dynamic based on route

      // Gates — phân loại (thay approvals)
      pendingGates: GateItem[];
      gateHistory: GateItem[];

      // Audit
      auditLog: AuditEntry[];           // 🆕 realtime

      // Output
      qaResult: QAResult | null;
      releaseStatus: 'pending' | 'approved' | 'rejected' | null;

      // Actions
      startPipeline: (repoUrl: string, request: string) => Promise<void>;
      resolveGate: (gateId: string, action: string, comment?: string) => Promise<void>;
      releaseDecision: (action: string) => Promise<void>;
    }
    ```

- [x] **Update Component: RepoInput**
  - File: `frontend/src/pages/SdlcDashboard/components/RepoInput.tsx`
  - **Thêm:** input field cho Feature Request (AIFA v3: repo + request)
  - URL validation (github.com/*, gitlab.com/*, bitbucket.org/*)
  - Default request: "add google login"
  - **Wireframe:**
    ```
    ┌────────────────────────────────────────────────────┐
    │  🔗 Repository URL            Feature Request      │
    │  ┌───────────────────────┐   ┌──────────────────┐  │
    │  │ https://github.com/...│   │ add google login │  │
    │  └───────────────────────┘   └──────────────────┘  │
    │                                         [▶ Run]    │
    │  📊 sample-app | React + Node.js | 90 files        │
    └────────────────────────────────────────────────────┘
    ```

- [ ] **NEW Component: GatePanel** ⭐ (core innovation — AIFA v3 §5.3, §5.2)
  - File: `frontend/src/pages/SdlcDashboard/components/GatePanel.tsx`
  - **Gate loại A (DEV file risk):**
    - Hiển thị file path + risk reason
    - Hiển thị **diff** (không chỉ tên file — AIFA v3 §12.11)
    - Approve / Reject + Comment
    - Badge: AUTO ✅ / APPROVAL 🔔 / BLOCK ❌
  - **Gate loại B (PO clarification):**
    - Tối đa 3 câu hỏi + options
    - User chọn hoặc dùng default
  - **Wireframe:**
    ```
    ┌───────────────────────────────────────────────────┐
    │  🔔 DEV GATE — Require Approval                   │
    │                                                   │
    │  DEV muốn sửa `src/middleware/auth.js`            │
    │  Risk: auth/security file                          │
    │                                                   │
    │  --- a/src/middleware/auth.js                      │
    │  +++ b/src/middleware/auth.js                      │
    │  @@ -15,3 +15,8 @@                                │
    │  + const googleAuth = require('./google-oauth');   │
    │  + app.use('/auth/google', googleAuth.router);    │
    │                                                   │
    │  [✅ Approve]  [❌ Reject + Comment]               │
    └───────────────────────────────────────────────────┘
    ```

---

### Day 3: PipelineStepper Update + DiffViewer

- [x] **Update Component: PipelineStepper**
  - File: `frontend/src/pages/SdlcDashboard/components/PipelineStepper.tsx`
  - **Route linh hoạt** (AIFA v3 §4.2):
    - FULLSTACK: PO → UX → DEV → QA (4 steps)
    - BACKEND: PO → DEV → QA (3 steps, skip UX)
    - ANALYSIS: PO → QA (2 steps)
  - Hiện route badge: "Route: FULLSTACK" / "Route: BACKEND (skip UX)"
  - States: pending | running | gate_pending | complete | failed
  - **Wireframe:**
    ```
    ┌──────────────────────────────────────────────────┐
    │  Pipeline    Route: FULLSTACK (UI + Backend)      │
    │  ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐     │
    │  │ PO ✅ │──▶│ UX ✅ │──▶│DEV 🔔│──▶│ QA ○ │     │
    │  │ 2m30s │   │ 1m45s│   │ gate │   │      │     │
    │  └──────┘   └──────┘   └──────┘   └──────┘     │
    └──────────────────────────────────────────────────┘
    ```

- [ ] **NEW Component: DiffViewer** (AIFA v3 §12.11)
  - File: `frontend/src/pages/SdlcDashboard/components/DiffViewer.tsx`
  - Render unified diff với syntax highlighting
  - Dùng `react-diff-viewer-continued` hoặc custom CSS
  - Props: `diff: string`, `fileName: string`
  - Used by: GatePanel, DetailModal
  - ```powershell
    cd frontend && npm install react-diff-viewer-continued
    ```

---

### Day 4: AuditLog + FinalApproval + ApprovalQueue + QAResultCard

- [ ] **NEW Component: AuditLog** (AIFA v3 §8.6)
  - File: `frontend/src/pages/SdlcDashboard/components/AuditLog.tsx`
  - List gọn, realtime (SSE driven)
  - Mỗi entry: timestamp + actor icon + action + status badge
  - Filter: agent type (PO/UX/DEV/QA/A2A/SYSTEM)
  - **Wireframe:**
    ```
    ┌───────────────────────────────────────────────────┐
    │  📋 Audit Log (realtime)                          │
    │  10:30:05  🤖 PO  ✅ Route classified: FULLSTACK  │
    │  10:30:35  🤖 PO  ✅ PRD generated (conf: 88%)    │
    │  10:31:00  🔗 A2A ✅ PO→UX handoff (hash ✓)       │
    │  10:32:45  🎨 UX  ✅ UX spec generated             │
    │  10:33:00  💻 DEV ⏳ Running...                     │
    │  10:33:15  💻 DEV 🔔 Gate: auth.js needs approval  │
    └───────────────────────────────────────────────────┘
    ```

- [ ] **NEW Component: FinalApproval** (AIFA v3 §5.7)
  - File: `frontend/src/pages/SdlcDashboard/components/FinalApproval.tsx`
  - Nút "Approve Release" (disabled until QA passes + no blockers)
  - Hiện output release info: branch name, commit hash, final.md status
  - Owner/admin only

- [x] **Component: ApprovalQueue** — ✅ Giữ nguyên
- [x] **Component: QAResultCard** — ✅ Giữ nguyên
- [x] **Component: DetailModal** — ✅ Giữ nguyên

---

### Day 5: Integration với Backend

- [ ] **Connect SSE stream**
  - `EventSource('/api/v1/sdlc/stream/:workflowId')`
  - Handle events: progress, gate_pending, gate_resolved, completed, error, heartbeat
  - Reconnect on error

- [ ] **Chuyển mock → real API**
  - Set `VITE_USE_MOCK=false`
  - Verify tất cả endpoints hoạt động
  - Test SSE realtime updates

- [ ] **Update SdlcDashboard/index.tsx**
  - Layout: RepoInput → PipelineStepper → GatePanel → AuditLog → FinalApproval
  - Archive các components cũ (move vào `_archive/`)

---

### Day 6: Testing + Polish

- [ ] **Test tất cả flows:**
  - [ ] Submit repo + request → clone → analyze → hiện tech stack
  - [ ] PO route classification → stepper adjusts (3 or 4 steps)
  - [ ] A2A handoff visible trong audit log
  - [ ] DEV file gate → GatePanel hiện diff
  - [ ] Approve gate → pipeline continues
  - [ ] Reject gate → pipeline stops + reason required
  - [ ] QA complete → QAResultCard hiện
  - [ ] Final approval → RELEASED
  - [ ] Audit log shows full trail

- [ ] **UI polish:**
  - [ ] Responsive trên mobile
  - [ ] Dark mode compatibility
  - [ ] Loading skeletons
  - [ ] Error states (network error, timeout)
  - [ ] Empty states

---

## Phase 4: Documentation (Day 7)

- [ ] Update `README.md` — hướng dẫn setup FE, remove Multica references
- [ ] Update `frontend/docs/PROGRESS.md` — ghi nhận tiến độ
- [ ] Review + merge code của Minh và Nam
- [ ] Viết `docs/DEMO_GUIDE.md` — hướng dẫn demo AIFA flow

---

## Quản Lý Dự Án (Song Song Cả Tuần)

### Daily check:
- [ ] **Day 1:** Confirm Minh bắt đầu RepoService + GateBridge, Nam hiểu AIFA v3 strategy
- [ ] **Day 2:** Verify Docker sandbox build thành công
- [ ] **Day 3:** Review API contract với Minh — thống nhất SSE events + gate types
- [ ] **Day 4:** Check Nam đã update agent prompts với route_classification chưa
- [ ] **Day 5:** Integration day — pair với Minh để connect SSE + gates
- [ ] **Day 6:** Full team test E2E AIFA flow
- [ ] **Day 7:** Final review + docs

### Blocking issues cần escalate:
- Nếu Docker Desktop không chạy → fallback: skip sandbox test, chỉ mock
- Nếu API contract thay đổi → update mock data + thông báo Minh
- Nếu SSE không hoạt động → fallback: polling mỗi 3s

---

## Files Tôi Chịu Trách Nhiệm

| Action | File |
|---|---|
| 🆕 NEW | `frontend/src/pages/SdlcDashboard/components/GatePanel.tsx` |
| 🆕 NEW | `frontend/src/pages/SdlcDashboard/components/DiffViewer.tsx` |
| 🆕 NEW | `frontend/src/pages/SdlcDashboard/components/AuditLog.tsx` |
| 🆕 NEW | `frontend/src/pages/SdlcDashboard/components/FinalApproval.tsx` |
| 🔄 MODIFY | `frontend/src/pages/SdlcDashboard/components/RepoInput.tsx` |
| 🔄 MODIFY | `frontend/src/pages/SdlcDashboard/components/PipelineStepper.tsx` |
| ✅ KEEP | `frontend/src/pages/SdlcDashboard/components/ApprovalQueue.tsx` |
| ✅ KEEP | `frontend/src/pages/SdlcDashboard/components/QAResultCard.tsx` |
| ✅ KEEP | `frontend/src/pages/SdlcDashboard/components/DetailModal.tsx` |
| ✅ KEEP | `frontend/src/pages/SdlcDashboard/components/HumanGatePanel.tsx` |
| 🔄 MODIFY | `frontend/src/pages/SdlcDashboard/index.tsx` |
| 🔄 MODIFY | `frontend/src/services/api/sdlcApi.ts` |
| 🔄 MODIFY | `frontend/src/store/useSdlcStore.ts` |
| 🆕 NEW | `docs/DEMO_GUIDE.md` |
| 🔄 MODIFY | `README.md` |
| 📁 ARCHIVE | 9 old FE components (AgentPhaseCard, FeatureRequestForm, McpActivityPanel, StageInspector, PenpotPreview, ReleaseGatePanel, ArtifactViewer, KanbanBoard, WorkflowMetricsPanel) |

---

## API Contract (Thống nhất với Minh)

```typescript
// === Types ===

type GateType = 'DEV_FILE_GATE' | 'PO_CLARIFY' | 'HITL_REVIEW' | 'FINAL_RELEASE';
type RouteType = 'UI' | 'BACKEND' | 'ANALYSIS' | 'FULLSTACK';
type GateAction = 'approve' | 'reject';

interface GateItem {
  id: string;
  type: GateType;
  payload: {
    action?: string;         // 'MODIFY' | 'DELETE' | 'CREATE'
    path?: string;           // file path
    reason?: string;         // risk reason
    diff?: string;           // unified diff (AIFA v3: "hiển thị diff")
    questions?: string[];    // PO clarification questions (max 3)
  };
  createdAt: string;
}

interface AuditEntry {
  timestamp: string;
  actor: 'PO' | 'UX' | 'DEV' | 'QA' | 'A2A' | 'SYSTEM' | 'USER';
  action: string;
  status: 'ok' | 'warning' | 'error' | 'pending';
}

interface PhaseStatus {
  agent: 'PO' | 'UX' | 'DEV' | 'QA';
  status: 'pending' | 'running' | 'gate_pending' | 'completed' | 'failed' | 'skipped';
  duration?: string;
}

interface PipelineResponse {
  workflowId: string;
  status: string;
  routeType: RouteType;
  pipelinePhases: PhaseStatus[];
  pendingGates: GateItem[];
  auditLog: AuditEntry[];
  qaResult?: QAResult;
  repoInfo?: {
    techStack: string[];
    fileCount: number;
    components: string[];
  };
}
```

> ⚠️ **Lưu ý:** API contract này cần Minh confirm. Nếu có thay đổi → update mock data tương ứng.
