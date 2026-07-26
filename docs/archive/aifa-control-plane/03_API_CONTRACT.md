# 03 — API Contract

All HTTP endpoints exposed by the backend. Base path: `/api/v1/sdlc`.

---

## Agent execution

### `POST /run-intent-agent`
Start the intent analysis agent.
```jsonc
// Request
{ "feature_request": { "title": "...", "description": "..." }, "project_id": "..." }

// Response
{ "taskId": "...", "status": "processing" }
```

### `POST /run-po-agent`
Start the PO agent after intent is approved.
```jsonc
{ "project_id": "...", "source_task_id": "..." }
```

### `POST /run-ux-agent`
```jsonc
{ "project_id": "...", "source_task_id": "..." }
```

### `POST /run-dev-agent`
```jsonc
{ "project_id": "...", "source_task_id": "..." }
```

### `POST /run-qa-agent`
```jsonc
{ "project_id": "...", "source_task_id": "..." }
```

---

## HITL gate decisions

### `POST /tasks/:task_id/gate-decision`
Simple approve/reject.
```jsonc
// Request
{ "decision": "APPROVE" | "REJECT" | "REQUEST_CHANGES", "comment": "..." }

// Response
{ "hitlDecision": { "id": "...", "decision": "APPROVE", "gate": "DEV_GATE", ... } }
```

### `POST /tasks/:task_id/decision`
Structured HITL (patch + field-level feedback).
```jsonc
// Request
{
  "decision_id": "uuid",            // idempotency key
  "base_output_version": 0,
  "action": "approve" | "reject_and_rerun" | "patch_and_approve",
  "payload": {
    "target_fields": ["acceptance_criteria"],
    "blocking_issues": ["AC #3 is not testable"],
    "patch": [{ "op": "replace", "path": "/acceptance_criteria/2", "value": "..." }]
  },
  "comment": "..."
}
```

### `POST /tasks/:task_id/cancel`
Cancel a running or awaiting task.
```jsonc
{}
```

---

## Gate approvals (Claude Code onGate)

### `GET /approvals?task_id=xxx`
List pending interactive gates for a task.
```jsonc
// Response
{
  "approvals": [
    {
      "id": "...",
      "taskId": "...",
      "type": "tool_use" | "question" | "decision",
      "prompt": "...",
      "status": "pending" | "interrupted",
      "options": ["Yes", "No"]
    }
  ]
}
```

### `POST /approvals/:approval_id`
Resolve a pending gate.
```jsonc
// Approve/reject
{ "action": "approve" | "reject", "comment": "..." }

// Answer a question
{ "answers": { "question_text": "answer_text" } }
```

---

## Task status

### `GET /tasks/:task_id`
```jsonc
{
  "id": "...",
  "type": "dev-agent",
  "status": "completed",
  "executionStatus": "queued" | "running" | "done" | "failed",
  "versionStatus": "draft" | "committed",
  "agentOutput": { ... },         // parsed JSON object
  "result": { "gateRecommendation": "PASS" | "REWORK" | "HOLD" },
  "observability": { ... }
}
```

### `GET /status/:task_id`
SSE stream of task lifecycle events (text/event-stream).

### `GET /tasks/:task_id/events`
Paginated event log for a task.

---

## Workflow-level views

### `GET /workflow-status?project_id=xxx`
Full workflow state for a project.
```jsonc
{
  "phases": {
    "intent": { "taskId": "...", "status": "completed", "versionStatus": "committed", "gate": "REQUIREMENT_GATE", "invalid": false, "awaitingReview": false },
    "po": { ... },
    "ux": { ... },
    "dev": { ... },
    "qa":  { ... }
  },
  "releaseGate": {
    "eligible": true,
    "canDecide": true,
    "approvalBlocked": false,
    "status": "pending" | "released" | "rejected",
    "decision": HitlDecision | null,
    "evidence": { "open_blockers": [] }
  },
  "currentPhase": "FINAL_REVIEW",
  "hitlDecisions": [...]
}
```

### `GET /final-review-packet/:project_id`
All artifacts and decisions for the final human review.

### `POST /projects/:project_id/release-decision`
Submit the final release decision.
```jsonc
// Request
{ "decision_id": "uuid", "decision": "APPROVE" | "REJECT", "comment": "..." }
```
**Preconditions checked server-side:**
1. QA task `status === 'completed'` and `versionStatus === 'committed'`
2. QA gate passed (either `gateRecommendation === 'PASS'` OR `test_run_report.executed && failed === 0`)
3. No open blockers in release evidence
4. Caller has `owner` or `admin` role

### `GET /audit-trail/:project_id`
Full event log including agent starts, HITL decisions, handoffs.

### `GET /workflow/:id/timeline`
UI-friendly timeline (same data as audit-trail).

### `GET /projects/:project_id/metrics`
Workflow metrics: cycle time, gate durations, retry counts.

### `GET /projects/:project_id/artifacts`
All `AgentArtifact` records for a project.

---

## Board (demo)

### `POST /demo/seed-board?reset=true`
Provision the `/aifa` board. Idempotent; `reset=true` destroys existing state.

### `GET /demo/board`
Aggregated board state. Response shape:
```jsonc
{
  "status": "success",
  "data": {
    "flows": [ BoardFlow, ... ]
  }
}
```
`BoardFlow` includes: `flowNo`, `active`, `projectId`, `target`, `status`, `currentPhase`, `released`, `progress`, `card`, `releaseGate`, `pendingGates`, `failure`.

`BoardCard` includes: `agent`, `title`, `desc`, `invalid`, `patchDiff`, `penpotUrl`, `testCases`, `qaReport`, `actions.review`, `actions.approve`, `actions.reject`.

### `POST /demo/flow/:project_id/retry`
Re-run a failed agent from its committed upstream source.

### `GET /demo/flow/:project_id/ux-doc`
Fetch the UX markdown document to write into the opened folder.

---

## Repo / folder upload

### `POST /upload-repo`
Multipart: `files[]` + `paths[]` + `project_id`. Max 8 000 files, 25 MB per file.

---

## Error shape

All errors follow:
```jsonc
{ "error": { "code": "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | ..., "message": "..." } }
```
HTTP status codes: 400 bad input, 403 forbidden, 404 not found, 409 conflict (gate blocked), 429 quota exceeded, 500 internal.
