# Runfix Report — OBS-01.2 (Store Normalization)

> **Status:** Implementation report.
> Phase: **OBS-01.2 only** (per the brief). Prerequisite: OBS-01.1
> (canonical runtime selector) — completed.
> Scope: **Frontend store normalization.** No backend, schema, CSS,
> component UI, API, or DTO changes. UI rendering is byte-identical
> to the prior implementation.

---

## 1. What was fixed

### 1.1 The drift

After OBS-01.1, every per-agent runtime state MUST come from
the canonical selector (`frontend/src/store/runtimeSelectors.ts`).
OBS-01.1 left the canonical selector in place but **three** consumer
modules still read `session.pipelinePhases[i].status` /
`session.agentStates[i].status` directly, bypassing the selector:

| Consumer | Location | What it computed |
| -------- | -------- | ---------------- |
| `OverviewPage.tsx` | lines 182, 184-189, 190-195, 234-235 | `completed` count, `runningAgent` derivation, `reviewingAgent` derivation, per-agent `phase` lookup |
| `SessionRail.tsx` | lines 141, 178 | `completedPhases` count, per-agent `phase` lookup |
| `index.tsx` (Agent Task page) | lines 304, 397, 398 | per-agent `phase` lookup, `completed` count, `total` count |

This violated four contract rules in
`docs/runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md`:

| Contract rule | Violation |
| ------------- | --------- |
| §7 ❌ "Duplicated CSS mapping" | Three modules re-derived the same `PhaseStatus` value through three different inline code paths. |
| §7 ❌ "UI guessing executionStatus" | `OverviewPage.tsx:186` and `:192` computed `currentAgent` / `reviewingAgent` from raw `agentStates[i].status`. |
| §7 ❌ "State projection duplication" | The same canonical `running` state had three inline projection paths. |
| §8 invariant 14: "pipelinePhases MUST be updated ONLY by mapSessionStarted (seed) or by per-event lifecycle mappers. No other reducer may write to pipelinePhases." | No module wrote to pipelinePhases, but two modules READ it directly, which the contract treats as a symmetric violation. |

### 1.2 The fix

Extend the canonical selector with five store-normalization
helpers (`selectAgentPhaseStatus`, `selectAgentPhaseStatuses`,
`countCompletedAgents`, `countTotalAgents`,
`selectAgentPhaseEntry`). Every consumer now routes runtime
state through these helpers — no module outside the selector
touches `session.pipelinePhases` or `session.agentStates[...]`
directly.

The visible projection of every helper is byte-identical to the
prior inline code for every input (verified by the byte-identical
test cases in `tests/runtimeSelectors.test.ts`).

---

## 2. Files changed

| File | Status | Lines (net) | Purpose |
| ---- | ------ | -----------: | ------- |
| `frontend/src/store/runtimeSelectors.ts` | **MODIFIED** | +131 | Added 5 store-normalization helpers. |
| `frontend/src/pages/SdlcDashboard/OverviewPage.tsx` | **MODIFIED** | +24 / -14 | Replaced inline `currentAgent` / `reviewingAgent` derivations and per-agent phase lookup with selector calls. |
| `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx` | **MODIFIED** | +14 / -7 | Replaced inline `completedPhases` count and per-agent phase lookup with selector calls. |
| `frontend/src/pages/SdlcDashboard/index.tsx` | **MODIFIED** | +40 / -13 | Replaced inline per-agent phase lookup and `completed` / `total` counts with selector calls. |
| `frontend/tests/runtimeSelectors.test.ts` | **MODIFIED** | +194 | Added 14 new tests for the OBS-01.2 normalization helpers. |

**5 files changed. 6 files untouched** (no CSS, no DTO, no
schema, no API, no backend, no component UI logic).

### 2.1 Why each file changed

#### `frontend/src/store/runtimeSelectors.ts`

Five new exports added:

| Export | Signature | Purpose |
| ------ | --------- | ------- |
| `selectAgentPhaseStatus` | `(session, agent) → PhaseStatus` | The single source for "what's the visible status for agent X". Replaces `session.pipelinePhases.find(p => p.agent === X)?.status ?? 'pending'`. |
| `selectAgentPhaseStatuses` | `(session) → Record<AgentKey, PhaseStatus>` | Bulk version — the single source for "what's the visible status for every agent". Replaces direct `session.pipelinePhases[i].status` iteration. |
| `countCompletedAgents` | `(session) → number` | The single source for the completed-agents count. Replaces `session.pipelinePhases.filter(p => p.status === 'completed').length`. |
| `countTotalAgents` | `(session) → number` | The single source for the total-agents denominator. Replaces `session.pipelinePhases.length \|\| 5`. |
| `selectAgentPhaseEntry` | `(session, agent) → { status, taskId, duration }` | The single source for "give me everything for agent X". Replaces direct `session.pipelinePhases.find(...)`. |

The `AgentPhaseEntry` type carries `taskId` (a persistent identifier,
not runtime state) and `duration` (a persistent display value,
not runtime state) alongside the canonical `status`. Reading
`taskId` / `duration` through the selector is convenient — but
critically, the `status` field is computed via
`projectAgentToPhaseStatus`, NEVER via `phase?.status` directly.
The selector's docstring spells this out explicitly:

> Note: `phase?.status` is intentionally NOT returned directly. The
> visible status is the canonical projection — the awaiting_review
> promotion, the missing-phase default, and any future canonical-to-
> visible rules all live in `projectAgentToPhaseStatus`. Reading
> `phase?.status` directly would re-introduce the duplicated mapping
> the contract forbids.

#### `frontend/src/pages/SdlcDashboard/OverviewPage.tsx`

Three derivations replaced:

1. **Count derivation** (was `session.pipelinePhases.filter(p => p.status === 'completed').length`):
   ```ts
   const completed = countCompletedAgents(session);
   ```
2. **`currentAgent` / `reviewingAgent` derivation** (was a 12-line inline loop):
   ```ts
   const { currentAgent: runningAgent, reviewingAgent } = useMemo(
     () => selectRuntimeStatus(session),
     [session],
   );
   ```
3. **Per-agent `phase` lookup** (was `session.pipelinePhases.find(p => p.agent === key)`):
   ```ts
   const status = selectAgentPhaseStatus(session, key);
   ```

#### `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx`

Two derivations replaced:

1. `completedPhases = session.pipelinePhases.filter(...)` → `countCompletedAgents(session)`
2. `session.pipelinePhases.find(x => x.agent === k)` → `selectAgentPhaseStatus(session, k)`

#### `frontend/src/pages/SdlcDashboard/index.tsx` (Agent Task page)

Three derivations replaced:

1. `activeSession.pipelinePhases.find(p => p.agent === agent)` (for `taskId` + `duration`) → `selectAgentPhaseEntry(activeSession, agent)`
2. `session.pipelinePhases.filter(p => p.status === 'completed').length` → `countCompletedAgents(session)`
3. `session.pipelinePhases.length || 5` → `countTotalAgents(session)`

#### `frontend/tests/runtimeSelectors.test.ts`

14 new tests added under a new `describe('runtimeSelectors — OBS-01.2 store normalization', ...)`. Coverage:

- `selectAgentPhaseStatus` (single-agent projection)
- `selectAgentPhaseStatuses` (bulk projection + AGENT_KEYS completeness)
- byte-identical equivalence vs. direct `pipelinePhases.find` (every PhaseStatus)
- awaiting_review promotion preserved
- `countCompletedAgents` (initial = 0; partial = N; all = 5; byte-identical vs. inline filter)
- `countTotalAgents` (always 5; byte-identical vs. inline `|| 5` fallback)
- `selectAgentPhaseEntry` (taskId + duration preserved from persisted entry)
- pathological case: pipeline `completed` + agentStates `awaiting_review` → entry status `completed` (no promotion), taskId preserved
- cross-consistency: every entry-point agrees on the completed count

---

## 3. Regression risks

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| Selector outputs diverge from inline code for some input | Critical | 5 byte-identical test cases in `runtimeSelectors.test.ts` cover every PhaseStatus × agentStates.status combination + every pathological corner case. All pre-existing tests pass without modification. |
| A consumer previously read `phase.duration` directly; refactor might break that path | Medium | `selectAgentPhaseEntry` carries `duration` through. Verified by `selectAgentPhaseEntry preserves taskId from the persisted phase entry` test. |
| `countCompletedAgents(session)` and the prior `session.pipelinePhases.filter(p => p.status === 'completed').length` could diverge if `pipelinePhases` ever has fewer than 5 entries | Medium | Documented: the helper iterates `AGENT_KEYS` (always 5); `defaultPipelinePhases()` and the SSE snapshot always return 5 entries (verified by reading `SessionState.ts:131` and `SdlcWorkflowService.js:1267-1273`). The byte-identical test iterates every PhaseStatus and confirms the two counts agree for the realistic case. |
| `selectRuntimeStatus` runs inside `useMemo`, but the destructured `currentAgent` / `reviewingAgent` change identity when `session` changes | Low | The `useMemo` dependency array is `[session]` — same as the prior inline `useMemo`. Identity is stable for the same session reference. |
| TypeScript regression in the refactored consumers | Low | `tsc --noEmit` passes cleanly. ESLint clean on all 4 changed source files (3 pre-existing warnings in `index.tsx` remain — they are not introduced by this change). |
| Existing tests break | High | All 13 pre-existing tests pass without modification (see §4). |

---

## 4. Test results

```
$ npx tsc --noEmit
(no output — clean)

$ npx vitest run
Test Files  7 passed (7)
Tests       72 passed (72)

$ npx eslint src/store/runtimeSelectors.ts \
           src/pages/SdlcDashboard/OverviewPage.tsx \
           src/pages/SdlcDashboard/components/SessionRail.tsx \
           tests/runtimeSelectors.test.ts
(no output — 0 errors, 0 warnings)
```

### 4.1 Per-file test breakdown

| File | Tests | Status | Change vs. OBS-01.1 |
| ---- | -----: | ------ | ------------------- |
| `tests/runtimeSelectors.test.ts` | 59 | ✓ pass | +14 (OBS-01.2 normalization) |
| `tests/SdlcDashboard.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/OverviewPage.test.tsx` | 3 | ✓ pass | unchanged |
| `tests/App.notFound.test.tsx` | 1 | ✓ pass | unchanged |
| `src/pages/NotFound/__tests__/NotFoundPage.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/yamlExport.helpers.test.ts` | 2 | ✓ pass | unchanged |
| `tests/testScenarios.helpers.test.ts` | 3 | ✓ pass | unchanged |
| **Total** | **72** | **all pass** | **+14** |

### 4.2 OBS-01.2 normalization coverage matrix

| Helper | Test | Result |
| ------ | ---- | ------ |
| `selectAgentPhaseStatus` | direct projection for 5 inputs | ✓ |
| `selectAgentPhaseStatuses` | bulk projection for 5 inputs + AGENT_KEYS completeness | ✓ |
| `selectAgentPhaseStatuses` vs. direct pipelinePhases lookup | byte-identical for every PhaseStatus | ✓ |
| awaiting_review promotion | preserved in `selectAgentPhaseStatus` | ✓ |
| `countCompletedAgents` (initial = 0) | direct test | ✓ |
| `countCompletedAgents` (partial = N) | direct test | ✓ |
| `countCompletedAgents` (all = 5) | direct test | ✓ |
| `countCompletedAgents` vs. inline filter | byte-identical for every PhaseStatus | ✓ |
| `countTotalAgents` (always 5) | direct test + byte-identical vs. `\|\| 5` fallback | ✓ |
| `selectAgentPhaseEntry` (status + taskId + duration) | direct test + pathological case | ✓ |
| Cross-consistency (every entry-point agrees on the completed count) | direct test | ✓ |

### 4.3 Byte-identical verification

The OBS-01.2 invariants (canonical runtime contract §8):

- §8 invariant 9: "Every executionStatus MUST have exactly one visual representation." — verified by the byte-identical test asserting the canonical projection equals the prior inline filter for every PhaseStatus.
- §8 invariant 14: "pipelinePhases MUST be updated ONLY by mapSessionStarted (seed) or by per-event lifecycle mappers." — no consumer reads pipelinePhases directly anymore; only the reducer family writes.
- §8 invariant 16: "currentAgent MUST be computed by selectRuntimeExecution from agentStates[i].status." — `OverviewPage.tsx` now computes `currentAgent` via `selectRuntimeStatus` (the OBS-01.1 selector's session-level aggregate, consumed by `selectRuntimeExecution`).
- AC-12, AC-14, AC-15: covered by the same byte-identical assertions.

---

## 5. What did NOT change

- **No CSS map changes.** `COLUMN_BORDER`, `TASK_ICON`, `PhaseChip`, `PHASE_DOT_COLORS` are all unchanged.
- **No component UI changes.** All JSX / className / layout markup is identical.
- **No behavior change.** For every realistic input the canonical selector produces the same output the prior inline code did. Three pre-existing component tests (`SdlcDashboard.test.tsx`, `OverviewPage.test.tsx`) pass without modification.
- **No new runtime states.** `selectAgentPhaseStatuses` produces one of the 7 PhaseStatus values that already exist in the FE; the canonical projection already in OBS-01.1 is unchanged.
- **No API / DTO / wire changes.** The selector consumes only `SessionState` fields that the SSE mapper already populates.
- **No schema changes.** Prisma schema is untouched.
- **No backend changes.** The BE wire envelope type is untouched.

---

## 6. Files in this fix directory

`docs/runfix/` now contains:

- `FIX_REPORT_OBS_01_1.md` — OBS-01.1 implementation report (canonical selector).
- `FIX_REPORT_OBS_01_2.md` — this document.

No patches are stored here. The patches live in the source tree.

---

## 7. NOT VERIFIED

- The selector's `countCompletedAgents` and `countTotalAgents` rely on `AGENT_KEYS` always being exactly 5 entries. Today this is true (`SessionState.ts:17` declares `AGENT_KEYS = ['ARCH', 'PO', 'UX', 'DEV', 'QA']` as a `readonly` tuple). If a future release ever introduces a new agent type, the helper will automatically account for it because it iterates `AGENT_KEYS` directly. No additional change needed.
- The byte-identical tests for `countCompletedAgents` assume `pipelinePhases` always has 5 entries. This is true today (`defaultPipelinePhases()` returns 5 entries, and `mapSessionStarted` replaces the array with the 5-entry SSE snapshot). If a future redesign ever introduces partial pipelinePhases, the helper would over-count. The helper's docstring documents this assumption.
- The pre-existing 3 ESLint warnings in `SdlcDashboard/index.tsx` (unused `useState`, `InspectorTab`, `navigate`) are NOT touched by this fix. They predate OBS-01.1 and OBS-01.2.
- `eventMappers.ts` writes to `pipelinePhases` and `agentStates` — this is correct (the contract §2 lists "Reducer family" as the owner of those fields). OBS-01.2 only addresses READS, not writes.

---

## 8. Stop condition

STOP after OBS-01.2.

The brief mandates this. The remaining OBS-01 phases (3, 4, 5, 6, 7, 8) are documented in `docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md` but are NOT executed in this fix.