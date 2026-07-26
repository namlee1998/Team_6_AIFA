# 🎯 Task Assignment: Nam — Agent Management Lead

> **Vai trò:** Agent Management, Prompt Engineering, Pipeline Logic
> **Phases chịu trách nhiệm:** Phase 2 (Mock Agent Scenarios) + Phase 4 (Cleanup agents)
> **Tham chiếu:** [AIFA_INTEGRATION_PLAN.md](./AIFA_INTEGRATION_PLAN.md)
> **Liên hệ:** Giang (FE + PM), Minh (Backend)

---

## Tổng Quan Công Việc

```
Day 1-2: Hiểu AIFA v3 strategy + thiết kế mock scenarios
Day 3:   Refactor PO Agent (route classification bắt buộc) + UX Agent
Day 4:   Refactor DEV Agent (risk + diff output) + QA Agent
Day 5:   Integration testing — verify mock agents chạy qua MockClaudeCodeRunner
Day 6:   E2E test full pipeline
Day 7:   Cleanup old deps + docs
```

---

## Bối Cảnh Thay Đổi Quan Trọng

### ❌ KHÔNG CÒN dùng Multica
- Không cần Multica CLI, daemon, server
- Không cần Claude Code CLI login
- Không gọi LLM API thật (mock toàn bộ)

### ✅ AIFA v3 Strategy: Mock-First
- Agents chạy mock qua `MockClaudeCodeRunner` (Minh viết)
- Mock phát sự kiện qua **đúng interface bản thật** (AIFA v3 §4.5)
- Execution path chính: `claude-code (mock)`
- LangChain path: chỉ giữ compatibility, không phát triển thêm

### 🆕 Thay đổi lớn trong Agent output:
1. **PO bắt buộc có `route_classification`** — quyết định skip UX hay không
2. **PO bắt buộc có `risk_classification`** — phân loại rủi ro request
3. **DEV output có `changed_files` với risk level** — RiskClassifier dùng
4. **DEV output hiển thị diff** — không chỉ tên file
5. **QA kiểm tra logic tối thiểu** — dù mock (AIFA v3 §5.6)

---

## Phase 2: Mock Agent Scenarios (Day 1-4)

### Day 1-2: Hiểu Strategy + Thiết Kế Scenarios

- [ ] **Đọc AIFA v3 chiến lược** — focus vào:
  - §4.2: Pipeline route linh hoạt (PO quyết định)
  - §4.3: Vai đặc thù mỗi agent
  - §5.3: Gate loại A (DEV file risk — phân tầng)
  - §5.4: A2A contract (required fields)
  - §5.6: QA kiểm tra logic tối thiểu

- [ ] **Thiết kế mock scenarios** (6 scenarios, mỗi scenario = 1 demo path):

  | # | Scenario | Route | UX? | Gate A trigger? | Sandbox? |
  |---|---|---|---|---|---|
  | 1 | "add google login" | FULLSTACK | ✅ | ✅ auth.js | ✅ |
  | 2 | "fix API pagination bug" | BACKEND | ❌ skip | ❌ | ✅ |
  | 3 | "add dark mode toggle" | UI | ✅ | ❌ | ✅ |
  | 4 | "analyze code quality" | ANALYSIS | ❌ skip | ❌ | ❌ |
  | 5 | "add payment Stripe" | FULLSTACK | ✅ | ✅ payment.js | ✅ |
  | 6 | "update README" | BACKEND | ❌ skip | ❌ | ❌ |

- [ ] **Viết mock data cho mỗi scenario** vào `mock-data/scenarios/`

---

### Day 3: PO Agent + UX Agent Refactor

- [ ] **Refactor `agents/src/agents/po_agent.py`**

  **QUAN TRỌNG:** PO bắt buộc chạy route classification đầu tiên (AIFA v3 §4.2)

  ```python
  """PO Agent — Product Owner / PRD Generator + Route Classifier.

  Execution: MockClaudeCodeRunner (mock) hoặc Claude Code CLI (thật)
  Input: repo analysis + user request
  Output: PRD + route_classification + risk_classification
  """

  def build_po_prompt(repo_analysis: dict, user_request: str) -> str:
      """Build prompt cho PO Agent."""
      return f"""You are an expert Product Owner analyzing a software repository.

  ## Repository Analysis
  - Tech Stack: {', '.join(repo_analysis.get('techStack', []))}
  - File Count: {repo_analysis.get('fileCount', 'unknown')}
  - Components: {', '.join(repo_analysis.get('components', []))}

  ## User Request
  {user_request}

  ## STEP 1: Route Classification (MANDATORY)
  Classify this request into one of:
  - "UI" — only frontend/UI changes
  - "BACKEND" — only backend/API/bugfix
  - "ANALYSIS" — only analysis/documentation
  - "FULLSTACK" — both frontend and backend changes

  ## STEP 2: Generate PRD
  Based on the classification, generate a comprehensive PRD.

  ## Output Format (JSON)
  {{
    "route_classification": "FULLSTACK",
    "risk_classification": "MEDIUM",
    "prd_title": "...",
    "executive_summary": "...",
    "user_stories": [
      {{"id": "US-001", "as_a": "...", "i_want": "...", "so_that": "...", "priority": "HIGH"}}
    ],
    "acceptance_criteria": ["AC-001: ...", "AC-002: ..."],
    "scope": ["..."],
    "out_of_scope": ["..."],
    "confidence_score": 85
  }}

  Output ONLY valid JSON. No markdown fences.
  """

  def parse_po_output(raw_output: str) -> dict:
      """Parse PO agent output + validate route_classification."""
      import json, re
      text = raw_output.strip()
      fence = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
      if fence:
          text = fence.group(1).strip()
      try:
          result = json.loads(text)
          # Validate route_classification exists
          if 'route_classification' not in result:
              result['route_classification'] = 'FULLSTACK'  # default safe
          # Validate risk_classification exists
          if 'risk_classification' not in result:
              result['risk_classification'] = 'MEDIUM'
          return result
      except json.JSONDecodeError:
          return {
              "prd_title": "Parse Error",
              "route_classification": "FULLSTACK",
              "risk_classification": "HIGH",
              "confidence_score": 30,
              "error": "Failed to parse PO output"
          }
  ```

  **Mock data cho PO (scenario 1: "add google login"):**
  ```json
  {
    "route_classification": "FULLSTACK",
    "risk_classification": "MEDIUM",
    "prd_title": "Google OAuth Login Integration",
    "executive_summary": "Add Google OAuth 2.0 login to existing auth system...",
    "user_stories": [
      {"id": "US-001", "as_a": "user", "i_want": "login with Google account", "so_that": "I can quickly access the app", "priority": "HIGH"}
    ],
    "acceptance_criteria": [
      "AC-001: User can click 'Login with Google' button",
      "AC-002: OAuth flow redirects to Google and back",
      "AC-003: New user profile created from Google data"
    ],
    "scope": ["Google OAuth integration", "Login button UI", "User profile creation"],
    "out_of_scope": ["Facebook login", "Apple login", "2FA"],
    "confidence_score": 88
  }
  ```

- [ ] **Refactor `agents/src/agents/ux_agent.py`**

  ```python
  def build_ux_prompt(prd_output: dict, repo_analysis: dict) -> str:
      """Build prompt cho UX Agent.

      CHỈ CHẠY KHI route_classification = 'UI' hoặc 'FULLSTACK'.
      """
      return f"""You are an expert UX Designer.

  ## PRD Context
  {json.dumps(prd_output, indent=2)}

  ## Repository Tech Stack
  {', '.join(repo_analysis.get('techStack', []))}

  ## Your Task
  Create a UX specification based on the PRD above.

  ## Output Format (JSON)
  {{
    "ux_spec": {{
      "design_system": {{ "colors": {{}}, "typography": {{}}, "spacing": {{}} }},
      "wireframes": [
        {{"page": "...", "layout": "...", "components": ["..."]}}
      ],
      "user_flows": [
        {{"name": "...", "steps": ["..."]}}
      ]
    }},
    "wireframe_spec": "ASCII wireframe or description",
    "risk_classification": "{prd_output.get('risk_classification', 'MEDIUM')}",
    "accessibility_notes": ["..."],
    "confidence_score": 80
  }}
  """
  ```

---

### Day 4: DEV Agent + QA Agent

- [ ] **Refactor `agents/src/agents/dev_agent.py`**

  **QUAN TRỌNG:** DEV output phải có:
  1. `changed_files` với **risk level** per file
  2. `patch_diff` dạng unified git diff
  3. File operations cho MockClaudeCodeRunner onGate

  ```python
  def build_dev_prompt(prd_output: dict, ux_spec: dict, repo_analysis: dict) -> str:
      """Build prompt cho DEV Agent.

      Output PHẢI là:
      - changed_files với risk_level (cho RiskClassifier)
      - patch_diff dạng unified diff (cho DiffViewer + Sandbox)
      - security_gate assessment
      """
      return f"""You are a Senior Software Engineer implementing features.

  ## PRD
  {json.dumps(prd_output, indent=2)}

  ## UX Specification
  {json.dumps(ux_spec, indent=2) if ux_spec else "N/A (backend-only route)"}

  ## Repository Info
  - Tech Stack: {', '.join(repo_analysis.get('techStack', []))}

  ## Your Task
  Generate the implementation as code changes.

  ## Output Format (JSON)
  {{
    "implementation_plan": "Step-by-step plan...",
    "changed_files": [
      {{
        "path": "src/middleware/auth.js",
        "action": "MODIFY",
        "reason": "Add Google OAuth middleware",
        "risk_level": "REQUIRE_APPROVAL",
        "risk_reason": "auth/security file"
      }},
      {{
        "path": "src/features/login/GoogleLoginButton.tsx",
        "action": "CREATE",
        "reason": "New login component",
        "risk_level": "AUTO_APPROVE",
        "risk_reason": "new file in feature directory"
      }}
    ],
    "patch_diff": "diff --git a/src/middleware/auth.js b/src/middleware/auth.js\\n--- a/src/middleware/auth.js\\n+++ b/src/middleware/auth.js\\n@@ -15,3 +15,8 @@\\n+const googleAuth = require('./google-oauth');\\n+app.use('/auth/google', googleAuth.router);",
    "self_test_report": "Manual review: auth flow validated",
    "security_gate": {{
      "has_auth_changes": true,
      "has_env_changes": false,
      "risk_summary": "OAuth middleware added — requires review"
    }},
    "confidence_score": 72,
    "summary": "Added Google OAuth login with middleware + UI button"
  }}

  CRITICAL: patch_diff MUST be valid unified git diff format.
  CRITICAL: changed_files MUST include risk_level for each file.
  """
  ```

  **Mock data cho DEV (scenario 1):** phải include file operations với risk levels:
  ```json
  {
    "fileOperations": [
      {
        "action": "MODIFY",
        "path": "src/middleware/auth.js",
        "riskReason": "auth/security file — requires approval",
        "diff": "--- a/src/middleware/auth.js\n+++ b/src/middleware/auth.js\n@@ -15,3 +15,8 @@\n+const googleAuth = require('./google-oauth');\n+app.use('/auth/google', googleAuth.router);"
      },
      {
        "action": "CREATE",
        "path": "src/features/login/GoogleLoginButton.tsx",
        "riskReason": "new file in feature directory — auto-approved",
        "diff": "+import React from 'react';\n+export function GoogleLoginButton() { ... }"
      }
    ]
  }
  ```

- [ ] **Refactor `agents/src/agents/qa_agent.py`**

  **QA kiểm tra logic tối thiểu** (AIFA v3 §5.6) — dù mock:

  ```python
  def build_qa_prompt(
      prd_output: dict,
      dev_output: dict,
      sandbox_result: dict
  ) -> str:
      """Build prompt cho QA Agent.

      QA mock phải kiểm thật ở mức logic (AIFA v3 §5.6):
      - DEV artifact có patch_diff?
      - changed_files nằm trong scope?
      - acceptance criteria có coverage matrix?
      - test report ghi rõ "simulated"
      """
      return f"""You are a QA Engineer reviewing code changes.

  ## PRD Requirements
  Acceptance Criteria: {json.dumps(prd_output.get('acceptance_criteria', []))}

  ## DEV Agent Output
  Changed Files: {json.dumps(dev_output.get('changed_files', []))}
  Scope: {json.dumps(prd_output.get('scope', []))}
  Risk Level: {dev_output.get('security_gate', {}).get('risk_summary', 'UNKNOWN')}

  ## Sandbox Test Results
  {json.dumps(sandbox_result, indent=2)}

  ## Your Task
  1. Verify changed_files are within scope
  2. Create AC coverage matrix
  3. Generate QA report (mark "simulated" for mock tests)
  4. Provide release recommendation

  ## Output Format (JSON)
  {{
    "qa_report_md": "# QA Report\\n\\n## Summary\\n...\\n## AC Coverage\\n...",
    "ac_coverage_matrix": [
      {{"ac_id": "AC-001", "status": "covered", "evidence": "..."}}
    ],
    "test_run_report": {{
      "total": 5,
      "passed": 4,
      "failed": 0,
      "skipped": 1,
      "note": "Tests simulated — to be run on real environment"
    }},
    "security_findings": [],
    "blocker_count": 0,
    "status": "passed",
    "coverage_estimate": 85,
    "release_recommendation": "approve",
    "confidence_score": 90
  }}
  """
  ```

---

### Day 5: Integration Testing

- [ ] **Verify mock agents chạy qua MockClaudeCodeRunner (Minh)**
  - PO agent → route_classification output correctly
  - DEV agent → onGate triggers for risky files
  - QA agent → ac_coverage_matrix validates scope
  - A2A contract validation passes between agents

- [ ] **Test scenario "add google login" end-to-end:**
  ```
  1. PO → route = FULLSTACK → UX included ✓
  2. A2A: PO→UX contract validated (prd + AC + risk) ✓
  3. UX → ux_spec generated ✓
  4. A2A: UX→DEV contract validated ✓
  5. DEV → auth.js flagged REQUIRE_APPROVAL ✓
  6. Gate approved → DEV continues ✓
  7. Sandbox → tests pass ✓
  8. A2A: DEV→QA contract validated ✓
  9. QA → AC coverage matrix correct ✓
  10. Final approval → RELEASED ✓
  ```

- [ ] **Test scenario "fix API pagination bug":**
  ```
  1. PO → route = BACKEND → UX skipped ✓
  2. DEV → no risky files → all AUTO_APPROVE ✓
  3. QA → validates scope ✓
  ```

---

### Day 6: E2E Test

- [ ] **Full pipeline test** — xem AIFA_INTEGRATION_PLAN.md §7.2

---

## Phase 4: Cleanup (Day 7)

### Remove Old Dependencies

- [ ] **Update `agents/requirements.txt`**
  ```diff
  # REMOVE:
  - langchain>=0.3.0
  - langchain-openai>=0.2.0
  - langfuse>=3.0.0
  - openai>=1.50.0
  - e2b-code-interpreter>=1.0.0

  # KEEP:
    fastapi>=0.115.0
    uvicorn[standard]>=0.30.0
    python-dotenv>=1.0.0
    pydantic>=2.0.0
    httpx>=0.27.0
    PyYAML>=6.0
    pytest>=8.0.0
  ```

- [ ] **Archive old files:**
  ```powershell
  mkdir agents/src/agents/_archive
  # Move original LangChain-based files (giữ để tham khảo)
  ```

- [ ] **Archive sandbox files:**
  ```
  sandbox/e2b_runtime.py → _archive/
  sandbox/run_dev.py → _archive/
  sandbox/test_e2b.py → _archive/
  ```

- [ ] **Archive LangGraph workflow:**
  - `agents/src/workflows/main_pipeline.py` → `_archive/`
  - Pipeline mới nằm trong backend `SdlcWorkflowService.js`

- [ ] **Clean imports:** xóa tất cả `from langchain...`, `from openai...`, `from e2b_code_interpreter...`

---

## Files Tôi Chịu Trách Nhiệm

| Action | File |
|---|---|
| 🔄 REFACTOR | `agents/src/agents/po_agent.py` |
| 🔄 REFACTOR | `agents/src/agents/ux_agent.py` |
| 🔄 REFACTOR | `agents/src/agents/dev_agent.py` |
| 🔄 REFACTOR | `agents/src/agents/qa_agent.py` |
| 🔄 MODIFY | `agents/requirements.txt` |
| 🆕 NEW | `mock-data/scenarios/` (6 scenario files) |
| 📁 ARCHIVE | `agents/src/workflows/main_pipeline.py` |
| 📁 ARCHIVE | `sandbox/e2b_runtime.py` |
| 📁 ARCHIVE | `sandbox/run_dev.py` |
| 📁 ARCHIVE | `sandbox/test_e2b.py` |
| 🔄 UPDATE | `agents/src/tools/sandbox.py` (integrate với docker_sandbox) |

---

## Prompt Engineering Guidelines (AIFA v3 aligned)

### Output Format Rules
1. **Luôn yêu cầu JSON output** — dễ parse, dễ validate
2. **PO: bắt buộc `route_classification`** — quyết định pipeline path
3. **PO: bắt buộc `risk_classification`** — phân loại rủi ro tổng
4. **DEV: `changed_files` PHẢI có `risk_level`** — RiskClassifier dùng
5. **DEV: `patch_diff` phải là unified git diff** — DiffViewer + Sandbox cần
6. **QA: `ac_coverage_matrix`** — map AC → test evidence
7. **QA: ghi rõ "simulated"** nếu mock (trung thực — AIFA v3 §5.6)
8. **Luôn có `confidence_score`** (0-100) — dưới ngưỡng → human gate

### A2A Contract Required Fields

| Chặng | PO must output | UX must output | DEV must output |
|---|---|---|---|
| PO → UX | prd, acceptance_criteria, risk_classification | — | — |
| UX → DEV | — | ux_spec, wireframe_spec, risk_classification | — |
| DEV → QA | — | — | patch_diff, sandbox_result, self_test_report, security_gate |

### Prompt Testing Checklist
Mỗi prompt cần verify:
- [ ] Output là valid JSON
- [ ] `route_classification` (PO) là một trong: UI, BACKEND, ANALYSIS, FULLSTACK
- [ ] `risk_classification` tồn tại (PO, UX, DEV)
- [ ] `changed_files` có `risk_level` per file (DEV)
- [ ] `patch_diff` bắt đầu bằng `diff --git` (DEV)
- [ ] `ac_coverage_matrix` khớp với acceptance_criteria (QA)
- [ ] `confidence_score` nằm trong 0-100

---

## Dependencies & Blockers

| Phụ thuộc | Từ ai | Khi nào cần |
|---|---|---|
| MockClaudeCodeRunner code | Minh | Day 3 (để hiểu interface) |
| RiskClassifier rules | Minh | Day 4 (để align risk levels) |
| A2AContractValidator | Minh | Day 5 (integration test) |
| Sandbox Docker image | Minh | Day 5 (sandbox test) |
| FE GatePanel working | Giang | Day 6 (E2E test) |

---

## Lưu Ý Quan Trọng

> ⚠️ **KHÔNG CÒN cần Claude Code CLI login hay Multica daemon.**
> Agents chạy mock hoàn toàn. Khi lên thật → spike tích hợp riêng.

> ⚠️ **PO Agent PHẢI có `route_classification` trong output.**
> Thiếu field này → pipeline không biết skip UX hay không → fallback FULLSTACK.

> ⚠️ **DEV Agent `changed_files` PHẢI có `risk_level`.**
> Thiếu → RiskClassifier mặc định REQUIRE_APPROVAL cho mọi file → approval fatigue.

> ⚠️ **Mock data phải đi qua đúng interface bản thật** (AIFA v3 §4.5).
> Không cam kết "thay nguồn là xong" — phải spike tích hợp thật trước khi chốt.
