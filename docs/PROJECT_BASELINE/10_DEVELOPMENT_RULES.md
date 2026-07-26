# 10 — Development Rules

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document. Permanent rules
> learned during OBS-1..OBS-9 work. No temporary project notes.

---

## 1. Single Source of Truth

Every observable value has exactly one canonical writer. The writer
is identified by file:line in the per-layer ownership matrix
(`docs/OBS1/PHASE5.5-freeze/01_FINAL_ARCHITECTURE.md` §3). The wire
envelope shape, the canonical state column, the canonical visual map,
the canonical API shape, the canonical logger, the canonical
correlation backbone — all are single-source.

**Apply:** Before adding a new observable, identify the existing
canonical writer. Add to it. Do not introduce a second writer.

---

## 2. Canonical Ownership

One artifact, one owner. The owner is the only producer of the
artifact; all consumers route through the owner.

| Artifact | Owner | File |
| -------- | ----- | ---- |
| `Task.executionStatus` | `taskLifecycleService.transition` | `backend/src/services/taskLifecycleService.js:95-141` |
| `EventEnvelope` (canonical) | `eventPublisher.publishEvent` | `backend/src/services/eventPublisher.js:17-28` |
| `AgentEvent.envelope` (persisted) | `taskLifecycleService.appendEvent` | `backend/src/services/taskLifecycleService.js:57-69` |
| `pipeline_completed` envelope | `releaseManager.submitReleaseDecision` (APPROVE branch only) | `backend/src/services/releaseManager.js:170-186` |
| `gate_pending` envelope | `gateBridge.requestGate` | `backend/src/services/gateBridge.js:51-83` |
| `gate_resolved` envelope | `gateBridge.resolveGate` (with documented `releaseManager` fallback) | `backend/src/services/gateBridge.js:154-194` |
| `RUNTIME_VISUAL` | `runtimeSelectors.ts` (frozen) | `frontend/src/store/runtimeSelectors.ts:540` |
| `RuntimeVisualStyle` projection | `runtimeSelectors.ts` | `frontend/src/store/runtimeSelectors.ts:103-712` |
| `SessionState` mutations | `applyEnvelope` dispatcher | `frontend/src/store/eventMappers.ts:339-342` |
| Document CRUD HTTP | `DocumentController.js` | `backend/src/controllers/DocumentController.js` |

**Apply:** Document the owner in the patch plan before any new
artifact is introduced.

---

## 3. No Duplicated Mapping

The `EXECUTION_STATUS_TO_PHASE_STATUS` mapping
(`backend/src/services/sdlcConstants.js:157-166`) is the SINGLE
source of truth for how `Task.executionStatus` projects onto
`pipelinePhases[i].status`. The `toPhaseStatus` function
(`backend/src/services/sdlcConstants.js:202-228`) is the SINGLE
projector. The `RUNTIME_VISUAL` map
(`frontend/src/store/runtimeSelectors.ts:538-611`) is the SINGLE
visual source. The `PhaseStatus → RuntimeState` collapse
(`frontend/src/store/runtimeSelectors.ts:186-206`) is the SINGLE
collapse rule.

**Apply:** Never introduce a parallel mapping. If a new state is
required, amend the canonical mapping in a single place.

---

## 4. Runtime Selector Ownership

The runtime projection is owned by `frontend/src/store/runtimeSelectors.ts`.
Any new selector that derives runtime state from `pipelinePhases` or
`agentStates` directly is forbidden.

**Apply:** Components consume `selectRuntimeExecution` /
`selectAgentPhaseStatus` / `getRuntimeVisual` / `getRuntimeIcon` /
`getRuntimeAnimation`. Inline derivation in components is forbidden
(OBS-1 R-09, R-10).

---

## 5. Workflow Ownership

The workflow engine is owned by `SdlcWorkflowService` +
`workflowOrchestrator` + `workflowHelpers` + `workflowQueries`. No
new module may drive an agent run, resolve a gate, or advance the
chain outside these four files.

**Apply:** Handoff paths (`_recordApprovedHandoff`,
`_startNextAgentIfAvailable`) are the canonical advance points.
Bypass is forbidden (OBS-2).

---

## 6. SSE Ownership

The SSE transport is owned by `eventBus.publish` +
`SdlcController.streamPipelineStatus`. Envelopes flow through
`eventPublisher.publishEvent` (single facade). SSE replay forwards
`row.envelope` byte-for-byte (no mutation).

**Apply:** Never synthesize envelopes outside `publishEvent`. Never
mutate envelopes during replay. Never add a second SSE channel
besides `GET /api/v1/sdlc/stream/:sessionId` (OBS-1 R-04, R-05,
R-21).

---

## 7. API Ownership

The HTTP API is owned by the per-domain `*Controller.js` files in
`backend/src/controllers/`. The FE HTTP layer is owned by the
per-domain `*Api.ts` files in `frontend/src/services/api/`. Each
domain has exactly one canonical API surface (documents / projects
/ folders / tree).

**Apply:** Do not introduce parallel API files. Do not introduce
parallel backend routes. Do not bypass the canonical FE `*Api.ts`
files with inline `fetch`/`axios` calls (OBS-7 D-A).

---

## 8. No Speculative Refactor

Every refactor must have evidence:
- A drift or Repair ID in a frozen OBS phase.
- A patch plan with file:line evidence.
- A verification report with test outcomes.
- A "do not break" rule citing the canonical owner.

**Apply:** Speculative refactors without a frozen OBS phase are
forbidden. `CLAUDE.md` §1..§5 rules apply (SSE preservation, hybrid
router, CSS Grid vs Flexbox, auth bypass, no legacy agents).

---

## 9. Repair Workflow

A drift becomes a Repair ID via the OBS workflow:

1. **Trace** — `0N_*_TRACE.md`. Map the current state to its
   canonical owner.
2. **Drift** — `0N_*_DRIFT.md`. Catalogue the divergence with
   file:line evidence.
3. **Patch plan** — `0N_*_PATCH_PLAN.md`. Per-patch file:line
   evidence and acceptance criteria.
4. **Patch** — land the patches in source.
5. **Verify** — `0N_*_VERIFICATION.md`. Tests pass; contracts
   preserved; no regression.

**Apply:** No new Repair ID without a new OBS phase. No patches
without a patch plan. No close without a verification report.

---

## 10. Trace Before Patch

Every patch begins with a trace. The trace establishes the current
behaviour, the expected behaviour, the first incorrect value, the
broken invariant, the responsible owner, and the evidence.

**Apply:** A patch without a trace is rejected.

---

## 11. Verification Before Close

Every OBS phase closes only after a verification report shows:
- All in-scope drifts resolved or formally deferred.
- The pre-existing contracts preserved (OBS-01..OBS-09 frozen files
  untouched).
- The pre-existing test suite passing (no new failures).
- The new tests passing (where the patch added coverage).
- TypeScript clean (`npx tsc --noEmit` clean).
- Prisma schema in sync (`npx prisma db push` succeeds).

**Apply:** No close without a verification report.

---

## 12. Defensive Fallback Pattern

When a legacy writer and a canonical writer coexist, the reader uses
`task.executionStatus ?? task.status` (or the equivalent for the
field). This is the bridge between the legacy and canonical writers
introduced by OBS-2 R-25 and mirrored in OBS-3.

**Apply:** Do not remove the defensive fallback until the legacy
writers are removed in a new OBS phase. The fallback preserves
backward compatibility with existing fixtures.

---

## 13. Wire Is Domain-Only

The wire envelope carries no presentation fields. No colour, no
badge, no animation name, no CSS class, no icon name. The wire is
domain-only. The FE projection owns presentation.

**Apply:** Adding a presentation field to the wire is forbidden
(OBS-1 R-17).

---

## 14. Frozen Object Discipline

`RUNTIME_VISUAL` is `Object.freeze`d at module load. Mutations fail
at the language level. `EXECUTION_STATUS_TO_PHASE_STATUS`,
`AGENT_POLICY`, `AGENT_GATES`, `NEXT_AGENT`, `NODE_TARGET`,
`DEFAULT_GATE_MODE` are canonical constants.

**Apply:** Do not mutate frozen objects. Use the accessor functions
(`getRuntimeVisual`, `getRuntimeIcon`, `getRuntimeAnimation`).

---

## 15. Cross-Page Identity

The same `PhaseStatus` renders the same colour on Dashboard / Agent
Task / SessionRail / Inspector. The same `gate.kind` renders the
same colour on OverviewPage and InspectorPanel. The same
`session.status` renders the same colour on SessionRail and
SessionPill. The same connection state renders the same colour +
animation everywhere.

**Apply:** No local colour map. No local animation rule. No local
icon registry. Route through the canonical accessor.

---

## 16. Single Producer Per Envelope Type

Each `EventType` value has exactly one producer. Adding a new
`EventType` requires a contract amendment (OBS-1 R-15, R-16).

**Apply:** No new `EventType` without a contract amendment.

---

## 17. Audit Trail Discipline

`HitlDecision` rows are the durable audit for every HITL decision.
Every gate path writes a `HitlDecision` row (`HitlDecision.create`).
The `decisionId` is the idempotency key for release decisions
(releaseManager + HitlDecision.findByDecisionId).

**Apply:** Every HITL decision writes a `HitlDecision` row. The
FE `releaseDecision` decisionId cache is keyed on
`(sessionId, gateId)` (OBS-5 H-H). The cache entry is cleared on
completion.

---

## 18. Correlation Backbone

The correlation backbone is `requestContext` +
`AsyncLocalStorage`. The correlation key is `requestId`. The
correlation chain is `requestId → approvalId → taskId → role → kind
→ decision`.

**Apply:** No `console.*` in production backend code. No
`console.warn` in `sseClient.ts`. Use `logger.*` (BE) or `sseLog.*`
(FE). Sentry init is opt-in via `SENTRY_DSN` (OBS-4).

---

## 19. Document CRUD Atomicity

`moveDocument` writes the row once (single Prisma update). Upload
writes DB row first, file second; on file-write failure, the row is
cleaned up (best-effort). Rename pre-write check returns 409 on
collision.

**Apply:** No multi-write paths. No torn-row states. No silent
failures.

---

## 20. No Re-Introduction of Removed Code

The following are removed and MUST NOT be re-introduced without an
explicit OBS phase:

- `/api/v1/sdlc/demo/*` routes
- `backend/src/services/demoBoardService.js`
- `MOCK_REVIEW_STAGES`, `MOCK_SCENARIO_PROFILES`, `DEFAULT_MOCK_SCENARIO`,
  `_applyMockScenario`, `applyScenarioNarrative`, `buildScenarioBrief`,
  `resolveMockScenario`, `BOARD_TIMEOUT_MS`
- `frontend/src/services/api/sdlcLegacy.ts`
- FE wrappers `seedDemoBoard`, `getDemoBoard`, `getDemoUxDoc`,
  `retryDemoFlow`
- FE types `CardAction`, `BoardCard`, `BoardPhase`, `BoardReleaseGate`,
  `BoardFlow`, `DemoBoard`, `UxDoc`
- `socket.io-client` (frontend package)
- `GEMINI_API_KEY` define in `vite.config.ts`
- `AGENTS_BASE_URL` in `docker-compose.yml`
- `~/.codex/config.toml` mount in `docker-compose.yml`
- `intent-agent`, `ARCHITECTURE_GATE`, `ARCH_OUTPUT_REVIEW` in
  `sdlcConstants.js`
- `useAppStore.sseAbort`
- `import type * as api from '@/services/api/sdlcApi'`

**Apply:** Any re-introduction requires a frozen OBS phase
explicitly authorizing it.

---

## 21. Working Tree Discipline

The working tree must be clean before any new OBS phase begins.
TypeScript clean. Prisma schema in sync. Tests pass.

**Apply:** A dirty working tree is the first sign of an
uncoordinated change.

---

## 22. Documentation Discipline

Every OBS phase produces:
- Trace (`0N_*_TRACE.md`)
- Drift (`0N_*_DRIFT.md`)
- Patch plan (`0N_*_PATCH_PLAN.md`)
- Verification (`0N_*_VERIFICATION.md`)

The frozen contracts live in
`docs/OBS1/PHASE5.5-freeze/01..05_*.md` and
`docs/PROJECT_BASELINE/00..11_*.md`.

**Apply:** No OBS phase without documentation. No frozen contract
without a freeze sign-off.

End of Development Rules.
