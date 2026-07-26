"""QA worker: turn approved upstream evidence into test and release artifacts.

Beginner reading guide: _build_qa_content limits and organizes upstream context,
the model produces structured QA evidence, and the Node backend applies the
authoritative quality/release gates.
"""
from __future__ import annotations
import json, logging, os, re
from typing import Any
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from src.schemas.aidlc import QAAgentInput, QAAgentOutput, QATestCase, ACCoverageRow

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior QA Engineer. Your mission is to generate test cases that ACTUALLY catch real bugs — not just pass-for-the-sake-of-passing tests. Your output is the "soul" of the quality gate.

=== INPUTS ===
Given: PRD, Acceptance Criteria (AC) list, UX Spec, Implementation Plan, Code Diff, Sandbox Report, Risk Assessment.

=== OUTPUT (strict JSON) ===
{test_cases, qa_report, ac_coverage_matrix, test_run_report, regression_risks,
security_findings, release_decision, release_reason, pass_count, fail_count,
blocker_count, release_recommendation, summary}

=== TEST CASE RULES ===

1. ID FORMAT: TC-{3-digit} (TC-001, TC-002...)
2. TYPE — classify strictly:
   - "functional"  : Happy path — feature works with valid input (at least 1 per AC)
   - "negative"    : Invalid input, constraint violation, error handling (empty field, wrong format, over limit)
   - "edge"        : Boundary values, duplicate state, zero items, race conditions
   - "security"    : Auth bypass, unauthorized access, injection, privilege escalation — REQUIRED for auth/payment/role features
   - "ui"          : Render correctness, labels, loading states — only when UX spec specifies exact text

3. COVERAGE RULES (per AC):
   - Every AC → at least 1 functional test case
   - HIGH priority AC → at least 1 functional + 1 negative + 1 edge
   - Auth/payment/security AC → add 1 security test case

4. QUALITY STANDARDS (no generic tests):
   - steps[] must be concrete, executable steps a tester can follow without ambiguity
   - expected_result must describe EXACTLY what happens — not "success message appears" but "Toast shows 'Login successful' and user is redirected to /dashboard"
   - precondition must list full app state: auth state, screen, data, feature flags
   - test_data must use LITERAL values (not "a valid email" but "user@example.com")
   - If exact text is unknown from documents: use "PENDING_CLARIFICATION: confirm exact text with dev"

5. REAL BUG COVERAGE — think about these real failure scenarios:
   - What if the network call fails? (timeout, 500 error)
   - What if the user double-clicks submit?
   - What if the session expires mid-flow?
   - What if required data is missing in the response?
   - What if concurrent users hit the same resource?
   - What if the token/cookie is expired/tampered?
   - What if DB constraint is violated (unique, foreign key)?

6. SANDBOX INTEGRATION: If sandbox_report contains patch failures → generate regression test cases targeting the specific failure.

7. RISK ESCALATION:
   - risk_level=HIGH → generate at minimum 2 security + 2 edge cases beyond normal coverage
   - Include performance/load note in qa_report if risk mentions performance

=== AC COVERAGE MATRIX ===
For each AC: {ac: "string", test_case_ids: ["TC-001", ...], covered: true/false}
covered=false only when zero test cases exist for that AC.

=== QA REPORT FORMAT ===
## QA Report
**Feature**: [name]
**Total Test Cases**: X (functional: A, negative: B, edge: C, security: D)
**AC Coverage**: X% (Y/Z ACs covered)
**Blockers**: [list or "None"]
**Release Recommendation**: PASS | HOLD | REWORK
**Rationale**: [1-2 sentences explaining the recommendation]
**Risk Areas**: [specific risks found during analysis]
**Regression Coverage**: [what regressions are covered by these tests]

=== RECOMMENDATION LOGIC ===
- "PASS"   : 0 blockers, all ACs covered, no security gaps
- "HOLD"   : No blockers, but coverage < 90% or missing edge cases
- "REWORK" : Any blocker, security gap in auth/payment feature, or AC coverage < 70%

Output ONLY valid JSON. No markdown fences."""

from src.utils.llm_factory import get_llm as _get_llm

def _parse(raw):
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence: text = fence.group(1).strip()
    try:
        return json.loads(text)
    except Exception as exc:
        raise ValueError(f"QA agent generated invalid JSON: {exc}\nRaw output: {raw}") from exc

def _build_qa_content(input_data: QAAgentInput) -> str:
    """Build the human message content for QA Agent from all input artifacts."""
    content = ""
    # AC list first — most critical input
    if input_data.acceptance_criteria:
        content += "## Acceptance Criteria\n"
        for i, ac in enumerate(input_data.acceptance_criteria, 1):
            content += f"- AC-{i:03d}: {ac}\n"
        content += "\n"

    if input_data.prd:
        content += f"## Product Requirements Document\n{input_data.prd[:4000]}\n\n"

    if input_data.ux_spec:
        content += f"## UX Specification\n{input_data.ux_spec[:2500]}\n\n"

    if input_data.implementation_plan:
        content += f"## Implementation Plan\n{input_data.implementation_plan[:2500]}\n\n"

    if input_data.mock_code_diff:
        # Show diff summary (first 2000 chars) — helps QA understand what changed
        diff_preview = input_data.mock_code_diff[:2000]
        content += f"## Code Changes (Diff Preview)\n```diff\n{diff_preview}\n```\n\n"

    if input_data.sandbox_report:
        content += f"## Sandbox Report\n{input_data.sandbox_report[:1500]}\n\n"

    if input_data.risk_assessment:
        content += f"## Risk Assessment\n**Risk Level**: {input_data.risk_level}\n{input_data.risk_assessment[:1200]}\n\n"

    if input_data.feedback_prompt:
        content = f"<human_feedback>\n{input_data.feedback_prompt}\n</human_feedback>\n\n" + content

    if input_data.previous_draft:
        content += f"\n\n<previous_draft>\n{input_data.previous_draft}\n</previous_draft>\n<instruction>\nYou MUST use the previous_draft as your baseline. Only apply changes requested in the human_feedback. Do not rewrite perfectly good sections unnecessarily.\n</instruction>"

    return content


async def run_qa_agent(input_data: QAAgentInput, model_config=None, trace_context=None) -> QAAgentOutput:
    llm = _get_llm(model_config)
    content = _build_qa_content(input_data)
    cfg = trace_context.langchain_config("qa_agent") if trace_context else None
    resp = await llm.ainvoke([SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=content)],
                              **({"config": cfg} if cfg else {}))
    p = _parse(resp.content)
    test_cases = [QATestCase(**t) if isinstance(t, dict) else t for t in p.get("test_cases", [])]
    matrix = [ACCoverageRow(**r) if isinstance(r, dict) else r for r in p.get("ac_coverage_matrix", [])]
    return QAAgentOutput(
        test_cases=test_cases,
        qa_report=p.get("qa_report", ""),
        ac_coverage_matrix=matrix,
        test_run_report=p.get("test_run_report", {}),
        regression_risks=p.get("regression_risks", []),
        security_findings=p.get("security_findings", []),
        release_decision=p.get("release_decision", "needs_changes"),
        release_reason=p.get("release_reason", ""),
        pass_count=p.get("pass_count", 0),
        fail_count=p.get("fail_count", 0),
        blocker_count=p.get("blocker_count", 0),
        release_recommendation=p.get("release_recommendation", "HOLD"),
        summary=p.get("summary", "QA Agent completed"),
    )

async def stream_qa_agent(input_data: QAAgentInput, model_config=None, trace_context=None):
    llm = _get_llm(model_config)
    content = _build_qa_content(input_data)
    cfg = trace_context.langchain_config("qa_agent") if trace_context else None
    msgs = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=content)]
    full, tin, tout = "", 0, 0
    if hasattr(llm, "astream_events"):
        async for ev in llm.astream_events(msgs, version="v2", **({"config": cfg} if cfg else {})):
            if ev["event"] == "on_chat_model_stream" and ev["data"]["chunk"].content:
                full += ev["data"]["chunk"].content
                yield {"event":"progress","data":{"step":"qa_agent","token":ev["data"]["chunk"].content}}
            elif ev["event"] == "on_chat_model_end":
                u = getattr(ev["data"].get("output"),"usage_metadata",None)
                if u: tin += u.get("input_tokens",0); tout += u.get("output_tokens",0)
    else:
        async for chunk in llm.astream(msgs):
            if chunk.content: full += chunk.content; yield {"event":"progress","data":{"step":"qa_agent","token":chunk.content}}
    yield {"event":"completed","data":{**_parse(full),"token_usage":{"input":tin,"output":tout}}}
