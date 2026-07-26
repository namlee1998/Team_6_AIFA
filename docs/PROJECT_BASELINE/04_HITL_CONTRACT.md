# 04 — HITL Contract

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document.
> **Source of truth:** `docs/obs5-HITL/04_HITL_VERIFICATION.md`.

---

## Canonical Owner

`backend/src/services/gateBridge.js` (gate lifecycle),
`backend/src/services/SdlcWorkflowService.js` (HITL HTTP handlers +
output-review path),
`backend/src/services/releaseManager.js` (release gate resolution),
`backend/src/services/toGateType.js` (gate type derivation),
`backend/src/models/PendingGate.js` (durable gate row),
`backend/src/models/PipelineSession.js` (pendingReleaseGateId).

## Source of Truth

- `backend/src/services/gateBridge.js:51-83` — `requestGate`
  (canonical gate creation).
- `backend/src/services/gateBridge.js:154-194` — `resolveGate`
  (canonical gate resolution).
- `backend/src/services/toGateType.js` — gate type factory.
- `backend/src/services/releaseManager.js` — `submitReleaseDecision`
  (APPROVE branch owns `pipeline_completed`; belt-and-suspenders
  fallback publishes `gate_resolved` directly via `publishEvent`).
- `backend/prisma/schema.prisma` — `pendingReleaseGateId` column on
  `PipelineSession` (added by OBS-5 H-A).
- `backend/src/services/SdlcWorkflowService.js:264-336` — structured
  HITL decision API (`submitStructuredDecision`).
- `backend/src/services/SdlcWorkflowService.js:2123-2162` — output
  review decision API (`submitGateDecision`).

## Producer

| Surface | Producer | File |
| ------- | -------- | ---- |
| `gate_pending` envelope | `gateBridge.requestGate` (inner IIFE) | `backend/src/services/gateBridge.js:51-83` |
| `gate_resolved` envelope | `gateBridge.resolveGate`; `releaseManager.submitReleaseDecision` (fallback) | `backend/src/services/gateBridge.js:154-194`; `backend/src/services/releaseManager.js` |
| `pipeline_completed` envelope | `releaseManager.submitReleaseDecision` (APPROVE branch only) | `backend/src/services/releaseManager.js:170-186` |
| `PendingGate` row | `PendingGate.create` / `PendingGate.resolve` | `backend/src/models/PendingGate.js` |
| `HitlDecision` audit row | `HitlDecision.create` | `backend/src/models/HitlDecision.js` |

## Consumer

| Consumer | Reads | File |
| -------- | ----- | ---- |
| FE `useWorkflowStore` | `gate_pending` + `gate_resolved` via SSE | `frontend/src/store/eventMappers.ts` |
| FE `pendingReleaseGateId` cache key | server-provided gate id | `frontend/src/store/useWorkflowStore.ts` |
| FE `releaseDecision` decisionId | server-provided gate id | `frontend/src/store/useWorkflowStore.ts:13` |
| `taskLifecycle.transition` (output_review / release paths skip) | `gateBridge.resolveGate` | `backend/src/services/gateBridge.js:154-194` |

## Invariants

1. **Gate kind enum** — `'tool' | 'question' | 'output_review' | 'release'`
   (4 values). FROZEN.
2. **Gate type enum** — 13 values (e.g. `HITL_REVIEW`,
   `PO_CLARIFY`, `FINAL_RELEASE`). FROZEN. Derived presentation only;
   do not parse from the wire.
3. **`gate_pending` payload** — `{gate: {id, type, kind, taskId, projectId, role, status, payload, createdAt}}`.
4. **`gate_resolved` payload** — `{gateId, taskId, decision: 'approve' | 'reject' | 'answer' | 'timeout', comment?, resolvedAt}`.
   For FINAL_RELEASE, `role === 'release'`; otherwise `role === <agent-type>`.
5. **`output_review` HTTP contract** — `POST /output-review/:approval_id`
   body `{action, comment?}` → `{task, hitlDecision}`.
6. **`release` HTTP contract** —
   `POST /sessions/:session_id/release-decision`
   body `{decision_id, decision: 'APPROVE'|'REJECT', comment?, action?}`.
   Idempotent on `decision_id`.
7. **`tool` / `question` HTTP contract** — `POST /approvals/:approval_id`
   body `{action, comment?}` OR `{answers}`. Refuses output_review /
   release with HTTP 400 (Patch H-E).
8. **`pipeline_completed` is owned by exactly one path** —
   `releaseManager.submitReleaseDecision`'s APPROVE branch.
9. **Per-kind watchdog timeouts** — `output_review` and `release`
   get `ttl=0` (no watchdog); `tool` and `question` honor their env
   vars (Patch H-G).
10. **Release gate taskId** — sentinel `release-<sessionId>` (Patch H-B).
11. **`PendingGate.create` UPSERT guard** — rejects same-id-different-scope;
    lenient on same-id-same-scope-resolved (Patch H-K).

## Forbidden Ownership

- A second producer for `pipeline_completed` outside
  `releaseManager.submitReleaseDecision`'s APPROVE branch.
- A second producer for `gate_pending` outside `gateBridge.requestGate`.
- A second producer for `gate_resolved` outside `gateBridge.resolveGate`
  (with the documented `releaseManager` fallback for post-restart recovery).
- `PendingGate.create` mutating scope silently (Patch H-K guard).
- Reading `gate.kind` from the FE (the FE consumes `gate.type` after
  canonical derivation, never raw `kind`).

## Related OBS

- **OBS-5** — `docs/obs5-HITL/04_HITL_VERIFICATION.md` (freezes the
  contract; 17 of 18 drifts resolved; D-4 deferred to OBS-AGENT).

## Related Implementation Files

- `backend/src/services/gateBridge.js`
- `backend/src/services/SdlcWorkflowService.js`
- `backend/src/services/releaseManager.js`
- `backend/src/services/toGateType.js`
- `backend/src/models/PendingGate.js`
- `backend/src/models/PipelineSession.js`
- `backend/src/models/HitlDecision.js`
- `backend/prisma/schema.prisma`
- `frontend/src/store/useWorkflowStore.ts`
- `frontend/src/store/eventMappers.ts` (`mapGatePending`, `mapGateResolved`)
- `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx`

End of HITL Contract.
