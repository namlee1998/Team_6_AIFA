# 08 — Dependency Baseline

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document — derived from the
> current repository HEAD (`backup/obs-work-in-progress` @ `477acf2`).
> **Method:** No future planning. Current implementation only.

---

## 1. OBS Dependency Order

The OBS phases were executed in the following dependency-respecting
order. The order is computed from the dependency graph, not assigned
up-front. Each phase's prerequisite is the frozen contract of the
previous phase(s).

| # | Phase | Slug | Frozen by | Required prior contracts |
| - | ----- | ---- | --------- | ------------------------ |
| 1 | OBS-1 | `obs1-runtime` | PHASE 5.5 (2026-07-16) | — (frozen baseline) |
| 2 | OBS-2 | `obs2-workflow` | OBS-2 (2026-07-17) | OBS-1 frozen |
| 3 | OBS-3 | `obs3-agent` | OBS-3 (2026-07-17) | OBS-1, OBS-2 frozen |
| 4 | OBS-4 | `obs4-observability` | OBS-4 (2026-07-17) | OBS-1, OBS-2, OBS-3 frozen |
| 5 | OBS-5 | `obs5-hitl` | OBS-5 (2026-07-17) | OBS-1, OBS-2, OBS-3, OBS-4 frozen |
| 6 | OBS-6 | `obs6-ui` | OBS-6 (2026-07-17) | OBS-1, OBS-5 frozen |
| 7 | OBS-7 | `obs7-documents` | OBS-7 (2026-07-17) | OBS-1, OBS-2, OBS-3, OBS-5, OBS-6 frozen |
| 8 | OBS-8 | `obs8-demo` | OBS-8 (2026-07-17) | OBS-1, OBS-7 frozen |
| 9 | OBS-9 | `obs9-integration` | OBS-9 (2026-07-18) | OBS-1..OBS-8 frozen |

The dependency chain is:

```
OBS-1 (runtime)  ──→  OBS-2 (workflow)  ──→  OBS-3 (agent)
       │                  │                    │
       │                  │                    ↓
       │                  │            OBS-4 (observability)
       │                  │                    │
       └──────────────────┴────────────────────┘
                                │
                                ↓
                       OBS-5 (HITL)
                                │
                                ↓
                        OBS-6 (UI)
                                │
                                ↓
                      OBS-7 (Documents)
                                │
                                ↓
                       OBS-8 (Demo)
                                │
                                ↓
                    OBS-9 (Integration)
```

---

## 2. Real Producer → Real Consumer

### 2.1 Wire Envelope Path

```
backend/src/services/taskLifecycleService.js
   (publishLifecycle)
     ↓ publishes canonical EventEnvelope
backend/src/services/eventPublisher.js
   (publishEvent — single facade)
     ↓ publishes on bus
backend/src/services/eventBus.js
   (eventBus.publish)
     ↓ SSE write
backend/src/controllers/SdlcController.js
   (streamPipelineStatus — bytes-to-wire)
     ↓ SSE JSON frames over HTTP
frontend/src/services/sseClient.ts
   (subscribe + sseLog.warn)
     ↓ dispatch
frontend/src/store/eventMappers.ts
   (applyEnvelope — 13-type mapper registry)
     ↓ SessionState update
frontend/src/store/useWorkflowStore.ts
   (Zustand store)
     ↓ projection
frontend/src/store/runtimeSelectors.ts
   (selectRuntimeExecution, selectAgentPhaseStatus, getRuntimeVisual)
     ↓ PhaseStatus + RuntimeVisualStyle
frontend/src/pages/SdlcDashboard/**
   (UI consumer — no inline derivation)
```

### 2.2 Gate Lifecycle Path

```
backend/src/services/SdlcWorkflowService.js
   (gateBridge.requestGate + resolveGate)
     ↓ gate_pending / gate_resolved envelope
backend/src/services/eventPublisher.js
     ↓ SSE
frontend/src/store/eventMappers.ts
   (mapGatePending + mapGateResolved)
     ↓ agentStates[i].status update
     ↓ pendingReleaseGateId cleared (U-O)
backend/src/services/gateBridge.js
   (PendingGate.create + PendingGate.resolve)
     ↓ durable audit
backend/src/models/HitlDecision.js
   (HitlDecision.create)
     ↓ audit row
backend/src/services/releaseManager.js
   (submitReleaseDecision — APPROVE branch owns pipeline_completed)
```

### 2.3 Agent Execution Path

```
backend/src/services/SdlcWorkflowService.js
   (_runAgent → agentDispatcher.runAgent)
     ↓
backend/src/services/agentDispatcher.js
   (runAgent → EXECUTION_PATH switch)
     ↓
backend/src/agents/claudeCodeRunner.js
   (real Claude Code SDK)
     ↓ lifecycle transition
backend/src/services/taskLifecycleService.js
   (transition + publishLifecycle)
```

### 2.4 Document CRUD Path

```
backend/src/controllers/DocumentController.js
   (9 HTTP routes)
     ↓
backend/src/services/DocumentService.js
   (moveDocument single-write, uploadDocument DB-first,
    renameDocument 409, getContent 415 for binary, EXDEV fallback)
     ↓
backend/src/models/Document.js
   (Prisma row — @@index([projectId]))

frontend/src/services/api/documentsApi.ts
   (8 HTTP wrappers; types from types.ts)
     ↓
frontend/src/store/useAppStore.ts
   (documents + docMgmtPreviewCache — cleared on setCurrentProject)
```

### 2.5 Observability Path

```
backend/src/middleware/requestContext.js
   (x-request-id → AsyncLocalStorage { requestId })
     ↓
backend/src/services/gateBridge.js
   (setContext({ approvalId, taskId, role, kind, decision }))
     ↓
backend/src/config/logger.js
   (pino logger with withCtx merge)
     ↓ log file
Operator correlates: requestId → approvalId → taskId → role → kind → decision
```

### 2.6 UI / Demo / Integration Path

```
.env.example + docker-compose.yml
   (EXECUTION_PATH=claude-code; no AGENTS_BASE_URL; no codex mount)
     ↓
backend/src/services/agentDispatcher.js:305
   (EXECUTION_PATH switch → claudeCodeRunner)
     ↓
backend/src/services/sdlcConstants.js
   (AGENT_POLICY carries 5 roles; no intent-agent)

frontend/src/store/runtimeSelectors.ts
   (8 visual maps frozen; RUNTIME_VISUAL Object.freeze)
     ↓
frontend/src/components/ui/ActionSpinner.tsx + ApproveRejectButtons.tsx
   (shared UI components)
     ↓
frontend/src/pages/SdlcDashboard/**
   (UI consumers)
```

---

## 3. Cross-Module Dependency

### 3.1 Backend Service Dependencies

| Service | Imported by (current source) |
| ------- | ----------------------------- |
| `taskLifecycleService` | `SdlcWorkflowService`, `agentDispatcher`, `releaseManager`, `taskWorkerService`, `gateBridge` |
| `eventPublisher` | `taskLifecycleService`, `gateBridge`, `releaseManager`, `SdlcController` |
| `eventBus` | `SdlcController`, `gateBridge` (transitively via `eventPublisher`) |
| `gateBridge` | `SdlcWorkflowService`, `releaseManager` |
| `agentDispatcher` | `SdlcWorkflowService` |
| `releaseManager` | `SdlcWorkflowService` |
| `artifactManager` | `SdlcWorkflowService` |
| `repoService` | `SdlcWorkflowService`, `releaseManager` |
| `sdlcConstants` | `SdlcWorkflowService`, `agentDispatcher`, `gateBridge`, `releaseManager`, `SdlcController`, `taskLifecycleService`, `workflowHelpers`, `workflowOrchestrator`, `workflowQueries` |
| `agentContract` | `SdlcWorkflowService`, `agentDispatcher` |
| `qaGate` | `SdlcWorkflowService`, `releaseManager` |
| `archAskEnforcer` | `agentDispatcher` |
| `claudeCodeRunner` | `agentDispatcher` |
| `codexRunner` | (dormant; no canonical caller — `sdlcConstants.AGENT_POLICY` no longer carries `intent-agent`) |
| `sequenceService` | `eventPublisher` |
| `requestContext` | `errorHandler`, `gateBridge`, `agentDispatcher`, `logger` |

### 3.2 Frontend Store Dependencies

| Store | Consumed by (current source) |
| ----- | ---------------------------- |
| `useWorkflowStore` | `runtimeSelectors`, `eventMappers`, `SdlcDashboard/**`, `AppShell`, `InspectorPanel`, `ClarificationPanel`, `ToolGatePanel`, `AgentOutputPanel` |
| `useUiStore` | `AppShell`, `AppSidebar`, `SdlcDashboard/**` |
| `useAppStore` | `AppShell`, `AppSidebar`, `DocumentViewer/**`, `FileTree/**` |
| `runtimeSelectors` | `useWorkflowStore`, `SdlcDashboard/**`, `InspectorPanel` |
| `workflowSelectors` | `useWorkflowStore`, `SdlcDashboard/**` |
| `eventMappers` | `useWorkflowStore` |

### 3.3 Frontend API Dependencies

| Module | Imported by (current source) |
| ------ | ---------------------------- |
| `documentsApi` | `useApiActions`, `DocumentViewer/**`, `FileTree/**`, `FeatureRequestChatbox` |
| `projectsApi` | `useApiActions`, `AppShell`, `AppSidebar` |
| `foldersApi` | `useApiActions`, `DocumentViewer/**` |
| `treeApi` | `useApiActions`, `FileTree/**` |
| `sdlcApi` (barrel) | `useWorkflowStore` (named imports — D-J), `SdlcDashboard/**` |
| `sdlcLegacy` | (deleted — OBS-9 I-E) |

---

## 4. Forbidden Dependency

The following dependencies MUST NOT be introduced:

1. **Direct reads of `Task.status` (legacy)** for runtime visualization.
   Always use `Task.executionStatus` (with `?? task.status` defensive
   fallback only where the OBS-2 / OBS-3 patches apply).
2. **Bypassing `taskLifecycle.transition`** to write `Task.executionStatus`.
3. **Bypassing `publishEvent`** to publish `EventEnvelope` (the documented
   exception is `releaseManager.submitReleaseDecision`'s belt-and-suspenders
   fallback for post-restart gate recovery).
4. **Multiple producers for `pipeline_completed`** — owned exclusively by
   `releaseManager.submitReleaseDecision`'s APPROVE branch.
5. **Multiple producers for `gate_pending`** — owned exclusively by
   `gateBridge.requestGate`.
6. **Multiple producers for `gate_resolved`** — owned exclusively by
   `gateBridge.resolveGate` (with the documented fallback).
7. **Hardcoded colour strings in JSX** outside the Tailwind theme tokens
   + `RUNTIME_VISUAL`.
8. **Hardcoded `animate-spin` / `animate-pulse`** on runtime state
   elements outside `RUNTIME_VISUAL[*].animation`.
9. **Cross-store reads** that bypass the canonical projection
   (`useWorkflowStore → runtimeSelectors`).
10. **Re-importing `sdlcLegacy`** (file deleted).
11. **Re-importing `socket.io-client`** (removed from `package.json`).
12. **Re-introducing `intent-agent`**, `ARCHITECTURE_GATE`,
    `ARCH_OUTPUT_REVIEW` (OBS-9 I-G).
13. **Re-introducing `/demo/*` HTTP routes**, `MOCK_*` constants,
    `demoBoardService.js`, FE `seedDemoBoard`/`getDemoBoard`/`getDemoUxDoc`/
    `retryDemoFlow` wrappers (OBS-8).
14. **Re-introducing `import type * as api`** — three sites converted to
    named imports (OBS-9 I-I).
15. **Reading `gate.kind` from the FE** — the FE consumes `gate.type`
    after canonical derivation, never raw `kind`.
16. **Adding presentation fields to the wire** — colour / badge / icon /
    animation / CSS class.
17. **Re-introducing the `socketService.js`** (deleted).

---

## 5. Reference Documents

- `docs/MASTER_DEPENDENCY/02_OBS_DEPENDENCY_GRAPH.md` — historical
  workstream map (regenerated from current source at the time).
- `docs/OBS1/PHASE5.5-freeze/01_FINAL_ARCHITECTURE.md` — runtime architecture.
- `docs/OBS1/PHASE5.5-freeze/04_DO_NOT_BREAK.md` — runtime invariants.
- `docs/OBS2/04_WORKFLOW_VERIFICATION.md` — workflow contract.
- `docs/OBS3/04_AGENT_VERIFICATION.md` — agent contract.
- `docs/OBS4/04_OBSERVABILITY_VERIFICATION.md` — observability contract.
- `docs/obs5-HITL/04_HITL_VERIFICATION.md` — HITL contract.
- `docs/obs6/04_UI_VERIFICATION.md` — UI contract.
- `docs/obs7/04_DOCUMENT_VERIFICATION.md` — document contract.
- `docs/obs8/04_DEMO_VERIFICATION.md` — demo / mock contract.
- `docs/obs9/04_INTEGRATION_VERIFICATION.md` — integration / env contract.

End of Dependency Baseline.
