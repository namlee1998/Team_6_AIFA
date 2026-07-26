"""FastAPI transport adapter for the optional Python/LangChain worker runtime.

Beginner reading guide:
- The Node backend sends a RunAgentRequest to ``/v1/agent/run``.
- This module converts generic context into a role-specific Pydantic input.
- It dispatches to PO/UX/DEV/QA modules and streams progress/completion as SSE.
- Workflow ordering, persistence, validation, and HITL gates remain in Node.
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from src.schemas import RunAgentRequest
from src.schemas.aidlc import (
    DEVAgentInput,
    FeatureRequest,
    IntentAgentInput,
    POAgentInput,
    ProjectContext,
    QAAgentInput,
    UXAgentInput,
    UserStory,
)
from src.agents.intent_agent import run_intent_agent, stream_intent_agent
from src.observability import create_trace_context, flush_observability
from src.routing.rework import determine_fix_target

load_dotenv(override=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agents-server")


# =============================================================================
# App lifecycle
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🤖 AI Agents server starting...")
    logger.info("Direct LangChain worker runtime initialized")
    yield
    flush_observability()
    logger.info("👋 AI Agents server shutting down")


app = FastAPI(
    title="AIDLC Platform — AI Agents",
    description="Direct LangChain workers for the four-stage AIDLC pipeline",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "AGENTS_CORS_ORIGINS",
            "http://localhost:5173,http://localhost:3000",
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Helper: dispatch to the right agent
# =============================================================================


def _first_context_value(context: dict, key: str, default=None):
    value = context.get(key, default)
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, dict) and "content" in first:
            return first["content"]
        return first
    return value


def _text_context(context: dict, key: str, default: str = "") -> str:
    value = _first_context_value(context, key, default)
    if isinstance(value, str):
        return value
    if value is None:
        return default
    return json.dumps(value, ensure_ascii=False)


def _list_context(context: dict, key: str) -> list:
    value = _first_context_value(context, key, [])
    if isinstance(value, list):
        return value
    return []


def _feedback_context(context: dict) -> str:
    return context.get("feedback_prompt") or context.get("feedbackPrompt") or ""


def _feature_request_from_context(context: dict) -> FeatureRequest:
    raw = (
        _first_context_value(context, "feature_request")
        or _first_context_value(context, "featureRequest")
        or _first_context_value(context, "feature_request")
    )
    if isinstance(raw, FeatureRequest):
        return raw
    if isinstance(raw, dict):
        return FeatureRequest(**raw)

    assumptions = _text_context(context, "intent_assumptions")
    title = "Approved feature request"
    description = assumptions or "Derived from approved intent artifacts."
    return FeatureRequest(title=title, description=description)


def _project_context_from_context(context: dict) -> ProjectContext:
    raw = context.get("project_context") or context.get("projectContext")
    if isinstance(raw, ProjectContext):
        return raw
    if isinstance(raw, dict):
        return ProjectContext(**raw)
    return ProjectContext(project_id=context.get("project_id", "PRJ-001"))


def _user_stories_from_context(context: dict) -> list[UserStory]:
    stories = _list_context(context, "user_stories")
    return [
        UserStory(**story) if isinstance(story, dict) else story for story in stories
    ]


def _parse_agent_input(node_target: str, context: dict):
    """Parse context dict into the correct agent input schema."""
    if node_target == "intent_node":
        fr_data = context.get("feature_request") or context.get("featureRequest") or {}
        fr = FeatureRequest(**fr_data) if isinstance(fr_data, dict) else fr_data
        return IntentAgentInput(
            feature_request=fr,
            feedback_prompt=_feedback_context(context),
        )
    if node_target == "po_agent":
        return POAgentInput(
            feature_request=_feature_request_from_context(context),
            project_context=_project_context_from_context(context),
            feedback_prompt=_feedback_context(context),
            previous_draft=_text_context(context, "previousDraft", None),
        )
    if node_target == "ux_agent":
        return UXAgentInput(
            prd=_text_context(context, "prd"),
            user_stories=_user_stories_from_context(context),
            acceptance_criteria=_list_context(context, "acceptance_criteria"),
            feedback_prompt=_feedback_context(context),
            previous_draft=_text_context(context, "previousDraft", None),
        )
    if node_target == "dev_agent":
        return DEVAgentInput(
            prd=_text_context(context, "prd"),
            ux_spec=_text_context(context, "ux_spec"),
            user_flow=_text_context(context, "user_flow"),
            acceptance_criteria=_list_context(context, "acceptance_criteria"),
            project_context=_project_context_from_context(context),
            architecture_ledger=_text_context(context, "architecture_ledger"),
            feedback_prompt=_feedback_context(context),
            previous_draft=_text_context(context, "previousDraft", None),
        )
    if node_target == "qa_agent":
        sandbox_result = _first_context_value(context, "sandbox_result")
        sandbox_report = _text_context(context, "sandbox_report")
        if not sandbox_report and sandbox_result:
            sandbox_report = json.dumps(sandbox_result, ensure_ascii=False)
        return QAAgentInput(
            prd=_text_context(context, "prd"),
            acceptance_criteria=_list_context(context, "acceptance_criteria"),
            ux_spec=_text_context(context, "ux_spec"),
            implementation_plan=_text_context(context, "implementation_plan"),
            mock_code_diff=_text_context(context, "patch_diff") or _text_context(context, "mock_code_diff"),
            sandbox_report=sandbox_report,
            risk_assessment=_text_context(context, "risk_assessment"),
            risk_level=_text_context(context, "risk_level", "LOW"),
            feedback_prompt=_feedback_context(context),
            previous_draft=_text_context(context, "previousDraft", None),
        )
    raise ValueError(f"Unknown node_target: {node_target}")


async def _run_agent(node_target: str, input_data, trace_context=None):
    """Run the appropriate agent with the parsed input. Returns markdown string."""
    from src.utils.router import get_agent_config
    import json

    context_text = json.dumps(input_data.model_dump(), default=str)
    model_config = get_agent_config(node_target, context_text)

    if node_target == "intent_node":
        return await run_intent_agent(
            input_data, model_config=model_config, trace_context=trace_context
        )
    if node_target == "po_agent":
        from src.agents.po_agent import run_po_agent

        return await run_po_agent(
            input_data, model_config=model_config, trace_context=trace_context
        )
    if node_target == "ux_agent":
        from src.agents.ux_agent import run_ux_agent

        return await run_ux_agent(
            input_data, model_config=model_config, trace_context=trace_context
        )
    if node_target == "dev_agent":
        from src.agents.dev_agent import run_dev_agent

        return await run_dev_agent(
            input_data, model_config=model_config, trace_context=trace_context
        )
    if node_target == "qa_agent":
        from src.agents.qa_agent import run_qa_agent

        return await run_qa_agent(
            input_data, model_config=model_config, trace_context=trace_context
        )
    raise ValueError(f"Unknown node_target: {node_target}")


async def _stream_agent(
    node_target: str, input_data, trace_context=None, session_id: str = "default", auto_approve: bool = False
) -> AsyncGenerator[dict, None]:
    """Stream the appropriate agent with the parsed input."""
    from src.utils.router import get_agent_config
    import json

    context_text = json.dumps(input_data.model_dump(), default=str)
    model_config = get_agent_config(node_target, context_text)

    if node_target == "intent_node":
        async for chunk in stream_intent_agent(
            input_data, model_config=model_config, trace_context=trace_context
        ):
            yield chunk
    elif node_target == "po_agent":
        from src.agents.po_agent import stream_po_agent

        async for chunk in stream_po_agent(
            input_data, model_config=model_config, trace_context=trace_context
        ):
            yield chunk
    elif node_target == "ux_agent":
        from src.agents.ux_agent import stream_ux_agent

        async for chunk in stream_ux_agent(
            input_data, model_config=model_config, trace_context=trace_context
        ):
            yield chunk
    elif node_target == "dev_agent":
        from src.agents.dev_agent import stream_dev_agent

        async for chunk in stream_dev_agent(
            input_data, model_config=model_config, trace_context=trace_context,
            session_id=session_id, auto_approve=auto_approve
        ):
            yield chunk
    elif node_target == "qa_agent":
        from src.agents.qa_agent import stream_qa_agent

        async for chunk in stream_qa_agent(
            input_data, model_config=model_config, trace_context=trace_context
        ):
            yield chunk
    else:
        yield {
            "event": "error",
            "data": {"message": f"Unknown node_target: {node_target}"},
        }


# =============================================================================
# Routes
# =============================================================================


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-agents"}


@app.post("/v1/agent/route-rework")
async def route_rework(request: dict):
    """
    Analyze user feedback to determine which agent should be triggered for rework.
    """
    feedback = request.get("feedback_prompt", "")
    target = determine_fix_target(feedback)
    return {"target_agent": target}


@app.post("/v1/agent/run")
async def run_agent(request: RunAgentRequest):
    """
    Run a specific agent node and return the result as JSON stream (SSE).

    The response is streamed as Server-Sent Events:
    - event: progress  → streaming tokens
    - event: completed → final parsed result
    - event: error     → error message
    """
    try:
        input_data = _parse_agent_input(request.node_target, request.context)
    except (ValueError, ValidationError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    trace_context = create_trace_context(
        session_id=request.session_id,
        node_target=request.node_target,
        user_id=request.user_id,
        project_id=request.project_id,
        source_run_id=request.source_run_id,
    )

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            async for chunk in _stream_agent(
                request.node_target, input_data, trace_context, request.session_id, request.auto_approve
            ):
                # Debug logging
                if chunk.get("event") == "completed":
                    chunk.setdefault("data", {})
                    chunk["data"]["observability"] = trace_context.complete()
                    logger.info(f"Agent completed with: {chunk.get('data', {}).keys()}")
                    if "flows" in chunk.get("data", {}):
                        logger.info(f"Flows count: {len(chunk['data']['flows'])}")
                        if chunk["data"]["flows"]:
                            logger.info(f"First flow: {chunk['data']['flows'][0]}")

                event_line = (
                    f"event: {chunk['event']}\n"
                    f"data: {json.dumps(chunk['data'], ensure_ascii=False)}\n\n"
                )
                yield event_line
        except Exception as e:
            logger.error(f"Agent streaming error: {e}", exc_info=True)
            error_line = (
                f"event: error\n"
                f"data: {json.dumps({'message': str(e), 'observability': trace_context.fail(str(e))}, ensure_ascii=False)}\n\n"
            )
            yield error_line
        finally:
            flush_observability()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

class ResumeAgentRequest(BaseModel):
    session_id: str
    node_target: str
    approved: bool
    feedback: str = ""

@app.post("/v1/agent/resume")
async def resume_agent(request: ResumeAgentRequest):
    """Resume a paused agent (like DEV Agent) after human tool approval."""
    if request.node_target != "dev_agent":
        raise HTTPException(status_code=400, detail="Only dev_agent supports resume")
        
    trace_context = create_trace_context(
        session_id=request.session_id,
        node_target=request.node_target,
    )
    
    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            from src.agents.dev_agent import stream_dev_agent, create_dev_graph
            from langchain_core.messages import ToolMessage
            import sqlite3
            from langgraph.checkpoint.sqlite import SqliteSaver
            
            graph = create_dev_graph(auto_approve=False)
            config = {"configurable": {"thread_id": request.session_id}}
            
            feedback = request.feedback or ""
            if not request.approved or (request.approved and feedback.strip() != ""):
                # If rejected OR approved with feedback, we inject a ToolMessage
                # so the LLM knows it must modify its action.
                current_state = graph.get_state(config)
                if current_state.next and "tools" in current_state.next:
                    last_msg = current_state.values["messages"][-1]
                    tool_calls = last_msg.tool_calls
                    tool_msgs = []
                    
                    if not request.approved:
                        message_content = f"Human rejected this action. Reason: {feedback}" if feedback else "Human rejected this action."
                    else:
                        message_content = f"Human intercepted execution and requested modification: {feedback}. Please re-generate the corrected tool call based on this."
                        
                    for tc in tool_calls:
                        tool_msgs.append(ToolMessage(
                            tool_call_id=tc["id"],
                            name=tc["name"],
                            content=message_content
                        ))
                    graph.update_state(config, {"messages": tool_msgs}, as_node="tools")
            
            # Resume the graph by streaming with None as input
            async for event in graph.astream(None, config=config, stream_mode="values"):
                messages = event.get("messages", [])
                if messages:
                    last_msg = messages[-1]
                    # We can yield intermediate text if needed
            
            # After graph finishes or pauses again
            new_state = graph.get_state(config)
            if new_state.next and "tools" in new_state.next:
                last_msg = new_state.values["messages"][-1]
                tool_calls = last_msg.tool_calls
                yield f"event: requires_action\ndata: {json.dumps({'message': 'Tool execution requires approval.', 'tool_calls': tool_calls})}\n\n"
            elif new_state.values.get("final_output"):
                yield f"event: completed\ndata: {json.dumps(new_state.values['final_output'], ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Agent resume error: {e}", exc_info=True)
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
        finally:
            flush_observability()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/v1/agent/run-sync")
async def run_agent_sync(request: RunAgentRequest):
    """
    Run a specific agent and return the complete JSON result (no streaming).
    Useful for simple cases where the caller just wants the final output.
    """
    try:
        input_data = _parse_agent_input(request.node_target, request.context)
    except (ValueError, ValidationError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        trace_context = create_trace_context(
            session_id=request.session_id,
            node_target=request.node_target,
            user_id=request.user_id,
            project_id=request.project_id,
            source_run_id=request.source_run_id,
        )
        result = await _run_agent(request.node_target, input_data, trace_context)
        return {
            "session_id": request.session_id,
            "node_target": request.node_target,
            "result": result,
            "observability": trace_context.complete(),
        }
    except Exception as e:
        flush_observability()
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {str(e)}")
    finally:
        flush_observability()


@app.get("/v1/agent/stream/{session_id}")
async def stream_capabilities(session_id: str):
    """Compatibility endpoint that points clients to the supported SSE stream."""
    return {
        "session_id": session_id,
        "transport": "sse",
        "message": "Use POST /v1/agent/run for real-time SSE progress.",
    }


# =============================================================================
# Run with uvicorn
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8001")),
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )
