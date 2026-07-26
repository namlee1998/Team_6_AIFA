"""UX worker: turn approved product artifacts into design artifacts.

Beginner reading guide: this module owns prompt/model/parsing concerns only.
The Node orchestrator supplies approved upstream context and controls handoff.
"""
from __future__ import annotations
import json
import logging
import os
import re
from typing import Any
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from src.schemas.aidlc import UXAgentInput, UXAgentOutput, ScreenSpec

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior UX Designer with expertise in mobile and web product design.

Given an approved PRD and User Stories, produce:

1. **ux_spec** — Full UX spec in markdown covering all main user journeys.

2. **user_flow** — Step-by-step user flow description in markdown (not a diagram code, but a readable description of the flow from entry point to completion).

3. **wireframe_spec** — Per-screen wireframe description in markdown. For each screen include:
   - Screen name
   - Purpose
   - Key UI elements
   - States: loading / error / empty / success

4. **component_inventory** — Markdown table of reusable components (buttons, forms, modals, alerts, etc.)

5. **screens** — Array of screen objects. Each: { name, purpose, elements[], states[] }

Output ONLY valid JSON with keys: ux_spec, user_flow, wireframe_spec, component_inventory, screens, summary.
No extra text outside the JSON.
"""

from src.utils.llm_factory import get_llm as _get_llm

def _parse_output(raw: str) -> dict:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except Exception as e:
        raise ValueError(f"Agent generated invalid JSON: {str(e)}\nRaw output: {raw}")

async def run_ux_agent(
    input_data: UXAgentInput,
    model_config: dict | None = None,
    trace_context: Any | None = None,
) -> UXAgentOutput:
    llm = _get_llm(model_config)

    user_content = f"""PRD:\n{input_data.prd}\n\n"""
    if input_data.user_stories:
        stories_text = "\n".join([f"- [{s.id}] As a {s.role}, I want {s.want}, so that {s.so_that}" for s in input_data.user_stories])
        user_content += f"User Stories:\n{stories_text}\n\n"
    if input_data.acceptance_criteria:
        user_content += f"Acceptance Criteria:\n" + "\n".join([f"- {ac}" for ac in input_data.acceptance_criteria])
    if input_data.feedback_prompt:
        user_content = f"<human_feedback>\n{input_data.feedback_prompt}\n</human_feedback>\n\n{user_content}"
    if input_data.previous_draft:
        user_content += f"\n\n<previous_draft>\n{input_data.previous_draft}\n</previous_draft>\n<instruction>\nYou MUST use the previous_draft as your baseline. Only apply changes requested in the human_feedback. Do not rewrite perfectly good sections unnecessarily.\n</instruction>"

    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
    config = trace_context.langchain_config("ux_agent") if trace_context else None
    response = await llm.ainvoke(messages, **({"config": config} if config else {}))
    parsed = _parse_output(response.content)

    screens = [ScreenSpec(**s) if isinstance(s, dict) else s for s in parsed.get("screens", [])]

    return UXAgentOutput(
        ux_spec=parsed.get("ux_spec", ""),
        user_flow=parsed.get("user_flow", ""),
        wireframe_spec=parsed.get("wireframe_spec", ""),
        component_inventory=parsed.get("component_inventory", ""),
        screens=screens,
        summary=parsed.get("summary", "UX Agent completed"),
    )

async def stream_ux_agent(
    input_data: UXAgentInput,
    model_config: dict | None = None,
    trace_context: Any | None = None,
):
    llm = _get_llm(model_config)
    user_content = f"PRD:\n{input_data.prd}\n\n"
    if input_data.user_stories:
        stories_text = "\n".join([f"- [{s.id}] As a {s.role}, I want {s.want}" for s in input_data.user_stories])
        user_content += f"User Stories:\n{stories_text}\n"
    if input_data.feedback_prompt:
        user_content = f"<human_feedback>\n{input_data.feedback_prompt}\n</human_feedback>\n\n{user_content}"
    if input_data.previous_draft:
        user_content += f"\n\n<previous_draft>\n{input_data.previous_draft}\n</previous_draft>\n<instruction>\nYou MUST use the previous_draft as your baseline. Only apply changes requested in the human_feedback. Do not rewrite perfectly good sections unnecessarily.\n</instruction>"

    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
    config = trace_context.langchain_config("ux_agent") if trace_context else None

    full_text = ""
    total_input = 0
    total_output = 0

    if hasattr(llm, "astream_events"):
        async for event in llm.astream_events(messages, version="v2", **({"config": config} if config else {})):
            if event["event"] == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if chunk.content:
                    full_text += chunk.content
                    yield {"event": "progress", "data": {"step": "ux_agent", "token": chunk.content}}
            elif event["event"] == "on_chat_model_end":
                usage = getattr(event["data"].get("output"), "usage_metadata", None)
                if usage:
                    total_input += usage.get("input_tokens", 0)
                    total_output += usage.get("output_tokens", 0)
    else:
        async for chunk in llm.astream(messages):
            if chunk.content:
                full_text += chunk.content
                yield {"event": "progress", "data": {"step": "ux_agent", "token": chunk.content}}

    parsed = _parse_output(full_text)
    yield {"event": "completed", "data": {**parsed, "token_usage": {"input": total_input, "output": total_output}}}
