# 🎯 Task Assignment: Minh — Backend Lead

> **Vai trò:** Backend Development (Node.js)
> **Phases chịu trách nhiệm:** Phase 1 (Core Services) + Phase 2 (Pipeline + Mock Agents)
> **Tham chiếu:** [AIFA_INTEGRATION_PLAN.md](./AIFA_INTEGRATION_PLAN.md)
> **Liên hệ:** Giang (FE + PM), Nam (Agent Prompts)

---

## Tổng Quan Công Việc

```
Day 1: Phase 1a — RepoService + GateBridge + RiskClassifier
Day 2: Phase 1b — Docker sandbox + Validation3L + unit tests
Day 3: Phase 2a — MockClaudeCodeRunner + A2AContractValidator
Day 4: Phase 2b — Pipeline state machine + SSE + endpoints
Day 5: Integration FE ↔ BE (pair với Giang)
Day 6: E2E test + fix bugs
Day 7: Cleanup + docs
```

---

## Phase 1: Backend Core Services (Day 1-2)

### Day 1: RepoService + GateBridge + RiskClassifier

- [ ] **Tạo `backend/src/services/RepoService.js`**

  Thay thế GitService (Multica plan) + thêm branch/cleanup (AIFA v3):

  ```javascript
  const simpleGit = require('simple-git');

  class RepoService {
    // Clone repo về workspace/projects/<projectId>/repo (shallow)
    async cloneRepo(repoUrl, projectId) {
      const targetDir = path.join(WORKSPACE_DIR, 'projects', projectId, 'repo');
      await simpleGit().clone(repoUrl, targetDir, ['--depth', '1']);
      return targetDir;
    }

    // Tạo branch aifa/<slug> (AIFA v3 §4.1)
    async createBranch(localPath, slug) {
      const branchName = `aifa/${slug}`;
      await simpleGit(localPath).checkoutLocalBranch(branchName);
      return branchName;
    }

    // Phân tích codebase: tech stack, components, file count
    async analyzeRepo(projectPath) {
      // Scan package.json, requirements.txt, go.mod, Cargo.toml
      // Detect Dockerfile, docker-compose.yml
      // List top-level folders → component candidates
      // Count files by extension
      // return { techStack, components, fileCount, hasTests, primaryLanguage }
    }

    // Commit artifact (final.md, QA report) vào branch
    async commitArtifact(localPath, filePath, content) {
      fs.writeFileSync(path.join(localPath, filePath), content);
      const git = simpleGit(localPath);
      await git.add(filePath);
      const result = await git.commit(`[AIFA] Add ${filePath}`);
      return result.commit;
    }

    // Get diff cho review (AIFA v3 §12.11: hiển thị diff, không chỉ tên file)
    async getRepoDiff(localPath) {
      return simpleGit(localPath).diff();
    }

    // Cleanup workspace khi xong (AIFA v3 §12.12)
    async cleanup(localPath) {
      // Remove workspace directory
      // Prune orphan branches
    }
  }
  ```

  **Repo Safety (AIFA v3 §12):**
  - Clone repo lạ → cô lập, KHÔNG tự chạy scripts
  - Timeout 60s cho clone, 30s cho analyze
  - Dùng `simple-git` (không dùng `child_process.exec` — tránh shell injection)

- [ ] **Tạo `backend/src/services/GateBridge.js`**

  Registry treo chờ duyệt (AIFA v3 §5.7-5.8):

  ```javascript
  class GateBridge {
    // Tạo gate pending, emit SSE gate_pending
    async requestGate(workflowId, gateType, payload) {
      return prisma.gate.create({
        data: {
          workflowId,
          type: gateType,    // 'DEV_FILE_GATE' | 'PO_CLARIFY' | 'HITL_REVIEW' | 'FINAL_RELEASE'
          status: 'PENDING',
          payload: JSON.stringify(payload),
          createdAt: new Date()
        }
      });
    }

    // Resolve gate — IDEMPOTENT (double-click safe)
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

    // Watchdog: auto-HOLD nếu không resolve trong timeout
    async watchdogTimeout(gateId, timeoutMs = 300000) { ... }

    // List pending gates cho FE
    async listPendingGates(workflowId) { ... }
  }
  ```

- [ ] **Tạo `backend/src/services/RiskClassifier.js`**

  Phân tầng hành động DEV (AIFA v3 §5.3):

  ```javascript
  class RiskClassifier {
    classify(action, filePath, context) {
      if (this.isBlockedAction(action, filePath)) return 'BLOCK';
      if (this.isRiskyAction(action, filePath)) return 'REQUIRE_APPROVAL';
      return 'AUTO_APPROVE';
    }

    isBlockedAction(action, filePath) {
      // .env files, push main, delete bulk, write outside repo
      return (
        filePath.includes('.env') ||
        action === 'PUSH_MAIN' ||
        action === 'DELETE_BULK' ||
        filePath.startsWith('../')
      );
    }

    isRiskyAction(action, filePath) {
      // auth, security, payment, migration, config, package.json
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

- [ ] **Install dependency: `simple-git`**
  ```powershell
  cd backend && npm install simple-git
  ```

- [ ] **Báo Giang:** ✅ Core services ready (RepoService, GateBridge, RiskClassifier)

---

### Day 2: Docker Sandbox + Validation + Unit Tests

- [ ] **Refactor `sandbox/Dockerfile`** (cherry-pick từ Multica plan)

  ```dockerfile
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

- [ ] **Tạo `sandbox/docker_sandbox.py`** (cherry-pick từ Multica plan §2.4)
  - Docker flags: `--network=none`, `--memory=512m`, `--cpus=1`, `--read-only`, `--pids-limit=100`
  - Input: workspace path + test command
  - Output: `{ success, report, exit_code }`

- [ ] **Build sandbox Docker image:**
  ```powershell
  cd sandbox
  docker build -t aifa-sandbox:latest .
  docker run --rm aifa-sandbox:latest node --version
  docker run --rm aifa-sandbox:latest python3 --version
  ```

- [ ] **Unit tests cho Phase 1 services:**
  ```javascript
  // tests/RepoService.test.js
  // - cloneRepo: mock simple-git, verify path
  // - analyzeRepo: test with sample package.json
  // - createBranch: verify branch name format

  // tests/RiskClassifier.test.js
  // - classify('.env', 'MODIFY') → BLOCK
  // - classify('src/auth.js', 'MODIFY') → REQUIRE_APPROVAL
  // - classify('src/utils/helper.js', 'CREATE') → AUTO_APPROVE

  // tests/GateBridge.test.js
  // - requestGate: creates PENDING gate
  // - resolveGate: resolves to approved
  // - resolveGate twice: idempotent (second call returns alreadyResolved)
  ```

- [ ] **Báo Giang:** ✅ Sandbox + validation + tests ready

---

## Phase 2: Pipeline + Mock Agents (Day 3-4)

### Day 3: MockClaudeCodeRunner + A2AContractValidator

- [ ] **Tạo `backend/src/services/MockClaudeCodeRunner.js`**

  Mock agent execution theo scenario (AIFA v3 §4.5):

  ```javascript
  class MockClaudeCodeRunner {
    async runAgent(agentType, input, onGate) {
      const scenario = this.getScenario(agentType, input);
      await this.delay(scenario.thinkingTime); // simulate latency

      // PO: bắt buộc route classification
      if (agentType === 'PO') {
        scenario.output.route_classification = this.classifyRoute(input.request);
      }

      // DEV: simulate file operations with risk gates
      if (agentType === 'DEV') {
        for (const fileOp of scenario.fileOperations) {
          const riskLevel = RiskClassifier.classify(fileOp.action, fileOp.path);

          if (riskLevel === 'BLOCK') {
            throw new Error(`BLOCKED: ${fileOp.action} on ${fileOp.path}`);
          }

          if (riskLevel === 'REQUIRE_APPROVAL') {
            const approved = await onGate({
              type: 'DEV_FILE_GATE',
              action: fileOp.action,
              path: fileOp.path,
              reason: fileOp.riskReason,
              diff: fileOp.diff  // AIFA v3: "hiển thị diff, không chỉ tên file"
            });
            if (!approved) throw new Error(`Gate rejected: ${fileOp.path}`);
          }
        }
      }

      return scenario.output;
    }

    classifyRoute(request) {
      // "add google login" → có UI → FULLSTACK
      // "fix API endpoint" → BACKEND
      // "analyze code quality" → ANALYSIS
      const uiKeywords = ['login', 'form', 'page', 'button', 'modal', 'UI', 'design'];
      const hasUI = uiKeywords.some(kw => request.toLowerCase().includes(kw));
      return hasUI ? 'FULLSTACK' : 'BACKEND';
    }
  }
  ```

- [ ] **Tạo `backend/src/services/A2AContractValidator.js`**

  Contract validation (AIFA v3 §5.4):

  ```javascript
  const CONTRACTS = {
    PO_UX: {
      requiredFields: ['prd', 'acceptance_criteria', 'risk_classification'],
      requireHash: true
    },
    UX_DEV: {
      requiredFields: ['ux_spec', 'wireframe_spec', 'risk_classification'],
      requireHash: true
    },
    DEV_QA: {
      requiredFields: ['patch_diff', 'sandbox_result', 'self_test_report', 'security_gate'],
      requireHash: true
    }
  };

  class A2AContractValidator {
    validateHandoff(from, to, payload) {
      const contract = CONTRACTS[`${from}_${to}`];
      // 1. Schema: check required fields
      // 2. Integrity: hash check
      // 3. Semantic: content validation
      // 4. Risk: auto/approval/block
      // Return: { valid: true } or { valid: false, error, code: 409 }
    }
  }
  ```

---

### Day 4: Pipeline State Machine + SSE + Endpoints

- [ ] **Update `backend/src/services/SdlcWorkflowService.js`**

  Thêm route linh hoạt + A2A + validation 3 lớp:

  ```javascript
  // Pipeline states:
  // REPO_CLONING → REPO_ANALYZED → PO_ROUTE_CLASSIFY
  // → PO_RUNNING → PO_GATE → [UX_RUNNING → UX_GATE]?
  // → DEV_RUNNING → DEV_FILE_GATE → SANDBOX_TESTING
  // → QA_RUNNING → QA_GATE → FINAL_APPROVAL → RELEASED

  async startPipeline(repoUrl, request) {
    // 1. RepoService.cloneRepo() + createBranch('aifa/<slug>')
    // 2. RepoService.analyzeRepo()
    // 3. MockClaudeCodeRunner.runAgent('PO', {...})
    // 4. PO output → route_classification → decide skip UX
    // 5. A2AContractValidator.validateHandoff('PO', nextAgent)
    // 6. Continue pipeline based on route
  }
  ```

- [ ] **Update `backend/src/controllers/SdlcController.js`**

  SSE stream + heartbeat (AIFA v3 §9):

  ```javascript
  // SSE per workflow
  router.get('/api/v1/sdlc/stream/:workflowId', (req, res) => {
    // Content-Type: text/event-stream
    // Heartbeat mỗi 15s
    // Events: progress, completed, error, gate_pending
  });
  ```

- [ ] **Update routes `backend/src/routes/sdlcRoutes.js`**

  ```javascript
  // AIFA endpoints
  router.post('/api/v1/sdlc/run-po-agent', auth, controller.startPipeline);
  router.post('/api/v1/sdlc/approvals/:id', auth, controller.resolveApproval);
  router.post('/api/v1/sdlc/projects/:id/release-decision', auth, controller.releaseDecision);
  router.get('/api/v1/sdlc/stream/:workflowId', controller.sseStream);
  router.get('/api/v1/sdlc/pipeline/:projectId', controller.getPipelineStatus);
  ```

- [ ] **Báo Giang:** ✅ API endpoints ready, SSE stream working

---

### Day 5: Integration với Frontend

- [ ] **Pair với Giang để connect FE ↔ BE**
  - Verify SSE stream hoạt động
  - Test gate_pending → GatePanel hiện
  - Fix CORS issues

- [ ] **Test flows:**
  - [ ] POST /run-po-agent → clone + analyze + PO starts
  - [ ] SSE stream → FE nhận events realtime
  - [ ] Gate pending → FE hiện GatePanel
  - [ ] POST /approvals/:id → gate resolved, pipeline continues
  - [ ] POST /release-decision → RELEASED

---

### Day 6: E2E Testing

- [ ] **Test full pipeline (AIFA flow):**
  - [ ] Submit repo URL + "add google login"
  - [ ] Branch aifa/add-google-login created
  - [ ] PO route = FULLSTACK → UX included
  - [ ] A2A contract PO→UX validated
  - [ ] DEV file gate triggers on auth.js
  - [ ] GatePanel shows diff (không chỉ tên file)
  - [ ] Docker sandbox runs tests
  - [ ] QA → final.md committed
  - [ ] Final approval → RELEASED

- [ ] **Edge cases:**
  - [ ] Invalid repo URL → graceful error
  - [ ] Gate timeout → HOLD status
  - [ ] Double-click approve → idempotent
  - [ ] Reject → reason required
  - [ ] BLOCK action → clear error message
  - [ ] Route BACKEND → skip UX

---

### Day 7: Cleanup + Docs

- [ ] Update `.env.example` với env vars mới
- [ ] Viết API documentation trong `docs/API.md`
- [ ] Verify tất cả tests pass

---

## Files Tôi Chịu Trách Nhiệm

| Action | File |
|---|---|
| 🆕 NEW | `backend/src/services/RepoService.js` |
| 🆕 NEW | `backend/src/services/GateBridge.js` |
| 🆕 NEW | `backend/src/services/RiskClassifier.js` |
| 🆕 NEW | `backend/src/services/MockClaudeCodeRunner.js` |
| 🆕 NEW | `backend/src/services/A2AContractValidator.js` |
| 🆕 NEW | `sandbox/docker_sandbox.py` |
| 🔄 REFACTOR | `sandbox/Dockerfile` |
| 🔄 MODIFY | `backend/src/services/SdlcWorkflowService.js` |
| 🔄 MODIFY | `backend/src/controllers/SdlcController.js` |
| 🔄 MODIFY | `backend/src/routes/sdlcRoutes.js` |
| 🔄 MODIFY | `.env.example` |
| 🆕 NEW | `docs/API.md` |

---

## API Contract (Thống nhất với Giang)

> ⚠️ **Giang sẽ code FE dựa trên contract này. Nếu thay đổi → báo ngay!**

```javascript
// POST /api/v1/sdlc/run-po-agent
// Request:
{ "repo_url": "https://github.com/user/repo.git", "request": "add google login" }
// Response:
{ "workflowId": "wf-abc123", "status": "REPO_CLONING" }

// GET /api/v1/sdlc/pipeline/:projectId
// Response:
{
  "workflowId": "wf-abc123",
  "status": "DEV_FILE_GATE",
  "routeType": "FULLSTACK",         // PO route classification
  "pipelinePhases": [
    { "agent": "PO", "status": "completed", "duration": "2m30s" },
    { "agent": "UX", "status": "completed", "duration": "1m45s" },
    { "agent": "DEV", "status": "gate_pending" },
    { "agent": "QA", "status": "pending" }
  ],
  "pendingGates": [
    {
      "id": "gate-001",
      "type": "DEV_FILE_GATE",
      "payload": {
        "action": "MODIFY",
        "path": "src/middleware/auth.js",
        "reason": "auth/security file",
        "diff": "--- a/src/middleware/auth.js\n+++ b/..."
      },
      "createdAt": "2026-06-05T10:33:15Z"
    }
  ],
  "auditLog": [
    { "timestamp": "10:30:05", "actor": "PO", "action": "Route classified: FULLSTACK", "status": "ok" },
    { "timestamp": "10:30:35", "actor": "PO", "action": "PRD generated (confidence: 88%)", "status": "ok" },
    { "timestamp": "10:31:00", "actor": "A2A", "action": "PO→UX handoff (hash verified)", "status": "ok" }
  ],
  "qaResult": null
}

// POST /api/v1/sdlc/approvals/:id
// Request:
{ "action": "approve", "comment": "LGTM" }  // or "reject" with required comment
// Response:
{ "success": true }

// POST /api/v1/sdlc/projects/:id/release-decision
// Request:
{ "action": "approve" }
// Response:
{ "success": true, "branch": "aifa/add-google-login", "finalMd": "committed" }

// GET /api/v1/sdlc/stream/:workflowId
// SSE Events:
// event: progress    data: { phase: "DEV", status: "running", progress: 45 }
// event: gate_pending data: { gateId, type, payload }
// event: gate_resolved data: { gateId, action }
// event: completed   data: { phase: "QA", output: {...} }
// event: error       data: { message, phase }
// event: heartbeat   data: {}  (mỗi 15s)
```

---

## Dependencies & Blockers

| Phụ thuộc | Từ ai | Khi nào cần |
|---|---|---|
| Docker Desktop running | Bản thân | Day 2 (sandbox build) |
| Agent prompt templates | Nam | Day 4 (mock scenarios) |
| FE mock data format | Giang | Day 1 (align contract) |
| Integration testing | Giang | Day 5 |
