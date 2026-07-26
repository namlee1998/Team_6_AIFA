# 02 — Flow Map

End-to-end data and control flow from user intent to production release.

---

## Pipeline overview

```
User types intent
      │
      ▼
[Intent Agent] ──────────────── REQUIREMENT_GATE ──► Human reviews intent assumptions
      │ APPROVE
      ▼
[PO Agent] ──────────────────── REQUIREMENT_GATE ──► Human reviews PRD / stories / AC
      │ APPROVE
      ▼
[UX Agent] ──────────────────── UX_GATE ──────────► Human reviews screens / Penpot
      │ APPROVE  (skipped when route.has_ui === false)
      ▼
[DEV Agent] ─────────────────── DEV_GATE ─────────► Human reviews code diff
      │ APPROVE
      ▼
[QA Agent] ──────────────────── QA_GATE ──────────► Human reviews test report
      │ APPROVE (Ship it)
      ▼
[FINAL_REVIEW] ─────────────────────────────────── Human clicks "Approve Final Release"
      │ APPROVE
      ▼
    RELEASED
```

---

## Route branching (PO → UX skip)

After PO completes, `classifyRoute()` inspects the feature request text:

| Route | `has_ui` | UX phase |
|-------|----------|----------|
| `ui` | true | runs |
| `fullstack` | true | runs |
| `backend` | false | **skipped** |
| `analysis` | false | **skipped** |

Default is `fullstack` — unknown requests always include the UX step.

---

## Context handoff between agents

Each agent receives a `compactContext` built from the approved outputs of all upstream tasks:

| Receiving agent | What it gets from upstream |
|-----------------|---------------------------|
| PO | `intent_assumptions` from Intent |
| UX | `prd`, `user_stories`, `acceptance_criteria`, `scope` from PO |
| DEV | `ux_spec`, `screens`, `wireframe_spec`, `color_palette`, `typography` from UX + full PO context |
| QA | `patch_diff`, `changed_files`, `implementation_plan`, `sandbox_result`, `self_test_report` from DEV + PO AC |

DEV must read UX screens and create one file per screen. QA must read the DEV diff hunk-by-hunk and write new test cases for each changed function — not re-run existing suites.

---

## Board modes

### `real_single` mode (`USE_MOCK_CLAUDE_CODE=false`)

- Flow 1 is the only active flow (flows 2 and 3 have `active: false`).
- Claude Code CLI runs the real DEV execution.
- Board API response: `{ status: 'success', data: { flows: [...] } }`.

### `three_flow` demo mode (default)

- Three separate projects seeded: Flow 1 parks at PO review, Flow 2 at DEV review, Flow 3 at QA review.
- Mock agents fill all outputs from `mock-data/{agent}/` files.
- Background drain timer auto-resolves in-flight gates between human reviews.

---

## Execution paths

```
EXECUTION_PATH env  →  langchain   Python agents (PO/UX/QA via astream_events SSE)
                    →  claude      Claude Agent SDK
                    →  claude_code Claude Code CLI (DEV when USE_MOCK_CLAUDE_CODE=false)
                    →  mock        Mock runner (always resolves, ignores timeouts)
```

---

## Board API response shape

```jsonc
GET /api/v1/sdlc/demo/board
{
  "status": "success",
  "data": {
    "flows": [
      {
        "flowNo": 1,
        "active": true,
        "projectId": "...",
        "target": "po",
        "status": "running" | "seeding" | "error" | "unavailable",
        "currentPhase": "PO_REVIEW" | "DEV_RUNNING" | "FINAL_REVIEW" | ...,
        "released": null | "RELEASED" | "RELEASE_REJECTED",
        "progress": { "done": 3, "total": 4 },
        "card": BoardCard | null,
        "releaseGate": { "eligible": bool, "approvalBlocked": bool, ... },
        "pendingGates": PendingGate[],
        "failure": FailureInfo | null
      }
    ]
  }
}
```

`card` is non-null when a human review is awaiting. When `card === null` and `currentPhase === 'FINAL_REVIEW'`, the release gate section should be shown and the board body says "All agents done — approve the final release below."

---

## Key timings and limits

| Parameter | Value |
|-----------|-------|
| Board poll interval | 5 s |
| Max parallel workflows | 3 (env: `MAX_PARALLEL_WORKFLOWS`) |
| PO timeout | 180 s |
| UX timeout | 240 s |
| DEV timeout | 1800 s |
| QA timeout | 900 s |
| Max retries per step | 3 (QA: 2) |
| Auto-approve confidence threshold | 0.8 |
