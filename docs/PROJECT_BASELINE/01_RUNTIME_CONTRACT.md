# 01 — Runtime Contract

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document.
> **Source of truth:** `docs/OBS1/PHASE5.5-freeze/01_FINAL_ARCHITECTURE.md`,
> `docs/OBS1/PHASE5.5-freeze/04_DO_NOT_BREAK.md`.

---

## Canonical Owner

`taskLifecycleService` (BE) → `eventPublisher` (BE) → SSE controller
(BE) → `eventMappers` (FE) → `runtimeSelectors` (FE) → UI consumers (FE).

Producer→consumer chain: `backend/src/services/taskLifecycleService.js`
→ `backend/src/services/eventPublisher.js`
→ `backend/src/controllers/SdlcController.js`
→ `frontend/src/store/eventMappers.ts`
→ `frontend/src/store/runtimeSelectors.ts`
→ `frontend/src/pages/SdlcDashboard/**`.

## Source of Truth

`backend/prisma/schema.prisma:84` — `Task.executionStatus` (canonical
state column).
`backend/src/services/sdlcConstants.js:202-228` — `toPhaseStatus` (the
canonical BE → wire mapping).
`backend/src/dto/eventEnvelope.js:10-23` — the 13-type `EventEnvelope`
discriminated union.
`frontend/src/store/runtimeSelectors.ts:538-611` — `RUNTIME_VISUAL`
(`Object.freeze`d; the canonical visual map).

## Producer

| Field | Producer | File |
| ----- | -------- | ---- |
| `Task.executionStatus` | `taskLifecycle.transition` | `backend/src/services/taskLifecycleService.js:95-141` |
| `EventEnvelope` | `eventPublisher.publishEvent` | `backend/src/services/eventPublisher.js:17-28` |
| `AgentEvent.envelope` | `taskLifecycleService.appendEvent` | `backend/src/services/taskLifecycleService.js:57-69` |
| `AgentEvent.sequence` | `sequenceService.next` | `backend/src/services/sequence.js:42-49` |
| SSE transport | `eventBus.publish` + `SdlcController.streamPipelineStatus` | `backend/src/controllers/SdlcController.js:286-406` |
| `runtimeSelectors` projection | `frontend/src/store/runtimeSelectors.ts` | `frontend/src/store/runtimeSelectors.ts:103-712` |
| `RUNTIME_VISUAL` | `frontend/src/store/runtimeSelectors.ts` | `frontend/src/store/runtimeSelectors.ts:540` (frozen) |

## Consumer

| Consumer | Reads | File |
| -------- | ----- | ---- |
| Dashboard pipeline strip | `PhaseStatus`, `RuntimeVisualStyle` | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx:244-265` |
| Dashboard session monitor | `countCompletedAgents`, `selectRuntimeStatus` | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx:175-302` |
| Agent Task card border + chip | `getRuntimeVisual`, `getRuntimeIcon`, `getRuntimeAnimation` | `frontend/src/pages/SdlcDashboard/index.tsx:293-380` |
| Agent Task SessionPill | session-level status | `frontend/src/pages/SdlcDashboard/index.tsx:396-417` |
| Agent Task summary bar | `countCompletedAgents`, `countTotalAgents` | `frontend/src/pages/SdlcDashboard/index.tsx:419-538` |
| SessionRail per-agent dot | `selectAgentPhaseStatus`, `getRuntimeVisual(.background)` | `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:188-198` |
| Inspector (gates only) | `selectRuntimeExecution` | `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx:47-50` |

## Invariants

The 30 invariants in `docs/OBS1/PHASE5.5-freeze/04_DO_NOT_BREAK.md`
(R-01..R-30) are the complete frozen rule set. The top-level
invariants:

1. One runtime state source per agent (`Task.executionStatus`).
2. One wire envelope type per runtime event (`EventEnvelope`).
3. Every lifecycle envelope carries `role: task.type` (NEVER null).
4. `pipelinePhases` is updated ONLY by `mapSessionStarted` +
   per-event lifecycle mappers.
5. `agentStates` is updated ONLY by per-event lifecycle mappers +
   `mapGatePending`.
6. `session.status` is updated ONLY by the 5 listed mappers.
7. SSE replay forwards `row.envelope` byte-for-byte (no mutation).
8. Wire carries no presentation fields (no colour / badge / icon /
   animation on the wire).
9. `RUNTIME_VISUAL` is `Object.freeze`d at module load.
10. Cross-page identity (Dashboard ≡ Agent Task ≡ SessionRail dot).

## Forbidden Ownership

- Reading `Task.status` (legacy) for runtime visualization
  (`taskLifecycleService.js` §R-01).
- Bypassing `taskLifecycle.transition` to write `Task.executionStatus`.
- Mutating `RUNTIME_VISUAL` at runtime.
- Adding presentation fields to the wire.
- Hardcoded colour strings in JSX (`index.css` + Tailwind theme is the
  only allowed source).
- Writing `pipelinePhases` outside `mapSessionStarted` + the 4
  per-event lifecycle mappers.
- Constructing runtime icons outside `RUNTIME_ICONS` /
  `getRuntimeIcon`.

## Related OBS

- **OBS-1** — `docs/OBS1/PHASE5.5-freeze/` (freezes the contract).

## Related Implementation Files

- `backend/src/services/taskLifecycleService.js`
- `backend/src/services/eventPublisher.js`
- `backend/src/services/sdlcConstants.js`
- `backend/src/dto/eventEnvelope.js`
- `backend/src/controllers/SdlcController.js`
- `backend/prisma/schema.prisma`
- `frontend/src/store/eventMappers.ts`
- `frontend/src/store/runtimeSelectors.ts`
- `frontend/src/store/workflowSelectors.ts`
- `frontend/src/models/SessionState.ts`
- `frontend/src/dto/event.ts`

End of Runtime Contract.
