# 07 — Canonical Runtime Contract

> **Status:** CANONICAL CONTRACT.
> SINGLE SOURCE OF TRUTH for runtime visualization.
>
> This document is NOT implementation. It is the contract that
> future implementations MUST conform to.
>
> Where this document and any other document disagree,
> this document wins.
>
> Every claim below cites a repository evidence line. Where
> evidence is missing the document writes
> "Evidence not found." — it does not infer.

---

## 1. Purpose

### 1.1 Why runtime visualization exists

The AIFA control plane runs five sequential agents (Architecture
→ PO → UX → DEV → QA → Release) per project session. A human
operator must observe the progress of each agent in real time
so that:

- pending human gates can be answered;
- failed runs can be diagnosed;
- the live state of the pipeline can be verified without
  polling the database.

The runtime visualization is the only surface through which
the operator observes the pipeline.

### 1.2 Why multiple sources caused drift

The repository contains FOUR co-existing sources of "what is
this agent doing right now":

| Field | Owner (current source) | Reference |
| ----- | ---------------------- | --------- |
| `Task.executionStatus` | `taskLifecycleService.TRANSITIONS` | `backend/src/services/taskLifecycleService.js:11-21` |
| `Task.status` | 8 direct writers; not state-machine governed | `backend/src/models/Task.js:39` |
| `pipelinePhases[i].status` | Snapshot of `Task.status` at SSE connect | `backend/src/services/SdlcWorkflowService.js:1256`; `frontend/src/store/eventMappers.ts:199-208` |
| `agentStates[i].status` | FE-only, dormant for canonical lifecycle path | `frontend/src/store/eventMappers.ts:215-292` |

Each consumer reads a different field. The result: the visible
UI is incorrect because the four sources drift apart after the
first SSE connect. See `docs/runtime-observability/03_DRIFT_ANALYSIS.md`
for the full drift catalogue.

### 1.3 Why this contract exists

This contract exists to:

1. designate exactly ONE owner per observable state;
2. define exactly ONE canonical state machine;
3. define exactly ONE wire contract for runtime events;
4. forbid the patterns that produced the current drift;
5. give future implementations a conformance target that is
   independent of any single module's current implementation.

Future implementations MUST conform to this contract. The
contract is the authority over every document in
`docs/runtime-observability/` and over the R-047 / OBS-01 backlog
entries.

---

## 2. Canonical Ownership

The contract enforces: **no state has two producers; no state
has two consumers that read different fields for the same
purpose.**

| Object | Owner | Evidence |
| ------ | ----- | -------- |
| `Task.executionStatus` | **Backend workflow engine** (`taskLifecycleService.transition` / `transitionIfPresent`) | `backend/src/services/taskLifecycleService.js:95-141` |
| `Task.status` (legacy) | **Backend workflow** — listed here for completeness only; MUST NOT be read for runtime visualization | `backend/src/models/Task.js:39`; `backend/src/services/agentDispatcher.js:312`; `backend/src/services/SdlcWorkflowService.js:1356, 2026, 1718` |
| `Task.versionStatus` | **Backend workflow** (`Task.commitTask`) | `backend/src/models/Task.js:214-220` |
| `PendingGate.id` (approvalId) | **GateBridge** | `backend/src/services/gateBridge.js:52` |
| `PendingGate.kind` | **GateBridge** (`requestGate`) | `backend/src/services/gateBridge.js:51-83` |
| `PendingGate.role` | **Agent Dispatcher** — passed at `requestGate` time by the calling code (e.g. `_saveAgentData`) | `backend/src/services/gateBridge.js:51-83`; `backend/src/services/SdlcWorkflowService.js:559-577, 2071-2087` |
| `PendingGate.type` | **Gate Factory** (`toGateType(role, kind)`) | `backend/src/services/toGateType.js` (referenced by `gateBridge.js:122`) |
| `PendingGate.payload` | **Agent Dispatcher / SdlcWorkflowService** — passed at `requestGate` time | `backend/src/services/gateBridge.js:85`; `backend/src/services/SdlcWorkflowService.js:559-577, 2071-2087` |
| `PipelineSession.status` | **Backend workflow** (`PipelineSession.update`) | `backend/src/services/SdlcWorkflowService.js:558`; `backend/src/services/releaseManager.js:168` |
| `HitlDecision.action` | **Structured HITL API** (`submitStructuredDecision`, `_autoApproveSafeOutput`) | `backend/src/services/SdlcWorkflowService.js:264-336, 2123-2162` |
| `RuntimeEvent` (canonical envelope) | **publishEvent** — the single facade | `backend/src/services/eventPublisher.js:17-28` |
| `AgentEvent.envelope` (persisted row) | **taskLifecycleService.appendEvent** (via `transition` / `record`) | `backend/src/services/taskLifecycleService.js:57-69` |
| `AgentEvent.sequence` | **sequenceService.next** — the single sequence source | `backend/src/services/sequence.js:42-49` (referenced by `eventPublisher.js:24`) |
| SSE transport | **eventBus.publish** + **SdlcController.streamPipelineStatus** | `backend/src/services/eventBus.js`; `backend/src/controllers/SdlcController.js:286-406` |
| SSE replay | **AgentEvent.list** + replay loop in `streamPipelineStatus` | `backend/src/controllers/SdlcController.js:340-357`; `backend/src/models/AgentEvent.js` |
| `SessionState.status` (FE) | **Reducer family** (`mapSessionStarted`, `mapGatePending`, `mapPipelineCompleted`, etc.) | `frontend/src/store/eventMappers.ts:199-336` |
| `SessionState.pipelinePhases[i].status` (FE) | **Reducer family** — written ONLY by `mapSessionStarted` (initial seed) and by OBS-01 lifecycle mappers (per-event patches) | `frontend/src/store/eventMappers.ts:199-208, 215-292` |
| `SessionState.agentStates[i].status` (FE) | **Reducer family** — written by lifecycle mappers + `mapGatePending` | `frontend/src/store/eventMappers.ts:100-130, 215-292` |
| `SessionState.runtimeEvents` (FE) | **Reducer family** — written by `mapAgentEvent` | `frontend/src/store/eventMappers.ts:168-190` |
| `AgentCard` view-model | **Frontend projection only** (`selectRuntimeExecution`) | `frontend/src/store/workflowSelectors.ts:216-317` |
| `PhaseStatus.status` (visible) | **Frontend projection only** (`selectRuntimeExecution.phases`) | `frontend/src/store/workflowSelectors.ts:247-264` |
| `AgentState.status` (visible) | **Frontend projection only** (read directly for `currentAgent`) | `frontend/src/store/workflowSelectors.ts:224-231` |
| `COLUMN_BORDER` (CSS map) | **Frontend presentation only** — `SdlcDashboard/index.tsx` | `frontend/src/pages/SdlcDashboard/index.tsx:76-83` |
| `TASK_ICON` (CSS map) | **Frontend presentation only** — `SdlcDashboard/index.tsx` | `frontend/src/pages/SdlcDashboard/index.tsx:44-51` |
| `PhaseChip` (CSS map) | **Frontend presentation only** — `SdlcDashboard/index.tsx` | `frontend/src/pages/SdlcDashboard/index.tsx:503-516` |
| `PHASE_DOT_COLORS` (CSS map) | **Frontend presentation only** — `SessionRail.tsx` | `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:8` |
| Color hex / Tailwind class names | **Tailwind theme tokens** (project-wide). No component owns a hardcoded colour string. | `frontend/src/index.css` / `frontend/src/theme/` |

**No duplicated ownership.** If a future implementation requires
two writers for one object, the contract is violated and the
implementation MUST be rejected.

---

## 3. Runtime State Machine

ONE canonical state machine. Every runtime visualization MUST
project from this machine.

```
                 ┌──────────────────────────────────────────┐
                 │                                          │
                 │              ┌────────────┐              │
                 ▼              │            │              ▼
   ┌──────────┐  queued   ┌──────────┐  failed  ┌──────────┐
   │  Idle    │ ────────► │ Dispatched│ ────────►│ Failed   │
   │ (initial │           │ (reserved)│         │ (terminal)│
   │  only)   │           └────┬──────┘         └──────────┘
   └──────────┘                │                     ▲
                               ▼                     │
                         ┌──────────┐                │
                         │ Running  │ ───────────────┤
                         └────┬─────┘                │
                              │                      │
            ┌─────────────────┼────────────────┐     │
            ▼                 ▼                ▼     │
      ┌───────────┐     ┌───────────┐    ┌───────────┐
      │ Waiting   │     │ Completed │    │ Cancelled │
      │  Human    │     │ (terminal)│    │ (terminal)│
      └─────┬─────┘     └───────────┘    └───────────┘
            │
            ▼
      (Waiting Human → Running via resolve)
```

### 3.1 Allowed transitions (canonical matrix)

| From | To | Producer | File:line |
| ---- | -- | -------- | --------- |
| `idle` | `queued` | `useWorkflowStore` initial state (FE-only; never reaches backend) | `frontend/src/models/SessionState.ts:113-129` |
| `queued` | `running` | `taskLifecycle.transition(taskId, 'running', …)` called from `agentDispatcher.runAgent` | `backend/src/services/taskLifecycleService.js:13`; `backend/src/services/agentDispatcher.js:313` |
| `queued` | `cancelled` | `taskLifecycle.transition(taskId, 'cancelled', …)` called from `cancelTask` | `backend/src/services/SdlcWorkflowService.js:1718-1719` |
| `running` | `waiting_human` | `taskLifecycle.transitionIfPresent(taskId, 'awaiting_gate', …)` called from `gateBridge.requestGate` (for `kind ∈ {'tool', 'question'}`) | `backend/src/services/gateBridge.js:115-119` |
| `running` | `completed` | `taskLifecycle.transitionIfPresent(taskId, 'completed', …)` called from `_saveAgentData` | `backend/src/services/SdlcWorkflowService.js:2041-2044` |
| `running` | `failed` | `taskLifecycle.transition(taskId, 'failed', …)` called from `agentDispatcher.markTaskFailed` | `backend/src/services/agentDispatcher.js:545-548` |
| `running` | `cancelled` | `taskLifecycle.transitionIfPresent(taskId, 'cancelled', …)` called from `cancelTask` | `backend/src/services/SdlcWorkflowService.js:1719` |
| `running` | `timeout` | `taskLifecycle.transition(taskId, 'timeout', …)` called from `handleTaskTimeout` | `backend/src/services/agentDispatcher.js:557-566` |
| `waiting_human` | `running` | `taskLifecycle.transitionIfPresent(taskId, 'running', …)` called from `gateBridge.resolveGate` (for `kind ∈ {'tool', 'question'}`) | `backend/src/services/gateBridge.js:170-174` |
| `waiting_human` | `failed` | `taskLifecycle.transition(taskId, 'failed', …)` | `backend/src/services/taskLifecycleService.js:16` |
| `waiting_human` | `cancelled` | `taskLifecycle.transitionIfPresent(taskId, 'cancelled', …)` | `backend/src/services/taskLifecycleService.js:16` |
| `waiting_human` | `timeout` | `taskLifecycle.transition(taskId, 'timeout', …)` | `backend/src/services/taskLifecycleService.js:16` |

### 3.2 Forbidden transitions

The matrix at `backend/src/services/taskLifecycleService.js:12-21`
forbids every transition not listed in §3.1. Specifically
forbidden:

| From | To | Why |
| ---- | -- | --- |
| `completed` | any non-terminal | terminal; no exits |
| `failed` | any non-terminal | terminal; no exits |
| `cancelled` | any non-terminal | terminal; no exits |
| `dispatched` | `running` (current source does not produce this edge) | reserved; producer absent |
| `dispatched` | `failed` (current source does not produce this edge) | reserved; producer absent |
| `queued` | `dispatched` (current source does not produce this edge) | reserved; producer absent |
| `idle` | any | `idle` is a FE-only initial value; no backend transition writes it |
| `running` | `dispatched` | matrix forbids |
| `waiting_human` | `queued` | matrix forbids |
| `waiting_human` | `dispatched` | matrix forbids |

### 3.3 Producer / consumer table

| State | Producer (who writes) | Consumer (who reads) |
| ----- | ---------------------- | --------------------- |
| `idle` | `emptyAgentStates()` (initial only) | `selectRuntimeExecution` (line 247-264); `OverviewPage.tsx:184-189` |
| `queued` | `Task.create` (`Task.executionStatus = 'queued'`) | `taskLifecycle.transition` |
| `running` | `agentDispatcher.runAgent` → `taskLifecycle.transition('running')` | `selectRuntimeExecution.phases`; `COLUMN_BORDER.running` |
| `waiting_human` | `gateBridge.requestGate` → `taskLifecycle.transitionIfPresent('awaiting_gate')` | `selectRuntimeExecution.phases`; `COLUMN_BORDER.gate_pending`; `mapGatePending` |
| `completed` | `_saveAgentData` → `taskLifecycle.transitionIfPresent('completed')` | `selectRuntimeExecution.phases`; `COLUMN_BORDER.completed`; `getWorkflowStatus` |
| `failed` | `agentDispatcher.markTaskFailed` → `taskLifecycle.transition('failed')` | `selectRuntimeExecution.phases`; `COLUMN_BORDER.failed` |
| `cancelled` | `cancelTask` → `taskLifecycle.transitionIfPresent('cancelled')` | `selectRuntimeExecution.phases`; `COLUMN_BORDER.skipped` (FE projection) |
| `dispatched` (reserved) | Evidence not found. | `taskLifecycle.transition` only. |

---

## 4. Event Contract

ONE wire envelope type: `EventEnvelope`
(`backend/src/dto/eventEnvelope.js:34-45`). All runtime events
travel as `EventEnvelope` instances published via
`publishEvent` (`backend/src/services/eventPublisher.js:17-28`)
and transported via `eventBus.publish`
(`backend/src/services/eventBus.js:18`).

The envelope carries `{ id, sequence, type, timestamp, projectId,
sessionId, taskId, role, payload }`. The `type` discriminator is
constrained to the union at `backend/src/dto/eventEnvelope.js:10-23`
and `frontend/src/dto/event.ts:7-19`.

### 4.1 Per-event contract

#### 4.1.1 `session_started`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `SdlcController.streamPipelineStatus` — initial connect only | 
| Producer (forbidden) | Every other module. The session-start snapshot is the single producer. |
| Consumer (allowed) | FE `mapSessionStarted` (`eventMappers.ts:199-208`) |
| Required payload | `status` (SessionStatus), `pipelinePhases` (PhaseStatus[]), `pendingGates` (GateItem[]), `repoInfo`, `resumedFrom` (number), `log` (string) |
| Optional payload | (none) |
| Emitted by | `SdlcController.streamPipelineStatus:367` (after `getPipelineResponse` returns) |

Evidence: `backend/src/controllers/SdlcController.js:366-378`.

#### 4.1.2 `session_resumed`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `SdlcController.streamPipelineStatus` — reconnect only |
| Producer (forbidden) | Every other module. Reconnect re-uses the snapshot producer. |
| Consumer (allowed) | FE `mapSessionResumed` |
| Required payload | identical to `session_started` |
| Optional payload | (none) |
| Emitted by | `SdlcController.streamPipelineStatus:367` |

Evidence: `backend/src/controllers/SdlcController.js:366`.

#### 4.1.3 `task_started`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `taskLifecycle.publishLifecycle` ONLY. Mapped from lifecycle `task_queued`, `task_dispatched`, or `task_started`. |
| Producer (forbidden) | Every other module. The dispatcher MUST NOT bypass `taskLifecycle.transition` to publish a `task_started` envelope. |
| Consumer (allowed) | FE `mapTaskStarted`. `task-lifecycle.test.js` (existing). |
| Required payload | `{ from, to: 'running' \| 'queued' \| 'dispatched' }` |
| Optional payload | `reason`, plus any keys the caller supplies (e.g. `stage`, `lifecycleType`) |
| Wire `role` (required) | `task.type` (e.g. `'po-agent'`). Contract: NEVER `null`. |
| `taskId` (required) | `task.id` (non-null) |
| Emitted by | `taskLifecycleService.js:78-93` |

Evidence: `backend/src/services/taskLifecycleService.js:23-45, 88-92`.

#### 4.1.4 `task_completed`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `taskLifecycle.publishLifecycle` mapped from `task_completed` lifecycle event. |
| Producer (forbidden) | Every other module. `_saveAgentData` MUST go through `taskLifecycle.transitionIfPresent('completed')`. |
| Consumer (allowed) | FE `mapTaskCompleted` |
| Required payload | `{ from, to: 'completed' }` |
| Optional payload | `reason`, plus caller-supplied keys |
| Wire `role` (required) | `task.type`. NEVER `null`. |
| `taskId` (required) | `task.id` |
| Emitted by | `taskLifecycleService.js:78-93` (after `transitionIfPresent('completed')`) |

Evidence: `backend/src/services/taskLifecycleService.js:28, 119-124`.

#### 4.1.5 `task_failed`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `taskLifecycle.publishLifecycle` mapped from `task_failed` lifecycle event. |
| Producer (forbidden) | Every other module. `markTaskFailed` MUST go through `taskLifecycle.transition`. |
| Consumer (allowed) | FE `mapTaskFailed` |
| Required payload | `{ from, to: 'failed' }` |
| Optional payload | `reason`, `code`, `recoverable`, `numTurns`, `stopReason`, `exitCode`, plus caller-supplied keys |
| Wire `role` (required) | `task.type`. NEVER `null`. |
| `taskId` (required) | `task.id` |
| Emitted by | `taskLifecycleService.js:78-93` (after `transition('failed')`) |

Evidence: `backend/src/services/taskLifecycleService.js:29, 95-141`; `backend/src/services/agentDispatcher.js:545-548`.

#### 4.1.6 `task_interrupted`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `taskLifecycle.publishLifecycle` mapped from `task_cancelled` or `task_timeout` lifecycle events. |
| Producer (forbidden) | Every other module. `cancelTask` and `handleTaskTimeout` MUST go through `taskLifecycle.transition` / `transitionIfPresent`. |
| Consumer (allowed) | FE `mapTaskInterrupted` |
| Required payload | `{ from, to: 'cancelled' \| 'timeout' }` |
| Optional payload | `reason`, plus caller-supplied keys |
| Wire `role` (required) | `task.type`. NEVER `null`. |
| `taskId` (required) | `task.id` |
| Emitted by | `taskLifecycleService.js:78-93` (after `transition` / `transitionIfPresent`) |

Evidence: `backend/src/services/taskLifecycleService.js:30-31, 41-42`.

#### 4.1.7 `task_resumed`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | Reserved for future use. |
| Producer (forbidden) | Every current module (no producer in source). The discriminated union advertises this type but no producer exists. |
| Consumer (allowed) | FE `mapTaskResumed` (registered but never invoked). |
| Required payload | `{ from, to }` (when produced) |
| Optional payload | (none) |
| `taskId` (required) | `task.id` |
| Status | dormant; the contract preserves the type. |

Evidence: `backend/src/dto/eventEnvelope.js:17`; FE mapper
`eventMappers.ts:278-292`.

#### 4.1.8 `gate_pending`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `gateBridge.requestGate` ONLY. |
| Producer (forbidden) | Every other module. `SdlcWorkflowService._saveAgentData` MUST call `gateBridge.requestGate`, not `publishEvent` directly. |
| Consumer (allowed) | FE `mapGatePending`. SSE clients. |
| Required payload | `gate: { id, type, kind, taskId, projectId, role, status: 'pending', payload, createdAt }` |
| Optional payload | (none — every field is required) |
| Wire `role` (required) | the gate's owning agent role (e.g. `'po-agent'`) |
| Side effect | `taskLifecycle.transitionIfPresent(taskId, 'awaiting_gate', …)` for `kind ∈ {'tool', 'question'}` |
| Emitted by | `backend/src/services/gateBridge.js:123-138` |

Evidence: `backend/src/services/gateBridge.js:115-138`.

#### 4.1.9 `gate_resolved`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `gateBridge.resolveGate` ONLY. |
| Producer (forbidden) | Every other module. `releaseManager.submitReleaseDecision` MUST call `gateBridge.resolveGate` for `kind='release'` (current source bypasses; see backlog R-041). |
| Consumer (allowed) | FE `mapGateResolved`. SDK awaiters. |
| Required payload | `gateId, decision, comment, resolvedAt` |
| Optional payload | `taskId` |
| Wire `role` (required) | `rec.role` |
| `taskId` (required) | `rec.taskId` (null only when `kind='release'` and no source task is bound) |
| Emitted by | `backend/src/services/gateBridge.js:180-189` |

Evidence: `backend/src/services/gateBridge.js:154-194`.

#### 4.1.10 `pipeline_completed`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `releaseManager.submitReleaseDecision` (APPROVE branch) ONLY. |
| Producer (forbidden) | Every other module. `SdlcWorkflowService._saveAgentData` MUST NOT emit `pipeline_completed`. |
| Consumer (allowed) | FE `mapPipelineCompleted`. |
| Required payload | `qaResult` |
| Optional payload | `commitSha`, `reportUrl` |
| Wire `role` (required) | `'release'` (per `releaseManager.js:175`) |
| `taskId` (required) | the QA task id (`qaTask.id`) |
| Persistence (required) | `AgentEvent.create({ envelope })` — see backlog R-001 |
| Emitted by | `backend/src/services/releaseManager.js:173-186` |

Evidence: `backend/src/services/releaseManager.js:170-186`.

#### 4.1.11 `pipeline_failed`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | Reserved for future use. |
| Producer (forbidden) | Every current module (no producer in source). |
| Consumer (allowed) | FE `mapPipelineFailed` (registered but never invoked). |
| Required payload | `message` |
| Optional payload | `code`, `statusCode` |
| Status | dormant; the contract preserves the type. |

Evidence: `backend/src/dto/eventEnvelope.js:12`.

#### 4.1.12 `agent_event`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | Reserved for future use. |
| Producer (forbidden) | Every current module (no producer in source). |
| Consumer (allowed) | FE `mapAgentEvent`. |
| Required payload | `type` (one of `'agent_start' \| 'agent_tool_call' \| 'agent_tool_result' \| 'agent_complete' \| 'file_change' \| 'token_usage' \| 'error'`), `agent` (AgentKey), `role` |
| Optional payload | `tool`, `filePath`, `action`, `details`, `error` |
| Status | dormant; preserved for future rich-runtime wire (Phase ≥ OBS-02) |

Evidence: `backend/src/dto/eventEnvelope.js:21`; `frontend/src/dto/event.ts:84-92`; `eventMappers.ts:168-190`.

#### 4.1.13 `runtime_log`

| Property | Value |
| -------- | ----- |
| Producer (allowed) | `SdlcWorkflowService._recordGateAudit`, `SdlcWorkflowService.resolveOutputReviewGate` (auto_commit log). |
| Producer (forbidden) | Every other module. `agentDispatcher.runAgent` MUST NOT emit `runtime_log` directly. |
| Consumer (allowed) | FE `mapRuntimeLog`. Inspector (future). |
| Required payload | `taskId, level, source, message` |
| Optional payload | `meta` |
| `taskId` (optional) | may be null for session-level logs |
| Persistence | partial — `_recordGateAudit` persists; auto_commit logs are live-only |
| Emitted by | `backend/src/services/SdlcWorkflowService.js:1556-1569, 509-518` |

Evidence: `backend/src/services/SdlcWorkflowService.js:1556-1569`.

### 4.2 Cross-event rules

1. Every runtime envelope MUST be allocated by `publishEvent`
   (`backend/src/services/eventPublisher.js`). Direct
   `eventBus.publish` calls from any other module are FORBIDDEN.
2. Every lifecycle envelope's `role` field MUST equal
   `task.type`. NEVER `null`. (See §4.1.3–4.1.6.)
3. Every gate envelope's `role` field MUST equal the gate's
   owning role. NEVER `null`.
4. The wire MUST NOT carry presentation fields (colours, badges,
   animation names, CSS class names, icon names). The wire is
   domain-only.
5. Every envelope MUST carry a non-null `sessionId`. The session-
   bound `sequenceService.next` is the single sequence source.

---

## 5. UI Projection Contract

The runtime visualization MUST project from the canonical
state machine defined in §3. The FE NEVER invents or infers a
state — it only renders the value the BE writes.

The mapping below is the complete projection. No other
mapping is allowed.

### 5.1 Per-state UI contract

#### 5.1.1 `idle`

| Aspect | Value |
| ------ | ----- |
| Badge text | `IDLE` (uppercase). Projected from `'idle'` value. |
| Background | dim gray |
| Border | dim gray (`border-outline-variant/20`) |
| Icon | `PlayCircle` |
| Pulse | none |
| Animation | none |
| Glow | none |
| Text on hover | "Agent not yet started" |

#### 5.1.2 `queued`

| Aspect | Value |
| ------ | ----- |
| Badge text | `QUEUED` (uppercase) |
| Background | dim gray (`bg-surface-container text-on-surface-variant/70`) |
| Border | dim gray (`border-outline-variant/20`) |
| Icon | `PlayCircle` |
| Pulse | none |
| Animation | none |
| Glow | none |

Evidence (target UI map): `SdlcDashboard/index.tsx:44-51, 76-83,
503-516`.

#### 5.1.3 `dispatched` (reserved)

| Aspect | Value |
| ------ | ----- |
| Badge text | `DISPATCHED` |
| Background | dim gray |
| Border | dim gray |
| Icon | `PlayCircle` |
| Pulse | none |
| Animation | none |
| Glow | none |

#### 5.1.4 `running`

| Aspect | Value |
| ------ | ----- |
| Badge text | `RUNNING` (uppercase). Derived from `status.replace('_', ' ')`. |
| Background | blue (`bg-blue-500/20 text-blue-300`) |
| Border | blue (`border-blue-500/30`) |
| Icon | `Loader2` |
| Pulse | **YES** (the `Loader2` icon has class `animate-spin`) |
| Animation | `animate-spin` on the per-task icon |
| Glow | none |

Evidence (target UI map): `SdlcDashboard/index.tsx:44-51, 76-83,
503-516`.

#### 5.1.5 `waiting_human`

| Aspect | Value |
| ------ | ----- |
| Badge text | `WAITING HUMAN` (uppercase; underscore replaced) |
| Background | yellow (`bg-amber-500/20 text-amber-400`) |
| Border | yellow (`border-amber-500/30`) |
| Icon | `Clock` |
| Pulse | none (per-task icon is static) |
| Animation | none (per-task); `animate-pulse` is allowed on session-level indicators only |
| Glow | none |

Evidence (target UI map): `SdlcDashboard/index.tsx:44-51, 76-83,
503-516`.

#### 5.1.6 `completed`

| Aspect | Value |
| ------ | ----- |
| Badge text | `COMPLETED` (uppercase) |
| Background | green (`bg-emerald-500/20 text-emerald-400`) |
| Border | green (`border-emerald-500/20`) |
| Icon | `Check` |
| Pulse | none |
| Animation | none |
| Glow | none |

Evidence (target UI map): `SdlcDashboard/index.tsx:44-51, 76-83,
503-516`.

#### 5.1.7 `failed`

| Aspect | Value |
| ------ | ----- |
| Badge text | `FAILED` (uppercase) |
| Background | red (`bg-red-500/20 text-red-400`) |
| Border | red (`border-red-500/30`) |
| Icon | `AlertCircle` |
| Pulse | none |
| Animation | none |
| Glow | none |

Evidence (target UI map): `SdlcDashboard/index.tsx:44-51, 76-83,
503-516`.

#### 5.1.8 `cancelled`

| Aspect | Value |
| ------ | ----- |
| Badge text | `CANCELLED` (uppercase) |
| Background | dim gray (`bg-outline-variant/30 text-on-surface-variant`) |
| Border | dashed (`border-dashed border-outline-variant/20`) |
| Icon | `SkipForward` |
| Pulse | none |
| Animation | none |
| Glow | none |

Evidence (target UI map): `SdlcDashboard/index.tsx:44-51, 76-83,
503-516`.

### 5.2 Cross-state projection rules

1. Every visible UI value for runtime state MUST be derived
   from the canonical state in §3 via the per-state UI mapping
   in §5.1.
2. Two views of the same canonical state MUST render the SAME
   colour, badge text, icon, and animation. The Dashboard
   pipeline strip, the Agent Task card, and the SessionRail
   dot MUST agree byte-for-byte.
3. The CSS maps (`COLUMN_BORDER`, `TASK_ICON`, `PhaseChip`,
   `PHASE_DOT_COLORS`) are the SINGLE source for colour and
   icon. Components MUST NOT introduce hardcoded colour
   strings outside these maps.
4. The transition source (matrix edge in §3.1) MUST match
   the visible transition (next render after the event).

---

## 6. Synchronization Rules

The contract enforces the following invariants across the
runtime visualization stack.

1. **Frontend NEVER invents runtime state.** The FE MUST NOT
   introduce a state value that the BE has not emitted. If a
   state is not in §3, it MUST NOT be rendered.
2. **Frontend NEVER infers completion.** A state MUST be marked
   `completed` only after the BE emits `task_completed` (or
   `pipeline_completed` at the session level). The FE MUST NOT
   infer completion from a `gate_resolved` envelope, a missing
   envelope, or a session-level signal.
3. **Frontend ONLY projects backend state.** Every visible
   value is a function of `Task.executionStatus` (via the wire
   event stream). The FE MUST NOT derive runtime from
   `PendingGate` alone, from `Task.status` alone, from session
   timestamps, or from any other secondary field.
4. **Backend NEVER sends presentation fields.** The wire
   envelope MUST NOT carry colours, badges, animation names,
   CSS class names, or icon names. (See §4.2 rule 4.)
5. **Backend NEVER sends colors.** No `color`, `bgColour`,
   `cssClass`, `iconName` keys on any envelope.
6. **Backend NEVER sends CSS.** No stylesheet references, no
   Tailwind class strings, no CSS variables on any envelope.
7. **Backend NEVER sends UI state directly.** The backend
   MAY write `status` (the canonical machine value), but the
   FE is responsible for the projection from status to
   visible colour / badge / icon.
8. **SSE replay is byte-for-byte.** The replay loop at
   `SdlcController.streamPipelineStatus:340-357` MUST forward
   `row.envelope` verbatim. The replay MUST NOT mutate,
   re-derive, or re-projection any field.
9. **The session-start snapshot is the only initial seed.**
   No other code path may emit `session_started` or
   `session_resumed` with a `pipelinePhases` payload. The
   per-event mapper for `task_started/completed/failed/interrupted`
   is the only path that updates `pipelinePhases[i].status`
   after the seed.
10. **The wire envelope discriminator union is closed.** No
    event type may be added or removed without amending this
    contract.

---

## 7. Forbidden Patterns

The following patterns created the current drift. They are
FORBIDDEN by this contract.

❌ **Deriving runtime from `PendingGate`.** A gate exists or
   does not; a gate is NEVER the runtime state of an agent.
   The runtime state of an agent is `Task.executionStatus`.

❌ **Deriving runtime from `Task.status` (legacy).** `Task.status`
   is a free-form legacy field. It MUST NOT be read by the
   runtime visualization. The canonical source is
   `Task.executionStatus`.

❌ **Multiple runtime enums.** The discriminated union at
   `backend/src/dto/eventEnvelope.js:10-23` is the single
   source. Adding a second union (e.g. an `AgentState`-keyed
   map) is forbidden.

❌ **Duplicated CSS mapping.** No two components may declare
   the same colour → state mapping. The single source is
   `COLUMN_BORDER` at `frontend/src/pages/SdlcDashboard/index.tsx:76-83`.

❌ **Duplicated color mapping.** No two CSS strings may map
   the same state to the same colour. The single source is
   the Tailwind theme tokens.

❌ **UI guessing `executionStatus`.** The FE MUST NOT compute
   a state from secondary signals (e.g. "the previous state
   was X and the gate resolved, so it must be Y"). The FE
   MUST wait for the explicit lifecycle envelope.

❌ **Hardcoded `"running"`.** The literal string `'running'`
   MUST NOT appear in any component outside the canonical CSS
   maps. Components read the value from the canonical state;
   they do not hardcode it.

❌ **Multi-owner for `PipelinePhase.status`.** Two producers
   writing to the same field on the same store entry is a
   forbidden pattern. The single owner is the reducer
   family; no `setState` call outside the mapper may write
   to `pipelinePhases[i].status`.

❌ **`role: null` on lifecycle envelopes.** The wire envelope
   for `task_started/completed/failed/interrupted/resumed`
   MUST carry `role: task.type`. NEVER `null`.

❌ **Frozen snapshot for runtime transitions.** After the
   initial `session_started` seed, every runtime state
   transition MUST be delivered via a per-event envelope that
   the FE mapper translates to a `pipelinePhases[i].status`
   patch. The snapshot MUST NOT be re-published as a substitute
   for per-event transitions.

❌ **Inline colour string in a component.** Every colour token
   MUST come from the Tailwind theme. Hardcoded hex or RGB
   values inside a JSX `className` are forbidden.

❌ **Reading `Task.status` from the FE store.** The FE store
   does NOT carry `Task.status`. If a future FE feature needs
   legacy task status, it MUST be passed via the wire envelope,
   not by adding `taskStatus` to the SessionState model.

❌ **Adding a new `EventType` to the union without a producer.**
   If a discriminated union member has no producer, it is
   forbidden. (The current union has three such members —
   `pipeline_failed`, `task_resumed`, `agent_event` — which
   are dormant. Future work MAY add a producer, OR MAY amend
   this contract to remove them.)

❌ **Two producers for the same wire event type.** Each
   `EventType` has exactly one producer per §4.1. A second
   producer is forbidden.

❌ **Bypassing `taskLifecycle.transition`.** Direct
   `Task.update({ executionStatus: … })` writes outside
   `taskLifecycle.transition` are forbidden. The state machine
   is the single writer.

❌ **Bypassing `publishEvent`.** Direct `eventBus.publish`
   calls from any module other than `eventPublisher` are
   forbidden.

❌ **State projection duplication.** Two components MUST NOT
   render the same state with different colours or different
   badge text. Every state has exactly one projection.

---

## 8. Required Invariants

The contract is the canonical source of these invariants.
Future implementations MUST preserve them.

1. There MUST be exactly one runtime state source per agent.
   The source is `Task.executionStatus`.

2. There MUST be exactly one wire envelope type per runtime
   event. The type is `EventEnvelope` (see §4).

3. Every runtime event MUST correspond to exactly one backend
   transition. A transition without an event is forbidden;
   an event without a transition is forbidden.

4. Every `EventEnvelope.type` MUST have exactly one producer.
   See §4.1.

5. Every `EventEnvelope.role` on a lifecycle envelope MUST be
   `task.type` (NEVER `null`). See §4.1.3–4.1.6.

6. A `PendingGate` MUST NOT change `executionStatus` directly.
   A `PendingGate` MAY trigger a `taskLifecycle.transition` to
   `'awaiting_gate'` (for `kind ∈ {'tool', 'question'}`), but the
   transition itself MUST go through the state machine.

7. A `gate_resolved` MUST trigger `taskLifecycle.transition` to
   `'running'` (for `kind ∈ {'tool', 'question'}`) ONLY through
   the state machine. The `gate_pending` mapper MUST NOT
   set `agentStates[i].status = 'running'` directly.

8. The FE MUST render every `executionStatus` value in §3. A
   state that has no CSS map entry is a contract violation.

9. Every `executionStatus` MUST have exactly one visual
   representation. The per-state UI mapping in §5.1 is the
   single source.

10. Dashboard, Agent Task, and Inspector MUST NEVER disagree
    on the same input. See §5.2 rule 2.

11. The runtime visualization MUST be SSE-driven. Polling for
    state MUST NOT be used as a substitute for SSE.

12. The wire MUST NOT carry presentation fields. See §4.2
    rule 4 and §6 rule 4.

13. Every `pipelinePhases[i].status` patch MUST be the
    projection of exactly one canonical state. The mapper MUST
    NOT introduce a value that is not in the per-state UI
    mapping in §5.1.

14. The `pipelinePhases` array MUST be initialized to all-
    `'pending'` and MUST be updated ONLY by `mapSessionStarted`
    (seed) or by per-event lifecycle mappers (per-event
    patches). No other reducer may write to `pipelinePhases`.

15. The `agentStates` map MUST be initialized to all-`'idle'`
    and MUST be updated ONLY by per-event lifecycle mappers
    and by `mapGatePending`. No other reducer may write to
    `agentStates`.

16. The `currentAgent` derivation MUST be computed by
    `selectRuntimeExecution` from `agentStates[i].status`. No
    component may compute `currentAgent` independently.

17. The session-level `SessionState.status` MUST be updated by
    `mapGatePending`, `mapGateResolved`, `mapPipelineCompleted`,
    `mapPipelineFailed`, and `mapSessionStarted`. No other
    reducer may write to `session.status`.

18. Every SSE envelope forwarded by the controller MUST be
    byte-for-byte identical to the source envelope. The replay
    loop MUST NOT mutate `row.envelope`.

19. The `AgentCard` (Dashboard pipeline strip, Agent Task
    column, SessionRail dot) MUST derive its colour and badge
    text from the same `PhaseStatus.status` projection. No
    component may introduce a private projection.

20. The Tailwind theme tokens MUST be the single source for
    every colour string. Components MUST NOT introduce
    hardcoded colour strings.

---

## 9. Acceptance Criteria

The contract is COMPLETE when every acceptance criterion below
holds. Phase 4 implementation engineers MUST verify each AC
before declaring OBS-01 complete.

**AC-01** Changing `Task.executionStatus` on the backend MUST
update every Agent Card within one SSE round-trip.

**AC-02** The `waiting_human` state MUST always render with
yellow background, yellow border, and `Clock` icon. There MUST
NOT be any other colour for `waiting_human`.

**AC-03** The `running` state MUST always render with blue
background, blue border, and `Loader2` icon with `animate-spin`.
There MUST NOT be any other colour for `running`.

**AC-04** The `completed` state MUST always render with green
background, green border, and `Check` icon. There MUST NOT be
any other colour for `completed`.

**AC-05** The `failed` state MUST always render with red
background, red border, and `AlertCircle` icon. There MUST NOT
be any other colour for `failed`.

**AC-06** The `cancelled` state MUST always render with dashed
dim border and `SkipForward` icon. There MUST NOT be any other
colour for `cancelled`.

**AC-07** The `idle` and `queued` states MUST always render
with the dim gray default colour and `PlayCircle` icon. There
MUST NOT be any other colour for `idle` or `queued`.

**AC-08** Every lifecycle envelope (`task_started`,
`task_completed`, `task_failed`, `task_interrupted`,
`task_resumed`) MUST carry `role: task.type`. The literal
`null` MUST NOT appear in the `role` field of any canonical
lifecycle envelope.

**AC-09** Every `EventEnvelope.type` MUST have exactly one
producer. No two modules may call `publishEvent` with the same
`type` discriminator for the same logical event.

**AC-10** Every runtime event MUST correspond to exactly one
backend transition. A transition without an event is a contract
violation. An event without a transition is a contract violation.

**AC-11** A `PendingGate` MUST NOT change `executionStatus`
directly. The state machine (`taskLifecycle.transition`) is the
sole writer.

**AC-12** The FE MUST render every `executionStatus` value in
§3. The CSS maps at `SdlcDashboard/index.tsx:44-51, 76-83,
503-516` MUST contain an entry for every canonical state.

**AC-13** Dashboard, Agent Task, and Inspector MUST NEVER
disagree on the same input. For any given `pipelinePhases[i].status`
value, the colour and badge text MUST be identical across
the three surfaces.

**AC-14** No component may derive runtime state independently.
Every component MUST read from `session.pipelinePhases[i].status`
(via `selectRuntimeExecution`) and MUST NOT compute the
visible state from secondary signals.

**AC-15** The `pipelinePhases` array MUST be updated ONLY by
`mapSessionStarted` (initial seed) and by per-event lifecycle
mappers (per-event patches). No other reducer may write to
`pipelinePhases`.

**AC-16** The `agentStates` map MUST be updated ONLY by
per-event lifecycle mappers and by `mapGatePending`. No other
reducer may write to `agentStates`.

**AC-17** The wire envelope MUST NOT carry presentation fields
(colours, badges, animation names, CSS class names, icon
names). The wire is domain-only.

**AC-18** The SSE replay MUST forward `row.envelope` byte-for-
byte. The replay loop MUST NOT mutate, re-derive, or
re-project any field.

**AC-19** The wire envelope discriminator union MUST be the
13-type union at `backend/src/dto/eventEnvelope.js:10-23`. No
type may be added or removed without amending this contract.

**AC-20** No UI component may introduce a hardcoded colour
string outside the Tailwind theme tokens. Every colour MUST
come from the theme.

---

## 10. Relationship with Other Documents

This document is the AUTHORITY. Every other document in
`docs/runtime-observability/` and the R-047 / OBS-01 entries
in `docs/repair-backlog/` MUST be consistent with this contract.
Where any other document disagrees with this contract, this
contract wins.

| Document | Relationship to this contract |
| -------- | ------------------------------ |
| `docs/runtime-observability/01_RUNTIME_STATE_TRACE.md` | Provides the empirical evidence that this contract codifies. Every observation in 01 MUST be consistent with §3 and §5 of this contract. If 01 reports a drift, this contract MUST be re-read against §7 and §8. |
| `docs/runtime-observability/02_FRONTEND_STATE_MAPPING.md` | Documents the current rendering chain. Future implementations MUST conform to §5 of this contract, which is the destination of 02's current chain. |
| `docs/runtime-observability/03_DRIFT_ANALYSIS.md` | Lists the current drifts D-1 through D-9. Each drift is a violation of a rule in §6, §7, or §8. Implementation engineers MUST treat each drift as evidence of a contract violation. |
| `docs/runtime-observability/04_REPAIR_PROPOSAL.md` | The 8-phase implementation order OBS-01.1 through OBS-01.8 is the canonical implementation path that conforms to this contract. The risk assessment in §5 of 04 is bounded by the invariants in §8 of this contract. The rollback plan in §6 of 04 is the contract's safety net. |
| `docs/runtime-observability/05_CANONICAL_RUNTIME_STATE.md` | The state spec. Every row in the mapping table at §3.1 of 05 corresponds to exactly one row in §3 of this contract and exactly one row in §5 of this contract. The per-state UI mapping in §3.1 of 05 MUST agree with §5.1 of this contract byte-for-byte. |
| `docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md` | The per-stage checklist. Every step in OBS-01.1 through OBS-01.8 of 06 is checked against this contract. A step that violates this contract MUST NOT be marked complete. |
| `docs/repair-backlog/01_MASTER_BACKLOG.md` | R-047 is the canonical backlog entry for the runtime visualization drift. R-047 MUST be re-described to reference this contract as the authority. The other R-N entries are independent. |
| `docs/repair-backlog/02_REPAIR_BATCHES.md` | Batch OBS-01 is the canonical batch for R-047. OBS-01 is constrained by this contract: every change that lands in OBS-01 MUST conform to this contract. |
| `docs/repair-backlog/03_DEPENDENCY_GRAPH.md` | The dependency map. OBS-01's "specification documents" listing MUST point to this contract as the authority. |
| `docs/repair-backlog/04_EXECUTION_ORDER.md` and `05_REGRESSION_PLAN.md` | Existing batches' ordering and regression. OBS-01 lands independently of these documents. |

### 10.1 Authority chain

```
07_CANONICAL_RUNTIME_CONTRACT.md      (this document — AUTHORITY)
  │
  ├─► 05_CANONICAL_RUNTIME_STATE.md   (state spec; agrees with §3, §5)
  │     │
  │     └─► 01_RUNTIME_STATE_TRACE.md  (empirical evidence)
  │           │
  │           └─► 02_FRONTEND_STATE_MAPPING.md (current chain)
  │
  ├─► 06_IMPLEMENTATION_CHECKLIST.md (per-stage checklist)
  │
  ├─► 04_REPAIR_PROPOSAL.md           (8-phase implementation order)
  │     │
  │     └─► 03_DRIFT_ANALYSIS.md      (D-1..D-9)
  │
  └─► docs/repair-backlog/            (R-047, Batch OBS-01)
```

Future implementations MUST read this document first, then
05, then 06 and 04. The drift analysis (03) and the trace
documents (01, 02) are evidence — not authority.

### 10.2 Conformance test

A future implementation is conformant if and only if:

- Every AC-01 through AC-20 in §9 holds.
- Every invariant 1 through 20 in §8 holds.
- None of the forbidden patterns in §7 are present in the
  implementation.
- The wire envelopes produced by the implementation match
  §4.1 row-for-row.
- The CSS maps in the implementation match §5.1 row-for-row.
- The state machine in the implementation matches §3 row-for-
  row (allowed and forbidden transitions).

Any single violation is a contract failure. The implementation
MUST be rejected or amended.

---

## Appendix A — Forbidden Patterns (summary list)

```
❌ deriving runtime from PendingGate
❌ deriving runtime from task.status (legacy)
❌ multiple runtime enums (two discriminated unions)
❌ duplicated CSS mapping (two COLUMN_BORDER-style maps)
❌ duplicated color mapping (two colour-token sources)
❌ UI guessing executionStatus
❌ hardcoded "running" (or any state string) in a component
❌ multi-owner for PipelinePhase.status
❌ role: null on a lifecycle envelope
❌ frozen snapshot for runtime transitions
❌ inline colour string in a component
❌ reading Task.status from the FE store
❌ adding a new EventType to the union without a producer
❌ two producers for the same wire event type
❌ bypassing taskLifecycle.transition
❌ bypassing publishEvent
❌ state projection duplication
```

## Appendix B — Conformance Checklist

For each future implementation, the engineer MUST verify:

- [ ] Every wire event type has exactly one producer (§4).
- [ ] Every lifecycle envelope carries `role: task.type` (§4.2).
- [ ] The `taskLifecycle.TRANSITIONS` matrix matches §3.1.
- [ ] The forbidden transitions in §3.2 are not in the
      implementation.
- [ ] Every CSS map at `SdlcDashboard/index.tsx:44-51, 76-83,
      503-516` contains an entry for every state in §3.
- [ ] Dashboard, Agent Task, and Inspector render identical
      colour and badge text for the same state (§5.2 rule 2).
- [ ] No hardcoded colour string appears in any JSX
      `className` outside the canonical CSS maps (§8 invariant
      20, AC-20).
- [ ] The replay loop forwards `row.envelope` byte-for-byte
      (§6 rule 8, AC-18).
- [ ] The SSE snapshot is the only producer of `session_started`
      and `session_resumed` (§4.1.1, §4.1.2, §6 rule 9).
- [ ] Every mapper that writes to `pipelinePhases` or
      `agentStates` is listed in §2 (canonical ownership).
- [ ] Every AC-01 through AC-20 holds.