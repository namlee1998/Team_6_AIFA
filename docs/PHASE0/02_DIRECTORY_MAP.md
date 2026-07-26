# 02 — Directory Map (Frozen Baseline)

> **Status:** OBSERVATION ONLY. Tree shape as of `HEAD` on `namw6`.
> Tags: **[B]** Backend · **[F]** Frontend · **[A]** Python Agents ·
> **[S]** Shared/Infra · **[T]** Tests · **[X]** Scripts · **[D]** Docs
> · **[W]** Workspace (runtime data).

---

## Root

```
Team_6_End-to-End-Autonomous-Software-Factory-Multi-AI-Agent/
├── [B] backend/                              Node.js service
├── [F] frontend/                             React (Vite) SPA
├── [A] agents/                               Python LangChain service
├── [D] docs/                                 Spec, plans, fixbug audits, archive
├── [W] workspace/                            Per-project runtime repo workspaces
├── [D] public/                               Static UX-preview SVGs served by backend
├── [S] mock-data/                            Static deterministic mock agent outputs
├── [S] docker-compose.yml
├── [S] .env / .env.example
├── [D] README.md
├── [D] API_CONTRACT.md
├── [D] UPGRADE_TO_SINGLE_USER.md
├── [D] CLAUDE.md
├── [D] PROJECT_NOTES.md (if present)
├── [S] package.json (root-level, if present)
└── [S] requirements.txt / pytest.ini (root-level)
```

---

## `backend/` — Node.js service **[B]**

```
backend/
├── src/                                       (all production source)
│   ├── server.js                              composition root
│   ├── config/
│   │   ├── database.js                        Prisma client + SQLite PRAGMAs
│   │   ├── environment.js                     PORT / FRONTEND_URL / NODE_ENV
│   │   ├── agents.js                          Python agent URL helpers
│   │   ├── logger.js                          pino-style logger
│   │   └── qualityGateRules.js                QA gate rule definitions
│   ├── routes/
│   │   ├── index.js                           mounts all routes under /api/v1
│   │   ├── sdlc.js                            SDLC HTTP endpoints
│   │   ├── projects.js                        CRUD: projects
│   │   ├── documents.js                       CRUD: documents + uploads
│   │   ├── folders.js                         CRUD: folders
│   │   ├── tree.js                            GET /tree
│   │   └── sessions.js                        /sessions/:page state
│   ├── controllers/
│   │   ├── SdlcController.js                  largest; delegates to SdlcWorkflowService
│   │   ├── ProjectController.js
│   │   ├── DocumentController.js
│   │   ├── FolderController.js
│   │   ├── TreeController.js
│   │   └── SessionStateController.js
│   ├── middleware/
│   │   ├── authMiddleware.js                  local-dummy auth bypass
│   │   ├── errorHandler.js                    ApiError + Sentry
│   │   ├── logger.js                          request log
│   │   ├── requestContext.js                  AsyncLocalStorage requestId
│   │   └── validation.js
│   ├── services/
│   │   ├── SdlcWorkflowService.js             central orchestrator (class)
│   │   ├── workflowOrchestrator.js            pure orchestrator helpers (no this)
│   │   ├── agentDispatcher.js                 buildMockOutput / runAgent / claude-code path
│   │   ├── agentContract.js                   agent-io.v5 contract
│   │   ├── gateBridge.js                      in-memory + persisted gate registry
│   │   ├── gateManager.js                     validateGateOutput / evaluateGatePolicy
│   │   ├── taskLifecycleService.js            state machine (queued→…→completed)
│   │   ├── taskWorkerService.js               claim / heartbeat / sweepStale
│   │   ├── eventBus.js                        pub/sub transport
│   │   ├── eventPublisher.js                  publishEvent facade
│   │   ├── sequence.js                        per-session monotonic counter
│   │   ├── repoService.js                     clone, paths, git plumbing
│   │   ├── repoIndexService.js                shallow dir-tree index
│   │   ├── scopeResolver.js                   pure: repoIndex + featureRequest → scopeHints
│   │   ├── releaseManager.js                  submitReleaseDecision / buildReleaseEvidenceSummary
│   │   ├── artifactManager.js                 buildContextFromArtifacts / writeArtifactToFile / recordApprovedHandoff
│   │   ├── workflowReport.js                  final.md / qa-report.md / audit-trail.json
│   │   ├── workflowQueries.js                 read-only queries + contentHash + formatArtifactForClient
│   │   ├── workflowHelpers.js                 deriveCurrentPhase / selectCurrentTaskChain / routeReformatters
│   │   ├── archAskEnforcer.js                 AskUserQuestion enforcement loop
│   │   ├── riskClassifier.js                  tool risk → tier (auto / approval / block)
│   │   ├── sdlcConstants.js                   AGENT_GATES, NEXT_AGENT, OUTPUT_CONTRACTS, …
│   │   ├── qaGate.js                          shared qaGatePassed(task)
│   │   ├── toGateType.js                      (role, kind) → GateType
│   │   ├── QualityGateService.js              QA gate scoring engine
│   │   ├── AgentService.js                    HTTP bridge to Python agents
│   │   ├── authService.js                     standalone (NOT wired to any route)
│   │   ├── ProjectService.js                  project CRUD (legacy)
│   │   ├── DocumentService.js                 legacy document service
│   │   ├── FolderService.js                   legacy folder service
│   │   ├── TreeService.js                     legacy tree builder
│   │   ├── SessionStateService.js             session-state CRUD
│   │   ├── demoBoardService.js                demo board (legacy)
│   │   └── authService.js
│   ├── agents/                                local Claude/Codex runner adapters
│   │   ├── claudeCodeRunner.js                local Claude Agent SDK adapter
│   │   ├── claudePermissionDispatcher.js      canUseTool → AIFA gate
│   │   ├── codexRunner.js                     Codex CLI adapter
│   │   └── prompts/
│   │       ├── architecture.prompt.md
│   │       ├── po.prompt.md
│   │       ├── ux.prompt.md
│   │       ├── dev.prompt.md
│   │       ├── qa.prompt.md
│   │       └── repair-output.prompt.md
│   ├── models/                                Prisma-backed model classes
│   │   ├── index.js                           barrel export
│   │   ├── Task.js
│   │   ├── AgentArtifact.js
│   │   ├── AgentEvent.js
│   │   ├── HitlDecision.js
│   │   ├── PendingGate.js
│   │   ├── PipelineSession.js
│   │   ├── Project.js
│   │   ├── Document.js
│   │   ├── Folder.js
│   │   ├── Testcase.js
│   │   ├── SessionState.js
│   │   └── FeatureBacklog.js
│   ├── dto/
│   │   └── eventEnvelope.js                   canonical envelope DTO (pure)
│   ├── jobs/
│   │   └── batchJob.js                        no-op in single-user mode
│   └── utils/
│       └── agentParser.js                     legacy agent output parser
├── prisma/
│   ├── schema.prisma                          SQLite schema (the source of truth)
│   ├── dev.db / dev.db-shm / dev.db-wal       local SQLite database
│   ├── repro.db*                              diagnostic snapshot of dev.db
│   └── prisma/                                empty subfolder (no migrations)
├── migrations/                                (legacy SQL files; schema.prisma is the live source)
├── scripts/                                   (legacy helper scripts)
├── tests/                                     **[T]**
│   ├── setupEnv.js
│   └── integration/
│       ├── a2a-project-definition-plumbing.test.js
│       ├── agent-contract.test.js
│       ├── aifa-gate.test.js
│       ├── arch-mandatory-ask.test.js
│       ├── auth.middleware.test.js
│       ├── claude-code-adapter.test.js
│       ├── database.config.test.js
│       ├── dev-prompt-phase3.test.js
│       ├── eventBus.test.js
│       ├── gateBridge.subscribeProject.test.js
│       ├── gateBridge.terminal-state.test.js
│       ├── getSessionRepoInfo.test.js
│       ├── interventions.test.js
│       ├── normalizeClarificationQuestions.test.js
│       ├── output-contract.test.js
│       ├── po-prompt-phase3.test.js
│       ├── qa-prompt-phase3.test.js
│       ├── repoUrlValidation.test.js
│       ├── sdlc.handoff.test.js
│       ├── session-state.model.test.js
│       ├── task-lifecycle.test.js
│       ├── upstreamArtifactGuard.test.js
│       ├── ux-prompt-phase3.test.js
│       └── workflow-report.test.js
├── package.json / package-lock.json
├── jest.config.js
├── Dockerfile / Dockerfile.dev / .dockerignore
├── .env / .env.example / .gitignore
├── arch_runtime.js                            (legacy entry, see 08_CURRENT_KNOWN_ISSUES)
├── q-all-ux-truncation.js **[X]**             diagnostic helper script
├── q-find-tasks.js **[X]**                    diagnostic helper script
├── q-stop-reason-correlation.js **[X]**        diagnostic helper script
├── q-ux-evidence.js **[X]**                   diagnostic helper script
├── q-ux-rerun-evidence.js **[X]**              diagnostic helper script
├── claude-cli-probe.log **[X]**               diagnostic log
└── dev.db / dev.db-shm / dev.db-wal
```

---

## `frontend/` — React SPA **[F]**

```
frontend/
├── src/
│   ├── App.tsx                                routes (only /sdlc/* active)
│   ├── main.tsx
│   ├── index.css
│   ├── vite-env.d.ts
│   ├── react-i18next.d.ts
│   ├── i18n.ts
│   ├── components/
│   │   ├── ErrorBoundary.tsx
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── AppSidebar.tsx
│   │   │   ├── AppTopBar.tsx
│   │   │   └── dialogs/
│   │   │       ├── FeatureRequestProjectDialog.tsx
│   │   │       └── ImportProjectDialog.tsx
│   │   └── ui/
│   │       ├── Badge.tsx
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       └── LanguageSwitcher.tsx
│   ├── pages/
│   │   ├── NotFound/                          (page module)
│   │   └── SdlcDashboard/                     (page module)
│   ├── store/
│   │   ├── useAppStore.ts
│   │   ├── useUiStore.ts
│   │   ├── useWorkflowStore.ts                 the SOLE workflow store (SSE-backed)
│   │   ├── eventMappers.ts                    envelope → SessionState patch
│   │   ├── workflowSelectors.ts
│   │   └── index.ts
│   ├── services/
│   │   ├── api.ts                             legacy re-export
│   │   ├── sseClient.ts                       canonical SSE transport
│   │   └── api/
│   │       ├── client.ts
│   │       ├── sdlcApi.ts
│   │       ├── sdlcLegacy.ts
│   │       ├── types.ts
│   │       ├── documentsApi.ts
│   │       ├── testScenariosApi.ts
│   │       └── yamlApi.ts
│   ├── dto/
│   │   └── event.ts                           EventEnvelope TS mirror + isEnvelope
│   ├── models/
│   │   └── SessionState.ts                    per-session store shape
│   ├── hooks/
│   │   ├── useApi.ts
│   │   └── useApiActions.ts
│   ├── lib/
│   │   ├── testScenarioHelpers.ts
│   │   ├── yamlExportHelpers.ts
│   │   └── utils.ts
│   ├── theme/                                 (theme module)
│   └── locales/                               (i18n bundles)
├── tests/                                     **[T]**
│   ├── App.notFound.test.tsx
│   ├── OverviewPage.test.tsx
│   ├── SdlcDashboard.test.tsx
│   ├── testScenarios.helpers.test.ts
│   ├── yamlExport.helpers.test.ts
│   └── setup.ts
├── public/                                    static SPA assets
├── package.json / package-lock.json
├── tsconfig.json
├── vite.config.ts
├── eslint.config.js
├── .prettierrc / .env / .env.example / .gitignore
├── metadata.json
├── vercel.json
├── Dockerfile / Dockerfile.dev / .dockerignore
└── docs/                                      frontend-specific docs
```

---

## `agents/` — Python LangChain service **[A]**

```
agents/
├── main.py                                    FastAPI entry (HTTP + SSE bridge)
├── Dockerfile / Dockerfile.dev / .dockerignore
├── requirements.txt
├── .env / .env.example / .gitignore
├── agents-local*.log                          runtime logs (not source)
├── sandbox/                                   sandboxed shell helper
├── src/
│   ├── observability.py
│   ├── agents/
│   │   ├── dev_agent.py
│   │   ├── intent_agent.py                    (no architecture_agent.py)
│   │   ├── po_agent.py
│   │   ├── ux_agent.py
│   │   └── qa_agent.py
│   ├── mcp/
│   │   ├── __init__.py
│   │   ├── mcp_client.py
│   │   ├── tool_policy.py
│   │   ├── tool_registry.py
│   │   └── mocks/
│   ├── prompts/
│   │   ├── __init__.py
│   │   ├── agent_1.txt
│   │   ├── agent_1_ui_context.txt
│   │   ├── agent_2.txt
│   │   ├── agent_3.txt
│   ├── quality_gate/
│   │   ├── __init__.py
│   │   ├── evaluator.py
│   │   └── rules.py
│   ├── routing/
│   │   ├── __init__.py
│   │   └── rework.py
│   ├── schemas/
│   │   ├── __init__.py
│   │   └── aidlc.py
│   ├── tools/
│   │   ├── dev_tools.py
│   │   └── sandbox.py
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── llm_factory.py                     `_get_llm(model_config)` hybrid router
│   │   └── router.py
│   └── workflows/
│       └── main_pipeline.py                   canonical orchestrator (no agent_1/2/3)
├── tests/                                     **[T]**
├── venv/                                      Python venv (gitignored)
└── __pycache__/
```

---

## `docs/` — Documentation **[D]**

```
docs/
├── SPEC.md                                    frozen spec (2026-07-06)
├── ACCEPTANCE.md
├── ARCHITECTURE.md
├── BACKLOG.md
├── CONSTRAINTS.md
├── architecture/
│   └── A2A_PIPELINE_REDESIGN.md               Phase 2 plumbing source
├── archive/                                   historical AIFA documents (project-dup, luong, …)
├── fixbug/
│   └── AUDIT_2026_07_09_FULL_PIPELINE.md      §19 = FINAL_RELEASE re-architecture
└── plans/
    └── artifact-recovery-loop.md
```

---

## `workspace/` — Runtime repo workspaces **[W]**

```
workspace/
└── projects/
    └── <projectId>/
        ├── repo/                              canonical uploaded repo
        └── sessions/
            └── <sessionId>/
                └── repo/                      per-session working copy
```

---

## `mock-data/` — Static mock agent outputs **[S]**

```
mock-data/
└── <role>/                                    one folder per role (po-agent, ux-agent, …)
    ├── *.md                                   string fields
    └── *.json                                 JSON fields
```

The mock builder (`agentDispatcher.buildMockOutput`) reads this directory
and applies per-role defaults.

---

## Tests at a glance

- Backend: 24 Jest integration tests under
  `backend/tests/integration/`.
- Frontend: 6 Vitest tests under `frontend/tests/`.
- Agents: small folder `agents/tests/`.

---

## Files NOT to confuse with production source

These exist alongside production source but are diagnostic / transient /
non-source-of-truth:

- `backend/q-*.js` (root-level diagnostic scripts)
- `backend/claude-cli-probe.log`
- `backend/arch_runtime.js` (legacy, see 08_CURRENT_KNOWN_ISSUES)
- `backend/dev.db*`, `backend/prisma/repro.db*`, `backend/prisma/dev.db*`
- `agents/agents-local*.log`
- All `*.dev.*.log`, `*.stdout.log`, `*.stderr.log` files at repo root.

---

## Empty / placeholder folders

- `backend/prisma/prisma/` (empty; the live schema is the file
  `backend/prisma/schema.prisma`)
- `backend/migrations/` (legacy SQL; not wired to current Prisma client)
- `backend/scripts/` (legacy)
- `backend/src/utils/` (only `agentParser.js`)
- `agents/sandbox/` (small; not enumerated in detail)