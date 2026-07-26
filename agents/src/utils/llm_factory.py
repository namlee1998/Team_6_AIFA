import os
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic

def get_llm(model_config=None):
    """
    Centralized factory to initialize the LLM.
    Supports both OpenAI-compatible endpoints (e.g. OpenRouter) and direct Anthropic SDK.
    """
    if model_config is None:
        model_config = {}

    model_name = model_config.get("model") or os.getenv("DEFAULT_MODEL", "gpt-4o-mini")
    temp = model_config.get("temperature", 0.2)
    max_tokens = model_config.get("max_tokens", 8192)
    thinking = model_config.get("thinking", False)

    # Route to Anthropic SDK if model specifically indicates claude AND no base_url is set
    # (If base_url is set, it means we are using OpenRouter or similar proxy)
    base_url = os.getenv("OPENAI_API_BASE")
    if "claude" in model_name.lower() and not base_url:
        ant_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not ant_key:
            raise ValueError(f"ANTHROPIC_API_KEY is not set (required for {model_name}).")
        return ChatAnthropic(
            model_name=model_name,
            temperature=temp,
            max_tokens=max_tokens,
            api_key=ant_key
        )

    # Specific support for Native Google Gemini API (when no proxy base_url is provided)
    if "gemini" in model_name.lower() and not base_url:
        gemini_key = os.getenv("GOOGLE_API_KEY", "")
        if not gemini_key:
            raise ValueError(f"GOOGLE_API_KEY is not set (required for {model_name}).")
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model_name,
            temperature=temp,
            max_output_tokens=max_tokens,
            google_api_key=gemini_key
        )

    # Specific support for DeepSeek Native API (when no proxy base_url is provided)
    if "deepseek" in model_name.lower() and not base_url:
        ds_key = os.getenv("DEEPSEEK_API_KEY", "")
        if not ds_key:
            raise ValueError(f"DEEPSEEK_API_KEY is not set (required for {model_name}).")
            
        kwargs = {
            "model": model_name,
            "temperature": temp,
            "max_tokens": max_tokens,
            "api_key": ds_key,
            "base_url": "https://api.deepseek.com"
        }
        if thinking:
            kwargs["model_kwargs"] = {"extra_body": {"thinking": True}}
            
        return ChatOpenAI(**kwargs)

    # Otherwise route to ChatOpenAI (handles OpenAI and OpenRouter proxies)
    oai_key = os.getenv("OPENAI_API_KEY", "")
    if not oai_key:
        raise ValueError(f"OPENAI_API_KEY is not set (required for {model_name} or OpenRouter proxy).")

    kwargs = {
        "model": model_name,
        "temperature": temp,
        "max_tokens": max_tokens,
        "api_key": oai_key,
    }
    
    if base_url:
        kwargs["base_url"] = base_url

    # Specific support for OpenRouter deepseek thinking
    if thinking and "deepseek" in model_name.lower():
        kwargs["model_kwargs"] = {"extra_body": {"thinking": True}}
    
    return ChatOpenAI(**kwargs)
