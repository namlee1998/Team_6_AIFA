# Engineering Conflicts

> **Status:** This is a working record created during Phase 3.5
> consolidation. No production code is modified.
>
> Per the Phase 3.5 brief: "If two reports disagree, DO NOT
> choose one. Create a section 'Engineering Conflict'."
>
> Conflicts surfaced here are between the four Phase 0–3 source
> reports (`docs/engineering-freeze/`,
> `docs/engineering-audit/`, `docs/architecture-drift/`,
> `docs/repair-design/`). They are recorded for Phase 4 to
> resolve BEFORE any code change.

---

## Conflict C-1 — R-001 severity classification

### Conflicting reports

- `docs/architecture-drift/08_DRIFT_MATRIX.md` — DR-007 is
  rated **Critical**: "observable user-visible behaviour loss in
  normal operation today."
- `docs/architecture-drift/08_DRIFT_MATRIX.md` — DR-016 is
  rated **Critical** (same row rationale).
- `docs/repair-design/02_REPAIR_BATCHES.md` §Batch D DR-007 —
  rated **Low (additive change)** under "Regression risk".

### Evidence

The DRIFT_MATRIX's Critical rating is based on the user-visible
magnitude of the bug (SSE replay misses the terminal event).
The repair-design's Low rating is based on the magnitude of
damage from a flawed fix (the persistence step is purely
additive — `AgentEvent.create` is added next to the existing
`publishEvent` call; no existing producer is harmed).

These are different axes:
- "Severity" (matrix) = magnitude of user-visible behaviour loss
  in the current code.
- "Regression risk" (repair-design) = magnitude of damage from a
  flawed fix.

Both can be true simultaneously.

### Reason for conflict

Different definitions of the rating scale. The matrix's severity
scale is documented at the top of `08_DRIFT_MATRIX.md`:
"Critical — observable user-visible behaviour loss in normal
operation today." The repair-design's risk scale is documented at
the top of `04_REGRESSION_RISK.md`: "Critical — Reasonable
fix-regression scenario can take the SDLC pipeline offline."
Both are valid but they are not the same scale.

### Required verification before repair

Phase 4 must record which scale applies to R-001 before
implementation:

- If the matrix scale governs: prioritise R-001 in Batch D
  step 1; gate Batch G / Batch F on R-001's verification (the
  user's audit trail depends on it).
- If the repair-design scale governs: R-001 is low-risk; the
  Batch D step 1 fix can ship with the same confidence as any
  additive change.

Recommendation (not a decision): treat R-001 as Critical under
the matrix scale (the user-visible behaviour loss is real); the
additive nature of the fix makes its regression risk Low. Both
are recorded.

---

## Conflict C-2 — R-028 (`session_resumed` sequence allocation)

### Conflicting reports

- `docs/engineering-freeze/08_CURRENT_KNOWN_ISSUES.md` I-29 —
  "Idempotency is per `Last-Event-ID`, not per sequence value,
  so functionally fine but counter leaks under reconnect churn."
  (no fix proposed.)
- `docs/architecture-drift/08_DRIFT_MATRIX.md` — DR-018 rated
  **Low**.
- `docs/repair-design/02_REPAIR_BATCHES.md` §Batch D DR-018 —
  "Regression risk: **Medium**. Coalescing by cursor can hide
  reconnect gaps. If the FE is missing frames, omitting a
  snapshot does not help."

### Evidence

Phase 0 says the behaviour is functionally fine; Phase 2 says
the bug is Low-severity; Phase 3 says the proposed fix is
Medium-risk because it may hide reconnect gaps.

The fix (coalesce by `Last-Event-ID`) is correct under the
assumption that the FE's dedup is per `envelope.id` (it is, per
`useWorkflowStore.ts:60-72`). But a stale FE that missed the
previous reconnect's snapshot would not catch up.

### Reason for conflict

Phase 0 and Phase 2 describe the current state; Phase 3
describes the proposed fix's side effect. They agree on
diagnosis; they disagree on whether the side effect is
acceptable.

### Required verification before repair

Phase 4 must confirm:

- The FE's dedup is per `envelope.id` (yes — confirmed in
  `useWorkflowStore.ts:60-72`).
- The reconnect semantics for stale FE clients are acceptable
  (depends on whether a stale FE ever reconnects after missing a
  snapshot in production — NOT VERIFIED).

If the FE behaviour is acceptable, coalesce (Batch D step 3)
is safe. If not, the alternative is to keep the sequence leak
and document it (Phase 0's stance).

---

## Conflict C-3 — Legacy `submitGateDecision` (R-040)

### Conflicting reports

- `docs/architecture-drift/02_FLOW_DRIFT.md` DR-001 — listed
  under Flow Drift with severity **High**.
- `docs/architecture-drift/04_OWNERSHIP_DRIFT.md` §8 (review)
  — marked **WARNING** ("Legacy path lacks `decisionId`; novel
  `decision='CLARIFICATION'`.")
- `docs/architecture-drift/08_DRIFT_MATRIX.md` DR-001 / DR-024
  — both rated **High** and **Medium** respectively.
- `docs/repair-design/02_REPAIR_BATCHES.md` §Batch C DR-001 —
  "Regression risk: **High**. Removing the legacy
  `submitGateDecision` removes a tested path
  (`sdlc.handoff.test.js`)."

### Evidence

The ownership document flags the missing `decisionId` as a
WARNING; the flow document and matrix rate it High; the
repair-design says the fix itself is High-risk because it
removes a tested path.

These are compatible readings: the bug is High (the legacy path
can approve without advancing the chain) AND the fix is High
(the path is tested). The conflict is in the recommended
resolution: the matrix says Phase 4 (Bucket C); the
repair-design says Batch C step 1.

### Reason for conflict

Terminology drift: Phase 2's "Phase 4" is Bucket C of the
Phase-2 taxonomy (release-flow ownership). Phase 3's "Batch C"
is the same bucket, renamed. Not a real conflict.

### Required verification before repair

Phase 4 must confirm the legacy path is reachable from any
production client (NOT VERIFIED in NV-7). If reachable, the
deprecation window must be communicated. If not reachable
(internal tests only), the path can be deleted in a single PR.

---

## Conflict C-4 — R-001 / R-041 split (`pipeline_completed` ownership)

### Conflicting reports

- `docs/architecture-drift/02_FLOW_DRIFT.md` DR-002 — "The §19.4
  A.3 re-architecture explicitly transferred ownership of the
  terminal event to `releaseManager`. **The single emitter
  invariant is met.** The corresponding persistence invariant is
  NOT."
- `docs/architecture-drift/03_CONTRACT_DRIFT.md` §DR-007 —
  treats the persistence miss as a separate drift item.
- `docs/repair-design/02_REPAIR_BATCHES.md` §Batch C / §Batch D —
  treats DR-002 and DR-007 as coupled: "the persistence layer
  persists from the wrong site" if not coordinated.

### Evidence

Phase 2 splits the issue into DR-002 (single emitter) and
DR-007 (persistence). Phase 3 merges them at the design level
because the single-emitter invariant is already met (no fix
needed), and the only remaining work is the persistence step.

The repair-design's R-041 lumps DR-002 and DR-003 into one
canonical entry; the master backlog's R-001 captures the
persistence step (DR-007 / DR-016) as the actionable work.

### Reason for conflict

Phase 2 documents the drift with two IDs because there are two
distinct observations (who owns it vs. is it persisted). Phase 3
collapses DR-002 because the ownership decision was already
made (per §19.4 A.3) and the only remaining gap is the
persistence step. This is not a contradiction; it is
progressive refinement.

### Required verification before repair

Phase 4 must confirm that the single-emitter invariant is
already met in current code (per `releaseManager.js:170-186`,
yes). If a different code path also emits `pipeline_completed`,
that path must be removed BEFORE R-001 lands (otherwise
persistence will be applied to one emitter and not the other).

Recommendation (not a decision): grep for `pipeline_completed`
in `backend/src` to confirm only one producer exists. Phase 3.5
NOT VERIFIED — Phase 4 to perform.

---

## Conflict C-5 — R-046 FE store actions (DR-027 / DR-028 granularity)

### Conflicting reports

- `docs/architecture-drift/07_DEAD_ARCHITECTURE.md` §4 — lists
  6 separate items (USA-1 through USA-6) for the FE store.
- `docs/architecture-drift/08_DRIFT_MATRIX.md` — collapses to
  two items (DR-027, DR-028).
- `docs/repair-design/02_REPAIR_BATCHES.md` §Batch A / §Batch E
  — keeps DR-027 and DR-028.

### Evidence

Phase 2 §07 enumerates every dead action individually
(`toggleSidebar`, `setSidebarCollapsed`, `setSelectedAgentKey`,
`openAgentDetailDrawer`, `closeAgentDetailDrawer`,
`openReleaseDialog`, `closeReleaseDialog`, `resetUi`,
`cleanupSession`, `resetAll`). The matrix in §08 collapses
these into two entries by store file.

### Reason for conflict

Different granularity. Not a real conflict.

### Required verification before repair

Phase 4 should follow the matrix's two-item grouping (DR-027
+ DR-028 = R-046) for the PR description; the §07 enumeration
is the per-action checklist.

---

## Conflict C-6 — `recoverInterruptedGates` (R-030) — fix shape

### Conflicting reports

- `docs/engineering-audit/03_PIPELINE_GAPS.md` G-4 — observes
  the bug, no fix proposed.
- `docs/architecture-drift/05_STATE_DRIFT.md` HT-1 — labels
  the bug as a "Hidden transition".
- `docs/architecture-drift/08_DRIFT_MATRIX.md` DR-014 —
  Critical.
- `docs/repair-design/02_REPAIR_BATCHES.md` §Batch C / §Batch F
  — three options (matrix entry, guard, extend `gateBridge.resolveGate`).

### Evidence

Phase 1 and Phase 2 agree on the diagnosis. Phase 3 proposes
three mutually exclusive fixes; the brief's "DO NOT choose one"
rule means Phase 4 (controlled implementation) must select one
of:

- **Option A**: add `'awaiting_gate → 'running'` to the
  `TRANSITIONS` matrix.
- **Option B**: introduce a `taskLifecycle.transitionIfPresent`
  guard at `_resumeInterruptedTask` and at
  `agentDispatcher.runAgent`.
- **Option C**: change `_resumeInterruptedTask` to go through
  `gateBridge.resolveGate({timedOut:true})` first.

### Reason for conflict

The fix shape is the unresolved governance decision documented
as Phase 3 Step 0.7 in `05_IMPLEMENTATION_ORDER.md`. Phase 3.5
consolidates the conflict; Phase 4 must capture an ADR.

### Required verification before repair

Phase 4 must record:

- Whether the SDK Promise mid-pause is reusable after a backend
  restart (determines whether Option C is viable).
- Whether the existing `transitionIfPresent` call site at
  `_saveAgentData:2041-2044` is a sufficient template for
  Option B (it is — the helper exists).
- Whether the matrix is the canonical enforcer of "anyone
  holding a paused thread may resume" (governance; Batch F).

---

## Conflict C-7 — R-021 `featureRequest` canonical owner

### Conflicting reports

- `docs/architecture-drift/04_OWNERSHIP_DRIFT.md` §3 — flagged
  **FAIL** ("Two durable owners for the same object").
- `docs/repair-design/02_REPAIR_BATCHES.md` §Batch B DR-008 —
  notes the two candidates:
  - Owner A: `Task.observability.featureRequest`
  - Owner B: `AgentArtifact` of type `'feature_request'`
- The brief's `04_OWNERSHIP_DRIFT.md` notes that the
  `compactContext` whitelist in `claudeCodeRunner.js:93-101`
  controls which keys reach the AIFA Context; for `po-agent`,
  `featureRequest` IS in the whitelist.

### Evidence

Phase 2 documents the conflict but does not resolve it. Phase
3 documents the two candidates and requires an ADR. Phase 3.5
does not choose.

### Reason for conflict

This is the canonical "Bucket C — Needs Architecture Decision"
flag from Phase 2 §09. Phase 4 must capture the ADR.

### Required verification before repair

Phase 4 must record:

- Which consumer is canonical (`compactContext` reads
  `featureRequest` from the in-process argument, not from
  `Task.observability`).
- Whether the downstream `AgentArtifact` is ever read by any
  consumer (Phase 3 §NOT VERIFIED — to grep).
- The migration story (dual-write window, then drop the
  non-canonical writer).

---

## Conflict C-8 — Auth roadmap (R-006 / R-013 / R-024 / Batch G)

### Conflicting reports

- `docs/engineering-freeze/08_CURRENT_KNOWN_ISSUES.md` I-6,
  I-13, I-25 — observations only.
- `docs/engineering-audit/03_PIPELINE_GAPS.md` G-16, G-17 —
  observations only.
- `docs/architecture-drift/08_DRIFT_MATRIX.md` — DR-004
  (High), DR-025 (Medium), DR-026 (Medium).
- `docs/repair-design/02_REPAIR_BATCHES.md` §Batch G — Critical
  (DR-004), Critical (DR-025), High (DR-026).
- `docs/repair-design/01_REPAIR_STRATEGY.md` §11 — "Whether the
  auth team's roadmap has a real RBAC layer planned
  (DR-004 / DR-025 / DR-026 depend on this)" — NOT VERIFIED.

### Evidence

All four sources agree: the bypass is the open governance item;
Batch G is gated on the auth roadmap. The Phase-3 risk
classification is Critical; the Phase-2 matrix classification is
High (DR-004) / Medium (DR-025, DR-026).

### Reason for conflict

Same as Conflict C-1 — different scales (severity vs regression
risk).

### Required verification before repair

Phase 4 must obtain:

- Auth team's roadmap commitment (NV-8).
- A canary deployment plan (NV-10).
- A multi-user test scaffold (Batch G §test-gaps).

Batch G cannot start without these.

---

## Conflict summary

Eight conflicts surfaced. None are contradictions of the
underlying diagnosis; all are resolution choices that require
an ADR. The conflicts are recorded here so Phase 4 does not
introduce drift by silently resolving them.

| ID | Conflict | Resolution required from |
| -- | -------- | ------------------------ |
| C-1 | R-001 severity scale | Phase 4 (governance; record scale) |
| C-2 | R-028 fix side-effect | Phase 4 (governance; coalesce vs document) |
| C-3 | R-040 deprecation scope | Phase 4 (governance; communicate deprecation) |
| C-4 | R-001 / R-041 split | Phase 4 (governance; grep for additional emitters) |
| C-5 | R-046 granularity | No resolution (Phase 3.5 keeps the matrix's grouping) |
| C-6 | R-030 fix shape | Phase 4 (ADR; matrix vs guard vs resolveGate) |
| C-7 | R-021 canonical owner | Phase 4 (ADR; owner A vs owner B) |
| C-8 | Batch G auth roadmap | External (auth team) |

C-5 is the only conflict that Phase 3.5 closes by inheritance
(the granularity is consistent enough). The other seven
remain open.
