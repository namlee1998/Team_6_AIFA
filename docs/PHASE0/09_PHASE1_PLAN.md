# 09 — Phase 1 Plan (Frozen Baseline)

> **Status:** PLAN ONLY. Reconstructed from the existing Phase-0
> documents in `docs/engineering-freeze/`. No code changes.
> No design reinterpretation.

---

# Phase 1 Objective

Phase 1 is a **READ-ONLY engineering audit**. It does NOT touch any
production source, tests, contracts, configuration, or documentation
outside of `docs/engineering-audit/`.

Phase 1 will:

- Verify whether the implementation matches the frozen baseline
  (`docs/engineering-freeze/01–08.md`).
- Reconstruct state machines and pipeline transitions as they exist
  today.
- Identify observable drifts between code and baseline.
- Produce audit reports in `docs/engineering-audit/`.

Phase 1 MUST NOT:

- Modify production code.
- Modify tests.
- Modify API contracts (HTTP, SSE wire, event envelopes, DB schema).
- Rename anything.
- Refactor.
- "Fix" anything, even if it appears obviously broken.
- Optimize code.
- Update dependencies.
- Change frontend behaviour.

---

# Audit Order (strict)

The audit order is **strict** and follows dependency relationships
within the codebase. Each subsequent section builds on evidence
gathered (but does not depend on formal sign-off) from the previous
section.

## 1. Pipeline & State Machine

**Why first**: the pipeline is the spine of the system. Every other
audit area (events, HTTP, persistence, frontend) reads what the
pipeline does. The state machine (Task, PendingGate, HitlDecision,
PipelineSession) is what carries state across the pipeline. If the
pipeline and state machine are not stable, no other audit can be
grounded.

**Expected deliverables**

- `docs/engineering-audit/01_PIPELINE_TRACE.md` — every stage traced
  end-to-end with caller, callee, controller, service, DB writes,
  emitted events, human gates, next trigger. Every statement cites
  file:line.
- `docs/engineering-audit/02_STATE_MACHINE.md` — reconstructed state
  machines for Session, Task, PendingGate, HitlDecision, Pipeline.
  States, allowed transitions, transition owners, observed transitions,
  illegal transitions found.

**Estimated complexity**: high. Multiple files, multiple write sites,
multiple side effects per transition. Requires careful per-line
attribution.

**Dependencies**: none (this is the foundation).

## 2. HTTP/API Contracts

**Why second**: HTTP endpoints are the public surface that the FE
reads. Knowing exactly what the API returns (and what it claims to
return in code comments vs. what is actually produced) requires the
pipeline behaviour to be settled. Any route's response shape depends
on the services it delegates to — which depend on the pipeline.

**Expected deliverables**

- Documented HTTP routes in `05_HTTP_ENDPOINT_INVENTORY.md` cross-
  checked against `03_RUNTIME_ENTRYPOINTS.md`. Confirm every route in
  `routes/sdlc.js` matches every handler in `controllers/SdlcController.js`,
  and that every claimed payload field is actually produced.
- Detection of routes that return `410` (removed/deprecated) vs. routes
  that are active.
- Detection of controller methods that are defined but never bound to
  a route.

**Estimated complexity**: medium.

**Dependencies**: §1 (each endpoint delegates to a service or
controller that implements a pipeline entrypoint or a query).

## 3. Event Bus & SSE

**Why third**: events are the canonical contract between the SSE
writer and the FE store. Misalignment here surfaces only after the
pipeline and HTTP shape are clear.

**Expected deliverables**

- For every `publishEvent(...)` call in current source, verify against
  `06_EVENT_INVENTORY.md`. Confirm producer, consumer, persistence
  asymmetry (`pipeline_completed` is publish-only — see I-1 in
  `08_CURRENT_KNOWN_ISSUES.md`).
- For every canonical `EventType` in the discriminator union, verify
  whether it has any producer in current source. Identify types that
  are declared but never emitted (`pipeline_failed`, `task_resumed`,
  `agent_event` — I-2).
- SSE replay behaviour: confirm what
  `SdlcController.streamPipelineStatus:340-357` actually emits on
  reconnect (verbatim `row.envelope` for canonical rows; legacy
  fallback for non-`gate_audit` rows; silently dropped otherwise).

**Estimated complexity**: medium.

**Dependencies**: §1 (which services publish), §2 (HTTP routes that
depend on SSE).

## 4. Persistence / Database

**Why fourth**: persistence is the durable backing of the state
machine. The audit here is the bridge between the runtime objects
(Task / PipelineSession / AgentEvent / HitlDecision / PendingGate) and
the Prisma schema. Only after the runtime is settled can a comparison
to the schema be unambiguous.

**Expected deliverables**

- Verify the entity map in `07_DATABASE_ENTITY_MAP.md` against the
  live `prisma/schema.prisma`. Confirm every entity, every relation,
  every index, every `@unique` constraint.
- Identify any code that writes to a Prisma row without using the
  `models/*.js` wrapper (raw `prisma.task.update`, etc.).
- Identify FK constraints declared in code (scalar `taskId`, etc.)
  that are NOT declared as Prisma `references`.
- Cross-check `sequneceService.next` and the
  `@@unique([sessionId, sequence])` constraint together with every
  `AgentEvent.create` call site (I-12 in `08`).

**Estimated complexity**: medium-high.

**Dependencies**: §1 (which writes happen where), §2 (which read
endpoints rely on which tables), §3 (which event types map to which
rows).

## 5. Agent Runtime

**Why fifth**: the agent runtime (the dispatchers that wrap
claude-code / codex / langchain / mock execution paths) is the most
substituted surface. The audit must establish exactly which path is
selected under which condition, and confirm contract conformance per
path (mock output vs. real output vs. claude-code output share the
same `agent-io.v5` shape).

**Expected deliverables**

- Verify `agentDispatcher.runAgent` path selection
  (`backend/src/services/agentDispatcher.js:306-474`):
  - `EXECUTION_PATH=codex` → `codexRunner`.
  - `EXECUTION_PATH=claude-code` → `runClaudeCodePath` →
    `claudeCodeRunner.runAgent`. With `USE_MOCK_CLAUDE_CODE=true`,
    it short-circuits to `buildMockOutput`.
  - `EXECUTION_PATH=langchain` (default) → either mock via
    `USE_MOCK_AGENTS=true`, else the Python `AgentService` proxy.
- Verify `archAskEnforcer.enforceAskUserQuestion` coverage per role
  (`ENFORCED_ROLES`) against `OUTPUT_CONTRACTS`.
- Verify `claudePermissionDispatcher.dispatch` (interactive vs.
  non-interactive) against `riskClassifier.classifyAction` and the
  `gateBridge.requestGate` protocol.
- Document the Python agents service surface as far as
  `agents/main.py` endpoints are concerned.

**Estimated complexity**: high (cross-stack: JS ↔ Python ↔ SDK).

**Dependencies**: §1 (which agents run when), §3 (which events the
agent emits), §4 (which DB rows the agent produces via
`_saveAgentData`).

## 6. Frontend State Synchronization

**Why sixth**: the FE consumes the SSE stream and produces no
authoritative state of its own (per the `useWorkflowStore` comment:
"HTTP commands — DO NOT mutate local state on success; the SSE
stream is the authoritative source"). The audit here checks that
this invariant holds across every action and every reducer path.

**Expected deliverables**

- Verify every HTTP command in `useWorkflowStore` (`startPipeline`,
  `resolveGate`, `resolveOutputReviewGate`, `resolveClarification`,
  `resolveToolGate`, `releaseDecision`) does not mutate local state
  on success.
- Verify `eventMappers.ts` covers every canonical `EventType` with a
  no-op default branch.
- Verify `sseClient.ts` envelope validation (`isEnvelope`) rejects any
  non-canonical frame.
- Verify `useWorkflowStore`'s module-level dedup state
  (`seenEnvelopeIds`, `lastSeenSequenceBySession`,
  `sseUnsubscribeFns`) is reset on `cleanupSession` / `resetAll`.

**Estimated complexity**: medium.

**Dependencies**: §3 (event types feed the reducers), §2 (HTTP shapes
the FE expects).

## 7. Dead Code Inventory

**Why seventh**: dead code is observation-only and is safely cross-
checked against the rest of the audit. It must not be attempted
before the dependent audits have produced their own picture of which
paths are reachable.

**Expected deliverables**

- List every file / function / constant / env-switch that the audit
  traverses but is NOT reached by any current code path.
- Specifically:
  - Backend diagnostic root scripts (`backend/q-*.js`).
  - `backend/arch_runtime.js`.
  - The legacy `socketService.js` deletion entry (I-7).
  - Modules declared but not imported (`backend/src/utils/`,
    `backend/src/services/authService.js`, etc.).
  - Empty middleware (e.g. `validation.js`, `authMiddleware.js` beyond
    the bypass).
  - Mock-only constants that no current execution path can produce
    (legacy scaffold pieces the codebase explicitly forbids per
    `CLAUDE.md` §5 — `agent_1/2/3` Python prompts).

**Estimated complexity**: low-medium. Mostly file-by-file walks with
grep.

**Dependencies**: §1–§6 each produce evidence of reachable paths;
this section cross-checks against the union of reachable paths.

---

# Success Criteria

Phase 1 is successful when ALL of the following hold:

1. `docs/engineering-audit/01_PIPELINE_TRACE.md` exists and contains,
   for every stage (Project Creation, Architecture, PO, UX, DEV, QA,
   Release), a trace of every transition with caller, callee,
   controller, service, DB writes, emitted events, human gates, next
   trigger — every statement cited to file:line.
2. `docs/engineering-audit/02_STATE_MACHINE.md` exists and contains,
   for `Session`, `Task`, `PendingGate`, `HitlDecision`, `Pipeline`:
   states, allowed transitions, transition owner, observed
   transitions in current code, illegal transitions found (if any).
3. `docs/engineering-audit/03_PIPELINE_GAPS.md` exists and lists
   every observed drift between runtime behaviour and the baseline,
   each with `Evidence`, `Files`, `Functions`, `Impact`. NO FIX
   proposed for any item.
4. `docs/engineering-audit/04_PHASE1_SUMMARY.md` exists and
   summarises what was audited, what remains, current risk level,
   recommended Phase 2 scope.
5. Zero production source files were modified.
6. Zero tests were modified.
7. Zero API contracts were modified.
8. Zero behaviour changes were introduced.

If any item from the freeze package (`docs/engineering-freeze/01–08.md`)
is contradicted by §1–§7 deliverables, it is flagged in
`03_PIPELINE_GAPS.md`, not silently rewritten in the freeze package.

---

# Out of Scope

The following are explicitly forbidden under Phase 1:

- ✗ Modifying any production source file (Backend, Frontend, Agents).
- ✗ Modifying any test file (backend `tests/`, frontend `tests/`,
  agents `tests/`).
- ✗ Modifying `prisma/schema.prisma` or any DB migration.
- ✗ Modifying the SSE wire shape or any envelope payload.
- ✗ Modifying HTTP route paths, controllers, or response shapes.
- ✗ Modifying README, SPEC, ARCHITECTURE, or any other documentation
  outside `docs/engineering-audit/`.
- ✗ Renaming anything (functions, classes, files, fields, env vars).
- ✗ Refactoring (splitting, merging, re-orchestrating modules).
- ✗ Optimising (caching, batching, reducing allocations).
- ✗ Fixing any of the 30 issues documented in
  `08_CURRENT_KNOWN_ISSUES.md` or any new issue found during the
  audit.
- ✗ Updating dependencies (`package.json`, `requirements.txt`,
  `package-lock.json`).
- ✗ Changing environment configuration (`.env`, `.env.example`).
- ✗ Adding new tests.
- ✗ Removing files (even unused ones).
- ✗ Running destructive commands against the SQLite database or the
  workspace directory.
- ✗ Proposing code changes (the audit must remain observation-only;
  proposals belong in Phase 2).

If a candidate "fix" appears obvious during the audit, the agent
records it as an observation in `03_PIPELINE_GAPS.md` with a "NOT
VERIFIED" tag where appropriate and moves on. No exceptions.
