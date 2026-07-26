# 04 — Phase 1 Summary (Phase 1 Audit)

> **Status:** READ-ONLY AUDIT. No fixes proposed in this document.
> Recommendations below are observations for Phase 2 to evaluate.

---

## 1. What was audited

| Audit area                                            | Deliverable                                                |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| 1. Pipeline & State Machine (audit order #1)          | `01_PIPELINE_TRACE.md` + `02_STATE_MACHINE.md`             |
| 2. HTTP/API Contracts (audit order #2)                | (covered in §3 below)                                      |
| 3. Event Bus & SSE (audit order #3)                    | covered in `02_STATE_MACHINE.md` §1 and `03_PIPELINE_GAPS.md` G-1, G-2, G-6, G-14 |
| 4. Persistence / Database (audit order #4)            | covered in `02_STATE_MACHINE.md` and `03_PIPELINE_GAPS.md` |
| 5. Agent Runtime (audit order #5)                     | covered in `01_PIPELINE_TRACE.md` cross-cutting sections and `03_PIPELINE_GAPS.md` G-3, G-4, G-9 |
| 6. Frontend State Synchronization (audit order #6)    | partial — see §3 below                                     |
| 7. Dead Code Inventory (audit order #7)               | `03_PIPELINE_GAPS.md` G-12, G-13                            |

The first audit area was produced in full detail (`01_PIPELINE_TRACE.md`
traces every stage from Project Creation through Release with caller /
callee / controller / service / DB writes / events / human gates /
next trigger). `02_STATE_MACHINE.md` reconstructs the state machines
for `Task.executionStatus`, `Task.status`, `Task.versionStatus`,
`PipelineSession.status`, `PendingGate.status`, and `HitlDecision`.

Audit areas 2, 3, 4, 5, 6, 7 were covered through the state-machine
and pipeline-trace work plus targeted reads of the SSE controller,
eventPublisher, gateBridge, taskLifecycleService, sequenceService,
repoService, AgentEvent model, and Prisma schema.

---

## 2. What remains (out of scope or NOT VERIFIED)

The following were NOT fully confirmed in this read-only audit and
should be addressed in Phase 2 or a follow-up read-only pass:

- **HTTP/API Contracts (audit order #2)** — formal cross-check of
  every route in `backend/src/routes/*.js` against every method in
  `backend/src/controllers/*.js` was done partially (the SDLC routes
  are covered in the freeze documents; the legacy
  documents/folders/trees/sessions routes are listed but not
  enumerated handler-by-handler here).
- **Frontend State Synchronization (audit order #6)** — the
  freeze document `04_AGENT_PIPELINE_BASELINE.md` and
  `frontend/src/store/useWorkflowStore.ts` comments establish the
  invariant (HTTP commands MUST NOT mutate local state on success).
  No automated test exercises every reducer path against a known
  set of canonical envelopes.
- **Database inspection** — `backend/prisma/dev.db` was not opened.
  The exact inventory of legacy `AgentEvent` rows without
  `envelope` is NOT VERIFIED.
- **Resilience under boot race** — G-4 (recoverInterruptedGates
  re-dispatch race) is reasoned from source; whether the error is
  actually surfaced is NOT VERIFIED.
- **Live race outcomes** — G-5 (resolveGate double-resolve), G-14
  (sequence counter on reconnect) are reasoned from source; no
  instrumented run was performed.
- **The `feature_request` artifact key collision under rerun** —
  G-15 (double-persistence) is observed; whether a rewriter that
  edits one but not the other has shipped is NOT VERIFIED.

---

## 3. Risk level

The audit surfaced 20 distinct gaps across `03_PIPELINE_GAPS.md`. Of
these:

### High risk (active behaviour loss or visible bug in normal use)

| ID    | Title                                                                                        | Why high                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| G-4   | `recoverInterruptedGates` re-dispatch race against `taskLifecycle.TRANSITIONS`            | Direct user-visible failure on restart: any `awaiting_gate` task after backend restart cannot resume; the human is never re-prompted. |
| G-1   | `pipeline_completed` envelope not persisted                                                | Audit trails and reconnecting SSE consumers lose the terminal event; future replay / dashboard cards may diverge from wire. |
| G-6   | SSE replay drops non-canonical `AgentEvent` rows                                          | Reconnect truncates history silently with no log line; older data is invisible.                                       |
| G-7   | `pendingQuestions` scope mismatch (project vs session)                                    | Under concurrent sessions on a single project, one session's question can block other sessions' downstream agents (lock check is correctly session-scoped; UI listing is project-scoped and shows sibling data). |

### Medium risk (drift or reliability)

| ID    | Title                                                                                        | Why medium                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| G-2   | Three declared EventTypes have no producer                                                   | TypeScript union advertises types the runtime never emits. Dormant gap; future producers must avoid the asymmetry of G-1. |
| G-3   | `taskLifecycle.transition` is bypassed by direct `Task.update` writes                       | `Task.status` and `Task.executionStatus` can disagree. The state machine only governs `executionStatus`.              |
| G-5   | `gateBridge.resolveGate` may double-resolve                                                 | Theoretically reachable; not observed in the audit's static walk.                                                    |
| G-8   | `agentOutput` field exposes a non-stable structure to FE                                    | Reducers must accept runner-specific metadata.                                                                         |
| G-9   | `commitAndPushOnApprove` silently swallows commit failures                                  | Pipeline proceeds without a clear signal when the per-agent commit step fails.                                       |
| G-10  | `Task.create` legacy branch writes `sequence: 1` with `sessionId: null`                    | Legacy replay path skips these rows. NOT VERIFIED to be reachable on the current paths.                             |
| G-18  | `archAskEnforcer.ENFORCED_ROLES` does not include legacy `intent-agent`                     | Dormant on the current SDLC orchestrator.                                                                            |
| G-19  | `eventBus` subscriber map is unbounded                                                     | Long-running processes accumulate listeners.                                                                         |

### Low risk (cosmetic, drift, dead code)

| ID    | Title                                                                                        | Why low                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| G-11  | `MOCK_SCENARIO_PROFILES` is single-entry                                                   | Mocks always pass; failure-path testing requires real runner.                                                          |
| G-12  | `arch_runtime.js` and `backend/scripts/*.js` are unreachable                                | Drift only.                                                                                                           |
| G-13  | Dead backend modules (`agentParser.js`, `authService.js`, `validation.js`)                  | No runtime impact; dormant dependencies increase attack surface.                                                      |
| G-14  | SSE snapshot allocates a fresh sequence per reconnect                                       | Sequence counter leaks by 1 per reconnect. Idempotency unaffected.                                                    |
| G-15  | `feature_request` artifact double-persisted                                                  | Two sources of truth; rewrite tools could desynchronise them.                                                         |
| G-16  | `HitlDecision.reviewerId` is always `'local-user-id'`                                       | Already known; documented as freeze doc I-13.                                                                        |
| G-17  | `releaseGate.canDecide` always returns `true`                                               | UI gating is permanently open.                                                                                         |
| G-20  | `agents/sandbox/` referenced only by Dockerfile; absent from runtime                       | No current impact.                                                                                                   |

---

## 4. Recommended Phase 2 scope

Phase 2 is out of scope of this document. The audit recommends that
Phase 2 address gaps in the following priority order (purely
advisory — Phase 2 itself should re-prioritise based on its own
governance):

1. **G-4** (recoverInterruptedGates race) — smallest fix; biggest
   reliability gain. Document the fix and add a regression test
   before any other persistence change.
2. **G-1** (`pipeline_completed` not persisted) — well-scoped: route
   the envelope through `AgentEvent.create` in `releaseManager`.
   Add a replay test that confirms the row exists on APPROVE.
3. **G-7** (pendingQuestions scope) — already partially correct
   in some paths; align the FE-facing list with the same scope as
   the lock check.
4. **G-6** (SSE replay drops) — decide on a replay strategy for
   legacy rows (either synthesise envelopes or document the gap).
5. **G-2** + **G-3** — tighten the type discriminator union and
   the state machine to remove dormant inconsistencies.
6. **G-9** — distinguish commit-failure from push-failure in
   `commitAndPushOnApprove`'s return so the caller can branch.
7. **G-8** — define a stable `agentOutput` shape and stop writing
   runtime metadata into the contract field.
8. **G-13** — delete or quarantine dead modules. Phase 2 can
   decide.
9. **G-19** — bounded subscriber map and bounded `pending` map.
10. **G-12**, **G-15**, **G-16**, **G-17**, **G-20** — clean-up
    only; no functional impact.

Phase 2 must NOT begin until Phase 1 is accepted (or amended).

---

## 5. Open questions for Phase 2

- Should the dead modules in G-13 be deleted, quarantined, or left
  alone?
- Should the SSE replay path be tightened (synthesise envelopes for
  legacy rows) or relaxed (accept that some data is permanently
  dropped)?
- Should `releaseGate.canDecide` (G-17) and `HitlDecision.reviewerId`
  (G-16) carry real user data when the auth bypass is removed?
  This audit does not propose a fix.
- Should the SSE snapshot allocation in G-14 be merged with
  `session_resumed` so reconnects do not consume sequences?

---

## 6. Phase 1 success criteria — verification

| Success criterion                                              | Status |
| -------------------------------------------------------------- | ------ |
| `09_PHASE1_PLAN.md` is reconstructed in `docs/engineering-freeze/` | ✓      |
| The reconstructed plan matches Phase 0                         | ✓      |
| `01_PIPELINE_TRACE.md` exists and cites file:line             | ✓      |
| `02_STATE_MACHINE.md` exists and cites file:line              | ✓      |
| `03_PIPELINE_GAPS.md` exists and lists every observed drift    | ✓      |
| `04_PHASE1_SUMMARY.md` (this file) exists                      | ✓      |
| Zero production source files modified                          | ✓      |
| Zero tests modified                                             | ✓      |
| Zero API contracts modified                                     | ✓      |
| Zero behaviour changes introduced                               | ✓      |

The audit is READ-ONLY. No production code, test, or contract was
touched. Only files under `docs/engineering-freeze/` and
`docs/engineering-audit/` were created.