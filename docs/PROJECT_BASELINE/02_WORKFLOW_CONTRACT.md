# 02 — Workflow Contract

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document.
> **Source of truth:** `docs/OBS2/04_WORKFLOW_VERIFICATION.md`,
> `docs/OBS2/02_WORKFLOW_DRIFT.md`.

---

## Canonical Owner

`backend/src/services/SdlcWorkflowService.js` (orchestrator),
`backend/src/services/workflowOrchestrator.js` (chain advance),
`backend/src/services/workflowHelpers.js` (helpers),
`backend/src/services/workflowQueries.js` (read-side projections).

## Source of Truth

- `backend/src/services/SdlcWorkflowService.js:744-998` — `getFinalReviewPacket`,
  `_buildReleaseEvidenceSummary`.
- `backend/src/services/SdlcWorkflowService.js:1156` — `mapPhase`
  (canonical status projection).
- `backend/src/services/sdlcConstants.js:157-166` —
  `EXECUTION_STATUS_TO_PHASE_STATUS`.
- `backend/src/services/workflowHelpers.js:243-262` — `deriveCurrentPhase`
  (defensive fallback to canonical).

## Producer

| Field / Surface | Producer | File |
| --------------- | -------- | ---- |
| `phases.<agent>.status` (SSE snapshot) | `SdlcWorkflowService.mapPhase` | `backend/src/services/SdlcWorkflowService.js:1156-1175` |
| `phases.<agent>.executionStatus` (release bundle) | `workflowQueries.getFinalReviewPacket.phases` | `backend/src/services/workflowQueries.js:144-150` |
| `deriveCurrentPhase` result | `workflowHelpers._deriveCurrentPhase` | `backend/src/services/workflowHelpers.js:243-262` |
| Gate resolution decision | `gateBridge.resolveGate` (transitive through SdlcWorkflowService) | `backend/src/services/gateBridge.js:154-194` |
| Chain advance | `workflowOrchestrator.startNextAgentIfAvailable` | `backend/src/services/workflowOrchestrator.js:603` |
| QA dedup pre-run guard | `workflowOrchestrator` | `backend/src/services/workflowOrchestrator.js:526-530` |

## Consumer

| Consumer | Reads | File |
| -------- | ----- | ---- |
| `SdlcController.streamPipelineStatus` | `phases.<agent>.status` for SSE snapshot | `backend/src/controllers/SdlcController.js:286-406` |
| `releaseManager.submitReleaseDecision` | `phases.<agent>.executionStatus` for release evidence | `backend/src/services/releaseManager.js` |
| `agentDispatcher.runAgent` | `deriveCurrentPhase` for chain selection | `backend/src/services/agentDispatcher.js:331` |
| `gateBridge.requestGate` | `deriveCurrentPhase` to decide next gate | `backend/src/services/gateBridge.js:51-83` |
| `workflowOrchestrator` | pre-run guard for QA dedup | `backend/src/services/workflowOrchestrator.js:526-530` |

## Invariants

1. **Defensive fallback pattern** — every reader of `Task.status` /
   `Task.executionStatus` MUST use `task.executionStatus ?? task.status`
   until legacy writers are removed. The OBS-2 patches preserve
   backward compatibility with legacy fixtures.
2. **`mapPhase.status` reads canonical `executionStatus` first** —
   `SdlcWorkflowService.js:1156-1175`.
3. **`getFinalReviewPacket.phases` carries `executionStatus`** —
   `workflowQueries.js:144-150` (mirror of OBS-1 R-25).
4. **`_requireApprovedTask` reads `executionStatus` first** —
   `SdlcWorkflowService.js:1601`.
5. **`workflowOrchestrator.startNextAgentIfAvailable` reads
   canonical first** — `workflowOrchestrator.js:603`.
6. **D-W9 (`agentDispatcher.js:442` legacy `PENDING_TOOL_APPROVAL` write)**
   is OUT OF SCOPE for OBS-2; deferred to OBS-AGENT (filed as
   D-A2 in OBS-3).

## Forbidden Ownership

- Reading `Task.status` without the defensive fallback.
- Adding new handoff paths that bypass `_recordApprovedHandoff` /
  `_startNextAgentIfAvailable`.
- Adding new state values outside `EXECUTION_STATUS_TO_PHASE_STATUS`.

## Related OBS

- **OBS-2** — `docs/OBS2/04_WORKFLOW_VERIFICATION.md` (freezes the
  contract; 9 drifts resolved, D-W9 deferred).
- **OBS-3** — `docs/OBS3/04_AGENT_VERIFICATION.md` (defers D-W9 → D-A2).

## Related Implementation Files

- `backend/src/services/SdlcWorkflowService.js`
- `backend/src/services/workflowOrchestrator.js`
- `backend/src/services/workflowHelpers.js`
- `backend/src/services/workflowQueries.js`
- `backend/src/services/sdlcConstants.js`
- `backend/src/controllers/SdlcController.js`

End of Workflow Contract.
