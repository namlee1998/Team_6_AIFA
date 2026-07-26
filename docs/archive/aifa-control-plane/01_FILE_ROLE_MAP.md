# 01 — File Role Map

Every file that matters to the AIFA control plane, what it does, and what you must NOT do to it.

---

## Backend core

| File | Role | Critical constraints |
|------|------|----------------------|
| `backend/src/services/SdlcWorkflowService.js` | **Master orchestrator.** Owns the state machine, output contracts, gate modes, retry policy, release gate, audit trail, and board status derivation. | Never rewrite without explicit approval. Do not inline gate logic elsewhere. |
| `backend/src/services/QualityGateService.js` | Evaluates QA output against hardcoded rules (complexity, score, recommendation). Called by SdlcWorkflowService at QA gate. | `SCENARIO_ORDER` order matters — changing it changes which tests are classified as which type. |
| `backend/src/services/demoBoardService.js` | View-model for the `/aifa` board. Aggregates workflow status into per-flow cards with actions. | `REVIEW_HOLD_ROLES` controls which stages park for human review. `STAGE_META` maps stage → button labels. |
| `backend/src/services/taskLifecycleService.js` | Low-level task state transitions (pending → processing → completed/failed). | Do not call directly from routes — go through SdlcWorkflowService. |
| `backend/src/services/taskWorkerService.js` | Dispatches a task to the correct execution backend (mock / LangChain / Claude Code). | |
| `backend/src/services/gateBridge.js` | Bridges Claude Code `onGate` callbacks into HITL approval records. | |
| `backend/src/services/PenpotService.js` | Creates Penpot design files from UX screen specs and returns a shareable URL. | Requires `PENPOT_*` env vars. |
| `backend/src/services/workflowReport.js` | Generates the combined release report (PDF/JSON) for download. | |
| `backend/src/services/repoService.js` | Handles repo folder upload and workspace management for Claude Code runs. | |
| `backend/src/routes/sdlc.js` | HTTP route map for all SDLC endpoints. Thin — delegates everything to SdlcController. | Do not add business logic here. |
| `backend/src/controllers/SdlcController.js` | Express controller — validates HTTP input, calls SdlcWorkflowService, serialises response. | |
| `backend/src/models/Task.js` | Prisma wrapper. **`_map()` parses `agentOutput`/`result` from JSON string.** Direct `db.task.findFirst()` bypasses this and returns raw strings. | Always use `Task.findLatestByProject()` / `Task.findById()`, never raw Prisma for agentOutput. |
| `backend/src/models/AgentArtifact.js` | Stores typed artifacts (`feature_request`, `a2a_handoff`, `VALID`/`INVALID` status). | `hasInvalid(taskId)` checks DB status — may be stale after gate rule changes. |
| `backend/src/models/HitlDecision.js` | Stores all HITL decisions including `FINAL_GATE` release decisions. | |
| `backend/src/agents/claudeCodeRunner.js` | Invokes real Claude Code CLI for the DEV/QA execution path. | `USE_MOCK_CLAUDE_CODE=false` activates this path. |
| `backend/src/agents/prompts/dev.prompt.md` | System prompt for DEV agent. Mandates 5 steps: read UX → create one file per screen → element type table → backend routes → tests. | Must not be vague. DEV reads `patch_diff` / `changed_files` from this context. |
| `backend/src/agents/prompts/qa.prompt.md` | System prompt for QA agent. Mandates 4 steps: parse DEV diff hunk-by-hunk → map to AC → write NEW test cases → execute. | Must not instruct QA to simply re-run existing test suites. |
| `backend/prisma/schema.prisma` | Database schema. `agentOutput` is `String?` (raw JSON). | Never change without explicit approval. |

## Frontend core

| File | Role | Critical constraints |
|------|------|----------------------|
| `frontend/src/pages/AifaDemo/index.tsx` | Full board UI. `FlowColumn` is a **top-level function** (not nested) — it has no closure access to parent state. Pass all callbacks as explicit props. | Adding state from `AifaDemo` inside `FlowColumn` without a prop will cause a silent `ReferenceError`. |
| `frontend/src/services/api/sdlcApi.ts` | TypeScript API client. Defines `BoardFlow`, `BoardCard`, `CardAction` types. | Always update when the board API response shape changes. |
| `frontend/src/pages/AifaDemo/sdlc.css` | SDLC pipeline layout styles. Pipeline uses **Flexbox**, not Grid. | Do not switch to Grid — connector arrows and phase cards will wrap. |

## Python agents

| File | Role |
|------|------|
| `agents/main.py` | Entry point for LangChain-based agents (PO / UX / QA Python path). |
| `agents/src/agents/qa_agent.py` | QA agent implementation. Uses `astream_events` for SSE streaming — do not refactor to `with_structured_output` without handling JSON delta reconstruction. |
| `agents/src/agents/po_agent.py` / `ux_agent.py` | PO and UX agent implementations. |

## Config / environment

| File | Key variables |
|------|---------------|
| `backend/.env` | `USE_MOCK_CLAUDE_CODE`, `USE_MOCK_AGENTS`, `EXECUTION_PATH`, `MAX_PARALLEL_WORKFLOWS`, `NODE_ENV`, `PENPOT_*` |
| `backend/.env.example` | Canonical list of all env vars with descriptions. |

---

## What is strictly forbidden

- Import `agent_1`, `agent_2`, or `agent_3` — these have been deleted.
- Hardcode production credentials anywhere.
- Call raw `prisma.task.findFirst()` and access `.agentOutput` as an object — it is a JSON string.
- Break SSE streaming in `stream_*` functions — the UI pipe depends on `astream_events`.
- Rewrite `SdlcWorkflowService` without explicit approval.
- Change the backend API response shape without updating `sdlcApi.ts` in the same commit.
