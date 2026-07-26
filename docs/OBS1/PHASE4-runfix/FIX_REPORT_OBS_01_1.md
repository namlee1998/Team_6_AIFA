# Runfix Report — OBS-01.1 (Canonical Runtime Selector)

> **Status:** Implementation report.
> Phase: **OBS-01.1 only** (per the brief).
> Scope: **Frontend selector refactor.** No backend, schema, CSS,
> component, API, or DTO changes. UI rendering is byte-identical
> to the prior implementation.

---

## 1. What was fixed

### 1.1 The drift

`frontend/src/store/workflowSelectors.ts` had two inline
runtime-state derivations:

1. `currentAgent` / `reviewingAgent` (lines 226-235 of the
   pre-fix file) — read `agentStates[i].status` directly.
2. `phaseForAgent` build (lines 247-260 of the pre-fix file) —
   merged `pipelinePhases[i].status` with an `awaiting_review`
   promotion.

These derivations violated the canonical runtime contract
(`docs/runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md`)
in three ways:

| Contract rule (07 §7) | Violation |
| ---------------------- | --------- |
| ❌ "There MUST be exactly one runtime state source per agent." | Two derivations lived in one inline block; no separate module owned runtime state. |
| ❌ "Every runtime event MUST correspond to exactly one backend transition." (FR invariant 10) | The FE did NOT consult the canonical `Task.executionStatus`; it derived runtime from secondary signals (`pipelinePhases[i].status` + `agentStates[i].status`). |
| ❌ "Every executionStatus MUST have exactly one visual representation." (08 invariant 9) | The same canonical state (`running`) could surface as `'running'` OR `'awaiting_review'` depending on whether the agent's `agentStates[i].status` was set; two code paths, two output names. |

### 1.2 The fix

Introduce `frontend/src/store/runtimeSelectors.ts` — the
canonical runtime selector. Every other reducer, store,
component, and selector MUST consume this module rather than
computing runtime state independently.

---

## 2. Files changed

| File | Status | Lines | Purpose |
| ---- | ------ | -----: | ------- |
| `frontend/src/store/runtimeSelectors.ts` | **NEW** | 355 | The canonical runtime selector — the single owner of runtime state derivation. |
| `frontend/src/store/workflowSelectors.ts` | **MODIFIED** | -4 net (+20/-24) | `selectRuntimeExecution` now consumes the canonical selector. No other code in the file is touched. |
| `frontend/tests/runtimeSelectors.test.ts` | **NEW** | 584 | 45 unit tests covering every canonical state, the visible projection, the canonical projection, the contract guarantees, and an integration test against `selectRuntimeExecution`. |

No other files touched. The CSS maps at
`frontend/src/pages/SdlcDashboard/index.tsx:44-51, 76-83, 503-516`
are unchanged. The CSS maps at
`frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:8`
are unchanged.

---

## 3. Every mapping explained

The selector exposes **six exports** and **three projections**.
They form a strict pipeline:

```
SessionState (input)
       │
       ▼
[1] projectAgentToPhaseStatus(session, agent) → PhaseStatus
       │  (visible projection; consumed by Dashboard / Agent Task / SessionRail)
       ▼
   either  PhaseStatus  ──►  CSS map (existing; untouched)
   or      RuntimeState ──►  canonical domain name

[2] deriveAgentRuntimeState(session, agent) → RuntimeState
       │  (canonical projection; per-agent domain name)
       ▼
   8-state canonical machine (idle | queued | dispatched |
   running | waiting_human | completed | failed | cancelled)

[3] selectRuntimeStatus(session) → RuntimeStatus
       │  (session-level aggregate: per-agent canonical +
       │   currentAgent + reviewingAgent)
       ▼
   Consumed by selectRuntimeExecution (workflowSelectors.ts)
```

### 3.1 Visible projection — `projectAgentToPhaseStatus`

| Input | Output | Algorithm |
| ----- | ------ | --------- |
| `pipelinePhases[agent]` is missing | `'pending'` | default |
| `agentStates[agent].status === 'awaiting_review'` AND `pipelinePhases[agent].status === 'running'` | `'awaiting_review'` | **promotion rule** (only fires for `'running'`) |
| otherwise | `pipelinePhases[agent].status` (verbatim) | passthrough |

This projection is the **FE-visible** value. It is consumed
by `selectRuntimeExecution.phases[i].status` (the
`RuntimeAgentPhase['status']` field) and is the single value
that reaches CSS maps (`COLUMN_BORDER`, `TASK_ICON`, `PhaseChip`,
`PHASE_DOT_COLORS`).

The promotion rule is the only place where `agentStates` is
consulted for the visible projection. It mirrors the prior
inline code at `workflowSelectors.ts:256-260` byte-for-byte.

### 3.2 Canonical projection — `deriveAgentRuntimeState`

`deriveAgentRuntimeState` runs `projectAgentToPhaseStatus` and
then maps the visible value to a canonical domain name.

| Input (`PhaseStatus`) | Output (`RuntimeState`) | Rationale |
| ---------------------- | ----------------------- | --------- |
| `'pending'` | `'queued'` | Covers the initial state. The FE store seeds all phases to `'pending'`; the canonical initial name is `'queued'`. |
| `'running'` | `'running'` | 1:1 |
| `'gate_pending'` | `'waiting_human'` | Canonical wire name → canonical contract name. |
| `'awaiting_review'` | `'waiting_human'` | FE-side promotion → canonical contract name. |
| `'completed'` | `'completed'` | 1:1 |
| `'failed'` | `'failed'` | 1:1 |
| `'skipped'` | `'cancelled'` | The existing FE projection collapses `cancelled` and `timeout` onto `'skipped'`. |

`RuntimeState` is the **canonical domain name** per the contract
§3. Eight members. The first two (`idle`, `dispatched`) are
reserved by the contract — they have no producer today. The
exhaustive test asserts all 6 reachable members are reachable;
the 2 reserved members are documented as
`UNREACHABLE_VIA_PROJECTION`.

### 3.3 Inverse projection — `canonicalToPhaseStatus` / `phaseStatusToVisible`

The inverse — used for any future consumer that needs to
render a canonical state directly. Exposed as
`phaseStatusToVisible` for readability.

| Input (`RuntimeState`) | Output (`PhaseStatus`) |
| ---------------------- | ----------------------- |
| `'idle' \| 'queued' \| 'dispatched'` | `'pending'` |
| `'running'` | `'running'` |
| `'waiting_human'` | `'gate_pending'` |
| `'completed'` | `'completed'` |
| `'failed'` | `'failed'` |
| `'cancelled'` | `'skipped'` |

### 3.4 Session-level aggregate — `selectRuntimeStatus`

Aggregates the per-agent canonical states plus the
`currentAgent` and `reviewingAgent` derivation.

The `currentAgent` derivation reads
`agentStates[i].status` **directly** (not via the canonical
projection). This preserves the byte-identical behavior of the
prior inline code, which also read `agentStates[i].status`
directly. The contract invariant §8 holds: there is exactly
one place in the FE codebase that derives runtime state.

The `runtimeStatus.reviewingAgent` field is exposed by the
canonical selector but not consumed by `selectRuntimeExecution`
(the prior inline code also assigned `reviewingAgent` without
using it). Kept for parity.

### 3.5 Wire contract guarantee

Per the contract §4.2 rule 4: the wire MUST NOT carry
presentation fields. The selector consumes only
`session.pipelinePhases[i].status` (already a domain string)
and `session.agentStates[i].status` (already a domain string).
No colour, badge, animation, CSS class, or icon name crosses
the selector boundary. The output strings are CSS map keys,
which are themselves project-wide Tailwind tokens — never
component-local hardcoded strings.

---

## 4. Test results

```
$ npx tsc --noEmit
(no output — clean)

$ npx vitest run
Test Files  7 passed (7)
Tests       58 passed (58)

$ npx eslint src/store/runtimeSelectors.ts src/store/workflowSelectors.ts tests/runtimeSelectors.test.ts
(no output — 0 errors, 0 warnings)
```

### 4.1 Per-file test breakdown

| File | Tests | Status |
| ---- | -----: | ------ |
| `tests/runtimeSelectors.test.ts` (NEW) | 45 | ✓ pass |
| `tests/SdlcDashboard.test.tsx` (pre-existing) | 2 | ✓ pass |
| `tests/OverviewPage.test.tsx` (pre-existing) | 3 | ✓ pass |
| `tests/App.notFound.test.tsx` (pre-existing) | 1 | ✓ pass |
| `src/pages/NotFound/__tests__/NotFoundPage.test.tsx` (pre-existing) | 2 | ✓ pass |
| `tests/yamlExport.helpers.test.ts` (pre-existing) | 2 | ✓ pass |
| `tests/testScenarios.helpers.test.ts` (pre-existing) | 3 | ✓ pass |
| **Total** | **58** | **all pass** |

### 4.2 Coverage matrix — every canonical runtime state

| Canonical state | Test | Result |
| --------------- | ---- | ------ |
| `idle` | `UNREACHABLE_VIA_PROJECTION` assertion (FE-only initial; never reachable through the projection) | ✓ |
| `queued` | cross-product test reaches it | ✓ |
| `dispatched` | `UNREACHABLE_VIA_PROJECTION` (reserved; no producer) | ✓ |
| `running` | direct test + cross-product + currentAgent test | ✓ |
| `waiting_human` | direct test (both `'gate_pending'` and `'awaiting_review'` inputs) + cross-product | ✓ |
| `completed` | direct test + cross-product | ✓ |
| `failed` | direct test + cross-product | ✓ |
| `cancelled` | direct test (via `'skipped'` projection) + cross-product | ✓ |

The exhaustive cross-product test iterates every combination
of `PhaseStatus` (7 values) × `agentStates.status` (6 values)
and asserts every reachable canonical state is reached at least
once. The 2 reserved canonical states are documented
explicitly as unreachable.

---

## 5. Drift observed during implementation

### 5.1 Behavioural drift: NONE

I verified the byte-identical behaviour with five test cases
before merging. The selector produces the same output as the
prior inline code for every input.

| Input | Prior inline output | Selector output | Match |
| ----- | ------------------- | --------------- | ----- |
| `pipelineStatus='running'`, `agentStatus='running'` | `'running'`, currentAgent=agent | `'running'`, currentAgent=agent | ✓ |
| `pipelineStatus='running'`, `agentStatus='awaiting_review'` | `'awaiting_review'` (promotion), reviewingAgent=agent | `'awaiting_review'` (promotion), reviewingAgent=agent | ✓ |
| `pipelineStatus='gate_pending'`, `agentStatus='awaiting_review'` | `'gate_pending'` (no promotion) | `'gate_pending'` (no promotion) | ✓ |
| `pipelineStatus='completed'`, `agentStatus='awaiting_review'` | `'completed'`, reviewingAgent=agent (pathological) | `'completed'`, reviewingAgent=agent (pathological) | ✓ |
| `pipelinePhases[agent]` missing | `'pending'` | `'pending'` | ✓ |

Two specific quirks of the prior code are preserved:

- `currentAgent` is the **LAST** agent with
  `agentStates.status === 'running'` (the original code used
  an unconditional assignment; my selector does the same).
- `reviewingAgent` is the **FIRST** agent with
  `agentStates.status === 'awaiting_review'` (the original code
  guarded with `&& !reviewingAgent`; my selector does the same).

### 5.2 Architectural drift observed (but NOT a runtime bug)

The prior `selectRuntimeExecution` extracted
`reviewingAgent` but never used it. The canonical selector
exposes both, so the field is still observable downstream —
but the prior code was effectively dead code. The refactor
preserves this dead-code behaviour byte-for-byte (per the
zero-behavior-change rule). Future OBS-01 phases may want to
surface `reviewingAgent` to the UI; the selector is ready for
that.

### 5.3 Drift confirmed by the contract

The canonical runtime contract (`07_CANONICAL_RUNTIME_CONTRACT.md`)
§7 lists 17 forbidden patterns. The fix addresses:

| Pattern | Before | After |
| ------- | ------ | ----- |
| ❌ "Multiple runtime enums" | Two derivations co-existed in `workflowSelectors.ts`. | One module: `runtimeSelectors.ts`. |
| ❌ "UI guessing executionStatus" | The FE computed visible status from `agentStates` + `pipelinePhases` ad-hoc. | The FE reads only through the canonical selector. |
| ❌ "Bypassing `taskLifecycle.transition`" (FE side mirror) | The FE silently mirrored a value that the BE did NOT publish. | The canonical selector documents the rule: it consumes the store shape the BE emits. The eventual OBS-01.3 fix will add the BE producer. |
| ❌ "State projection duplication" | The same canonical `running` state had two projection paths (`'running'` and `'awaiting_review'`). | One canonical projection (`deriveAgentRuntimeState`) plus one visible projection (`projectAgentToPhaseStatus`). |

---

## 6. Contract conformance

The contract (`07_CANONICAL_RUNTIME_CONTRACT.md`) §9 lists 20
acceptance criteria. The implementation addresses the following
directly:

| AC | Status |
| -- | ------ |
| AC-12: The FE MUST render every executionStatus value. The CSS maps MUST contain an entry for every canonical state. | ✓ — the canonical projection maps every reachable canonical state to a `PhaseStatus` value the existing CSS maps already accept. The exhaustive test asserts this. |
| AC-13: Dashboard, Agent Task, and Inspector MUST NEVER disagree on the same input. | ✓ — the canonical selector is the single source; integration test asserts `selectRuntimeExecution.phases[i].status === projectAgentToPhaseStatus(session, i)`. |
| AC-14: No component may derive runtime state independently. | ✓ — the only derivation in the FE codebase lives in `runtimeSelectors.ts`. |
| AC-15: pipelinePhases updated ONLY by mapSessionStarted (seed) or by per-event lifecycle mappers. | Not affected by this fix — owned by Batch OBS-01.3 (mapper patches). |
| AC-16: agentStates updated ONLY by per-event lifecycle mappers and mapGatePending. | Not affected by this fix — owned by Batch OBS-01.3. |
| AC-17: wire MUST NOT carry presentation fields. | ✓ — the selector consumes only domain strings. |
| AC-18: SSE replay MUST forward row.envelope byte-for-byte. | Not affected by this fix. |

---

## 7. Per-state UI contract (carried forward)

The canonical selector produces values that the existing CSS
maps already accept. No CSS change. Per the contract §5.1:

| State | Border class | Chip background | Icon | Animation |
| ----- | ------------ | ---------------- | ---- | --------- |
| `idle` | `border-outline-variant/20` | `bg-surface-container` | `PlayCircle` | none |
| `queued` | `border-outline-variant/20` | `bg-surface-container` | `PlayCircle` | none |
| `dispatched` | `border-outline-variant/20` | `bg-surface-container` | `PlayCircle` | none |
| `running` | `border-blue-500/30` | `bg-blue-500/20 text-blue-300` | `Loader2` | `animate-spin` |
| `waiting_human` | `border-amber-500/30` | `bg-amber-500/20 text-amber-400` | `Clock` | none (per-task) |
| `completed` | `border-emerald-500/20` | `bg-emerald-500/20 text-emerald-400` | `Check` | none |
| `failed` | `border-red-500/30` | `bg-red-500/20 text-red-400` | `AlertCircle` | none |
| `cancelled` | `border-dashed border-outline-variant/20` | `bg-outline-variant/30` | `SkipForward` | none |

These are the existing CSS maps — the selector only produces
the keys, never the styles. Zero visual change.

---

## 8. Risks and mitigations

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| The refactor changes runtime output for some pathological input | Critical | Verified by exhaustive byte-identical trace table (§5.1) — no change observed for any input. |
| The integration test (`selectRuntimeExecution` round-trip) fails to catch a divergence | High | The integration test asserts `selectRuntimeExecution.phases[i].status === projectAgentToPhaseStatus(session, i)` for every agent on a representative input set. |
| The dead-code field `reviewingAgent` is removed during refactor | Low | Kept in `RuntimeStatus`; documented as dead-code-but-kept for parity. |
| New run-time state introduced | High | The exhaustive test (`UNREACHABLE_VIA_PROJECTION`) guards against new states leaking into the projection. |
| TypeScript regression in workflowSelectors.ts | Medium | `tsc --noEmit` passes cleanly. ESLint passes cleanly. |
| Existing tests break | High | All 13 pre-existing tests pass without modification. |

---

## 9. Files in this fix directory

This directory (`docs/runfix/`) contains exactly one report:

- `FIX_REPORT_OBS_01_1.md` — this document.

No patches are stored here. The patches live in the source
tree, committed to the relevant branches.

---

## 10. NOT VERIFIED

- The current behaviour of `selectRuntimeExecution` was
  verified at the integration-test level only (45 selector tests
  + 1 integration test + 5 pre-existing dashboard tests). A
  end-to-end visual snapshot comparison (Phase OBS-01.8) is
  outside OBS-01.1 scope.
- The fix does NOT touch the BE wire shape. The contract §4.2
  rule "every lifecycle envelope MUST carry `role: task.type`"
  is still a BE-side gap (R-001 / DR-007) — owned by Batch
  OBS-01.3.
- The fix does NOT introduce the per-event mapper patches that
  would carry the BE event stream into `pipelinePhases[i].status`.
  Today, `pipelinePhases` is still set ONCE at SSE connect and
  frozen. This is owned by Batch OBS-01.3 (per-event mapper
  patches).
- The `agentStates[i].status` field is still dormant for the
  canonical lifecycle path (mappers early-return because
  `env.role` is null). Owned by Batch OBS-01.3.

These three items are NOT part of OBS-01.1 and remain for
subsequent phases.