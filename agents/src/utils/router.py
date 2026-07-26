import logging
import os
import json

logger = logging.getLogger(__name__)

# Try to import tiktoken, fallback to approximation
try:
    import tiktoken
    HAS_TIKTOKEN = True
except ImportError:
    HAS_TIKTOKEN = False

def count_tokens(text: str) -> int:
    """Count tokens in text."""
    if not text:
        return 0
        
    if HAS_TIKTOKEN:
        try:
            enc = tiktoken.get_encoding("o200k_base")
            return len(enc.encode(text))
        except Exception:
            return len(text) // 4
    else:
        return len(text) // 4

# Static Agent Configurations based on llm_strategy_report.md & Mentor Feedback
AGENT_CONFIGS = {
    "intent_node": {"model": "gpt-4o-mini", "thinking": False, "max_tokens": 512, "temperature": 0.1},
    "po_agent": {"model": os.getenv("PO_MODEL", "deepseek-chat"), "thinking": True, "max_tokens": 8192, "temperature": 0.1},
    "ux_agent": {"model": os.getenv("UX_MODEL", "gemini-2.5-pro"), "thinking": False, "max_tokens": 8192, "temperature": 0.1},
    # Config for the DEV agent
    "dev_agent": {"model": os.getenv("DEV_FALLBACK_MODEL", "claude-3-5-sonnet-latest"), "thinking": False, "max_tokens": 8192, "temperature": 0.0},
    "qa_agent": {"model": os.getenv("QA_MODEL", "grok-2-1212"), "thinking": False, "max_tokens": 4096, "temperature": 0.1},
    "self_review": {"model": "deepseek-chat", "thinking": False, "max_tokens": 2048, "temperature": 0.1}
}

def get_agent_config(node_target: str, context_text: str = "") -> dict:
    """
    Hybrid Router: 
    1. Base: Uses static mapping for optimal cost/IQ balance.
    2. Dynamic Fallback: If context exceeds safe thresholds, fallback to a heavy-duty model.
    """
    config = AGENT_CONFIGS.get(node_target)
    if not config:
        logger.warning(f"[Router] No config found for {node_target}. Using safe fallback.")
        config = {"model": "gpt-4o-mini", "thinking": False, "max_tokens": 2048, "temperature": 0.1}
        
    final_config = config.copy()
    
    # HYBRID MECHANISM
    if context_text:
        tokens = count_tokens(context_text)
        logger.info(f"[HybridRouter] Node: {node_target} | Tokens: {tokens} | Default Model: {final_config['model']}")
        
        # Guardrail: If token > 64,000, force switch to a safe fallback to prevent OOM/Cost blowout
        if tokens > 64000:
            fallback_model = os.getenv("ULTRABRAIN_MODEL", "gpt-4o")
            logger.warning(f"🚨 [HybridRouter] CONTEXT EXCEEDS 64k TOKENS! Switching from {final_config['model']} to {fallback_model}.")
            final_config['model'] = fallback_model
            final_config['thinking'] = False 
            
    return final_config
