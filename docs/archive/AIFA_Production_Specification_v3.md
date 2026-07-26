# AIFA Production Specification

**Version:** 3.0 (Final / build-ready)
**Status:** Approved for implementation
**Supersedes:** v2, AIFA vNext Master Specification (v1)
**Target:** Production system, single-user, local
**Owner:** AIFA Core Architecture

---

## 0. Changelog from v2

1. Gate model expanded from 3 → **6 gates** (one accept-gate after each of the 5 agents + one final master gate).
2. Every gate is **required** (no optional/soft gate).
3. Reject policy unified: any gate reject → **re-run that same agent once**; if it still fails → **FAIL the run**. No back-to-Architecture jumps.
4. Gate 6 (master) reject → **FAIL the run**.
5. Git model finalized: **1 repo, per-run subfolder `run_x/` with its own `git init`**, no merge back to the source repo — `run_x/` is the final deliverable.
6. Commit happens **only after Gate 6 approve**.
7. QA finalized as **static QA** (no app execution, no environment install). Smoke = compile/import validity.
8. **Audit trail** persisted after Gate 6 approve.
9. Concurrency: **4 parallel runs**, each an independent end-to-end flow.

---

## 1. Vision

AIFA (Autonomous Intelligent Factory Agent) is an artifact-driven software factory. The user provides a source repository and a natural-language requirement. Five agents — Architecture, PO, UX, DEV, QA — run in sequence, each followed by a required human accept-gate, ending with a final master gate where the user signs off on the whole run.

AIFA never releases, merges, or deploys autonomously. Every output is human-approved.

---

## 2. Core Principles

### P1 — PRD as Generated Contract
The user does **not** write a PRD. The user provides a raw natural-language requirement plus a repository. The **Architecture Agent generates the PRD** as the first artifact; it becomes the internal contract for all downstream agents.

### P2 — Artifact First
Every agent writes real artifact files into the run's subfolder. Document artifacts (md/spec/report) are written as the agent produces them. Source code changes are written into the run folder by DEV directly. Nothing is **committed** to git until Gate 6 approve.

### P3 — Human In The Loop (six gates)
AI has no authority to accept its own output. Each agent's output passes a required human gate, and the whole run passes a final master gate. See Section 5.

### P4 — Repository Aware
AIFA must understand the existing codebase before proposing changes. No greenfield assumption.

### P5 — Git Native, Per-Run Isolation
Each run is an independent copy of the source repository in its own subfolder with its own `git init`. The run folder is the final product; AIFA does not push or merge into the user's original repo. Commit occurs once, after Gate 6 approve.

### P6 — Evidence Driven
No agent emits a metric or conclusion it cannot measure. No fabricated coverage percentages, no invented stakeholders. Unmeasurable values are not reported.

### P7 — Smallest Safe Change
Agents prefer the minimal change that satisfies the task. No rewrites, no speculative abstraction.

---

## 3. Model Layer (Execution Substrate)

### 3.1 One Session Per Run, Role-Switching Prompt
The system runs on the **Claude Code SDK**. Each run uses **one long-running session** whose **system prompt is swapped per phase** so Claude acts as Architecture, then PO, then UX, then DEV, then QA in turn. Not subagents, not one-session-per-agent.

Constraint that justifies this: `AskUserQuestion` is **not available inside subagents** spawned via the Agent tool. AIFA relies on clarifying questions from every agent, so a single role-switching session is the correct architecture.

### 3.2 Context Reset Between Phases (Artifact-Mediated Handoff)
Between phases the session context is reset. The next agent does **not** inherit the previous agent's conversation; it reads the **artifact files** the previous agent wrote. Agents communicate through artifacts on disk, never through shared in-context reasoning.

This preserves QA's black-box property: QA reads `acceptance_criteria.md` + the code + DEV's reports, not DEV's chain of thought.

### 3.3 Session Identity and Resume
- Capture `session_id` at the start of each phase.
- Persist `session_id` + workflow state in the DB.
- On gate pause or process restart, resume the exact session via `resume=session_id`.

### 3.4 Concurrency
Up to **4 runs in parallel**, each a fully independent end-to-end flow with its own session, its own `run_x/` folder, and its own git history. Because each run is a separate repo copy, there are no shared-git lock races between runs.

---

## 4. Agents

Pipeline (each agent followed by a required gate; see Section 5):

```
Raw Requirement + Repository
        │
        ▼
  Architecture Agent  → Gate 1
        ▼
     PO Agent          → Gate 2
        ▼
     UX Agent          → Gate 3
        ▼
     DEV Agent         → Gate 4
        ▼
     QA Agent          → Gate 5
        ▼
   Gate 6 (Master sign-off)
        ▼
   APPROVE → commit run_x/ + write audit trail
```

### 4.1 Architecture Agent
**Mission:** Convert a raw requirement into an executable PRD grounded in the existing codebase.
**Inputs:** user requirement, repository, optional existing constraints.
**Responsibilities:** requirement analysis (business goal, functional/non-functional requirements, assumptions, open questions); repository discovery (architecture, stack, DB, APIs, dependencies); generate the PRD + supporting analysis. May call `AskUserQuestion` to confirm interpretation.
**Outputs (`run_x/.aifa/architecture/`):** `architecture_prd.md` (primary), `repository_analysis.md`, `technical_constraints.md`, `technical_risks.md`, `migration_plan.md` (only if a migration is implied).

### 4.2 PO Agent
**Mission:** Turn the PRD into an executable backlog with full traceability.
**Inputs:** PRD, architecture outputs.
**Outputs (`run_x/.aifa/po/`) — 5 measurable artifacts:** `epics.md`, `stories.md`, `tasks.md`, `acceptance_criteria.md` (Given/When/Then — the contract QA validates against), `traceability_matrix.md` (PRD → Epic → Story → Task → AC).

### 4.3 UX Agent
**Mission:** Design the UX and a simple visual preview before DEV begins.
**Inputs:** PRD, epics, stories.
**Outputs (`run_x/.aifa/ux/`):** `ux_spec.md`, `ui_spec.md`, `wireframe.md`, `ui_mockup.html`, `screenshots/`.

### 4.4 DEV Agent
**Mission:** Implement approved tasks, writing source changes directly into `run_x/`.
**Inputs (required):** architecture artifacts, PO tasks, UX specs, the run's repository copy.
**Inputs (optional):** coding standards, API contracts, DB schemas, prior gate decisions.
**Responsibilities:** task analysis, implementation planning, code implementation (written into `run_x/`, not yet committed), self-validation (compile check, lint, syntax-level test check), documentation update. **Primary user of `AskUserQuestion`** for unclear API/DB/migration/conflict decisions.
**Outputs (`run_x/.aifa/dev/`):** `implementation_plan.md`, `changed_files.md`, `migration_scripts/`, `build_report.md` (static checks), `implementation_report.md` (completed/incomplete tasks, known issues, tech debt, notes for QA). Source changes live in the actual code files of `run_x/`.

### 4.5 QA Agent (Static)
**Mission:** Quality validation by static analysis. No release authority. No app execution.
**Inputs:** `acceptance_criteria.md`, the code DEV changed in `run_x/`, `changed_files.md`, `implementation_report.md`, architecture outputs.

**Validation order (fail-fast; each check may short-circuit):**
1. **Smoke (static):** code compiles, imports resolve, test files are syntactically runnable. Fail → STOP.
2. **Functional (static):** each acceptance criterion is traceably addressed in the code. Fail → STOP.
3. **Contract (static):** implementation matches API spec (fields, schema, status codes, error shape) by code inspection. Fail → STOP.
4. **Regression (static):** changed files reviewed for breakage of existing logic. Severe → FAIL; minor → defect + downgrade to PASS_WITH_RISK.

**Test generation runs before execution-analysis** so requirement coverage is measured fully. Coverage = (AC with ≥1 mapped test case) / (total AC). No fabricated percentages.

**Severity:** Blocker, Critical, Major, Minor, Trivial.
**Recommendation mapping (deterministic):** ≥1 Blocker/Critical → FAIL; only Major/Minor → PASS_WITH_RISK; only Trivial/none → PASS.

**Important limitation (must be stated in output):** static QA does **not** verify runtime behavior (crashes, DB connectivity, race conditions). `risk_report.md` must explicitly flag "runtime not verified."

**Defect required fields:** title, severity, priority, steps/location, expected, actual, evidence. Evidence for static QA = code excerpt / file:line reference. A defect without evidence is invalid.

**Outputs (`run_x/.aifa/qa/`):** `test_cases.md`, `defects.md`, `requirement_coverage.md`, `risk_report.md`, `qa_report.md` + recommendation object:
```json
{
  "recommendation": "PASS | PASS_WITH_RISK | FAIL",
  "stoppedAtCheck": "smoke | functional | contract | regression | null",
  "failureReason": "string | null",
  "requirementCoverage": "8/10",
  "runtimeVerified": false,
  "defects": [],
  "risks": [],
  "evidence": []
}
```

---

## 5. Gate Model (Six Required Gates)

Every gate is required. Each gate pauses the pipeline and waits for a human decision.

| Gate | After | Accepts | Reject behavior |
|------|-------|---------|-----------------|
| **Gate 1** | Architecture | PRD + architecture artifacts | re-run Architecture once |
| **Gate 2** | PO | backlog (epics/stories/tasks/AC/traceability) | re-run PO once |
| **Gate 3** | UX | UX spec + preview | re-run UX once |
| **Gate 4** | DEV | source code changes | re-run DEV once |
| **Gate 5** | QA | QA report + recommendation | re-run QA once |
| **Gate 6** | — (master) | the entire run (go/no-go sign-off) | **FAIL the run** |

### 5.1 Decision values
`APPROVE`, `REJECT`.
- **APPROVE** (Gate 1–5) → proceed to next agent.
- **REJECT** (Gate 1–5) → re-run the same agent **exactly once** with the human's notes injected. If the re-run is rejected again → **FAIL the run**.
- **Gate 6 APPROVE** → commit `run_x/` (single commit) + write audit trail.
- **Gate 6 REJECT** → **FAIL the run** (gates 1–5 already validated each part; the master gate is the final go/no-go).

### 5.2 Retry rule
Each gate allows **one** reject-and-rerun of its own agent. There is no jump back to a previous agent. There is no multi-step loop. One retry, then FAIL.

---

## 6. HITL Mechanism (Concrete Implementation)

Three interaction types, three SDK mechanisms, one unified queue.

### 6.1 Single callback entry point
```python
async def can_use_tool(tool_name, input_data, context):
    if tool_name == "AskUserQuestion":
        return await handle_clarification(input_data)       # 6.3
    if tool_name in {"Write", "Edit", "Bash", "MultiEdit"}:
        return await handle_permission(tool_name, input_data)  # 6.2
    return allow()   # Read, Grep, Glob pass through
```

### 6.2 Permission (dangerous actions)
Intercepts attempts to run git commit / push or other irreversible actions before Gate 6. Document and code writes inside `run_x/` are allowed (the run folder is a sandbox); committing is blocked until Gate 6 approve.

### 6.3 Clarification (any agent, mid-phase)
**Every agent** may call `AskUserQuestion` (1–4 questions, 2–4 options each) when it lacks information — matching Claude Code local behavior. Claude generates the questions/options; the system presents them and returns the human's selection. Possible because the architecture is one role-switching session (not subagents).

### 6.4 Phase Gate (between phases)
Gates 1–6 use **interrupt + defer + session resume**, not `AskUserQuestion`, because the decision is APPROVE/REJECT on a whole artifact and the wait may be long.

Flow:
```
Phase completes → write artifacts → emit interrupt
  → return SDK "defer" (process may exit)
  → persist {session_id, gate_no, artifact_path, status=PENDING} to DB
  → UI shows artifacts + APPROVE / REJECT
  → human decides (may be hours later; no timeout — waits indefinitely)
  → resume session via resume=session_id, inject decision
```

### 6.5 Unified Review Center
All three interaction types (permission, clarification, gate) surface in **one human queue** — the Review Center (replacing a chat panel). Each item carries: type, payload, action buttons. The human sees a single inbox of "things needing me."

---

## 7. Storage Model

### 7.1 Database (control-flow source of truth)
- Run (id, status, folder path)
- Task (id, run_id, state)
- Workflow state-machine position
- Gate records: `PendingGate`, `HitlDecision`, `GateDecision` (gate no, type, decision, timestamps)
- `session_id` per phase (for resume)
- Artifact **paths** (not content)
- **Audit trail** (Section 8)

### 7.2 Filesystem (artifact + code content)
```
runs/
└── run_x/                 # independent git repo (git init)
    ├── <user's code>      # DEV edits here directly
    └── .aifa/
        ├── architecture/
        ├── po/
        ├── ux/
        ├── dev/
        └── qa/
```

### 7.3 Recover After Restart
On startup the orchestrator finds runs in paused/awaiting state, reads `session_id` + gate records from the DB, and resumes the exact session. Heartbeat/lock/timeout/idempotency patterns apply per adopted Multica practices.

---

## 8. Audit Trail

Written to the DB after **Gate 6 approve**. Records the full decision history of the run for traceability:
- Run id, requirement, repository reference
- For each gate (1–6): decision, timestamp, human notes, whether a re-run occurred
- Each agent's artifact paths and final status
- QA recommendation object
- Final commit hash of `run_x/`

The audit trail is the permanent record that the run was human-approved end to end.

---

## 9. Workflow State Machine

```
queued
  → running
  → awaiting_input        (clarification: AskUserQuestion pending — any agent)
  → awaiting_gate         (one of the 6 gates pending)
  → running               (resumed after decision; may be a single agent re-run)
  → completed | failed
```

- `awaiting_input` = in-phase clarification.
- `awaiting_gate` = between-phase approval (gates 1–6).
- Both persist enough to exit the process and resume later.
- Reject at a gate → re-run that agent once → back to its gate. Second reject → `failed`.
- Gate 6 reject → `failed`.

---

## 10. Success Criteria (System Level)

1. A raw requirement + repository yields a generated PRD accepted at Gate 1.
2. The pipeline pauses and resumes correctly at all six gates, surviving process restart.
3. No code or artifact is committed to git before Gate 6 approve.
4. QA produces deterministic recommendations with measurable coverage and evidence-backed defects, and explicitly flags runtime as unverified.
5. All three HITL interaction types surface in the unified Review Center.
6. Each gate enforces exactly one re-run before FAIL.
7. Four runs execute in parallel without cross-contamination.
8. Every approved run has a complete audit trail in the DB and a single commit in `run_x/`.

---

## 11. Non-Goals

AIFA does not, autonomously: accept its own output, commit before Gate 6, merge or push to the user's original repository, deploy, write features without an approved task, verify runtime behavior (static QA only in this version), or replace human decisions.

**AIFA produces and validates. The human accepts at every gate. The master gate is the final sign-off.**

---

## 12. Deferred to Later Versions (explicit TODO)

1. **Dynamic QA** (run the app in a sandbox/E2B/Docker to verify runtime) — out of scope for v3.
2. **Merge back to source repo / PR creation** — v3 leaves the deliverable in `run_x/`.
3. **Multi-user / auth** — v3 is single-user local.
4. **Patch conflict policy across runs** — not needed while runs are isolated copies that don't merge back.
