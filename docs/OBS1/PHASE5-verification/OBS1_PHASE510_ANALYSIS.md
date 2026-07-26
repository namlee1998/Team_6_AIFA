# OBS1_PHASE510_ANALYSIS.md

> **Status:** ANALYSIS ONLY. No production code modified.
> **Phase:** OBS-01.10 — Close remaining runtime drifts.
> **Authority:**
> - `docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md` (contract — HIGHEST AUTHORITY)
> - `docs/OBS1/phase1-runtime-observability/05_CANONICAL_RUNTIME_STATE.md` (state spec)
> - `docs/OBS1/phase1-runtime-observability/06_IMPLEMENTATION_CHECKLIST.md` (checklist)
> - `docs/OBS1/PHASE5-verification/01_VERIFICATION_REPORT.md` (Phase 5 verdict)
> - `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md` (R-XX inventory)

---

## 1. Current Runtime Flow (post Phase 5)

The canonical runtime has 4 layers:

```
  ┌──────────────────────────────────────────────────────────────────┐
  │ BE: Task.executionStatus  (canonical state machine — 8 values)   │
  │ Owner: taskLifecycleService.transition / transitionIfPresent      │
  │ Evidence: backend/src/services/taskLifecycleService.js:11-21,     │
  │           95-141                                                  │
  └──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ Wire: EventEnvelope                                              │
  │ Owner: publishEvent (single facade)                               │
  │ Carrier: 13-type discriminated union                              │
  │ Evidence: backend/src/services/eventPublisher.js,                 │
  │           backend/src/dto/eventEnvelope.js:10-23                  │
  └──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ SSE transport                                                     │
  │ Owner: SdlcController.streamPipelineStatus + eventBus             │
  │ Replay rule: forward row.envelope byte-for-byte                   │
  │ Evidence: backend/src/controllers/SdlcController.js:286-406        │
  └──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ FE: SessionState (Zustand store)                                  │
  │ Owner: reducer family (eventMappers.ts)                           │
  │ Sub-fields:                                                       │
  │   - session.pipelinePhases[i].status  (frozen after seed)         │
  │   - session.agentStates[i].status     (per-event patches)         │
  │   - session.status                     (session-level aggregate)  │
  │ Evidence: frontend/src/store/eventMappers.ts,                     │
  │           frontend/src/store/useWorkflowStore.ts                  │
  └──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ Projection: runtimeSelectors (single owner)                       │
  │   - projectAgentToPhaseStatus()  (visible)                        │
  │   - deriveAgentRuntimeState()    (canonical)                      │
  │   - selectRuntimeStatus()         (session-level aggregate)       │
  │   - selectAgentPhaseStatus()      (store-norm helper, Patch 02)   │
  │   - countCompletedAgents()        (store-norm helper, Patch 02)   │
  │   - countTotalAgents()            (store-norm helper, Patch 02)   │
  │   - selectAgentPhaseEntry()       (store-norm helper, Patch 02)   │
  │ Evidence: frontend/src/store/runtimeSelectors.ts                  │
  └──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ UI: RUNTIME_VISUAL map (single source)                            │
  │   - border / background / glyph / iconName / badge / animation    │
  │ Owner: runtimeSelectors.ts:538-611                                │
  │ Consumers:                                                        │
  │   - Dashboard: OverviewPage.tsx:244-265                           │
  │   - Agent Task: SdlcDashboard/index.tsx:311-358                   │
  │   - SessionRail dots: SessionRail.tsx:190 (uses canonical         │
  │     selector) + local PHASE_DOT_COLORS (drift — R-15)             │
  │   - Inspector: InspectorPanel.tsx (gate panel only, no per-agent  │
  │     runtime visuals per contract §5.1.5)                         │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 2. Current Ownership Map (post Phase 5)

| Object | Canonical owner | Evidence |
| ------ | --------------- | -------- |
| `Task.executionStatus` | `taskLifecycle.transition` | `backend/src/services/taskLifecycleService.js:95-141` |
| `Task.status` (legacy) | frozen — MUST NOT be read by runtime visualization | `backend/src/models/Task.js:39`; `backend/src/services/SdlcWorkflowService.js:1256` (drift — R-25) |
| `EventEnvelope.role` (lifecycle) | producer at call site (must be `task.type`) | `backend/src/services/taskLifecycleService.js:90` (drift — R-24) |
| `EventEnvelope.role` (gate envelopes) | `gateBridge` (correctly carries `role`) | `backend/src/services/gateBridge.js:124` |
| `PipelineSession.status` | `PipelineSession.update` | `backend/src/services/SdlcWorkflowService.js:558` |
| `AgentEvent.envelope` | `taskLifecycleService.appendEvent` | `backend/src/services/taskLifecycleService.js:57-69` |
| SSE replay | `streamPipelineStatus` (byte-for-byte) | `backend/src/controllers/SdlcController.js:340-358` |
| `session.pipelinePhases[i].status` | `mapSessionStarted` (seed) ONLY | `frontend/src/store/eventMappers.ts:199-208` |
| `session.agentStates[i].status` | per-event lifecycle mappers + `mapGatePending` | `frontend/src/store/eventMappers.ts:100-130, 215-292` |
| `session.status` | `mapSessionStarted` + `mapGatePending` + `mapGateResolved` + `mapPipelineCompleted` + `mapPipelineFailed` | `frontend/src/store/eventMappers.ts` |
| `RuntimeExecution.phases[i].status` | `selectRuntimeExecution` via `projectAgentToPhaseStatus` | `frontend/src/store/workflowSelectors.ts:253-260` |
| `currentAgent` derivation | `selectRuntimeStatus` | `frontend/src/store/runtimeSelectors.ts:299-322` |
| Visible colour / border / icon / badge / animation | `RUNTIME_VISUAL` (single map) | `frontend/src/store/runtimeSelectors.ts:538-611` |
| SessionRail dot colour | local `PHASE_DOT_COLORS` (DRIFT — R-15) | `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:12-20` |

---

## 3. Repair ID → canonical owner → dependency

| R-ID | Drift summary | Canonical owner (per contract) | Dependency chain |
| ---- | ------------- | ------------------------------ | ---------------- |
| **R-25** | `SdlcWorkflowService.toPhaseStatus:1256` reads `phaseData.status` (legacy `Task.status`) instead of canonical `phaseData.executionStatus` | Canonical owner of `pipelinePhases[i].status` is `Task.executionStatus` (per contract §2, §7 forbidden pattern "deriving runtime from `Task.status`") | `Task.executionStatus` (BE) → `getWorkflowStatus` → `toPhaseStatus` (BE) → `getPipelineResponse` → SSE snapshot (`session_started` / `session_resumed`) → FE `mapSessionStarted` → `session.pipelinePhases[i].status` |
| **R-24** | `taskLifecycle.publishLifecycle:90` emits `role: null` instead of `role: task.type` | Canonical owner of lifecycle envelope `role` is `task.type` (per contract §4.1.3–4.1.6, §7 forbidden pattern "`role: null` on lifecycle envelopes", AC-08) | `taskLifecycle.transition` → `publishLifecycle` → `publishEvent` → SSE bus → FE mapper (`mapTaskStarted` / `mapTaskCompleted` / `mapTaskFailed` / `mapTaskInterrupted`) → `session.agentStates[i].status` |
| **R-23** | `mapTaskStarted` / `mapTaskCompleted` / `mapTaskFailed` / `mapTaskInterrupted` (`eventMappers.ts:215-292`) update `agentStates` but NOT `pipelinePhases` | Canonical owner of `pipelinePhases[i].status` patch is per-event lifecycle mapper (per contract §8 invariant 14, §7 forbidden pattern "frozen snapshot for runtime transitions", AC-15) | Wire envelope (carries `role`) → FE mapper → `session.pipelinePhases[i].status` + `session.agentStates[i].status` |
| **R-15** | `SessionRail.tsx:12-20` declares local `PHASE_DOT_COLORS` that duplicates `RUNTIME_VISUAL` colour mapping | Canonical owner of colour mapping is `RUNTIME_VISUAL` (per contract §7 forbidden pattern "duplicated CSS mapping", AC-13 / §5.2.2 cross-page identity) | `RUNTIME_VISUAL` (single source) → consumer surfaces. SessionRail currently bypasses and declares its own map. |

---

## 4. Detailed trace per Repair ID

### 4.1 R-25 — Legacy `phaseData.status` usage

**Producer → Transport → Store → Projection → UI → Consumer**

| Layer | Evidence (file:line) | Current | Canonical (per contract) |
| ----- | -------------------- | ------- | ------------------------ |
| **Producer (BE)** | `backend/src/services/workflowQueries.js:145-149` | `architecture: architectureTask ? { taskId, status: architectureTask.status, versionStatus } : null` | Must read `executionStatus` from the task (canonical machine) |
| **Transport (BE)** | `backend/src/services/SdlcWorkflowService.js:1235` (`getWorkflowStatus(sessionId, user)`) | calls `getWorkflowStatus` and consumes `legacyStatus.phases.{agent}` | Same call signature, must source from `executionStatus` |
| **Projection (BE)** | `backend/src/services/SdlcWorkflowService.js:1253-1265` (`toPhaseStatus`) | `let status = phaseData.status` (legacy) | Must read `phaseData.executionStatus` |
| **Wire envelope (SSE)** | `backend/src/controllers/SdlcController.js:367-378` (`session_started` snapshot) | publishes `pipelinePhases: initialPipeline.pipelinePhases` (the legacy-projected array) | Same payload shape, but each `pipelinePhases[i].status` should be the canonical-machine projection |
| **Store (FE)** | `frontend/src/store/eventMappers.ts:199-208` (`mapSessionStarted`) | `pipelinePhases: (pipelinePhases as SessionState['pipelinePhases']) ?? state.pipelinePhases` | Same — receives the canonical-projected snapshot |
| **FE Projection** | `frontend/src/store/runtimeSelectors.ts:103-127` (`projectAgentToPhaseStatus`) | reads `session.pipelinePhases[i].status` | unchanged |
| **UI** | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx:244-265`; `frontend/src/pages/SdlcDashboard/index.tsx:300-380` | reads via `selectAgentPhaseStatus` | unchanged |
| **Consumer (visible)** | Same as UI | Same | Same |

**Impact (with evidence):**

- The SSE snapshot publishes `pipelinePhases[i].status = 'pending'` even when the canonical `Task.executionStatus === 'running'`, because `agentDispatcher.runAgent:312` writes `Task.status = 'processing'` (legacy) but `taskLifecycle.transition` writes `Task.executionStatus = 'running'` (canonical).
- The FE's `RUNTIME_VISUAL` does NOT have an entry for `'processing'`. The pipeline strip falls back to dim gray (`RUNTIME_VISUAL['pending'].background`) at SSE connect until the per-event `agent_event` envelope (from T6 commit, `9965ac0`) updates `agentStates[i].status`. The canonical projection (`projectAgentToPhaseStatus`) reads `agentStates[i].status === 'running'` for the `awaiting_review` promotion but NOT for plain `'running'` (per `runtimeSelectors.ts:115`, promotion only fires for `awaiting_review`).
- **Visible failure mode**: When a user opens the build page, the SSE snapshot shows the agent as `pending` (dim gray) until the agent's first `agent_event` envelope arrives. This is the OBS-01 drift D-1 documented in `phase1-runtime-observability/03_DRIFT_ANALYSIS.md` and `06_IMPLEMENTATION_CHECKLIST.md` §OBS-01.1.b.

**Canonical (target) state after R-25 fix:**

- `toPhaseStatus` reads `phaseData.executionStatus` and maps to the FE-visible `PhaseStatus` value:
  - `queued` → `'pending'`
  - `dispatched` → `'pending'` (reserved; dormant in current source)
  - `running` → `'running'`
  - `awaiting_gate` → `'gate_pending'`
  - `completed` → `'completed'`
  - `failed` → `'failed'`
  - `cancelled` → `'skipped'`
  - `timeout` → `'skipped'`
- The `awaitingReview` promotion (line 1257: `if (phaseData.awaitingReview) status = 'gate_pending'`) MUST be preserved — it is the canonical way to project the output_review gate (per contract §4 evidence gaps "gated vs ungated output_review").

**Risk / regression:**

- The legacy `phaseData.status` may still hold values the canonical `executionStatus` does NOT carry (e.g., `'processing'`, `'PENDING_TOOL_APPROVAL'`). The fix MUST read `executionStatus` first, fall back to `status` ONLY if `executionStatus` is null (defensive — not strictly required because schema default is `'queued'`).
- `versionStatus` projection (line 1258 includes `awaitingReview`) must remain.

---

### 4.2 R-24 — Lifecycle envelope `role` drift

**Producer → Transport → Store → Projection → UI → Consumer**

| Layer | Evidence (file:line) | Current | Canonical (per contract) |
| ----- | -------------------- | ------- | ------------------------ |
| **Producer (BE)** | `backend/src/services/taskLifecycleService.js:78-93` (`publishLifecycle`) | `role: null` (line 90) | `role: task.type` |
| **Wire envelope** | `backend/src/services/taskLifecycleService.js:88-92` (`publishEvent(...)`) | envelope carries `role: null` | envelope carries `role: task.type` |
| **Transport (SSE)** | `backend/src/services/eventBus.js` (`publish`) + `backend/src/controllers/SdlcController.js:299-303` (`sendEnvelope`) | forwards envelope verbatim | unchanged — replay must remain byte-for-byte (per contract AC-18) |
| **Store (FE)** | `frontend/src/store/eventMappers.ts:34-37` (`inferAgentKey(role)`) | returns `null` if `role` is null, mapper early-returns `{ lastUpdatedAt: Date.now() }` | receives `role: task.type`, mapper updates `agentStates[agentKey]` AND `pipelinePhases[i].status` |
| **FE mapper** | `frontend/src/store/eventMappers.ts:215-292` | `mapTaskStarted` / `mapTaskCompleted` / `mapTaskFailed` / `mapTaskInterrupted` | updated by R-24 to receive the agent, AND by R-23 to patch both fields |
| **Projection** | `frontend/src/store/runtimeSelectors.ts:299-322` (`selectRuntimeStatus`) | reads `agentStates[i].status` directly for `currentAgent` derivation | unchanged |
| **UI** | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx:271-303`; `frontend/src/pages/SdlcDashboard/index.tsx:293-380` | reads via canonical selector | unchanged |
| **Consumer** | Same | Same | Same |

**Impact (with evidence):**

- Today: The FE mapper `mapTaskStarted:215-227` calls `inferAgentKey(env.role)`. With `env.role === null`, `AGENT_TO_ROLE[null]` is undefined → `inferAgentKey` returns `null` → mapper early-returns without updating `agentStates`. The mapper is effectively a no-op for the canonical lifecycle envelopes.
- Today: `agentStates[i].status` is updated in practice only by the `agent_event` envelope path (T6 commit, `9965ac0`): `mapAgentEvent` calls `applyAgentRuntime` (line 168-189) which uses `payload.agent` (the FE-side `AgentKey`, not the wire `role`).
- **Visible failure mode**: If the BE stops emitting `agent_event` envelopes (or they arrive out-of-order with `task_*` envelopes), the `agentStates[i].status` for an agent is stale.
- **Contract violation**: §4.1.3–4.1.6 require `role: task.type` on lifecycle envelopes; §7 forbidden pattern "`role: null` on lifecycle envelopes"; AC-08 ("Every lifecycle envelope MUST carry `role: task.type`").

**Canonical (target) state after R-24 fix:**

- `publishLifecycle` passes `role: task.type` (where `task.type` is e.g. `'po-agent'`, `'dev-agent'`).
- Note: `backend/src/controllers/SdlcController.js:369` (session_started / session_resumed) and `SdlcWorkflowService.js:510` (runtime_log) and `Task.js:28` (task_created) MAY legitimately carry `role: null` because those are session-level / non-lifecycle envelopes per the contract §4.1.1, §4.1.2, §4.1.13. They are exempt from AC-08.

**Risk / regression:**

- The contract §4.1.13 (`runtime_log`) requires `runtime_log` to be produced by `_recordGateAudit` / `resolveOutputReviewGate`. The `role: null` on `runtime_log` is acceptable because it is a session-level envelope. The fix at `taskLifecycleService.js:90` does NOT change `runtime_log`.
- The wire replay (`SdlcController.js:347-348`) forwards `row.envelope` byte-for-byte. The replay loop MUST still forward the envelope as-is — no change to the replay path.
- Pre-existing tests at `backend/tests/integration/task-lifecycle.test.js:182` and `gateBridge.subscribeProject.test.js:53,73` and `eventBus.test.js:20` pass `role: null` in test fixtures. These tests should still pass after the fix because `publishEvent` accepts `base.role ?? null` (per `eventEnvelope.js:62`). The fix changes the producer (publishLifecycle) to pass `task.type`, NOT the consumer signature.

---

### 4.3 R-23 — Lifecycle mapper does not update `pipelinePhases`

**Producer → Transport → Store → Projection → UI → Consumer**

| Layer | Evidence (file:line) | Current | Canonical (per contract) |
| ----- | -------------------- | ------- | ------------------------ |
| **Producer (BE)** | `backend/src/services/taskLifecycleService.js:78-93` (`publishLifecycle`) | emits lifecycle envelope (with `role: null` — see R-24) | unchanged |
| **Wire envelope** | Same | Same | Same (R-24 fixes `role`) |
| **Mapper (FE)** | `frontend/src/store/eventMappers.ts:215-292` | `mapTaskStarted` line 222-226: only patches `agentStates[agentKey].status`. `mapTaskCompleted` line 232-244: only patches `agentStates[agentKey].status`. `mapTaskFailed` line 246-260: only patches `agentStates[agentKey].status`. `mapTaskInterrupted` line 262-276: only patches `agentStates[agentKey].status`. | must ALSO patch `pipelinePhases` array: `pipelinePhases: state.pipelinePhases.map((p) => p.agent === agentKey ? { ...p, status: <canonical> } : p)` |
| **Store (FE)** | `frontend/src/store/useWorkflowStore.ts` + `applyEnvelope` (`eventMappers.ts:338-342`) | `agentStates` updated; `pipelinePhases` frozen | both updated per envelope |
| **FE Projection** | `frontend/src/store/runtimeSelectors.ts:103-127` (`projectAgentToPhaseStatus`) | reads `pipelinePhases[i].status` (the field being patched) | unchanged — but now sees canonical projection |
| **UI** | Same | Same | Same — now sees correct values per-event |
| **Consumer** | Same | Same | Same |

**Impact (with evidence):**

- Today: `session.pipelinePhases[i].status` is set ONCE by `mapSessionStarted` (the SSE snapshot seed) and frozen thereafter. Direct readers of `pipelinePhases` (none exist post-cleanup per Phase 5 §11.3) would see stale data. The visible UI is correct because the canonical projection reads `agentStates[i].status` (per `runtimeSelectors.ts:111-117`).
- The contract §8 invariant 14 is violated: "The `pipelinePhases` array MUST be initialized to all-`'pending'` and MUST be updated ONLY by `mapSessionStarted` (seed) or by per-event lifecycle mappers (per-event patches)." Currently only the seed path writes.
- AC-15 violated.

**Canonical (target) state after R-23 fix:**

- Each per-event lifecycle mapper writes BOTH:
  - `agentStates: { ...state.agentStates, [agentKey]: { ...state.agentStates[agentKey], status: <canonical>, ... } }` (existing behaviour)
  - `pipelinePhases: state.pipelinePhases.map((p) => p.agent === agentKey ? { ...p, status: <phaseStatus> } : p)` (NEW)
- Where `<phaseStatus>` for each mapper:
  - `mapTaskStarted`: `pipelineStatus` from the envelope `to` field (or default `'running'` if missing)
  - `mapTaskCompleted`: `'completed'`
  - `mapTaskFailed`: `'failed'`
  - `mapTaskInterrupted`: `'skipped'` (covers both `'cancelled'` and `'timeout'` per FE enum)

**Risk / regression:**

- The visible UI is unchanged (canonical projection compensates). The patch makes the invariant explicit in code rather than relying on the selector's `agentStates`-aware promotion rule.
- If the agent-key resolution fails (`inferAgentKey(env.role)` returns `null` — see R-24), the mapper early-returns without patching anything. R-23 alone does NOT fix that gate; R-24 is the prerequisite.
- The test `runtimeSelectors.test.ts:546-617` ("integration with workflowSelectors") asserts `selectRuntimeExecution.phases[i].status === projectAgentToPhaseStatus(session, i)` for every agent. This must still pass after the fix.
- The cross-page identity test (`runtimeSelectors.test.ts:628-702`) must still pass.

---

### 4.4 R-15 — Duplicate `PHASE_DOT_COLORS`

**Producer → Transport → Store → Projection → UI → Consumer**

| Layer | Evidence (file:line) | Current | Canonical (per contract) |
| ----- | -------------------- | ------- | ------------------------ |
| **Producer (FE)** | `frontend/src/store/runtimeSelectors.ts:103-127` (`projectAgentToPhaseStatus`) | returns `PhaseStatus` value | unchanged |
| **Store (FE)** | `frontend/src/store/useWorkflowStore.ts` | pipelinePhases + agentStates | unchanged |
| **FE Projection** | `frontend/src/store/runtimeSelectors.ts:625-628` (`getRuntimeVisual`) | returns the canonical `RuntimeVisualStyle` | unchanged |
| **UI consumer (drift)** | `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:12-20` | declares local `PHASE_DOT_COLORS: Record<PhaseStatus, string>` with values distinct from `RUNTIME_VISUAL[*].background` (e.g., `running → 'bg-blue-500 text-white'` vs canonical `running.background = 'bg-blue-500/20 text-blue-300'`) | must consume `RUNTIME_VISUAL[status].background` (or equivalent) |
| **UI usage** | `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:184-201` | `<span className={`flex items-center justify-center rounded text-[8px] font-bold ${PHASE_DOT_COLORS[status]}`} title={`${k} · ${status}`}>{k}</span>` | `<span className={`flex items-center justify-center rounded text-[8px] font-bold ${getRuntimeVisual(status).background}`} …>{k}</span>` |

**Impact (with evidence):**

- SessionRail per-agent dots render with `bg-blue-500 text-white` (saturated blue, white text) for `running`, while Dashboard pipeline strip + Agent Task card render with `bg-blue-500/20 text-blue-300` (transparent blue, blue-300 text). The palettes differ — visible to the user as a different "blue".
- Contract §5.2.2 cross-page identity ("Dashboard pipeline strip, Agent Task card, and SessionRail dot MUST agree byte-for-byte") is violated.
- AC-13 ("Dashboard, Agent Task, and Inspector MUST NEVER disagree") — Inspector doesn't render agent-state visuals per §5.1.5, but SessionRail dots are a per-agent visual surface.
- §7 forbidden pattern: "Duplicated CSS mapping" — "No two components may declare the same colour → state mapping. The single source is `COLUMN_BORDER` at `frontend/src/pages/SdlcDashboard/index.tsx:76-83`" (the column border has been removed; the canonical source is now `RUNTIME_VISUAL` per Phase 4).

**Canonical (target) state after R-15 fix:**

- `PHASE_DOT_COLORS` deleted from `SessionRail.tsx`.
- SessionRail per-agent dot rendering reads `getRuntimeVisual(status).background` (or a thin alias) instead.
- OR — alternative: SessionRail declares a per-state DOT shape on the canonical map (e.g., `RUNTIME_VISUAL_DOT[status].dotClass`) so the SessionRail dot's visual is centrally owned. The simpler path is to read `.background` directly.

**Risk / regression:**

- The SessionRail dot's visual will change colour (from saturated `bg-blue-500 text-white` to muted `bg-blue-500/20 text-blue-300`). The visual will become consistent with Dashboard pipeline strip + Agent Task card.
- The `title` attribute on each dot carries `${k} · ${status}` — unchanged.
- The SessionRail SessionCard's status badge (`STATUS_BADGE[session.status]`, line 31-38) is session-level, NOT per-agent. It is out of scope (session-level visuals are not covered by the per-agent runtime contract).

---

## 5. Cross-cutting invariants (per contract §8)

| Invariant | After all 4 patches |
| --------- | ------------------- |
| 1. One runtime state source per agent | ✓ — `runtimeSelectors.ts` |
| 5. Every lifecycle envelope `role == task.type` | ✓ — R-24 |
| 14. `pipelinePhases` updated ONLY by `mapSessionStarted` (seed) or per-event lifecycle mappers | ✓ — R-23 |
| 17. `pipelinePhases` array MUST be initialized to all-`'pending'` | ✓ — `defaultPipelinePhases()` (`SessionState.ts:131-133`) |
| 20. Tailwind theme tokens single source | ✓ — R-15 (single `RUNTIME_VISUAL[*].background`) |

---

## 6. Dependency graph between Repair IDs

```
   R-25 (BE snapshot → canonical executionStatus)
       │
       │  fixes SSE snapshot source for pipelinePhases[i].status
       │  so the FE seed (mapSessionStarted) sees canonical state
       │
       ▼
   (FE receives canonical seed)
       │
       ▼
   R-24 (BE publishLifecycle → role: task.type)
       │
       │  fixes wire envelope so FE mapper can resolve agentKey
       │
       ▼
   (FE mapper receives valid role)
       │
       ▼
   R-23 (FE mapper → patches pipelinePhases + agentStates)
       │
       │  makes the canonical projection explicit in store
       │
       ▼
   (per-event lifecycle updates pipelinePhases + agentStates)
       │
       ▼
   R-15 (FE SessionRail → canonical RUNTIME_VISUAL.background)
       │
       │  removes duplicate colour mapping; cross-page identity holds
       │
       ▼
   (visible UI consistent across Dashboard / Agent Task / SessionRail)
```

**Prerequisite chain**: R-25 → R-24 → R-23 → R-15 (R-25 first because it fixes the SSE seed; R-24 then enables FE mapper propagation; R-23 then makes the invariant explicit; R-15 is independent and can land any time but logically last).

**Independent**: R-15 has no functional dependency on the other three (it's a pure FE refactor).

---

## 7. Comparison: Current implementation vs Canonical Runtime Contract

### 7.1 R-25 — `SdlcWorkflowService.toPhaseStatus`

| Aspect | Current | Canonical (contract §7, §8 inv. 1, §2 ownership row `Task.executionStatus`) | Evidence |
| ------ | ------- | ----------------------------------------------------------------------- | -------- |
| Source field | `phaseData.status` (legacy `Task.status`) | `phaseData.executionStatus` (canonical `Task.executionStatus`) | `SdlcWorkflowService.js:1256` |
| Owner | `SdlcWorkflowService.toPhaseStatus` reads legacy | Same owner, but reads canonical | unchanged |
| Wire envelope | `session_started` carries the projected value | Same | unchanged |
| Effect on snapshot | `pipelinePhases[i].status` may be `'processing'` (legacy writer) instead of `'running'` | `pipelinePhases[i].status` derived from canonical machine | `agentDispatcher.runAgent:312` writes legacy `'processing'`; `taskLifecycle.transition:130` writes canonical `'running'` |

**Verdict**: Contract violation confirmed by evidence. R-25 fix required.

### 7.2 R-24 — `taskLifecycle.publishLifecycle`

| Aspect | Current | Canonical (contract §4.1.3–4.1.6, §7 forbidden "`role: null`", AC-08, §8 inv. 5) | Evidence |
| ------ | ------- | ----------------------------------------------------------------------- | -------- |
| `base.role` value | `null` (line 90) | `task.type` | `taskLifecycleService.js:90` |
| Wire discriminator | `task_started` / `task_completed` / `task_failed` / `task_interrupted` | Same | unchanged |
| Consumer | FE mapper `inferAgentKey(env.role)` returns `null`, mapper early-returns | FE mapper resolves agentKey, updates store | `eventMappers.ts:34-37` |
| Effect | `agentStates[i].status` not updated by canonical lifecycle path (mitigated by `agent_event` envelope from T6 commit) | `agentStates[i].status` updated by canonical lifecycle path | `agent_event` mapper `eventMappers.ts:168-189` |

**Verdict**: Contract violation confirmed by evidence. R-24 fix required.

### 7.3 R-23 — Per-event lifecycle mappers

| Aspect | Current | Canonical (contract §7 forbidden "frozen snapshot", §8 inv. 14, AC-15) | Evidence |
| ------ | ------- | ----------------------------------------------------------------------- | -------- |
| `mapTaskStarted` write | `agentStates` only | both `agentStates` + `pipelinePhases` | `eventMappers.ts:215-227` |
| `mapTaskCompleted` write | `agentStates` only | both | `eventMappers.ts:229-244` |
| `mapTaskFailed` write | `agentStates` only | both | `eventMappers.ts:246-260` |
| `mapTaskInterrupted` write | `agentStates` only | both | `eventMappers.ts:262-276` |
| Effect on visible UI | correct (selector compensates via `agentStates`) | correct + invariant satisfied in code | `runtimeSelectors.ts:103-127` |

**Verdict**: Contract violation confirmed by evidence. R-23 fix required.

### 7.4 R-15 — `PHASE_DOT_COLORS`

| Aspect | Current | Canonical (contract §7 forbidden "duplicated CSS mapping", §5.2.2 cross-page identity, AC-13) | Evidence |
| ------ | ------- | ----------------------------------------------------------------------- | -------- |
| Mapping | local `PHASE_DOT_COLORS: Record<PhaseStatus, string>` in `SessionRail.tsx:12-20` | single source `RUNTIME_VISUAL` | `runtimeSelectors.ts:538-611` |
| Effect on SessionRail dot | saturated palette (`bg-blue-500 text-white`) | muted palette (`bg-blue-500/20 text-blue-300`) | `SessionRail.tsx:194` |

**Verdict**: Contract violation confirmed by evidence. R-15 fix required.

---

## 8. Constraint compliance check (per brief §"Coding constraints")

Each fix below is bounded to the minimum required:

| Fix | Constraints satisfied? |
| --- | --------------------- |
| R-25 | ✓ — reads same field (`phaseData.executionStatus` instead of `phaseData.status`); no API change; no SSE contract change; no DTO change; no schema change (column exists) |
| R-24 | ✓ — changes one literal `null` to `task.type`; no API change; no SSE contract change; no DTO change; no schema change |
| R-23 | ✓ — adds one `pipelinePhases` patch per existing per-event mapper; no selector change; no store ownership change; no projection change |
| R-15 | ✓ — deletes local map; reads existing `getRuntimeVisual` accessor; no new export; no selector change |

---

## 9. Non-goals (per brief)

- ✗ Not touching OBS-02.
- ✗ No new features.
- ✗ No refactor.
- ✗ No cleanup beyond R-15's local map deletion.
- ✗ No optimization.
- ✗ No other Repair IDs.

---

## 10. References

- `docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md`
- `docs/OBS1/phase1-runtime-observability/05_CANONICAL_RUNTIME_STATE.md`
- `docs/OBS1/phase1-runtime-observability/06_IMPLEMENTATION_CHECKLIST.md`
- `docs/OBS1/PHASE5-verification/01_VERIFICATION_REPORT.md`
- `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md`
- `docs/OBS1/PHASE4-runfix/FIX_REPORT_OBS_01_*.md` (Patch reports 01–09)
- `frontend/src/store/runtimeSelectors.ts`
- `frontend/src/store/eventMappers.ts`
- `frontend/src/store/workflowSelectors.ts`
- `frontend/src/pages/SdlcDashboard/OverviewPage.tsx`
- `frontend/src/pages/SdlcDashboard/index.tsx`
- `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx`
- `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx`
- `backend/src/services/taskLifecycleService.js`
- `backend/src/services/SdlcWorkflowService.js`
- `backend/src/services/gateBridge.js`
- `backend/src/services/workflowQueries.js`
- `backend/src/controllers/SdlcController.js`
- `backend/src/dto/eventEnvelope.js`
- `backend/src/models/Task.js`

End of OBS-01.10 analysis (Bước 1).