"""PO worker: turn a feature request into product artifacts.

Beginner reading guide: build the prompt, optionally call mock MCP tools, invoke
the configured chat model, parse strict JSON, and return POAgentOutput. Backend
validation decides whether these artifacts may be handed to UX/DEV.
"""
from __future__ import annotations
import json
import logging
import os
import re
import asyncio
from typing import Any
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from src.schemas.aidlc import POAgentInput, POAgentOutput, UserStory
from src.mcp.mcp_client import call_tool

logger = logging.getLogger(__name__)


def _prepare_po_mcp(title: str) -> list[dict]:
    result = call_tool("PO", "docs.search", {"query": title})
    return [{"tool": "docs.search", "result": result}]


def _publish_po_mcp(title: str, prd: str, activity: list[dict]) -> list[dict]:
    result = call_tool("PO", "confluence.write", {"title": title, "content": prd})
    return [*activity, {"tool": "confluence.write", "result": result}]

SYSTEM_PROMPT = """You are a senior Product Owner with 10+ years of experience writing PRDs for software products.

Given a Feature Request and Project Context, produce:

1. **PRD** (prd) — A concise Product Requirements Document in markdown covering:
   - Problem Statement
   - Target User
   - Goals & Non-Goals
   - Key Requirements

2. **User Stories** (user_stories) — Array of structured stories. Each must have:
   - id: "US-001", "US-002", ...
   - role, want, so_that
   - acceptance_criteria: list of measurable, testable criteria

3. **Acceptance Criteria** (acceptance_criteria) — Flat list of ALL acceptance criteria from all user stories. Each must be measurable and testable.

4. **Scope** (scope) — Markdown list of what IS included in this feature.

5. **Out of Scope** (out_of_scope) — Markdown list of what is EXCLUDED.

Output ONLY valid JSON with keys: prd, user_stories, acceptance_criteria, scope, out_of_scope, summary.
No extra text outside the JSON block.
"""

from src.utils.llm_factory import get_llm as _get_llm

def _parse_po_output(raw: str) -> dict:
    """Extract JSON from LLM output, stripping markdown fences."""
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except Exception as e:
        raise ValueError(f"Agent generated invalid JSON: {str(e)}\nRaw output: {raw}")

async def run_po_agent(
    input_data: POAgentInput,
    model_config: dict | None = None,
    trace_context: Any | None = None,
) -> POAgentOutput:
    llm = _get_llm(model_config)
    fr = input_data.feature_request
    pc = input_data.project_context
    mcp_activity = _prepare_po_mcp(fr.title)

    user_content = f"""Feature Request:
- Title: {fr.title}
- Description: {fr.description}
- Priority: {fr.priority}
- Target User: {fr.target_user}
- Business Goal: {fr.business_goal}
- Constraints: {json.dumps(fr.constraints)}

Project Context:
- Project: {pc.project_name}
- Tech Stack: {json.dumps(pc.tech_stack)}
- Existing Features: {json.dumps(pc.existing_features)}
- Constraints: {json.dumps(pc.constraints)}
"""
    if input_data.feedback_prompt:
        user_content = f"<human_feedback>\n{input_data.feedback_prompt}\n</human_feedback>\n\n{user_content}"
    if input_data.previous_draft:
        user_content += f"\n\n<previous_draft>\n{input_data.previous_draft}\n</previous_draft>\n<instruction>\nYou MUST use the previous_draft as your baseline. Only apply changes requested in the human_feedback. Do not rewrite perfectly good sections unnecessarily.\n</instruction>"

    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
    config = trace_context.langchain_config("po_agent") if trace_context else None

    response = await llm.ainvoke(messages, **({"config": config} if config else {}))
    parsed = _parse_po_output(response.content)

    # Map user_stories dicts → UserStory objects
    stories = []
    for s in parsed.get("user_stories", []):
        if isinstance(s, dict):
            stories.append(UserStory(
                id=s.get("id", "US-001"),
                role=s.get("role", ""),
                want=s.get("want", ""),
                so_that=s.get("so_that", ""),
                acceptance_criteria=s.get("acceptance_criteria", []),
            ))

    prd = parsed.get("prd", "")
    return POAgentOutput(
        prd=prd,
        user_stories=stories,
        acceptance_criteria=parsed.get("acceptance_criteria", []),
        scope=parsed.get("scope", ""),
        out_of_scope=parsed.get("out_of_scope", ""),
        mcp_activity=_publish_po_mcp(fr.title, prd, mcp_activity),
        summary=parsed.get("summary", f"PO Agent completed for: {fr.title}"),
    )

async def stream_po_agent(
    input_data: POAgentInput,
    model_config: dict | None = None,
    trace_context: Any | None = None,
):
    """Stream PO Agent token by token, yield progress + completed events."""
    llm = _get_llm(model_config)
    fr = input_data.feature_request
    pc = input_data.project_context
    mcp_activity = await asyncio.to_thread(_prepare_po_mcp, fr.title)
    yield {"event": "progress", "data": {"step": "mcp", "token": "PO called MCP tool: docs.search"}}

    user_content = f"""Feature Request:
- Title: {fr.title}
- Description: {fr.description}
- Priority: {fr.priority}
- Target User: {fr.target_user}
- Business Goal: {fr.business_goal}
- Constraints: {json.dumps(fr.constraints)}

Project Context:
- Project: {pc.project_name}
- Tech Stack: {json.dumps(pc.tech_stack)}
- Existing Features: {json.dumps(pc.existing_features)}
"""
    if input_data.feedback_prompt:
        user_content = f"<human_feedback>\n{input_data.feedback_prompt}\n</human_feedback>\n\n{user_content}"
    if input_data.previous_draft:
        user_content += f"\n\n<previous_draft>\n{input_data.previous_draft}\n</previous_draft>\n<instruction>\nYou MUST use the previous_draft as your baseline. Only apply changes requested in the human_feedback. Do not rewrite perfectly good sections unnecessarily.\n</instruction>"

    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
    config = trace_context.langchain_config("po_agent") if trace_context else None

    max_retries = 3
    retries = 0
    parsed = None
    
    total_input = 0
    total_output = 0
    
    while retries < max_retries:
        full_text = ""
        
        if retries > 0:
            yield {"event": "progress", "data": {"step": "schema_gate", "token": f"\n\n🔄 Schema validation failed. Retrying JSON generation (Attempt {retries}/{max_retries})...\n\n"}}

        if hasattr(llm, "astream_events"):
            async for event in llm.astream_events(messages, version="v2", **({"config": config} if config else {})):
                kind = event["event"]
                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    if chunk.content:
                        full_text += chunk.content
                        yield {"event": "progress", "data": {"step": "po_agent", "token": chunk.content}}
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
                    yield {"event": "progress", "data": {"step": "po_agent", "token": chunk.content}}

        # Try to parse strict JSON
        text = full_text.strip()
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fence: text = fence.group(1).strip()
        
        try:
            parsed = json.loads(text)
            break # Success!
        except json.JSONDecodeError as e:
            retries += 1
            if retries == max_retries:
                # Fallback to robust parsing
                parsed = _parse_po_output(full_text)
                break
            else:
                messages.append(SystemMessage(content=f"Your last output was invalid JSON. Error: {str(e)}. Please output ONLY valid JSON."))

    parsed["mcp_activity"] = await asyncio.to_thread(_publish_po_mcp, fr.title, parsed.get("prd", ""), mcp_activity)
    yield {"event": "progress", "data": {"step": "mcp", "token": "PO called MCP tool: confluence.write"}}
    yield {
        "event": "completed",
        "data": {
            **parsed,
            "token_usage": {"input": total_input, "output": total_output},
        },
    }
