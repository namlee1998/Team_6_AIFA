# Kế Hoạch Tái Cấu Trúc AIFA Platform — Risk-Based Orchestrator

> **Ngày tạo:** 2026-06-06
> **Tác giả:** Team 6
> **Trạng thái:** Hướng B (AIFA v3) + cherry-pick kỹ thuật từ Multica plan
> **Thời gian ước lượng:** 7 ngày làm việc
> **Supersedes:** `MULTICA_INTEGRATION_PLAN.md` (archived)

---

## 1. Bối Cảnh & Quyết Định Chiến Lược

### 1.1 Tóm Tắt Quyết Định

Team đã audit 2 hướng đi và **chọn Hướng B (AIFA v3)** với lý do:

| Tiêu chí | Multica Integration (bỏ) | AIFA Self-built (chọn) |
|---|---|---|
| Governance | Task-level (yếu) | Action-level risk-based ✅ |
| Vendor lock-in | Phụ thuộc Multica platform | 100% code của team ✅ |
| Feasibility | Rủi ro cao (Windows + CLI) | Mock-first, an toàn ✅ |
| Innovation | "Cài tool rồi wrap" | "Tự xây orchestrator" ✅ |

### 1.2 Cherry-pick Từ Multica Plan

Các chi tiết kỹ thuật sau được giữ lại:

| Item | Nguồn | Lý do giữ |
|---|---|---|
| **GitService** (clone, analyze, commit) | Multica Plan §3.2.1 | Cần thiết cho repo-first flow |
| **Docker Local Sandbox** | Multica Plan §2.4 | Isolation tốt, free, thay E2B |
| **Pipeline UI wireframe** | Multica Plan §3.3.3 | Visualization rõ ràng |
| **Verification plan** | Multica Plan §6 | Test checklist chi tiết |
| **Sandbox Dockerfile** | Multica Plan §2.4 | Security hardening flags |

### 1.3 Định Vị Sản Phẩm — AIFA

> **AIFA** — Orchestrator kiểm soát AI agent theo mức rủi ro: hành động an toàn được tự động hóa, hành động rủi ro phải qua human gate.

AIFA không bán giấc mơ "AI tự viết phần mềm". AIFA bán năng lực **kiểm soát** AI agent trong quy trình phát triển phần mềm — governance, approval, handoff, audit, traceability.

---

## 2. Kiến Trúc Tổng Thể

### 2.1 Kiến Trúc Hiện Tại (AS-IS)

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│   Frontend      │     │   Backend Gateway    │     │   Agents Service    │
│   React + Vite  │────▶│   Express + Prisma   │────▶│   FastAPI           │
│   12 components │     │   SQLite             │     │   + LangChain       │
│   42KB CSS      │     │   84KB workflow svc  │     │   + OpenAI API ❌   │
└─────────────────┘     └──────────────────────┘     │   + Langfuse ❌     │
                                                      │   + E2B SDK ❌      │
                                                      └─────────────────────┘
```

**Vấn đề:**
1. Input flow sai: user gõ text → không phải repo-first
2. LLM lock-in: agents gọi trực tiếp OpenAI/Claude API → tốn tiền
3. FE quá phức tạp: 12 components hiển thị đồng thời
4. QA output bị trap: chỉ hiển thị trên UI, không commit vào repo
5. Dependencies thừa: LangChain, OpenAI, Langfuse, E2B
6. Không có risk-based governance

### 2.2 Kiến Trúc Đề Xuất (TO-BE)

```
┌─────────────────────┐
│   Frontend          │
│   React + Vite      │
│   1 màn chính:      │
│   - RepoInput       │
│   - PipelineStepper │
│   - GatePanel       │  ← Gate loại A (DEV risk) + loại B (PO clarify)
│   - AuditLog        │
│   - FinalApproval   │
└────────┬────────────┘
         │ REST + SSE (heartbeat)
         ▼
┌─────────────────────┐
│   Backend Gateway   │
│   Express + Prisma  │
│   + RepoService  🆕 │  ← clone, branch, commit, diff, cleanup
│   + GateBridge   🆕 │  ← registry treo chờ duyệt, idempotent
│   + RiskClassifier🆕│  ← auto/approval/block phân tầng
│   + Validation3L 🆕 │  ← schema + semantic + risk
│   + A2AContract  🆕 │  ← hash integrity, HTTP 409
└────────┬────────────┘
         │ agent-io.v1 interface
         ▼
┌─────────────────────┐     ┌──────────────────────┐
│   Agents Service    │     │   Docker Sandbox     │
│   FastAPI           │     │   --network=none     │
│   Mock runners 🆕   │     │   --memory=512m      │
│   (claude-code mock)│     │   --read-only        │
│   Prompt templates  │     │   ✅ Free, no API key │
│   Output parsers    │     └──────────────────────┘
└─────────────────────┘
         │ git operations
         ▼
┌─────────────────────┐
│   Target Repo       │
│   Branch: aifa/<slug>│
│   + final.md        │
│   + QA report       │
└─────────────────────┘
```

### 2.3 Luồng Dữ Liệu (Data Flow)

```
1. User paste repo URL + request (vd "add google login")
   │
   ▼
2. Backend: RepoService.cloneRepo() + createBranch("aifa/<slug>")
   → workspace/projects/<project-id>/repo/
   │
   ▼
3. Backend: RepoService.analyzeRepo()
   → { techStack, components, fileCount, hasTests, primaryLanguage }
   │
   ▼
4. PO Agent: route classification (bắt buộc)
   → Phân loại: UI / backend / phân tích / full-stack
   → Quyết định skip UX hay không
   │
   ▼
5. PO Agent: PRD + acceptance_criteria + risk_classification
   │
   ▼
6. HITL Gate (G1): validation 3 lớp
   → Đạt → auto handoff qua A2A contract
   → Không đạt → raise INVALID, board cho human
   │
   ▼
7. [Nếu route có UI] UX Agent: ux_spec + wireframe_spec
   │
   ▼
8. HITL Gate (G2): validation 3 lớp
   │
   ▼
9. DEV Agent (mock claude-code): code diff + changed_files
   │
   ▼
10. Gate loại A — PHÂN TẦNG theo risk:
    → Auto-approve: tạo file mới, sửa test/docs/mock
    → Require approval: xóa file, sửa auth/security/payment/env/migration
    → Block: ghi ngoài repo, đọc secret, push main
    │
    ▼
11. Sandbox Gate (G3):
    → Apply patch vào Docker container (--network=none)
    → Chạy test commands
    → FAIL & retries < 3 → quay lại DEV Agent
    → PASS → tiếp QA
    │
    ▼
12. QA Agent: test case + ac_coverage_matrix + release_recommendation
    │
    ▼
13. HITL Gate (G4): QA validation
    │
    ▼
14. Final Approval (owner/admin):
    → Khóa nếu còn blocker cao
    → Approve → RELEASED
    │
    ▼
15. Output Release:
    → Branch aifa/<slug>
    → Commit / patch diff
    → final.md (audit trail)
    → QA report
    → Release decision
```

---

## 3. Quyết Định Kỹ Thuật (Risk-Based Control)

### 3.1 HITL Gate Sau Mỗi Stage

| Điều kiện | Hành vi |
|---|---|
| Đạt ngưỡng + đủ file downstream + validation pass | Tự động handoff qua A2A contract |
| Không đạt / thiếu file / validation fail | INVALID → board cho human (feedback + rerun, max 3 lần → escalation) |

### 3.2 PO Clarification Gate (Giới Hạn)

- Tối đa **1 lần hỏi**, tối đa **3 câu**
- User không trả lời → dùng default assumptions
- Mọi assumption phải ghi vào PRD + audit trail

### 3.3 DEV File Gate — Phân Tầng Theo Risk

| Tầng | Hành động | Ví dụ |
|---|---|---|
| **Auto-approve** | Tạo file mới trong thư mục feature, sửa test/docs/mock | `src/features/login/LoginForm.tsx` |
| **Require approval** | Xóa file, sửa auth/security/payment, sửa env/config, migration DB | `src/middleware/auth.js`, `prisma/schema.prisma` |
| **Block** | Ghi ngoài repo, đọc secret, sửa .env, push main, xóa hàng loạt | `.env`, `git push origin main` |

### 3.4 A2A Contract (Tự Động Khi Đạt)

| Chặng | Required fields | Integrity |
|---|---|---|
| PO → UX | prd, acceptance_criteria, risk_classification | Hash khớp, upstream committed |
| UX → DEV | ux_spec, wireframe_spec, risk_classification | Hash khớp, upstream committed |
| DEV → QA | patch_diff, sandbox_result, self_test_report, security_gate | Hash khớp, upstream committed |
| Thiếu bất kỳ field | HTTP 409 — chặn handoff | |

### 3.5 Validation 3 Lớp

| Lớp | Kiểm tra | Ví dụ |
|---|---|---|
| **Schema** | Đủ field, đúng format | `prd.acceptance_criteria` phải là array |
| **Semantic** | Nội dung hợp lý | AC có testable không? UX map với AC không? |
| **Risk** | Cần approval cao hơn? | auth/payment/security → require human gate |

### 3.6 Idempotency

- Một approval chỉ resolve một lần (double-click safe)
- Approval hết hạn → báo rõ
- Reject phải có reason
- Gate timeout → HOLD/INVALID rõ ràng

---

## 4. Chi Tiết Từng Phase

### Phase 1: Backend Core — RepoService + GateBridge + RiskClassifier (Ngày 1-2)

#### 4.1.1 RepoService — Clone, Branch, Analyze, Commit

**File mới:** `backend/src/services/RepoService.js`

| Method | Input | Output | Mô tả |
|---|---|---|---|
| `cloneRepo(repoUrl, projectId)` | URL + project ID | Local path | Clone vào `workspace/projects/<id>/repo/` |
| `createBranch(localPath, slug)` | Path + slug | Branch name | Tạo branch `aifa/<slug>` |
| `analyzeRepo(localPath)` | Path | RepoAnalysis | Scan tech stack, components, file count |
| `commitArtifact(localPath, filePath, content)` | Path + file + content | Commit hash | Ghi artifact + commit |
| `getRepoDiff(localPath)` | Path | Diff string | `git diff` cho review |
| `cleanup(localPath)` | Path | void | Dọn workspace khi xong |

**Dùng `simple-git` thay `child_process`** (AIFA v3 recommendation):

```javascript
const simpleGit = require('simple-git');

class RepoService {
  async cloneRepo(repoUrl, projectId) {
    const targetDir = path.join(WORKSPACE_DIR, 'projects', projectId, 'repo');
    await simpleGit().clone(repoUrl, targetDir, ['--depth', '1']);
    return targetDir;
  }

  async analyzeRepo(localPath) {
    // Scan package.json, requirements.txt, go.mod, Cargo.toml
    // Detect tech stack, components, file count
    // Return structured RepoAnalysis
  }

  async createBranch(localPath, slug) {
    const git = simpleGit(localPath);
    const branchName = `aifa/${slug}`;
    await git.checkoutLocalBranch(branchName);
    return branchName;
  }

  async commitArtifact(localPath, filePath, content) {
    fs.writeFileSync(path.join(localPath, filePath), content);
    const git = simpleGit(localPath);
    await git.add(filePath);
    const result = await git.commit(`[AIFA] Add ${filePath}`);
    return result.commit;
  }
}
```

**Repo Safety (cherry-pick từ AIFA v3 §12):**
- Clone repo lạ có thể chứa script độc → **cô lập, không tự chạy**
- Secret leakage: agent có thể đọc .env/token → **block đọc secret**
- Workspace isolation: allowlist đường ghi

#### 4.1.2 GateBridge — Registry Treo Chờ Duyệt

**File mới:** `backend/src/services/GateBridge.js`

| Method | Mô tả |
|---|---|
| `requestGate(workflowId, gateType, payload)` | Tạo gate pending, emit SSE `gate_pending` |
| `resolveGate(gateId, action, comment?)` | Resolve gate (idempotent), emit SSE `gate_resolved` |
| `getGateStatus(gateId)` | Trả status hiện tại |
| `watchdogTimeout(gateId, timeoutMs)` | Auto-HOLD nếu không resolve trong timeout |
| `listPendingGates(workflowId)` | List tất cả gates đang chờ |

```javascript
class GateBridge {
  // Idempotent: double-click safe
  async resolveGate(gateId, action, comment) {
    const gate = await prisma.gate.findUnique({ where: { id: gateId } });
    if (gate.status !== 'PENDING') {
      return { alreadyResolved: true, status: gate.status };
    }
    return prisma.gate.update({
      where: { id: gateId },
      data: { status: action, comment, resolvedAt: new Date() }
    });
  }
}
```

#### 4.1.3 RiskClassifier — Phân Tầng Hành Động

**File mới:** `backend/src/services/RiskClassifier.js`

```javascript
class RiskClassifier {
  classify(action, filePath, context) {
    // BLOCK — cấm tuyệt đối
    if (this.isBlockedAction(action, filePath)) return 'BLOCK';
    // REQUIRE_APPROVAL — cần human gate
    if (this.isRiskyAction(action, filePath)) return 'REQUIRE_APPROVAL';
    // AUTO_APPROVE — an toàn
    return 'AUTO_APPROVE';
  }

  isBlockedAction(action, filePath) {
    return (
      filePath.includes('.env') ||
      action === 'PUSH_MAIN' ||
      action === 'DELETE_BULK' ||
      filePath.startsWith('../') // ghi ngoài repo
    );
  }

  isRiskyAction(action, filePath) {
    const riskyPaths = ['auth', 'security', 'payment', 'migration', 'config'];
    return (
      action === 'DELETE_FILE' ||
      riskyPaths.some(p => filePath.toLowerCase().includes(p)) ||
      filePath.includes('package.json') ||
      filePath.includes('requirements.txt')
    );
  }
}
```

#### 4.1.4 Sandbox — Docker Local (Cherry-pick từ Multica Plan)

**File refactor:** `sandbox/Dockerfile`

```dockerfile
# sandbox/Dockerfile — Docker Local Sandbox (thay E2B)
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 python3-pip python3-venv jq curl \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages pytest pytest-cov pydantic
RUN useradd -m -s /bin/bash sandbox
USER sandbox
WORKDIR /workspace
CMD ["sh", "-c", "echo 'No test command specified'"]
```

**File mới:** `sandbox/docker_sandbox.py` (giữ nguyên từ Multica Plan §2.4)

Docker flags bắt buộc: `--network=none`, `--memory=512m`, `--cpus=1`, `--read-only`, `--pids-limit=100`

#### 4.1.5 Deliverables Phase 1

- [ ] `RepoService.js`: clone, branch, analyze, commit, cleanup
- [ ] `GateBridge.js`: requestGate, resolveGate (idempotent), watchdog
- [ ] `RiskClassifier.js`: classify → AUTO/APPROVAL/BLOCK
- [ ] `sandbox/Dockerfile` refactored
- [ ] `sandbox/docker_sandbox.py` created
- [ ] Unit tests cho RepoService + RiskClassifier

---

### Phase 2: Backend Pipeline — Mock Agents + A2A + Validation (Ngày 3-4)

#### 4.2.1 Mock Agent Runners

**Thay đổi lớn:** Agents chạy mock qua `mockClaudeCodeRunner` — diễn hành vi DEV qua onGate theo scenario. Execution path chính: `claude-code (mock)`.

**File mới:** `backend/src/services/MockClaudeCodeRunner.js`

```javascript
class MockClaudeCodeRunner {
  async runAgent(agentType, input, onGate) {
    const scenario = this.getScenario(agentType, input);

    // Simulate agent execution with realistic delays
    await this.delay(scenario.thinkingTime);

    // DEV Agent: simulate file operations with risk gates
    if (agentType === 'DEV') {
      for (const fileOp of scenario.fileOperations) {
        const riskLevel = RiskClassifier.classify(fileOp.action, fileOp.path);
        if (riskLevel === 'REQUIRE_APPROVAL') {
          // Treo chờ human gate loại A
          const approved = await onGate({
            type: 'DEV_FILE_GATE',
            action: fileOp.action,
            path: fileOp.path,
            reason: fileOp.riskReason,
            diff: fileOp.diff  // hiển thị diff, không chỉ tên file
          });
          if (!approved) throw new Error(`Gate rejected: ${fileOp.path}`);
        }
        if (riskLevel === 'BLOCK') {
          throw new Error(`BLOCKED: ${fileOp.action} on ${fileOp.path}`);
        }
      }
    }

    return scenario.output;
  }
}
```

#### 4.2.2 A2A Contract Validator

**File mới:** `backend/src/services/A2AContractValidator.js`

```javascript
class A2AContractValidator {
  validateHandoff(from, to, payload) {
    const contract = CONTRACTS[`${from}_${to}`];

    // Schema validation
    for (const field of contract.requiredFields) {
      if (!payload[field]) {
        return { valid: false, error: `Missing required field: ${field}`, code: 409 };
      }
    }

    // Integrity check
    if (contract.requireHash && payload._hash !== this.computeHash(payload)) {
      return { valid: false, error: 'Integrity check failed', code: 409 };
    }

    // Semantic validation
    const semanticResult = this.validateSemantic(from, to, payload);
    if (!semanticResult.valid) return semanticResult;

    // Risk validation
    const riskResult = this.validateRisk(payload);
    if (!riskResult.valid) return riskResult;

    return { valid: true };
  }
}

const CONTRACTS = {
  PO_UX: { requiredFields: ['prd', 'acceptance_criteria', 'risk_classification'], requireHash: true },
  UX_DEV: { requiredFields: ['ux_spec', 'wireframe_spec', 'risk_classification'], requireHash: true },
  DEV_QA: { requiredFields: ['patch_diff', 'sandbox_result', 'self_test_report', 'security_gate'], requireHash: true },
};
```

#### 4.2.3 Pipeline State Machine (Update SdlcWorkflowService)

**File modify:** `backend/src/services/SdlcWorkflowService.js`

**Pipeline states mới:**

```
REPO_CLONING → REPO_ANALYZED → PO_ROUTE_CLASSIFY
→ PO_RUNNING → PO_GATE → [UX_RUNNING → UX_GATE]?
→ DEV_RUNNING → DEV_FILE_GATE → SANDBOX_TESTING → SANDBOX_RETRY?
→ QA_RUNNING → QA_GATE → FINAL_APPROVAL → RELEASED
```

**Route linh hoạt (PO quyết định):**

```javascript
// PO Agent output bao gồm route classification
const route = poOutput.route_classification;
switch (route) {
  case 'UI':        // PO → UX → DEV → QA
  case 'FULLSTACK': // PO → UX → DEV → QA
    nextPhase = 'UX_RUNNING';
    break;
  case 'BACKEND':   // PO → DEV → QA (skip UX)
  case 'BUGFIX':    // PO → DEV → QA (skip UX)
    nextPhase = 'DEV_RUNNING';
    break;
  case 'ANALYSIS':  // PO → QA/review
    nextPhase = 'QA_RUNNING';
    break;
}
```

#### 4.2.4 SSE + Heartbeat (Giao tiếp BE ↔ FE)

**File modify:** `backend/src/controllers/SdlcController.js`

```javascript
// SSE stream per workflow
router.get('/api/v1/sdlc/stream/:workflowId', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Heartbeat mỗi 15s (tránh lỗi kết nối đứt âm thầm)
  const heartbeat = setInterval(() => {
    res.write('event: heartbeat\ndata: {}\n\n');
  }, 15000);

  // Events: progress, completed, error, gate_pending
  const listener = (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  };
  eventBus.on(`workflow:${req.params.workflowId}`, listener);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventBus.off(`workflow:${req.params.workflowId}`, listener);
  });
});
```

#### 4.2.5 API Endpoints

```javascript
// Endpoints chính
router.post('/api/v1/sdlc/run-po-agent', auth, controller.startPipeline);
  // Body: { repo_url, request }
  // Response: { workflowId, status: 'REPO_CLONING' }

router.post('/api/v1/sdlc/approvals/:id', auth, controller.resolveApproval);
  // Body: { action: 'approve'|'reject', comment? }
  // Idempotent

router.post('/api/v1/sdlc/projects/:id/release-decision', auth, controller.releaseDecision);
  // Body: { action: 'approve'|'reject' }
  // Final approval

router.get('/api/v1/sdlc/stream/:workflowId', controller.sseStream);
  // SSE stream

router.get('/api/v1/sdlc/pipeline/:projectId', controller.getPipelineStatus);
  // Polling fallback
```

#### 4.2.6 Deliverables Phase 2

- [ ] `MockClaudeCodeRunner.js`: mock agent execution với onGate
- [ ] `A2AContractValidator.js`: contract validation + hash integrity
- [ ] `SdlcWorkflowService.js` updated: route linh hoạt, A2A, validation 3 lớp
- [ ] `SdlcController.js` updated: SSE stream + heartbeat
- [ ] API endpoints: run-po-agent, approvals, release-decision, stream
- [ ] Backend tests pass

---

### Phase 3: Frontend — 1 Màn Tối Giản (Ngày 5-6)

#### 4.3.1 Nguyên Tắc Thiết Kế

Theo AIFA v3 §8: **"Vứt Build page / MCP panel / Outputs / CI mock / Kanban / metrics / timeline cũ. Một màn."**

#### 4.3.2 Component Structure Mới

```
SdlcDashboard/components/
├── RepoInput.tsx          ✅ Giữ — Input repo URL + request
├── PipelineStepper.tsx    🔄 Update — route linh hoạt (skip UX nếu backend)
├── GatePanel.tsx          🆕 — Gate loại A (DEV file risk) + loại B (PO clarify)
├── DiffViewer.tsx         🆕 — Hiển thị diff, không chỉ tên file (AIFA v3 §12.11)
├── ApprovalQueue.tsx      ✅ Giữ — pending approval cards
├── QAResultCard.tsx       ✅ Giữ — QA summary + commit status
├── AuditLog.tsx           🆕 — List gọn, realtime (thay AuditTimeline)
├── FinalApproval.tsx      🆕 — Nút Approve release (owner/admin)
├── DetailModal.tsx        ✅ Giữ — lazy-loaded detail view
├── HumanGatePanel.tsx     ✅ Giữ — modal logic giữ nguyên
├── EmptyProjectState.tsx  ✅ Giữ
│
├── [Archive — không dùng nữa]
│   ├── AgentPhaseCard.tsx       → merge vào PipelineStepper
│   ├── FeatureRequestForm.tsx   → thay bằng RepoInput
│   ├── McpActivityPanel.tsx     → bỏ
│   ├── StageInspector.tsx       → bỏ
│   ├── PenpotPreview.tsx        → bỏ
│   ├── ReleaseGatePanel.tsx     → merge vào FinalApproval
│   ├── ArtifactViewer.tsx       → bỏ (view qua DetailModal)
│   ├── KanbanBoard.tsx          → bỏ
│   └── WorkflowMetricsPanel.tsx → bỏ
```

#### 4.3.3 Wireframe: Dashboard Mới

```
┌─────────────────────────────────────────────────────────┐
│  AIFA Control Platform                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🔗 Repository URL            Feature Request           │
│  ┌───────────────────────┐   ┌───────────────────────┐  │
│  │ https://github.com/...│   │ add google login      │  │
│  └───────────────────────┘   └───────────────────────┘  │
│                                              [▶ Run]    │
│                                                         │
│  📊 sample-app | React + Node.js | 90 files             │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Pipeline Progress     Route: FULLSTACK (UI + Backend)  │
│  ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐            │
│  │ PO ✅ │──▶│ UX ✅ │──▶│DEV ⏳│──▶│ QA ○ │            │
│  │ 2m30s │   │ 1m45s│   │ run..│   │      │            │
│  └──────┘   └──────┘   └──────┘   └──────┘            │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🔔 DEV GATE — Require Approval                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  DEV muốn sửa `src/middleware/auth.js`            │  │
│  │  Risk: auth/security file                          │  │
│  │                                                   │  │
│  │  --- a/src/middleware/auth.js                      │  │
│  │  +++ b/src/middleware/auth.js                      │  │
│  │  @@ -15,3 +15,8 @@                                │  │
│  │  + const googleAuth = require('./google-oauth');   │  │
│  │  + app.use('/auth/google', googleAuth.router);    │  │
│  │                                                   │  │
│  │  [✅ Approve]  [❌ Reject + Comment]               │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  📋 Audit Log (realtime)                                │
│  10:30:05  PO  ✅ Route classified: FULLSTACK           │
│  10:30:35  PO  ✅ PRD generated (confidence: 88%)       │
│  10:31:00  A2A ✅ PO→UX handoff (hash verified)         │
│  10:32:45  UX  ✅ UX spec generated                     │
│  10:33:00  DEV ⏳ Running...                             │
│  10:33:15  DEV 🔔 Gate: auth.js requires approval       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [✅ Approve Release]  (disabled until QA passes)       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### 4.3.4 Component Chi Tiết

**GatePanel.tsx** (🆕 — core innovation)
- Gate loại A (DEV file risk): hiển thị diff + risk reason + approve/reject
- Gate loại B (PO clarification): tối đa 3 câu + options → user chọn (hoặc default)
- Badge: AUTO ✅ / APPROVAL 🔔 / BLOCK ❌

**DiffViewer.tsx** (🆕)
- Render unified diff với syntax highlighting
- "Hiển thị diff, không chỉ tên file" (AIFA v3 §12.11)
- Cân nhắc thư viện: `react-diff-viewer-continued`

**AuditLog.tsx** (🆕 — thay AuditTimeline)
- List gọn, realtime (SSE driven)
- Mỗi entry: timestamp + actor + action + status icon
- Filter basic: agent type

**FinalApproval.tsx** (🆕)
- Nút Approve release (owner/admin)
- Disabled nếu còn blocker cao
- Ghi output release: branch, commit, final.md, QA report

**PipelineStepper.tsx** (🔄 Update)
- Route linh hoạt: hiện "Route: FULLSTACK" hoặc "Route: BACKEND (skip UX)"
- Steps thay đổi theo route (3 hoặc 4 steps)

#### 4.3.5 State & API (Frontend)

**File modify:** `frontend/src/store/useSdlcStore.ts`

```typescript
interface SdlcState {
  // Input
  repoUrl: string;
  featureRequest: string;        // 🆕 AIFA v3: repo + request

  // Pipeline
  workflowId: string | null;
  routeType: 'UI' | 'BACKEND' | 'ANALYSIS' | 'FULLSTACK' | null;  // 🆕 route
  pipelinePhases: PhaseStatus[];  // dynamic based on route

  // Gates — phân loại
  pendingGates: GateItem[];       // 🆕 thay approvals
  gateHistory: GateItem[];

  // Audit
  auditLog: AuditEntry[];         // 🆕 realtime

  // Output
  qaResult: QAResult | null;
  releaseStatus: 'pending' | 'approved' | 'rejected' | null;

  // Actions
  startPipeline: (repoUrl: string, request: string) => Promise<void>;
  resolveGate: (gateId: string, action: string, comment?: string) => Promise<void>;
  releaseDecision: (action: string) => Promise<void>;
}
```

**File modify:** `frontend/src/services/api/sdlcApi.ts`

```typescript
// AIFA endpoints (thay Multica endpoints)
export async function startPipeline(repoUrl: string, request: string);
export async function resolveApproval(approvalId: string, action: string, comment?: string);
export async function releaseDecision(projectId: string, action: string);
// SSE: EventSource('/api/v1/sdlc/stream/:workflowId')
```

#### 4.3.6 Deliverables Phase 3

- [ ] `GatePanel.tsx`: loại A (DEV risk) + loại B (PO clarify)
- [ ] `DiffViewer.tsx`: unified diff viewer
- [ ] `AuditLog.tsx`: realtime audit list
- [ ] `FinalApproval.tsx`: release approval button
- [ ] `PipelineStepper.tsx` updated: route linh hoạt
- [ ] `RepoInput.tsx` updated: thêm feature request input
- [ ] `useSdlcStore.ts` updated: new state shape
- [ ] `sdlcApi.ts` updated: new endpoints + SSE
- [ ] Frontend tests pass
- [ ] TypeScript build pass

---

### Phase 4: Agent Prompts + Cleanup + Docs (Ngày 7)

#### 4.4.1 Agent Prompt Refactor

Agents service → **prompt template builders** (giữ execution path chính: `claude-code mock`).

**Giữ nguyên:**
- Pydantic schemas (`POAgentInput`, `UXAgentInput`, etc.)
- Output parsing logic
- Quality gate evaluator
- 6 mock scenarios
- Jest tests

**Thêm mới cho mỗi agent:**
- `route_classification` trong PO output (bắt buộc)
- `risk_classification` trong PO/UX/DEV output
- `changed_files` với risk level trong DEV output

#### 4.4.2 Dependencies Loại Bỏ

**agents/requirements.txt — REMOVE:**
```
langchain>=0.3.0
langchain-openai>=0.2.0
langfuse>=3.0.0
openai>=1.50.0
e2b-code-interpreter>=1.0.0
```

**agents/requirements.txt — KEEP:**
```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-dotenv>=1.0.0
pydantic>=2.0.0
httpx>=0.27.0
PyYAML>=6.0
pytest>=8.0.0
```

**frontend/package.json — REMOVE:**
```
@google/genai
```

#### 4.4.3 Documentation

| File | Thay đổi |
|---|---|
| `README.md` | Update setup steps, remove Multica/API key requirements |
| `docs/architecture.md` | Update diagram TO-BE |
| `CLAUDE.md` | Update rules |
| `docs/project/AIFA_INTEGRATION_PLAN.md` | Document này — mark completed items |

#### 4.4.4 Deliverables Phase 4

- [ ] Agent prompts updated: route_classification, risk_classification
- [ ] `requirements.txt` cleaned (5 packages removed)
- [ ] `package.json` cleaned
- [ ] README.md updated
- [ ] architecture.md updated
- [ ] End-to-end test pass

---

## 5. Tech Stack Xác Định (Final)

| Layer | Technology | Status | Ghi chú |
|---|---|---|---|
| **Frontend** | React 19 + Vite 6 + TypeScript 5.8 | ✅ Giữ | |
| **State** | Zustand 5 | ✅ Giữ | |
| **Styling** | Vanilla CSS + Tailwind 4 | ✅ Giữ | |
| **Animation** | Motion (framer-motion) | ✅ Giữ | |
| **i18n** | react-i18next | ✅ Giữ | |
| **Icons** | lucide-react | ✅ Giữ | |
| **Diff viewer** | react-diff-viewer-continued | 🆕 Thêm | Cần cho Gate loại A |
| **Backend** | Express 5 + Prisma/SQLite | ✅ Giữ | |
| **Auth** | JWT (local) | ✅ Giữ | |
| **Git** | simple-git | 🆕 Thêm | Thay child_process |
| **Orchestration** | Self-built (SdlcWorkflowService) | 🔄 Extend | Thêm risk gates |
| **Agent Runtime** | Mock claude-code runner | 🆕 Thay | Thay LangChain/OpenAI |
| **Agent Prompts** | FastAPI (Python) | 🔄 Refactor | Prompt builder only |
| **Sandbox** | Docker local container | 🆕 Thay E2B | Cherry-pick từ Multica plan |
| **Observability** | SSE + heartbeat + audit trail | 🔄 Extend | Thay Langfuse |

---

## 6. Risk Assessment & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Mock→thật: streaming/lỗi/timeout/auth khác | High | High | **Spike tích hợp** trước khi chốt mức sửa logic |
| Repo safety: clone repo lạ chứa script độc | High | Medium | Cô lập, không tự chạy, sandbox |
| Secret leakage: agent đọc .env/token | High | Medium | Block đọc secret, RiskClassifier |
| Prompt injection trong repo README/comment | Medium | Medium | Cảnh giác nội dung repo |
| SdlcWorkflowService quá lớn (84KB) | Medium | Confirmed | Tách module: RepoService, GateBridge, RiskClassifier |
| Frontend breaking change | Medium | High | Archive old components, gradual migration |
| Workspace cleanup khi nhiều luồng | Low | Medium | RepoService.cleanup() + cron |
| Docker Desktop không cài trên máy dev | Medium | Low | Document prerequisites rõ ràng |

---

## 7. Verification Plan

### 7.1 Unit Tests

```powershell
# Backend (Jest)
cd backend && npm test
# Expected: 40+ tests pass (including RepoService, GateBridge, RiskClassifier)

# Agents (pytest)
python -m pytest
# Expected: 10+ tests pass

# Frontend (Vitest)
cd frontend && npm test
# Expected: 21+ tests pass
```

### 7.2 Integration Test Checklist

```
[ ] 1. Login vào FE (admin@vfs.com / admin123)
[ ] 2. Create/select project
[ ] 3. Paste repo URL + feature request "add google login"
[ ] 4. Verify: repo cloned, branch aifa/add-google-login created
[ ] 5. Verify: repo analysis displayed (tech stack, components)
[ ] 6. Verify: PO route classification = FULLSTACK (có UI)
[ ] 7. Verify: PipelineStepper shows PO → UX → DEV → QA
[ ] 8. Verify: A2A contract PO→UX validated (hash check)
[ ] 9. Verify: DEV file gate triggers on auth.js (REQUIRE_APPROVAL)
[ ] 10. Verify: GatePanel shows diff, not just filename
[ ] 11. Verify: Approve gate → DEV continues
[ ] 12. Verify: Sandbox gate runs Docker tests
[ ] 13. Verify: QA complete → QAResultCard + audit log
[ ] 14. Verify: final.md committed to branch
[ ] 15. Verify: Final Approval → RELEASED
[ ] 16. Verify: Audit log shows full trail
```

### 7.3 Mock Mode

```env
USE_MOCK_AGENTS=true   # Default: true (mock claude-code)
# Khi mock = true → MockClaudeCodeRunner diễn hành vi
# Khi mock = false → gọi claude-code thật (cần spike)
```

---

## 8. Timeline Tổng Hợp

```
Week 1:
  Day 1  ▓▓▓▓░░░░░░  Phase 1a: RepoService + GateBridge + RiskClassifier
  Day 2  ▓▓▓▓░░░░░░  Phase 1b: Docker sandbox + Validation3L + unit tests
  Day 3  ░░▓▓▓▓░░░░  Phase 2a: MockClaudeCodeRunner + A2AContractValidator
  Day 4  ░░▓▓▓▓░░░░  Phase 2b: Pipeline state machine + SSE + endpoints
  Day 5  ░░░░▓▓▓▓░░  Phase 3a: GatePanel + DiffViewer + AuditLog
  Day 6  ░░░░▓▓▓▓░░  Phase 3b: PipelineStepper update + FinalApproval + integration
  Day 7  ░░░░░░▓▓▓▓  Phase 4: Agent cleanup + docs + E2E test
```

---

## 9. File Change Summary

| Action | File | Phase | Owner |
|---|---|---|---|
| 🆕 NEW | `backend/src/services/RepoService.js` | 1 | Minh |
| 🆕 NEW | `backend/src/services/GateBridge.js` | 1 | Minh |
| 🆕 NEW | `backend/src/services/RiskClassifier.js` | 1 | Minh |
| 🆕 NEW | `backend/src/services/A2AContractValidator.js` | 2 | Minh |
| 🆕 NEW | `backend/src/services/MockClaudeCodeRunner.js` | 2 | Minh |
| 🆕 NEW | `sandbox/docker_sandbox.py` | 1 | Minh |
| 🔄 REFACTOR | `sandbox/Dockerfile` | 1 | Minh |
| 🔄 MODIFY | `backend/src/services/SdlcWorkflowService.js` | 2 | Minh |
| 🔄 MODIFY | `backend/src/controllers/SdlcController.js` | 2 | Minh |
| 🔄 MODIFY | `backend/src/routes/sdlcRoutes.js` | 2 | Minh |
| 🆕 NEW | `frontend/.../GatePanel.tsx` | 3 | Giang |
| 🆕 NEW | `frontend/.../DiffViewer.tsx` | 3 | Giang |
| 🆕 NEW | `frontend/.../AuditLog.tsx` | 3 | Giang |
| 🆕 NEW | `frontend/.../FinalApproval.tsx` | 3 | Giang |
| 🔄 MODIFY | `frontend/.../RepoInput.tsx` | 3 | Giang |
| 🔄 MODIFY | `frontend/.../PipelineStepper.tsx` | 3 | Giang |
| ✅ KEEP | `frontend/.../ApprovalQueue.tsx` | — | Giang |
| ✅ KEEP | `frontend/.../QAResultCard.tsx` | — | Giang |
| ✅ KEEP | `frontend/.../DetailModal.tsx` | — | Giang |
| ✅ KEEP | `frontend/.../HumanGatePanel.tsx` | — | Giang |
| 🔄 MODIFY | `frontend/src/store/useSdlcStore.ts` | 3 | Giang |
| 🔄 MODIFY | `frontend/src/services/api/sdlcApi.ts` | 3 | Giang |
| 🔄 MODIFY | `frontend/src/pages/SdlcDashboard/index.tsx` | 3 | Giang |
| 🔄 REFACTOR | `agents/src/agents/po_agent.py` | 4 | Nam |
| 🔄 REFACTOR | `agents/src/agents/ux_agent.py` | 4 | Nam |
| 🔄 REFACTOR | `agents/src/agents/dev_agent.py` | 4 | Nam |
| 🔄 REFACTOR | `agents/src/agents/qa_agent.py` | 4 | Nam |
| 🔄 MODIFY | `agents/requirements.txt` | 4 | Nam |
| 📁 ARCHIVE | `sandbox/e2b_runtime.py` | 4 | Nam |
| 📁 ARCHIVE | `sandbox/run_dev.py` | 4 | Nam |
| 📁 ARCHIVE | `sandbox/test_e2b.py` | 4 | Nam |
| 📁 ARCHIVE | 9 old FE components | 3 | Giang |
| 🔄 MODIFY | `README.md` | 4 | Giang |
| 📁 ARCHIVE | `MULTICA_INTEGRATION_PLAN.md` | — | — |

---

## 10. Glossary

| Thuật ngữ | Giải thích |
|---|---|
| **AIFA** | AI Factory Autonomy — orchestrator kiểm soát AI agent theo mức rủi ro |
| **Gate loại A** | DEV file gate — phân tầng auto/approval/block theo risk |
| **Gate loại B** | PO clarification gate — PO hỏi user (giới hạn 1 lần, 3 câu) |
| **A2A Contract** | Agent-to-Agent contract — hash integrity + required fields |
| **HITL** | Human-in-the-Loop — con người review trước khi pipeline tiếp tục |
| **Risk Classification** | Phân loại hành động: AUTO_APPROVE / REQUIRE_APPROVAL / BLOCK |
| **Validation 3 lớp** | Schema + Semantic + Risk validation |
| **Route Classification** | PO phân loại request: UI / backend / analysis / fullstack |
| **Confidence Score** | Điểm tự tin (0-100). Dưới ngưỡng → human gate |
| **Sandbox Gate (G3)** | Docker container isolated test (--network=none, --read-only) |
| **MockClaudeCodeRunner** | Mock implementation diễn hành vi agent qua onGate |
| **Idempotency** | Một approval chỉ resolve 1 lần, double-click safe |
| **final.md** | Audit trail document committed vào repo |
