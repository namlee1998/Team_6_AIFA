from __future__ import annotations

from main import _parse_agent_input
from src.schemas.aidlc import DEVAgentInput, POAgentInput, QAAgentInput, UXAgentInput


def test_dispatch_parses_camel_case_intent_payload():
    parsed = _parse_agent_input(
        "intent_node",
        {
            "featureRequest": {"title": "Checkout", "description": "Add one-tap checkout"},
            "feedbackPrompt": "tighten assumptions",
        },
    )

    assert parsed.feature_request.title == "Checkout"
    assert parsed.feedback_prompt == "tighten assumptions"


def test_dispatch_parses_po_from_persisted_intent_artifacts():
    parsed = _parse_agent_input(
        "po_agent",
        {
            "feature_request": [
                {
                    "content": {
                        "title": "Checkout",
                        "description": "Add one-tap checkout",
                    }
                }
            ],
            "feedback_prompt": "focus MVP",
        },
    )

    assert isinstance(parsed, POAgentInput)
    assert parsed.feature_request.title == "Checkout"
    assert parsed.feedback_prompt == "focus MVP"


def test_dispatch_parses_downstream_sdlc_artifacts():
    ux = _parse_agent_input(
        "ux_agent",
        {
            "prd": [{"content": "# PRD"}],
            "user_stories": [{"content": [{"id": "US-001", "role": "buyer", "want": "pay", "so_that": "checkout faster"}]}],
            "acceptance_criteria": [{"content": ["AC-1"]}],
        },
    )
    dev = _parse_agent_input(
        "dev_agent",
        {
            "prd": [{"content": "# PRD"}],
            "ux_spec": [{"content": "# UX"}],
            "acceptance_criteria": [{"content": ["AC-1"]}],
        },
    )
    qa = _parse_agent_input(
        "qa_agent",
        {
            "prd": [{"content": "# PRD"}],
            "implementation_plan": [{"content": "# Plan"}],
            "risk_assessment": [{"content": "LOW"}],
        },
    )

    assert isinstance(ux, UXAgentInput)
    assert ux.user_stories[0].id == "US-001"
    assert isinstance(dev, DEVAgentInput)
    assert dev.ux_spec == "# UX"
    assert isinstance(qa, QAAgentInput)
    assert qa.implementation_plan == "# Plan"


def test_qa_dispatch_prefers_real_patch_and_structured_sandbox_evidence():
    qa = _parse_agent_input(
        "qa_agent",
        {
            "patch_diff": [{"content": "diff --git a/src/a.js b/src/a.js"}],
            "mock_code_diff": [{"content": "old mock diff"}],
            "sandbox_result": [
                {
                    "content": {
                        "tests_ran": True,
                        "build_ok": True,
                        "tests_passed": 3,
                    }
                }
            ],
        },
    )

    assert qa.mock_code_diff.startswith("diff --git")
    assert '"tests_ran": true' in qa.sandbox_report.lower()
