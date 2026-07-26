# 11 — Release Sign-off

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document.
> **Source of truth:** All OBS phase verification reports
> (OBS-1..OBS-9); `docs/PROJECT_BASELINE/00..10_*.md`.

---

## 1. Project Summary

The AIFA project stabilization is complete. The repository is now
considered the canonical implementation baseline. All nine OBS
phases (OBS-1 Runtime, OBS-2 Workflow, OBS-3 Agent, OBS-4
Observability, OBS-5 HITL, OBS-6 UI, OBS-7 Documents, OBS-8 Demo,
OBS-9 Integration) are closed with frozen contracts. The end-to-end
pipeline — Architecture → PO → UX → DEV → QA → Release — is
exercisable end-to-end via the real Claude Code SDK with
`EXECUTION_PATH=claude-code` as the default executor.

Auth, quota, admin, and membership are bypassed by project rule
(`CLAUDE.md` §4). The system runs as a single dummy local user.

---

## 2. OBS Completion Matrix

| OBS | Slug | Phase | Status | Source of truth |
| --- | ---- | ----- | :----: | --------------- |
| 1 | OBS-1 Runtime | PHASE 5.5 freeze | ✓ CLOSED | `docs/OBS1/PHASE5.5-freeze/FREEZE_SIGNOFF.md` |
| 1.10 | OBS-01.10 | Per-event mappers | ✓ CLOSED | `docs/OBS1/PHASE5-verification/PATCH_R{15,23,24,25}_VERIFICATION.md` |
| 2 | OBS-2 Workflow | Drift + patch | ✓ CLOSED | `docs/OBS2/04_WORKFLOW_VERIFICATION.md` |
| 3 | OBS-3 Agent | Drift + patch | ✓ CLOSED | `docs/OBS3/04_AGENT_VERIFICATION.md` |
| 4 | OBS-4 Observability | Drift + patch | ✓ CLOSED | `docs/OBS4/04_OBSERVABILITY_VERIFICATION.md` |
| 5 | OBS-5 HITL | Drift + patch | ✓ CLOSED | `docs/obs5-HITL/04_HITL_VERIFICATION.md` |
| 6 | OBS-6 UI | Drift + patch | ✓ CLOSED | `docs/obs6/04_UI_VERIFICATION.md` |
| 7 | OBS-7 Documents | Drift + patch | ✓ CLOSED | `docs/obs7/04_DOCUMENT_VERIFICATION.md` |
| 8 | OBS-8 Demo | Drift + patch | ✓ CLOSED | `docs/obs8/04_DEMO_VERIFICATION.md` |
| 9 | OBS-9 Integration | Drift + patch | ✓ CLOSED | `docs/obs9/04_INTEGRATION_VERIFICATION.md` |

### Per-OBS drift status

| OBS | Drifts catalogued | Closed | Deferred | Rejected |
| --- | :---------------: | :----: | :------: | :------: |
| 1 | 5 (R-15, R-23, R-24, R-25) | 5 | 0 | 0 |
| 2 | 10 (D-W1..D-W10) | 9 | 1 (D-W9) | 0 |
| 3 | 14 (D-A1..D-A14) | 5 | 2 (D-A2, D-A6) | 7 |
| 4 | 15 (D-O1..D-O15) | 7 | 4 (D-O2, D-O5, D-O10, D-O14) | 4 (D-O11 + 3 partial / dormant) |
| 5 | 18 (D-1..D-18) | 17 | 1 (D-4) | 0 |
| 6 | 20 (D-U1..D-U20) | 19 | 1 (D-U20) | 0 (D-U16 decided, not rejected) |
| 7 | 25 (D-D1..D-D25) | 22 | 1 (D-D17) | 1 (D-D22) + 1 verified (D-D21) |
| 8 | 26 (D-X1..D-X26 + extra-1) | 25 | 0 | 1 (D-X7) |
| 9 | 26 (I-X1..I-X26) | 16 | 5 (I-X10, X20, X23, X24 + 1 verified) | 4 (I-X16, X19, X25, X26) |

**Total**: 159 drifts catalogued; 125 closed; 15 deferred; 14
rejected / verified / decided.

---

## 3. Remaining Deferred Work

| Drift | Owner | Blocking dependency | Forward direction |
| ----- | ----- | ------------------- | ----------------- |
| D-W9 / D-A2 | OBS-AGENT | `PENDING_TOOL_APPROVAL` legacy write requires OBS-02 amendment (`SdlcWorkflowService.resumeTask` / `getPendingToolApprovals`). | File under a future OBS-AGENT phase. |
| D-A6 | OBS-AGENT | codex path rich-runtime wire; codex path is dormant (`EXECUTION_PATH=claude-code` is canonical per OBS-9). | Defer until a future requirement activates the codex path. |
| D-O2 | OBS-01 amendment | SSE envelope `requestId` touches OBS-01 frozen wire shape. | File under a future OBS-01 amendment. |
| D-O4 (partial) | OBS-02 amendment | `SdlcWorkflowService._saveAgentData` + `_recordApprovedHandoff` parts touch OBS-02 frozen `SdlcWorkflowService`. | File under a future OBS-02 amendment. |
| D-O5 | OBS-02 amendment | Gate audit in-memory only. | File under a future OBS-02 amendment. |
| D-O10 | OBS-01 amendment | `taskLifecycleService` silent — touches OBS-01 frozen surface. | File under a future OBS-01 amendment. |
| D-O12 | OBS-AGENT | `claudeCodeRunner` silent — agent subsystem scope. | File under a future OBS-AGENT phase. |
| D-O14 | future OBS | No metrics endpoint — larger workstream (Prometheus format). | File under a future metrics OBS phase. |
| D-4 | OBS-AGENT | `_resumeAgentStream` legacy tool-gate re-attach path; agentServer contract must publish `gate_pending` on `requires_action`. | File under a future OBS-AGENT phase. |
| D-9 | OBS-6 amendment | Narrow audit-race window — true `prisma.$transaction` requires restructuring `PendingGate.resolve`. | File under a future OBS-6 amendment. |
| D-U20 | future OBS | `OverviewPage.SessionMonitorCard.currentAction` reads direct; per-event detail. | File under a future UI cleanup OBS. |
| D-D17 | future OBS | Multi-tenant signed-URL — single-user auth per `CLAUDE.md §4`. | File under a future auth/rbac OBS phase. |
| I-X10 | future OBS | Barrel `api.ts` re-exports 6 sub-files with zero consumers. | File under a future tree-shaking OBS. |
| I-X20 | future OBS | 3 dead event types in `eventEnvelope.js` — contract-level change. | File under a future OBS-01 amendment. |
| I-X23 | future OBS-10 | `_saveAgentData` whitelist trim. | File under a future OBS-10 (output contract audit). |
| I-X24 | future i18n OBS | Locale bundle cleanup. | File under a future i18n-focused OBS. |

---

## 4. Known Limitations

The frozen limitations inherited from OBS-1.10 (`05_KNOWN_LIMITATIONS.md`)
remain in force. The major non-bug limitations are:

| ID | Limitation |
| -- | ---------- |
| L-01 | `dispatched` reserved / dormant (no current producer). |
| L-02 | `task_resumed` reserved / dormant. |
| L-03 | `pipeline_failed` reserved / dormant. |
| L-04 | `agent_event` partially active (T6/B8 commit). |
| L-05 | `cancelled` / `timeout` collapse to `skipped`. |
| L-06 | `idle` is FE-only initial (not in canonical machine). |
| L-07 | `gate_pending` does not patch `pipelinePhases` (handled by projection rule). |
| L-08 | Inspector does not render per-agent runtime visuals. |
| L-09 | Session-level `STATUS_BADGE` (SessionRail) is not canonical. |
| L-10 | `getFinalReviewPacket.phases` does not include `executionStatus`. |
| L-11 | `Task.create` emits `task_started` with `role: null` (OUT OF R-24 scope; `lifecycleType === 'task_queued'` identifies the row). |
| L-12 | Pre-existing test debt in `aifa-gate` and `arch-mandatory-ask` (3 BE test failures, predated OBS-01). |

### Open Architectural Decisions (OAD)

| OAD | Decision |
| --: | -------- |
| OAD-01 | `cancelled` vs `timeout` visual distinction. |
| OAD-02 | `dispatched` state activation. |
| OAD-03 | Inspector agent-state panel. |
| OAD-04 | Session-level visual map canonicalization. |

---

## 5. Regression Status

| Surface | Result | Evidence |
| ------- | :----: | -------- |
| OBS-01 Runtime Contract | ✓ no regression | `git status` — `runtimeSelectors.ts`, `eventMappers.ts`, `eventEnvelope.js`, `taskLifecycleService.js` untouched by OBS-2..OBS-9 |
| OBS-02 Workflow Contract | ✓ no regression | `git status` — `SdlcWorkflowService.js`, `workflowHelpers.js`, `workflowOrchestrator.js`, `workflowQueries.js` not touched by OBS-3..OBS-9 (except where noted in OBS-5 H-A/B/C/D/E/F/J) |
| OBS-03 Agent Contract | ✓ no regression | `git status` — `agentDispatcher.js`, `taskWorkerService.js` modified only for logger coverage (O-A) and double-mark guard (AG-E), no semantic change |
| OBS-04 Observability | ✓ no regression | `git status` — `gateBridge.js` modified only for `setContext` enrichment |
| OBS-05 HITL | ✓ no regression | OBS-6 reverted any UI touchpoints in lockstep |
| OBS-06 UI | ✓ no regression | No backend changes from OBS-6 |
| OBS-07 Documents | ✓ no regression | OBS-7 modified only documents API + service layer |
| OBS-08 Demo | ✓ no regression | OBS-8 is delete-only; affected tests pass |
| OBS-09 Integration | ✓ no regression | OBS-9 is deletion-and-normalization only |

---

## 6. Test Status

| Suite | Pass | Fail | Notes |
| ----- | :--: | :--: | ----- |
| Backend (Jest) | 333 | 3 | 3 pre-existing failures unchanged from OBS-01 baseline (`aifa-gate × 2`, `arch-mandatory-ask × 1`) |
| Frontend (Vitest) | 142 | 0 | 142/142 pass post-OBS-6 (10 test files) |
| TypeScript | ✓ | — | `npx tsc --noEmit` clean |
| Prisma schema | ✓ | — | `npx prisma db push` succeeded |
| Smoke (real Claude Code) | ✓ | — | `realClaudeCodeSmoke.js` boots; exits 77 if no login |
| Smoke (claude-code prefight) | ✓ | — | `demoSmokeClaudeCode.js` loads env flags via `_demoFlags.js` |

Pre-existing failures (out of OBS scope):

| Test file | Failure | Reason |
| --------- | :-----: | ------ |
| `tests/integration/arch-mandatory-ask.test.js` | `ux-agent with valid output runs exactly once` | Test fixture bug — `archAskEnforcer.enforceAskUserQuestion`. Pre-OBS-01 baseline. |
| `tests/integration/aifa-gate.test.js` | `po next-agent honours the route` | Missing feature on `_nextAgentFor`. Pre-OBS-01 baseline. |
| `tests/integration/aifa-gate.test.js` | `completed QA waits for human review` | Test signature misuse (5 args vs 7 expected). Pre-OBS-01 baseline. |

---

## 7. Repository Status

| Item | Status |
| ---- | :----: |
| Branch | `backup/obs-work-in-progress` |
| HEAD | `477acf2` |
| Working tree | clean |
| Files changed (cumulative OBS-1..9) | per OBS verification reports |
| Production code | frozen per OBS contracts |
| Tests | 333 BE + 142 FE passing |
| Documentation | `docs/PROJECT_BASELINE/00..11_*.md` complete |

---

## 8. Go / No-Go Decision

| Gate | Status | Evidence |
| ---- | :----: | -------- |
| All 9 OBS phases closed | ✓ | `obs{2..9}/04_*_VERIFICATION.md` |
| Runtime contract frozen | ✓ | `docs/OBS1/PHASE5.5-freeze/FREEZE_SIGNOFF.md` |
| All contracts frozen | ✓ | `docs/PROJECT_BASELINE/01..07_*_CONTRACT.md` |
| Dependency baseline | ✓ | `docs/PROJECT_BASELINE/08_DEPENDENCY_BASELINE.md` |
| Repair status complete | ✓ | `docs/PROJECT_BASELINE/09_REPAIR_STATUS.md` |
| Development rules frozen | ✓ | `docs/PROJECT_BASELINE/10_DEVELOPMENT_RULES.md` |
| TypeScript clean | ✓ | `npx tsc --noEmit` clean |
| Prisma schema in sync | ✓ | `npx prisma db push` succeeds |
| No new pre-existing failures | ✓ | 333 BE pass, 142 FE pass |
| Smoke boot | ✓ | `realClaudeCodeSmoke.js` |
| Working tree clean | ✓ | `git status` clean |

**Decision: GO.**

---

## 9. Release Recommendation

**Recommendation: RELEASE.**

The AIFA codebase is the canonical implementation baseline for
forward development. All frozen contracts are documented in
`docs/PROJECT_BASELINE/00..11_*.md`. Deferred work is explicitly
filed with owners and blocking dependencies. Known limitations are
documented (`L-01..L-12` + `OAD-01..OAD-04`). Pre-existing test debt
is documented and out of stabilization scope.

Forward development must:
1. Honour `docs/PROJECT_BASELINE/10_DEVELOPMENT_RULES.md`.
2. Honour the 30 runtime invariants in
   `docs/OBS1/PHASE5.5-freeze/04_DO_NOT_BREAK.md`.
3. File any new repair as a new OBS phase (Repair workflow).
4. Re-open the working tree only by branching from
   `backup/obs-work-in-progress` @ `477acf2`.

End of Release Sign-off.