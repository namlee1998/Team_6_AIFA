from __future__ import annotations
import json
import logging
import sqlite3
import os
from typing import AsyncGenerator, Annotated, Sequence, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END, add_messages
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.prebuilt import ToolNode

from src.schemas.aidlc import DEVAgentInput, DEVAgentOutput
from src.utils.router import get_agent_config
from src.utils.llm_factory import get_llm
from src.tools.dev_tools import execute_bash, read_file, write_file

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a senior software engineer implementing a feature. Your code must be production-quality.

You have access to tools to interact with the file system and run commands (execute_bash, read_file, write_file).
Use them to implement the feature, run tests, and verify your work.
When you are completely finished, you must call the `SubmitFinalOutput` tool to provide the final structured output.

=== INPUTS ===
Given: PRD, Acceptance Criteria, UX Spec, User Flow, Architecture Ledger.

=== CODE QUALITY STANDARDS ===
1. CLEAN CODE PRINCIPLES
2. ERROR HANDLING
3. SECURITY STANDARDS
4. TESTABILITY
"""

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    input_data: DEVAgentInput
    final_output: dict | None

def create_dev_graph(auto_approve: bool = False):
    tools = [execute_bash, read_file, write_file]
    tool_node = ToolNode(tools)

    def agent_node(state: AgentState):
        messages = state["messages"]
        input_data = state["input_data"]
        
        llm_config = get_agent_config("dev_agent", input_data.prd)
        llm = get_llm(llm_config)
        llm_with_tools = llm.bind_tools(tools)
        
        response = llm_with_tools.invoke(messages)
        return {"messages": [response]}

    def should_continue(state: AgentState):
        messages = state["messages"]
        last_message = messages[-1]
        if not last_message.tool_calls:
            return "final_output"
        return "tools"
        
    def final_output_node(state: AgentState):
        messages = state["messages"]
        input_data = state["input_data"]
        llm_config = get_agent_config("dev_agent", input_data.prd)
        llm = get_llm(llm_config)
        structured_llm = llm.with_structured_output(DEVAgentOutput)
        
        # Summarize conversation to generate final output
        summary_prompt = "Based on your work above, generate the final structured DEVAgentOutput."
        messages_for_final = list(messages) + [HumanMessage(content=summary_prompt)]
        
        final_out = structured_llm.invoke(messages_for_final)
        return {"final_output": final_out.model_dump() if final_out else None}

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tool_node)
    workflow.add_node("final_output", final_output_node)

    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", "final_output": "final_output"})
    workflow.add_edge("tools", "agent")
    workflow.add_edge("final_output", END)

    interrupt_before = [] if auto_approve else ["tools"]
    
    # We use a persistent SQLite checkpointer
    conn = sqlite3.connect("dev_checkpoints.sqlite", check_same_thread=False)
    memory = SqliteSaver(conn)
    
    return workflow.compile(checkpointer=memory, interrupt_before=interrupt_before)

async def run_dev_agent(input_data: DEVAgentInput, model_config=None, trace_context=None) -> DEVAgentOutput:
    # Fallback sync run (if used)
    graph = create_dev_graph(auto_approve=True)
    prompt = f"PRD: {input_data.prd}\nUX Spec: {input_data.ux_spec}\nFeedback: {input_data.feedback_prompt}"
    config = {"configurable": {"thread_id": "sync_run_1"}}
    
    state = {"messages": [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=prompt)], "input_data": input_data}
    final_state = graph.invoke(state, config=config)
    return DEVAgentOutput(**final_state["final_output"])

async def stream_dev_agent(input_data: DEVAgentInput, model_config=None, trace_context=None, session_id: str = "default", auto_approve: bool = False, is_resume: bool = False, approved_tool_call_id: str = None) -> AsyncGenerator[dict, None]:
    graph = create_dev_graph(auto_approve)
    config = {"configurable": {"thread_id": session_id}}
    
    if not is_resume:
        prompt = f"PRD: {input_data.prd}\nUX Spec: {input_data.ux_spec}\nAC: {input_data.acceptance_criteria}\nFeedback: {input_data.feedback_prompt}"
        state = {"messages": [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=prompt)], "input_data": input_data}
        # Start execution
        async for event in graph.astream(state, config=config, stream_mode="values"):
            messages = event.get("messages", [])
            if messages:
                last_msg = messages[-1]
                if isinstance(last_msg, AIMessage) and not last_msg.tool_calls:
                    yield {"event": "progress", "data": {"content": last_msg.content}}
    else:
        # Resume execution
        # If user approved, graph resumes automatically.
        # If we had custom logic for reject, we'd inject a ToolMessage with an error.
        pass
        
    # After astream finishes, check if it was interrupted
    current_state = graph.get_state(config)
    if current_state.next and "tools" in current_state.next:
        # Interrupted!
        last_msg = current_state.values["messages"][-1]
        tool_calls = last_msg.tool_calls
        yield {
            "event": "requires_action",
            "data": {
                "message": "Tool execution requires approval.",
                "tool_calls": tool_calls
            }
        }
    elif current_state.values.get("final_output"):
        yield {
            "event": "completed",
            "data": current_state.values["final_output"]
        }
