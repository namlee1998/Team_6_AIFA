# 04 — Agent Output Contract

Version: `gate-output.v4`  
Source of truth: `OUTPUT_CONTRACTS` in `SdlcWorkflowService.js`.

Each rule has: `rule` (name), `severity` (`BLOCKER` | `WARNING`), `check(output, task) → bool`, optional `when(output) → bool` (skip the rule unless condition met), `detail` (human-readable violation message).

---

## Intent Agent

| Rule | Severity | Check |
|------|----------|-------|
| `intent_assumptions_present` | BLOCKER | `intent_assumptions` is non-empty |

---

## PO Agent

| Rule | Severity | Check |
|------|----------|-------|
| `prd_present` | BLOCKER | `prd` is a non-empty string |
| `user_stories_present` | BLOCKER | `user_stories` is a non-empty array |
| `ac_present` | BLOCKER | `acceptance_criteria` array is non-empty |
| `ac_testable` | BLOCKER | At least one AC is ≥ 15 characters (concrete/testable) |
| `ac_measurable` | WARNING | Every AC is ≥ 12 characters |
| `scope_present` | BLOCKER | `scope` is non-empty |
| `out_of_scope_present` | BLOCKER | `out_of_scope` is non-empty |
| `risk_classification_present` | BLOCKER | `risk_classification.level` is non-empty AND `required_gates[]` is non-empty |

**Required output fields:**
```jsonc
{
  "prd": "string",
  "user_stories": ["As a user..."],
  "acceptance_criteria": ["string ≥15 chars"],
  "scope": "string",
  "out_of_scope": "string",
  "risk_classification": {
    "level": "HIGH" | "LOW",
    "tags": ["auth", "oauth"],
    "required_gates": ["schema", "validation", "evidence", "security", "qa"],
    "reason": "string"
  },
  "feature_request": { "title": "...", "description": "..." }
}
```

---

## UX Agent

| Rule | Severity | Check |
|------|----------|-------|
| `ux_spec_present` | BLOCKER | `ux_spec` is a non-empty string |
| `user_flow_present` | BLOCKER | `user_flow` is non-empty |
| `wireframe_present` | BLOCKER | `wireframe_spec` is non-empty |
| `screens_present` | BLOCKER | `screens[]` is non-empty |
| `components_present` | BLOCKER | `component_inventory` is non-empty |

**Required output fields:**
```jsonc
{
  "ux_spec": "string",
  "user_flow": "string",
  "wireframe_spec": "string",
  "screens": [
    {
      "name": "Login Page",
      "route": "/login",
      "elements": [
        { "type": "logo", "content": "..." },
        { "type": "heading", "content": "Sign in to Acme" },
        { "type": "button-google", "label": "Sign in with Google" },
        { "type": "error-banner", "condition": "on OAuth error" }
      ]
    }
  ],
  "component_inventory": "string",
  "color_palette": { "primary": "#...", "error": "#..." },
  "typography": { "heading": "...", "body": "..." }
}
```

UX element types: `logo`, `heading`, `subheading`, `button-google`, `button-primary`, `button-secondary`, `input`, `error-banner`, `spinner`, `divider`, `link`, `avatar`, `nav`, `card`.

---

## DEV Agent

| Rule | Severity | Check |
|------|----------|-------|
| `implementation_plan_present` | BLOCKER | `implementation_plan` is non-empty |
| `patch_present` | BLOCKER | `patch_diff` OR `mock_code_diff` is non-empty |
| `changed_files_present` | BLOCKER | `changed_files[]` is non-empty |
| `patch_format` | WARNING | `patch_format` field is defined |
| `build_ok` | BLOCKER | `sandbox_result.build_ok !== false` |
| `sandbox_tests` | BLOCKER | `sandbox_result.tests_ran === true` |
| `self_test_report` | BLOCKER | `self_test_report` is non-empty |
| `linked_ac` | BLOCKER | `linked_ac_ids[]` is non-empty |
| `risk_assessment_present` | BLOCKER | `risk_assessment` is non-empty |
| `risk_classification_present` | BLOCKER | `risk_classification.level` + `required_gates[]` non-empty |
| `security_notes` | BLOCKER | `security_notes` present — **only when** `required_gates` includes `'security'` |
| `security_gate` | BLOCKER | `security_gate.recommendation === 'PASS'` — **only when** `required_gates` includes `'security'` |

**Required output fields:**
```jsonc
{
  "implementation_plan": "string",
  "patch_diff": "unified diff string",
  "changed_files": ["public/login.html", "app.py"],
  "patch_format": "unified",
  "sandbox_result": { "build_ok": true, "tests_ran": true, "output": "..." },
  "self_test_report": "string",
  "linked_ac_ids": ["AC-1", "AC-2"],
  "risk_assessment": "string",
  "risk_classification": { "level": "HIGH", "required_gates": ["security", "qa"] },
  "security_notes": "string",          // when security gate required
  "security_gate": { "recommendation": "PASS" }  // when security gate required
}
```

**DEV must create one file per UX screen** — not patch existing files unless intentional. Map UX element types to exact HTML/CSS per the element type table in `dev.prompt.md`.

---

## QA Agent

| Rule | Severity | Check |
|------|----------|-------|
| `test_cases_present` | BLOCKER | `test_cases[]` is non-empty |
| `coverage_present` | BLOCKER | `ac_coverage_matrix[]` is non-empty |
| `coverage_complete` | BLOCKER | Every row in `ac_coverage_matrix` has `covered === true` |
| `tests_executed` | BLOCKER | `test_run_report.executed === true` |
| `test_count_consistent` | BLOCKER | `test_run_report.total === test_cases.length` |
| `test_evidence_present` | BLOCKER | `test_run_report.logs` or `test_run_report.evidence` is non-empty |
| `tests_passed` | BLOCKER | `test_run_report.failed === 0` |
| `no_blockers` | BLOCKER | `blocker_count === 0` |
| `qa_report_present` | BLOCKER | `qa_report` is non-empty |
| `release_decision_present` | BLOCKER | `release_decision` ∈ `['approve','reject','needs_changes']` |
| `release_reason` | BLOCKER | `release_reason` is non-empty |
| `quality_gate_pass` | BLOCKER | `gateRecommendation === 'PASS'` OR (`test_run_report.executed && failed === 0 && total > 0`) |

**Note on `quality_gate_pass`:** The second condition is a fallback for cases where the QA agent produces a `REWORK` recommendation despite all tests passing (labelling gap). The system treats this as a pass since execution evidence supersedes the label.

**Required output fields:**
```jsonc
{
  "test_cases": [
    {
      "id": "TC-001",
      "title": "Google login redirects to OAuth URL",
      "source_ac": "AC-1",
      "type": "integration",
      "steps": ["Navigate to /login", "Click Sign in with Google"],
      "expected": "Redirect to accounts.google.com",
      "actual": "302 → accounts.google.com",
      "result": "PASS",
      "evidence": "pytest output / HTTP trace"
    }
  ],
  "ac_coverage_matrix": [{ "ac_id": "AC-1", "covered": true, "test_ids": ["TC-001"] }],
  "test_run_report": {
    "executed": true,
    "total": 25,
    "passed": 25,
    "failed": 0,
    "evidence": "pytest session output",
    "logs": "..."
  },
  "blocker_count": 0,
  "qa_report": "string",
  "release_decision": "approve",
  "release_reason": "string",
  "gate_evaluation": { "recommendation": "PASS", "score": 88 }
}
```

**QA must NOT** simply re-run the existing test suite and report totals. It must parse the DEV `patch_diff` hunk-by-hunk, identify changed functions, and write NEW test cases targeting those changes.

---

## Scoring (QualityGateService)

Score is 0–100, computed from:

| Component | Weight | Notes |
|-----------|--------|-------|
| Total test case count | 25 pts | Full credit at `minTotalTestCases` per complexity tier |
| Scenario distribution | 25 pts | Only scored when suite carries explicit scenario tags; otherwise full 25 pts awarded |
| AC coverage % | 25 pts | Linear from 0→100% |
| Gate checks (security scan + static analysis) | 15 pts | |
| No blockers | 10 pts | |

Recommendation thresholds: `PASS` ≥ 75, `HOLD` 50–74, `REWORK` < 50.

Complexity tiers (based on AC count + changed file count):
- `small`: ≥5 test cases required
- `medium`: ≥10
- `large`: ≥15
