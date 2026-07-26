# 06 — Observability Contract

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document.
> **Source of truth:** `docs/OBS4/04_OBSERVABILITY_VERIFICATION.md`.

---

## Canonical Owner

**Backend:**

- `backend/src/middleware/requestContext.js` — `AsyncLocalStorage`
  + `setContext` + `withCtx` merge (correlation backbone).
- `backend/src/config/logger.js` — `pino` logger.
- `backend/src/services/gateBridge.js` — `setContext` calls in
  `requestGate` / `resolveGate` (Patch O-B).
- `backend/src/services/agentDispatcher.js` — `logger.*` calls
  replacing the legacy 14 `console.*` (Patch O-A).
- `backend/src/middleware/errorHandler.js` — `logger.error` replacing
  `console.error` (Patch O-E).
- `backend/src/services/archAskEnforcer.js` — per-retry `logger.debug`
  (Patch O-F).
- `backend/src/server.js` — Sentry init guarded by `SENTRY_DSN` (Patch O-C).

**Frontend:**

- `frontend/src/services/sseClient.ts` — `sseLog.warn` helper
  (Patch O-D).
- `frontend/src/store/eventMappers.ts` — `mapRuntimeLog` (Patch O-G).
- `frontend/src/models/SessionState.ts` — `RuntimeEventType` union
  (Patch O-G).

## Source of Truth

- `backend/src/middleware/requestContext.js` — `requestId` injection,
  `setContext`, `withCtx`.
- `backend/src/config/logger.js` — `pino` instance + level.
- `backend/src/server.js` — Sentry init + `SENTRY_DSN` guard +
  `SENTRY_TRACES_SAMPLE_RATE` + `SENTRY_PROFILES_SAMPLE_RATE`.

## Producer

| Surface | Producer | File |
| ------- | -------- | ---- |
| `requestId` (HTTP) | `requestContextMiddleware` | `backend/src/middleware/requestContext.js` |
| `AsyncLocalStorage` context | `setContext({approvalId, taskId, role, kind, decision})` in `gateBridge` | `backend/src/services/gateBridge.js` |
| Log lines (BE) | `logger.{info, warn, error, debug}` | `backend/src/config/logger.js` |
| Log lines (FE) | `sseLog.warn(message, fields)` | `frontend/src/services/sseClient.ts` |
| Sentry events | `Sentry.init` (only when `SENTRY_DSN` set) | `backend/src/server.js` |
| `runtimeEvents` (FE timeline) | `mapRuntimeLog` append to `state.runtimeEvents` (bounded by `RUNTIME_EVENTS_LIMIT`) | `frontend/src/store/eventMappers.ts` |

## Consumer

| Consumer | Reads | File |
| -------- | ----- | ---- |
| Operator (log file) | JSON log lines with merged context | `backend-dev.stderr.log` / stdout |
| Operator (FE timeline) | `state.runtimeEvents` | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx` |
| Operator (Sentry) | trace events + profile samples | `Sentry.init` consumer |
| Log correlation | `requestId → approvalId → taskId → role → kind → decision` | log file |

## Invariants

1. **Correlation chain** — HTTP request → `x-request-id` →
   `requestContextMiddleware` → `AsyncLocalStorage { requestId }` →
   `setContext` (in `gateBridge`) → `logger.*` → log file.
2. **`requestId` is the sole correlation key** for HTTP-originated logs.
3. **No `console.*` in production backend code** — `console.error`,
   `console.warn`, `console.log` are forbidden in `backend/src/`
   (Patch O-A replaced 14 occurrences in `agentDispatcher.js`; Patch O-E
   replaced 1 in `errorHandler.js`).
4. **No `console.*` in production frontend SSE code** — `sseClient.ts`
   uses `sseLog.warn` only (Patch O-D).
5. **Sentry init is opt-in** — `if (process.env.SENTRY_DSN)` guard;
   `logger.warn` on missing DSN.
6. **Sentry sample rates are env-driven** — `SENTRY_TRACES_SAMPLE_RATE`,
   `SENTRY_PROFILES_SAMPLE_RATE`; default 0.1.
7. **`runtime_log` envelopes persist to FE timeline** — `mapRuntimeLog`
   appends a `RuntimeEvent` to `state.runtimeEvents` (Patch O-G).
8. **`errorHandler` logs carry `requestId`** — `withCtx` merge.
9. **`archAskEnforcer` retry attempts are logged at DEBUG** (Patch O-F).

## Forbidden Ownership

- A second correlation backbone (the existing
  `requestContext + AsyncLocalStorage` is the only one).
- Direct Sentry init outside `backend/src/server.js`.
- Bypassing `logger.*` with `console.*` in production code.
- Reading `runtime_log` envelope payload and discarding it
  (Patch O-G fixed this in `mapRuntimeLog`).

## Deferred Drifts

- **D-O2** — SSE envelope `requestId` (touches OBS-01 frozen wire shape).
- **D-O5** — gate audit in-memory only (touches OBS-02 frozen
  `SdlcWorkflowService`).
- **D-O10** — `taskLifecycleService` silent (touches OBS-01 frozen surface).
- **D-O14** — no metrics endpoint (larger workstream).

## Related OBS

- **OBS-4** — `docs/OBS4/04_OBSERVABILITY_VERIFICATION.md` (freezes the
  contract; 7 of 15 drifts resolved; 4 deferred).

## Related Implementation Files

- `backend/src/middleware/requestContext.js`
- `backend/src/config/logger.js`
- `backend/src/server.js`
- `backend/src/middleware/errorHandler.js`
- `backend/src/services/gateBridge.js`
- `backend/src/services/agentDispatcher.js`
- `backend/src/services/archAskEnforcer.js`
- `frontend/src/services/sseClient.ts`
- `frontend/src/store/eventMappers.ts`
- `frontend/src/models/SessionState.ts`

End of Observability Contract.
