"""
Pydantic schemas for AIDLC agents (PO / UX / DEV / QA).
Extends the original schemas from A20-App-155.
"""

from __future__ import annotations
from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel, Field

# Keep all original schemas
from src.schemas import (
    UXFlow, FlowUIContext, ErrorSignal,
    Agent1Input, Agent1Output,
    Agent2Input, Agent2Output, TestScenario, TestStep,
    Agent3Input, Agent3Output, AutomationFile,
    RunAgentRequest, StreamChunk,
)

# =============================================================================
# A2A Handoff (Context passed between pipelines)
# =============================================================================
class A2AHandoff(BaseModel):
    job_id: str = Field(...)
    from_worker: str = Field(...)
    to_worker: str = Field(...)
    artifacts: list[str] = Field(default_factory=list)
    summary: str = Field(default="")
    approval_id: str = Field(...)
    constraints: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Transitional fields used by the current in-process adapter.
    prd_context: str = Field(default="")
    ux_spec: str = Field(default="")
    test_cases: list[str] = Field(default_factory=list)
    quality_gate_status: str = Field(default="")
    risk_level: str = Field(default="LOW")

# =============================================================================
# Feature Request (input to PO Agent)
# =============================================================================

class FeatureConstraint(BaseModel):
    text: str = Field(..., description="Constraint mô tả giới hạn kỹ thuật hoặc nghiệp vụ")

class FeatureRequest(BaseModel):
    id: str = Field(default="FR-001", description="Feature Request ID")
    title: str = Field(..., description="Tên tính năng ngắn gọn")
    description: str = Field(default="", description="Mô tả chi tiết tính năng")
    priority: str = Field(default="Medium", description="High / Medium / Low")
    target_user: str = Field(default="End user", description="Đối tượng sử dụng tính năng")
    business_goal: str = Field(default="", description="Mục tiêu kinh doanh")
    constraints: list[str] = Field(default_factory=list, description="Các ràng buộc kỹ thuật/sản phẩm")
    created_by: str = Field(default="human_user")
    status: str = Field(default="DRAFT")

class ProjectContext(BaseModel):
    project_id: str = Field(default="PRJ-001")
    project_name: str = Field(default="")
    tech_stack: dict[str, str] = Field(default_factory=dict, description="{'frontend': 'React', 'backend': 'FastAPI'}")
    existing_features: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)

# =============================================================================
# Intent Agent Output
# =============================================================================

class IntentAgentInput(BaseModel):
    feature_request: FeatureRequest
    feedback_prompt: str = Field(default="")

class IntentAgentOutput(BaseModel):
    intent_assumptions: str = Field(default="", description="AI Assumptions — markdown")
    clarifying_questions: list[str] = Field(default_factory=list)
    summary: str = Field(default="")

# =============================================================================
# PO Agent Output
# =============================================================================

class UserStory(BaseModel):
    id: str = Field(..., description="US-001")
    role: str = Field(..., description="As a [role]")
    want: str = Field(..., description="I want [action]")
    so_that: str = Field(..., description="So that [benefit]")
    acceptance_criteria: list[str] = Field(default_factory=list, description="Measurable AC list")

class POAgentInput(BaseModel):
    feature_request: FeatureRequest
    project_context: ProjectContext = Field(default_factory=ProjectContext)
    feedback_prompt: str = Field(default="")
    previous_draft: str | None = Field(default=None)

class POAgentOutput(BaseModel):
    prd: str = Field(default="", description="Product Requirements Document — markdown")
    user_stories: list[UserStory] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list, description="Flat list of all ACs")
    scope: str = Field(default="", description="In-scope items — markdown")
    out_of_scope: str = Field(default="", description="Out-of-scope items — markdown")
    mcp_activity: list[dict[str, Any]] = Field(default_factory=list)
    summary: str = Field(default="")

# =============================================================================
# UX Agent Output
# =============================================================================

class ScreenSpec(BaseModel):
    name: str
    purpose: str
    elements: list[str] = Field(default_factory=list)
    states: list[str] = Field(default_factory=list, description="loading/error/empty/success")

class UXAgentInput(BaseModel):
    prd: str = Field(default="")
    user_stories: list[UserStory] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    feedback_prompt: str = Field(default="")
    previous_draft: str | None = Field(default=None)

class UXAgentOutput(BaseModel):
    ux_spec: str = Field(default="", description="UX Spec — markdown")
    user_flow: str = Field(default="", description="User Flow diagram description — markdown")
    wireframe_spec: str = Field(default="", description="Wireframe description per screen — markdown")
    component_inventory: str = Field(default="", description="Component list — markdown")
    screens: list[ScreenSpec] = Field(default_factory=list)
    summary: str = Field(default="")

# =============================================================================
# DEV Agent Output
# =============================================================================

class ChangedFile(BaseModel):
    path: str
    reason: str
    change_type: str = Field(default="modify", description="add / modify / delete")

class SandboxReport(BaseModel):
    """Structured result of running the patch inside the local git worktree sandbox."""
    build_ok: bool = Field(default=False, description="Did the patch build/install successfully")
    tests_ran: bool = Field(default=False, description="Were tests actually executed")
    tests_passed: int = Field(default=0)
    tests_failed: int = Field(default=0)
    logs: str = Field(default="", description="Raw stdout/stderr excerpt — markdown")

class DEVAgentInput(BaseModel):
    prd: str = Field(default="")
    ux_spec: str = Field(default="")
    user_flow: str = Field(default="")
    acceptance_criteria: list[str] = Field(default_factory=list)
    project_context: ProjectContext = Field(default_factory=ProjectContext)
    architecture_ledger: str = Field(default="", description="Lịch sử thay đổi hệ thống trước đây")
    feedback_prompt: str = Field(default="")
    previous_draft: str | None = Field(default=None)

class DEVAgentOutput(BaseModel):
    architecture_ledger_update: str = Field(default="", description="Những thay đổi kiến trúc sau Story này")
    implementation_plan: str = Field(default="", description="Step-by-step plan — markdown")
    mock_code_diff: str = Field(default="", description="Unified git diff under the legacy field name")
    # The patch must be a well-defined format so QA knows exactly what to test
    # (plan section 2.1: "patch của DEV phải định nghĩa rõ là gì").
    patch_format: str = Field(default="unified_diff", description="unified_diff | file_bundle | git_commit")
    changed_files: list[ChangedFile] = Field(default_factory=list)
    # AC.id traceability thread: which acceptance criteria this patch implements.
    linked_ac_ids: list[str] = Field(default_factory=list, description="AC ids this patch implements")
    risk_assessment: str = Field(default="", description="Risk level LOW/MEDIUM/HIGH + reasoning — markdown")
    risk_level: str = Field(default="LOW", description="LOW | MEDIUM | HIGH")
    sandbox_report: str = Field(default="", description="Human-readable sandbox report — markdown (legacy field)")
    sandbox_result: SandboxReport = Field(default_factory=SandboxReport, description="Structured sandbox run result")
    patch_branch: str = Field(default="")
    patch_commit: str = Field(default="")
    summary: str = Field(default="")

# =============================================================================
# QA Agent Output
# =============================================================================

class ACCoverageRow(BaseModel):
    ac: str
    ac_id: str = Field(default="", description="Stable AC id (AC-1...) for cross-agent traceability")
    test_case_ids: list[str]
    covered: bool

class TestRunReport(BaseModel):
    """Did tests actually run, and what happened — not just a coverage matrix."""
    executed: bool = Field(default=False, description="Were the test cases actually executed")
    total: int = Field(default=0)
    passed: int = Field(default=0)
    failed: int = Field(default=0)
    duration_ms: int = Field(default=0)
    logs: str = Field(default="", description="Test runner output excerpt — markdown")

class QATestCase(BaseModel):
    id: str = Field(..., description="TC-001")
    source_ac: str = Field(default="", description="Acceptance Criterion this TC covers")
    title: str
    type: str = Field(default="functional", description="functional / ui / security / edge")
    priority: str = Field(default="Medium")
    precondition: str = Field(default="")
    steps: list[str] = Field(default_factory=list)
    expected_result: str = Field(default="")
    status: str = Field(default="Not Run")

class QAAgentInput(BaseModel):
    prd: str = Field(default="")
    acceptance_criteria: list[str] = Field(default_factory=list)
    ux_spec: str = Field(default="")
    implementation_plan: str = Field(default="")
    mock_code_diff: str = Field(default="")
    sandbox_report: str = Field(default="")
    risk_assessment: str = Field(default="")
    risk_level: str = Field(default="LOW")
    feedback_prompt: str = Field(default="")
    previous_draft: str | None = Field(default=None)

class QAAgentOutput(BaseModel):
    test_cases: list[QATestCase] = Field(default_factory=list)
    qa_report: str = Field(default="", description="QA Report — markdown")
    ac_coverage_matrix: list[ACCoverageRow] = Field(default_factory=list)
    # QAOutput is not just a coverage matrix (plan section 2.1): it must report
    # whether tests actually ran, regression + security findings, and a reasoned
    # release decision.
    test_run_report: TestRunReport = Field(default_factory=TestRunReport)
    regression_risks: list[str] = Field(default_factory=list)
    security_findings: list[str] = Field(default_factory=list)
    release_decision: str = Field(default="needs_changes", description="approve | reject | needs_changes")
    release_reason: str = Field(default="", description="Justification for the release decision")
    pass_count: int = Field(default=0)
    fail_count: int = Field(default=0)
    blocker_count: int = Field(default=0)
    release_recommendation: str = Field(default="HOLD", description="PASS / HOLD / REWORK")
    summary: str = Field(default="")


# =============================================================================
# Quality Gate Result (output of QualityGate evaluator)
# =============================================================================

class GateViolation(BaseModel):
    rule: str = Field(..., description="Rule name that was violated")
    expected: str = Field(..., description="Expected value / threshold")
    actual: str = Field(..., description="Actual value found")
    severity: str = Field(default="BLOCKER", description="BLOCKER | WARNING | INFO")


class GateCheck(BaseModel):
    check: str = Field(..., description="Check name (security_scan, static_analysis, fast_gate)")
    passed: bool
    issues: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    message: str = Field(default="")


class QualityGateMetrics(BaseModel):
    total_test_cases: int = Field(default=0)
    type_counts: dict[str, int] = Field(default_factory=dict)
    ac_coverage_pct: float = Field(default=0.0)
    blocker_count: int = Field(default=0)
    min_total_required: int = Field(default=0)
    min_happy_required: int = Field(default=0)
    min_negative_required: int = Field(default=0)
    min_edge_required: int = Field(default=0)
    min_security_required: int = Field(default=0)
    min_ac_coverage_required: float = Field(default=0.0)
    min_approvers_required: int = Field(default=1)
    bad_case_ratio_pct: float = Field(default=0.0)
    duplicate_rate_pct: float = Field(default=0.0)
    scope_violations: int = Field(default=0)


class QualityGateEvaluation(BaseModel):
    """Result of Quality Gate evaluation. Attached to QAAgentOutput after gate check."""
    complexity: str = Field(default="small", description="small | medium | large")
    gate_type: str = Field(default="FAST", description="FAST | ASYNC | STRICT")
    score: int = Field(default=0, description="Quality score 0-100")
    recommendation: str = Field(default="HOLD", description="PASS | HOLD | REWORK")
    violations: list[GateViolation] = Field(default_factory=list)
    metrics: QualityGateMetrics = Field(default_factory=QualityGateMetrics)
    gate_checks: list[GateCheck] = Field(default_factory=list)
    summary: str = Field(default="")
    passed: bool = Field(default=False)


# =============================================================================
# Structured HITL — Gate Mode, Run State, Human Decision (plan section 2)
# =============================================================================

# Gate Mode policy per gate (plan 2.3.1): not every gate must pause.
GATE_MODE_STRICT_MANUAL = "strict_manual"        # always require a human approve
GATE_MODE_CONFIDENCE = "confidence_based"        # pause only on low confidence / warnings
GATE_MODE_AUTO_SAFE = "auto_approve_safe"        # auto-approve when all validation passes AND risk low

# Retry reason taxonomy (plan 2.3.3) — to detect an agent repeating the same error.
RETRY_REASONS = (
    "schema_invalid", "ac_not_measurable", "coverage_gap",
    "build_fail", "quality_low", "other",
)

MAX_RETRY_PER_STEP = 3


class StepState(BaseModel):
    """Per-step state inside a factory run (plan 2.4 / 2.7)."""
    step: str = Field(..., description="po | ux | dev | qa")
    status: str = Field(default="pending", description="pending|running|waiting_human|approved|rejected|failed|needs_human_resolution")
    agent_output: dict[str, Any] = Field(default_factory=dict, description="Raw output the agent produced")
    approved_output: dict[str, Any] | None = Field(default=None, description="Human-approved/edited output — what the next agent receives")
    version: int = Field(default=0, description="Optimistic-lock version, bumped on each edit")
    retry_count: int = Field(default=0)
    last_retry_reason: str = Field(default="")
    gate_evaluation: QualityGateEvaluation | None = Field(default=None)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FactoryRunState(BaseModel):
    """Global run state shared by /build and /audit (plan 2.7 / 1.3)."""
    run_id: str
    project_id: str = Field(default="")
    feature_request: str = Field(default="")
    current_step: str = Field(default="po", description="po | ux | dev | qa | done")
    status: str = Field(
        default="running",
        description="running|waiting_human|approved|rejected|failed|completed|needs_human_resolution",
    )
    steps: dict[str, StepState] = Field(default_factory=dict)
    audit_event_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class HumanEdit(BaseModel):
    """Field-level edit using JSON Patch (RFC 6902), not a text diff (plan 2.3.4)."""
    base_version: int
    patch_format: str = Field(default="json_patch")
    patch: list[dict[str, Any]] = Field(default_factory=list, description="RFC 6902 operations")
    edited_output: dict[str, Any] = Field(default_factory=dict, description="Result after applying the patch")


class HumanDecisionRequest(BaseModel):
    """Idempotent HITL decision (plan 2.8)."""
    run_id: str
    step_id: str
    decision_id: str = Field(..., description="Idempotency key — duplicate is ignored, not re-processed")
    base_output_version: int = Field(default=0, description="Optimistic lock — stale version is rejected")
    action: str = Field(..., description="approve | reject | edit_approve")
    payload: dict[str, Any] = Field(default_factory=dict)


# Re-export everything
__all__ = [
    # Original
    "UXFlow", "FlowUIContext", "ErrorSignal",
    "Agent1Input", "Agent1Output",
    "Agent2Input", "Agent2Output", "TestScenario", "TestStep",
    "Agent3Input", "Agent3Output", "AutomationFile",
    "RunAgentRequest", "StreamChunk",
    # AIDLC
    "FeatureRequest", "ProjectContext",
    "IntentAgentInput", "IntentAgentOutput",
    "POAgentInput", "POAgentOutput", "UserStory",
    "UXAgentInput", "UXAgentOutput", "ScreenSpec",
    "DEVAgentInput", "DEVAgentOutput", "ChangedFile", "SandboxReport",
    "QAAgentInput", "QAAgentOutput", "QATestCase", "ACCoverageRow", "TestRunReport",
    # Quality Gate
    "GateViolation", "GateCheck", "QualityGateMetrics", "QualityGateEvaluation",
    # Structured HITL / Run State
    "StepState", "FactoryRunState", "HumanEdit", "HumanDecisionRequest",
    "GATE_MODE_STRICT_MANUAL", "GATE_MODE_CONFIDENCE", "GATE_MODE_AUTO_SAFE",
    "RETRY_REASONS", "MAX_RETRY_PER_STEP",
    # Context Pipeline
    "A2AHandoff",
]
