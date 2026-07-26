# 00 — Project Baseline

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** This document is the canonical entry point for the
> frozen AIFA implementation baseline. It supersedes prior stabilization
> reports for the purpose of forward development.

---

## 1. Project Scope

AIFA (Autonomous Software Factory) is a single-tenant, SSE-driven
multi-agent pipeline that turns a feature request into a released
software artifact. The pipeline runs five sequential agent roles
(**Architecture → PO → UX → DEV → QA → Release**) on a per-project
session, gated by Human-in-the-Loop (HITL) decisions.

The system is delivered as two coordinated services:

- **Backend (Node.js / Express / Prisma).** Owns the canonical state
  machine, the wire envelope, the gate lifecycle, the document store,
  and the real Claude Code SDK execution path.
- **Frontend (React / Vite / Zustand).** Consumes the SSE stream,
  projects the canonical state through frozen selectors, renders the
  dashboard, the gate panels, the document UI, and the release
  dialog.

Auth, quota, admin, and membership are deliberately bypassed
(`CLAUDE.md` §4). The backend runs as a single dummy local user.

---

## 2. Canonical Architecture

The frozen canonical architecture is the OBS-01 6-layer runtime model
extended by the OBS-2..OBS-9 frozen contracts:

| Layer | Owner | Frozen by | Reference |
| ----- | ----- | --------- | --------- |
| **L1 — Backend Runtime Machine** | `taskLifecycleService` | OBS-1 | `01_FINAL_ARCHITECTURE.md` §4.1 |
| **L2 — Wire Envelope (`EventEnvelope`)** | `eventPublisher` | OBS-1 | `01_FINAL_ARCHITECTURE.md` §4.2 |
| **L3 — SSE Transport** | `eventBus` + `SdlcController.streamPipelineStatus` | OBS-1 | `01_FINAL_ARCHITECTURE.md` §4.3 |
| **L4 — FE Reducer Family (`eventMappers`)** | `frontend/src/store/eventMappers.ts` | OBS-1 | `01_FINAL_ARCHITECTURE.md` §4.4 |
| **L5 — FE Projection (`runtimeSelectors`)** | `frontend/src/store/runtimeSelectors.ts` | OBS-1 | `01_FINAL_ARCHITECTURE.md` §4.5 |
| **L6 — UI Consumers** | Dashboard, Agent Task, SessionRail, Inspector | OBS-6 | `obs6/04_UI_VERIFICATION.md` |
| **L7 — Backend Workflow Engine** | `SdlcWorkflowService` + `workflowOrchestrator` + `workflowHelpers` + `workflowQueries` | OBS-2 | `OBS2/04_WORKFLOW_VERIFICATION.md` |
| **L8 — Backend Agent Execution** | `agentDispatcher` + `claudeCodeRunner` + `archAskEnforcer` + `qaGate` | OBS-3 | `OBS3/04_AGENT_VERIFICATION.md` |
| **L9 — Backend Observability** | `requestContext` + `logger` + `Sentry` | OBS-4 | `OBS4/04_OBSERVABILITY_VERIFICATION.md` |
| **L10 — HITL Surface** | `gateBridge` + `SdlcWorkflowService` HITL paths + `releaseManager` | OBS-5 | `obs5-HITL/04_HITL_VERIFICATION.md` |
| **L11 — Document CRUD** | `DocumentService` + `documentsApi` + FE kitchen-sink | OBS-7 | `obs7/04_DOCUMENT_VERIFICATION.md` |
| **L12 — Demo / Mock Surface** | `_demoFlags.js` + smoke scripts (no runtime HTTP routes) | OBS-8 | `obs8/04_DEMO_VERIFICATION.md` |
| **L13 — Integration / Env** | `.env.example` + `docker-compose.yml` + real Claude Code SDK path | OBS-9 | `obs9/04_INTEGRATION_VERIFICATION.md` |

There is **exactly ONE producer per observable state** and **exactly
ONE consumer chain per surface**. Wire envelopes are domain-only.
Presentation lives in the FE canonical projection.

---

## 3. Frozen Boundaries

The frozen boundaries are documented across the per-contract files in
this directory and in `docs/OBS1/PHASE5.5-freeze/04_DO_NOT_BREAK.md`.
The high-level statement:

1. **Runtime contract** — frozen by OBS-1 PHASE 5.5
   (`04_DO_NOT_BREAK.md` §R-01..R-30). No file in the runtime stack
   may be modified without a new OBS phase.
2. **Workflow contract** — frozen by OBS-2 (`OBS2/04_WORKFLOW_VERIFICATION.md` §5).
   The defensive fallback pattern
   (`task.executionStatus ?? task.status`) is the bridge between the
   legacy and canonical writers.
3. **Agent contract** — frozen by OBS-3 (`OBS3/04_AGENT_VERIFICATION.md` §5).
   `agentDispatcher`, `taskWorkerService`, and the runner integration
   are the canonical execution engine.
4. **Observability contract** — frozen by OBS-4 (`OBS4/04_OBSERVABILITY_VERIFICATION.md` §5).
   `pino` + `AsyncLocalStorage` + `requestContext` is the correlation
   backbone; `Sentry` is opt-in via `SENTRY_DSN`.
5. **HITL contract** — frozen by OBS-5 (`obs5-HITL/04_HITL_VERIFICATION.md` §3).
   The four `gate.kind` values (`tool | question | output_review | release`)
   are the canonical dispatch keys; `toGateType(role, kind)` derives the
   presentation type.
6. **UI contract** — frozen by OBS-6 (`obs6/04_UI_VERIFICATION.md` §3).
   8 visual maps in `runtimeSelectors.ts` are the only allowed colour
   sources; `<ActionSpinner>` and `<ApproveRejectButtons>` are the
   only allowed shared components.
7. **Document contract** — frozen by OBS-7 (`obs7/04_DOCUMENT_VERIFICATION.md` §3).
   9 HTTP routes + `DocumentItem` shape + `Document` Prisma model
   are the canonical surface.
8. **Demo / mock surface** — frozen by OBS-8 (`obs8/04_DEMO_VERIFICATION.md` §7).
   The 4 `/demo/*` routes are unmounted; `demoBoardService.js` is
   deleted; `MOCK_*` constants are deleted from production code.
9. **Integration / env** — frozen by OBS-9 (`obs9/04_INTEGRATION_VERIFICATION.md` §7).
   `EXECUTION_PATH=claude-code` is the canonical execution path; the
   real Claude Code SDK is the verifiable default.

---

## 4. Current Implementation Status

| Surface | Status | Evidence |
| ------- | :----: | -------- |
| Backend runtime machine | ✓ FROZEN | `OBS1/PHASE5.5-freeze/01_FINAL_ARCHITECTURE.md` |
| Wire envelope (13-type union) | ✓ FROZEN | `OBS1/PHASE5.5-freeze/01_FINAL_ARCHITECTURE.md` §3 |
| SSE transport | ✓ FROZEN | `OBS1/PHASE5.5-freeze/01_FINAL_ARCHITECTURE.md` §4.3 |
| FE reducer family | ✓ FROZEN | `OBS1/PHASE5.5-freeze/01_FINAL_ARCHITECTURE.md` §4.4 |
| FE canonical projection | ✓ FROZEN | `OBS1/PHASE5.5-freeze/01_FINAL_ARCHITECTURE.md` §4.5 |
| HITL 4-gate-kind surface | ✓ FROZEN | `obs5-HITL/04_HITL_VERIFICATION.md` §3 |
| UI 8 visual maps + 2 shared components | ✓ FROZEN | `obs6/04_UI_VERIFICATION.md` §3 |
| Document 9-route CRUD | ✓ FROZEN | `obs7/04_DOCUMENT_VERIFICATION.md` §3 |
| Demo / mock surface | ✓ FROZEN (deleted) | `obs8/04_DEMO_VERIFICATION.md` §7 |
| Real Claude Code SDK execution path | ✓ FROZEN (default) | `obs9/04_INTEGRATION_VERIFICATION.md` §7 |
| Observability correlation chain | ✓ FROZEN | `OBS4/04_OBSERVABILITY_VERIFICATION.md` §5 |

---

## 5. Supported Runtime

| Item | Value |
| ---- | ----- |
| Backend runtime | Node.js (Express + Prisma + Socket.IO deleted) |
| Frontend runtime | React 18 + Vite + Zustand |
| Database | SQLite (Prisma-managed, file at `backend/prisma/dev.db`) |
| Live channel | Server-Sent Events on `GET /api/v1/sdlc/stream/:sessionId` |
| Agent executor | Real Claude Code SDK (`EXECUTION_PATH=claude-code`) |
| Smoke path | `USE_MOCK_CLAUDE_CODE=true` (smoke scripts only) |
| Mock scaffold | `USE_MOCK_AGENTS=true` (smoke scripts only) |

The `agents` (Python langchain) container, the `socket.io-client`
frontend package, the `socketService.js` middleware, and the
`codexRunner` integration are no longer wired into the canonical
runtime. They remain in the source tree only where required by
historical imports; no canonical code path reaches them.

---

## 6. Supported Execution Path

A feature request flows through the canonical execution path:

```
HTTP POST /sessions/:sessionId/start
   ↓
SdlcWorkflowService.startSession
   ↓
taskLifecycle.transition('queued') → 'dispatched' → 'running'
   ↓
agentDispatcher.runAgent (EXECUTION_PATH=claude-code)
   ↓
claudeCodeRunner.runAgent (real Claude Code SDK)
   ↓
taskLifecycle.transition('completed' | 'failed' | 'timeout')
   ↓
[optional] gateBridge.requestGate({kind: 'output_review' | 'question' | 'tool'})
   ↓
[optional] HITL decision via POST /approvals/:id | /output-review/:id | /sessions/:id/release-decision
   ↓
[next agent in chain OR releaseManager.submitReleaseDecision]
   ↓
releaseManager.submitReleaseDecision (APPROVE branch)
   ↓
pipeline_completed envelope
   ↓
SSE → FE session monitor → operator sees RELEASED
```

The 4 gate kinds dispatch to 4 distinct HTTP endpoints
(`obs5-HITL/04_HITL_VERIFICATION.md` §3). The `release` gate uses the
sentinel taskId `release-<sessionId>` (`obs5-HITL/04_HITL_VERIFICATION.md`
§2.2 Patch H-B). The `pipeline_completed` envelope is owned by exactly
one producer (`releaseManager.submitReleaseDecision`'s APPROVE branch).

---

## 7. Release Readiness

| Gate | Status |
| ---- | :----: |
| All 9 OBS phases closed | ✓ |
| Runtime contract frozen | ✓ |
| Workflow contract frozen | ✓ |
| Agent contract frozen | ✓ |
| HITL contract frozen | ✓ |
| UI contract frozen | ✓ |
| Document contract frozen | ✓ |
| Integration contract frozen | ✓ |
| BE test suite | 333/336 pass (3 pre-existing failures unrelated to OBS) |
| FE test suite | 142/142 pass |
| TypeScript | `npx tsc --noEmit` clean |
| Prisma schema | in sync (`npx prisma db push` succeeds) |
| Smoke scripts | `realClaudeCodeSmoke.js` boots; claude-code smoke flags route via `_demoFlags.js` |
| Working tree | clean on `backup/obs-work-in-progress` @ `477acf2` |

See `11_RELEASE_SIGNOFF.md` for the formal Go / No-Go decision.

---

## 8. Reference Documents

- `docs/OBS1/PHASE5.5-freeze/01_FINAL_ARCHITECTURE.md` — runtime architecture
- `docs/OBS1/PHASE5.5-freeze/04_DO_NOT_BREAK.md` — runtime invariants
- `docs/OBS1/PHASE5.5-freeze/05_KNOWN_LIMITATIONS.md` — runtime limitations
- `docs/OBS2/04_WORKFLOW_VERIFICATION.md` — workflow contract
- `docs/OBS3/04_AGENT_VERIFICATION.md` — agent contract
- `docs/OBS4/04_OBSERVABILITY_VERIFICATION.md` — observability contract
- `docs/obs5-HITL/04_HITL_VERIFICATION.md` — HITL contract
- `docs/obs6/04_UI_VERIFICATION.md` — UI contract
- `docs/obs7/04_DOCUMENT_VERIFICATION.md` — document contract
- `docs/obs8/04_DEMO_VERIFICATION.md` — demo / mock contract
- `docs/obs9/04_INTEGRATION_VERIFICATION.md` — integration / env contract
- `docs/MASTER_DEPENDENCY/02_OBS_DEPENDENCY_GRAPH.md` — historical workstream map
- `CLAUDE.md` — project rules (auth bypass, SSE preservation, hybrid router, legacy agents forbidden)
- `.claude/CLAUDE.md` — AIFA Specification Guardian
- `docs/PROJECT_BASELINE/01_RUNTIME_CONTRACT.md` — runtime contract reference
- `docs/PROJECT_BASELINE/02_WORKFLOW_CONTRACT.md` — workflow contract reference
- `docs/PROJECT_BASELINE/03_AGENT_CONTRACT.md` — agent contract reference
- `docs/PROJECT_BASELINE/04_HITL_CONTRACT.md` — HITL contract reference
- `docs/PROJECT_BASELINE/05_DOCUMENT_CONTRACT.md` — document contract reference
- `docs/PROJECT_BASELINE/06_OBSERVABILITY_CONTRACT.md` — observability contract reference
- `docs/PROJECT_BASELINE/07_INTEGRATION_CONTRACT.md` — integration / UI / demo contract reference
- `docs/PROJECT_BASELINE/08_DEPENDENCY_BASELINE.md` — current dependency baseline
- `docs/PROJECT_BASELINE/09_REPAIR_STATUS.md` — repair status roll-up
- `docs/PROJECT_BASELINE/10_DEVELOPMENT_RULES.md` — frozen development rules
- `docs/PROJECT_BASELINE/11_RELEASE_SIGNOFF.md` — release sign-off

End of Project Baseline.
