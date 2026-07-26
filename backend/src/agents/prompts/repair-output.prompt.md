Prompt owner: backend/agent team
Schema owner: backend workflow team
Validator owner: backend workflow team

# Repair Output Prompt

Convert the provided raw Claude output into a valid `agent-io.v3` JSON object for
the requested AIFA stage.

Rules:
- Do not call Bash, Edit, Write, or any side-effect tool.
- Do not invent repository changes.
- Preserve evidence and uncertainty from the raw output.
- Return only one fenced JSON block matching the requested stage contract.
