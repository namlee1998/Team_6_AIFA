"""
Pydantic schemas for all agent I/O contracts.
Every input and output between agents and the outside world
must conform to these schemas.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# =============================================================================
# Agent 1 — UX Flow Extraction
# =============================================================================


class ErrorSignal(BaseModel):
    """Tín hiệu UI khi xảy ra lỗi trong một flow."""

    trigger: str = Field(
        ..., description="Điều kiện gây ra lỗi, VD: 'empty required field'"
    )
    ui_text: str | None = Field(
        default=None,
        description="Exact text hiển thị trên UI; None nếu PRD không specify",
    )
    element: str | None = Field(
        default=None, description="UI element hiển thị lỗi, VD: 'amount field'"
    )


class FlowUIContext(BaseModel):
    """Context UI cụ thể cho một flow, được Agent 1 extract từ tài liệu."""

    active_screen: str | None = Field(
        default=None, description="Màn hình user đang thao tác"
    )
    elements: list[str] = Field(
        default_factory=list, description="UI elements visible trên active_screen"
    )
    success_screen: str | None = Field(
        default=None, description="Màn hình sau khi flow hoàn thành thành công"
    )
    success_signals: list[str] = Field(
        default_factory=list, description="Observable UI changes khi thành công"
    )
    validation_rules: list[dict] = Field(
        default_factory=list,
        description="[{field, constraint}] cho từng field có validation",
    )
    error_signals: list[ErrorSignal] = Field(
        default_factory=list, description="Tín hiệu UI khi có lỗi"
    )


class UXFlow(BaseModel):
    """Một UX flow được trích xuất từ tài liệu."""

    name: str = Field(..., description="Tên flow, VD: 'Login Flow'")
    source: str = Field(
        ..., description="Nguồn tham chiếu: 'Big Feature > Sub Feature'"
    )
    steps: list[str] = Field(default_factory=list, description="Các bước trong flow")
    ui_context: FlowUIContext = Field(
        default_factory=FlowUIContext, description="UI context tương ứng với flow này"
    )


class Agent1Output(BaseModel):
    """Output schema cho Agent 1 (UX Flow Extraction)."""

    flows: list[UXFlow] = Field(default_factory=list, description="Danh sách UX flows")
    raw_markdown: str = Field(default="", description="Agent 1 output as raw Markdown")
    feature_count: int = Field(default=0, description="Số lượng big features đã xử lý")


class Agent1Input(BaseModel):
    """Input cho Agent 1."""

    raw_text: str = Field(..., description="Nội dung tài liệu gốc")
    prompt_profile: str = Field(default="", description="Prompt profile được sử dụng")
    feedback_prompt: str = Field(
        default="", description="User feedback from HITL review"
    )


# =============================================================================
# Agent 2 — QA Scenario Generation
# =============================================================================


class TestStep(BaseModel):
    """Một bước trong test scenario."""

    id: str = Field(..., description="ID bước, VD: step_1")
    action: str = Field(..., description="Hành động cần thực hiện")
    expected_result: str = Field(..., description="Kết quả mong đợi")


class TestScenario(BaseModel):
    """Một test scenario."""

    id: str = Field(..., description="Unique ID, VD: TC_001")
    name: str = Field(..., description="Tên scenario")
    priority: str = Field(default="Medium", description="Priority: High / Medium / Low")
    type: str = Field(
        default="Functional", description="Loại: Functional / UI / Security"
    )
    preconditions: list[str] = Field(
        default_factory=list, description="Điều kiện tiên quyết"
    )
    steps: list[TestStep] = Field(default_factory=list, description="Các bước test")
    test_data: dict[str, Any] = Field(default_factory=dict, description="Dữ liệu test")
    expected_outcome: str = Field(
        default="", description="Kết luận cuối cùng mong đợi (behavioral description)"
    )
    assert_hints: list[str] = Field(
        default_factory=list,
        description="Observable UI signals cho Agent 3 sinh assert; dùng 'TODO:' nếu text chưa rõ",
    )
    flow_name: str = Field(default="", description="Tên UX flow nguồn (từ Agent 1)")
    feature_name: str = Field(
        default="", description="Tên feature nhóm (từ flow.source)"
    )


class Agent2Output(BaseModel):
    """Output schema cho Agent 2 (QA Scenario Generation)."""

    feature_name: str = Field(..., description="Tên tính năng")
    scenarios: list[TestScenario] = Field(
        default_factory=list, description="Danh sách test scenarios"
    )
    markdown: str = Field(
        default="", description="Markdown representation của scenarios"
    )


class Agent2Input(BaseModel):
    """Input cho Agent 2."""

    feature_name: str = Field(default="Unknown", description="Tên tính năng")
    # Structured flows from Agent 1 (Primary input now!)
    flows: list[UXFlow] = Field(default_factory=list, description="UX flows từ Agent 1")
    # Raw markdown (Secondary/Legacy)
    normalized_flows_text: str = Field(
        default="", description="Agent 1 output as raw Markdown"
    )
    # HITL: optional user correction prompt
    feedback_prompt: str = Field(
        default="",
        description="User feedback from HITL review (e.g. 'testcase 2 has wrong precondition')",
    )


# =============================================================================
# Agent 3 — Automation Code Generation
# =============================================================================


class AutomationFile(BaseModel):
    """Một file YAML automation."""

    filename: str = Field(..., description="Tên file, VD: 'login_test.yaml'")
    content: str = Field(..., description="Nội dung YAML")


class Agent3Output(BaseModel):
    """Output schema cho Agent 3 (Automation Code Generation)."""

    yaml_files: list[AutomationFile] = Field(
        default_factory=list, description="Danh sách file YAML"
    )
    summary: str = Field(default="", description="Tóm tắt công việc")


class Agent3Input(BaseModel):
    """Input cho Agent 3."""

    feature_name: str = Field(default="Unknown", description="Tên tính năng")
    # Structured input (Primary)
    scenarios: list[TestScenario] = Field(
        default_factory=list, description="Scenarios từ Agent 2"
    )
    # Raw text input (Secondary)
    test_scenarios_text: str = Field(
        default="", description="Agent 2 output as raw Markdown"
    )
    ui_description: str = Field(
        default="", description="Mô tả UI chi tiết (elements, selectors)"
    )
    framework: str = Field(
        default="AIDLC Auto Platform",
        description="Framework: AIDLC Auto Platform / appium / playright / detox",
    )
    feedback_prompt: str = Field(
        default="", description="User feedback from HITL review"
    )


# =============================================================================
# API Request / Response Schemas (FastAPI)
# =============================================================================


class RunAgentRequest(BaseModel):
    """Request body cho POST /v1/agent/run."""

    session_id: str = Field(..., description="Session / task ID")
    user_id: str | None = Field(
        default=None, description="User ID for trace correlation"
    )
    project_id: str | None = Field(
        default=None, description="Project ID for trace correlation"
    )
    source_run_id: str | None = Field(
        default=None, description="Upstream task ID for trace correlation"
    )
    node_target: str = Field(
        ...,
        description="Target node: 'agent_1_extraction' | 'agent_2_scenarios' | 'agent_3_automation'",
    )
    context: dict = Field(
        default_factory=dict,
        description="Context data sẽ được chuyển thành input của agent tương ứng",
    )
    auto_approve: bool = Field(
        default=False,
        description="Nếu True, LangGraph sẽ bỏ qua Breakpoint và tự động chạy Tool (Rảnh tay).",
    )


class StreamChunk(BaseModel):
    """Một chunk trong SSE stream."""

    event: str = Field(
        ..., description="event type: 'progress' | 'completed' | 'error'"
    )
    data: dict = Field(..., description="Payload")
