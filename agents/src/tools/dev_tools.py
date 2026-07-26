import os
import subprocess
from pathlib import Path
from langchain_core.tools import tool

def _get_workspace_dir() -> Path:
    configured = os.getenv("AGENT_WORKSPACE_REPO")
    if configured:
        return Path(configured).expanduser().resolve()
    # Fallback to repo root (3 levels up from this file)
    return Path(__file__).resolve().parents[3]

@tool
def execute_bash(command: str) -> str:
    """Execute a bash command in the workspace directory. Use this to run tests, list files, or install dependencies."""
    cwd = _get_workspace_dir()
    try:
        result = subprocess.run(
            command,
            cwd=str(cwd),
            shell=True,
            text=True,
            capture_output=True,
            timeout=120,
        )
        output = result.stdout + "\n" + result.stderr
        if not output.strip():
            output = f"Command executed successfully with no output."
        return f"Exit code: {result.returncode}\nOutput:\n{output}"
    except Exception as e:
        return f"Error executing command: {str(e)}"

@tool
def read_file(file_path: str) -> str:
    """Read the contents of a file in the workspace."""
    cwd = _get_workspace_dir()
    target = (cwd / file_path).resolve()
    if not str(target).startswith(str(cwd)):
        return "Error: Access denied outside workspace."
    try:
        with open(target, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"

@tool
def write_file(file_path: str, content: str) -> str:
    """Write content to a file in the workspace."""
    cwd = _get_workspace_dir()
    target = (cwd / file_path).resolve()
    if not str(target).startswith(str(cwd)):
        return "Error: Access denied outside workspace."
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Successfully wrote to {file_path}"
    except Exception as e:
        return f"Error writing file: {str(e)}"
