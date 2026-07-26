"""
Intent Agent — Generates AI Assumptions from a raw Feature Request.
"""
from __future__ import annotations
import json
import logging
import os
import re
from typing import Any
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from src.schemas.aidlc import IntentAgentInput, IntentAgentOutput

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Intent Agent (Intake Analyst).
Your job is to read the user's raw feature request and formulate an "AI Assumptions" document (intent_assumptions.md).
Do not reject the request. Instead, make intelligent assumptions about:
- What exactly the user wants to build.
- The likely target user.
- The business goal.
- Potential technical or product constraints.

Output ONLY valid JSON with keys: intent_assumptions, clarifying_questions, summary.
- intent_assumptions: A markdown string detailing your assumptions in a structured way (Problem, Target User, Assumptions).
- clarifying_questions: A list of 1-3 strings. Ask questions IF AND ONLY IF some assumptions are highly risky.
- summary: A short string summarizing what you did.
No extra text outside the JSON block.
"""

from src.utils.llm_factory import get_llm as _get_llm

def _parse_intent_output(raw: str) -> dict:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except Exception as e:
        raise ValueError(f"Agent generated invalid JSON: {str(e)}\nRaw output: {raw}")

async def run_intent_agent(
    input_data: IntentAgentInput,
    model_config: dict | None = None,
    trace_context: Any | None = None,
) -> IntentAgentOutput:
    llm = _get_llm(model_config)
    fr = input_data.feature_request

    user_content = f"""Raw Feature Request:
- Title: {fr.title}
- Description: {fr.description}
- Priority: {fr.priority}
- Target User: {fr.target_user}
- Business Goal: {fr.business_goal}
- Constraints: {json.dumps(fr.constraints)}
"""
    if input_data.feedback_prompt:
        user_content = f"<human_feedback>\n{input_data.feedback_prompt}\n</human_feedback>\n\n{user_content}"

    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
    config = trace_context.langchain_config("intent_agent") if trace_context else None

    response = await llm.ainvoke(messages, **({"config": config} if config else {}))
    parsed = _parse_intent_output(response.content)

    return IntentAgentOutput(
        intent_assumptions=parsed.get("intent_assumptions", ""),
        clarifying_questions=parsed.get("clarifying_questions", []),
        summary=parsed.get("summary", "Generated assumptions."),
    )

async def stream_intent_agent(
    input_data: IntentAgentInput,
    model_config: dict | None = None,
    trace_context: Any | None = None,
):
    llm = _get_llm(model_config)
    fr = input_data.feature_request

    user_content = f"""Raw Feature Request:
- Title: {fr.title}
- Description: {fr.description}
- Priority: {fr.priority}
- Target User: {fr.target_user}
- Business Goal: {fr.business_goal}
- Constraints: {json.dumps(fr.constraints)}
"""
    if input_data.feedback_prompt:
        user_content = f"<human_feedback>\n{input_data.feedback_prompt}\n</human_feedback>\n\n{user_content}"

    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
    config = trace_context.langchain_config("intent_agent") if trace_context else None

    full_text = ""
    total_input = 0
    total_output = 0

    if hasattr(llm, "astream_events"):
        async for event in llm.astream_events(messages, version="v2", **({"config": config} if config else {})):
            kind = event["event"]
            if kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if chunk.content:
                    full_text += chunk.content
                    yield {"event": "progress", "data": {"step": "intent_agent", "token": chunk.content}}
            elif kind == "on_chat_model_end":
                usage = getattr(event["data"].get("output"), "usage_metadata", None)
                if usage:
                    total_input += usage.get("input_tokens", 0)
                    total_output += usage.get("output_tokens", 0)
    else:
        stream = llm.astream(messages)
        async for chunk in stream:
            if chunk.content:
                full_text += chunk.content
                yield {"event": "progress", "data": {"step": "intent_agent", "token": chunk.content}}

    parsed = _parse_intent_output(full_text)

    yield {
        "event": "completed",
        "data": {
            **parsed,
            "token_usage": {"input": total_input, "output": total_output},
        },
    }
