# 03 — Contract Drift (Phase 2)

> **Status:** READ-ONLY. For each contract, identify the canonical
> producer and consumer (per Phase-0/Phase-1 baseline), the actual
> producer and consumer (per source), the observed drift, and the
> evidence. No fixes.
>
> Contracts in scope: HTTP DTO, SSE envelope, PendingGate, Approval,
> OutputReview, HitlDecision, Task, Session.

---

## 1. HTTP DTO

### Canonical producer / consumer

The canonical HTTP DTO is the wire shape returned by
`backend/src/controllers/SdlcController.js` and the legacy
`controllers/{Project,Document,Folder,Tree,SessionState}Controller.js`.
The freeze documents (`05_HTTP_ENDPOINT_INVENTORY.md`) enumerate the
canonical shapes.

### Actual producer / consumer

The SDLC HTTP layer's producer is `SdlcController`. The consumer is
the FE (`frontend/src/services/api/sdlcApi.ts`).

### Observed drift

#### DR-004 — `MembershipService` returns `'owner'` for every call

**Canonical expectation**: the
`MembershipService.requireProjectRole(user.id, projectId, [...])` call
is meant to gate by role. The contract assumes real RBAC enforcement
on every protected route.

**Actual producer**: `SdlcWorkflowService.js:20-31` and
`releaseManager.js:33-38` declare an inline stub:

```js
const MembershipService = {
  requireProjectRole: async () => ({ role: 'owner' }),
  listAccessibleProjectIds: async () => [],
  getUserProjectRole: async () => 'owner',
  createOwnerMembership: async () => { },
};
```

**Actual consumer**: every `requireProjectRole` invocation
(`SdlcWorkflowService.js:188, 267, 358, 689, 1054, 1098, 1132`,
`releaseManager.js:40`, `workflowQueries.js:21, 119, 159, 243`).

**Evidence**:
- `backend/src/services/SdlcWorkflowService.js:20-31`
- `backend/src/services/releaseManager.js:33-38`
- `backend/src/services/workflowQueries.js:19-22`

**Drift**: every protected endpoint behaves as if the caller is
`'owner'`. RBAC branches in
`releaseManager.js:42-44` (`['owner', 'admin']`) and
`SdlcWorkflowService.js:1212-1213` (same set, exposed to FE as
`canDecide`) are dead code under current conditions.

See `03_PIPELINE_GAPS.md G-17`.

---

#### DR-005 — `agentOutput` payload shape is not stable

**Canonical producer**: `_saveAgentData` writes the entire
`completedData` from the runner into `Task.agentOutput`
(`SdlcWorkflowService.js:2025-2034`). The
contract field carries both the role-specific artifact keys
(see `agentContract.REQUIRED_OUTPUT_KEYS`) and runner-internal
metadata (`token_usage`, `observability`, etc.).

**Canonical consumer**: `SdlcController.getTaskStatus:444` exposes
`agent_output: task.agentOutput || null` over HTTP.

**Actual consumer (FE)**: the FE receives whatever the runner
produced. Mock runners (`agentDispatcher.buildMockOutput:24-268`)
produce a different shape from the claude-code runner
(`claudeCodeRunner.normalizeOutput:291-342`): the former adds
`feature_request`, the latter adds `cli_session_id` /
`cli_total_cost_usd`.

**Evidence**:
- `backend/src/services/agentContract.js:24-46`
  (`REQUIRED_OUTPUT_KEYS`).
- `backend/src/agents/claudeCodeRunner.js:307-313` (claude-specific
  observability).
- `backend/src/services/agentDispatcher.js:168-170` (mock adds
  `feature_request`).
- `backend/src/controllers/SdlcController.js:444`.

**Drift**: there is no stable, documented "wire shape" for
`agent_output`. Different runners produce different shapes; reducers
must accept either.

See `03_PIPELINE_GAPS.md G-8`.

---

#### DR-006 — `HitlDecision.action` typos are not caught at the DB layer

**Canonical producer**: `submitStructuredDecision`,
`_handleGateRejection`, `resolveOutputReviewGate`,
`_autoApproveSafeOutput`, `releaseManager.submitReleaseDecision`,
`resolveApproval` (question branch).

**Canonical consumer**: `getAuditTrail` (`SdlcWorkflowService.js:776-784`)
maps `d.action` strings to lifecycle states by string equality.
`getWorkflowMetrics` (`workflowQueries.js:187-213`) counts
`action === 'auto_approve' | 'escalation_required'`.

**Drift**: `HitlDecision.action` (`schema.prisma:209`) is a free
`String?` with no CHECK constraint and no enum. Consumers in
`getAuditTrail` and `getWorkflowMetrics` branch on strings such as
`auto_approve`, `escalation_required`, `release_approve`,
`release_reject`, `edit_approve`, `answer`. A typo on the producer
side would persist silently and be invisible to consumers.

**Evidence**:
- `backend/prisma/schema.prisma:209` (free String).
- `backend/src/services/SdlcWorkflowService.js:776-784` (string
  equality).
- `backend/src/services/workflowQueries.js:187-213` (string
  equality).
- `backend/src/services/SdlcWorkflowService.js:204-230,
  521-527, 325-336` (producer-side strings).

**Drift**: contract enforcement is by convention only. Schema-level
enforcement is absent.

---

## 2. SSE envelope

### Canonical producer / consumer

The canonical envelope is `EventEnvelope`
(`backend/src/dto/eventEnvelope.js:34-45`). Producers use
`eventPublisher.publishEvent` (the only allowed path,
`eventPublisher.js:17-28`). The consumer is `SdlcController.streamPipelineStatus`
(SSE writer), which forwards frames via `sendEnvelope` to the FE
`sseClient.subscribe` (`frontend/src/services/sseClient.ts:27-119`).
The FE reducer is `applyEnvelope` in
`frontend/src/store/eventMappers.ts`.

### Observed drift

#### DR-007 — `pipeline_completed` envelope not persisted to `AgentEvent`

**Canonical producer**: `releaseManager.submitReleaseDecision` calls
`publishEvent('pipeline_completed', ...)` at line 173-186.

**Canonical consumer**: the SSE writer would expect the envelope to
also exist as an `AgentEvent` row for replay.

**Actual producer**: only `publishEvent` is called. No
`AgentEvent.create(envelope)` follows.

**Drift**: live SSE consumers see the terminal event; reconnecting
or replay consumers do NOT — `AgentEvent.list({ sessionId,
afterSequence })` returns zero rows for `pipeline_completed`. The
audit-trail timeline rendered by `getAuditTrail`
(`SdlcWorkflowService.js:833-862`) misses the final phase-transition.

**Evidence**:
- `backend/src/services/releaseManager.js:170-186` (publish only).
- `backend/src/services/taskLifecycleService.js:95-141` (the path
  every other event uses to persist envelope + transition).
- `backend/src/services/eventPublisher.js:17-28` (returns envelope;
  caller responsible for persistence).
- `backend/src/models/AgentEvent.js:21-41`
  (`AgentEvent.create({ envelope })`).
- `backend/src/controllers/SdlcController.js:340-357` (replay).

**Risk**: SSE replay on reconnect; audit-trail phase-transitions;
`getAuditTrail` report's terminal phase. See freeze I-1,
`03_PIPELINE_GAPS.md G-1`.

---

#### DR-017 — Three declared EventTypes have no producer

**Canonical producer**: declared in
`backend/src/dto/eventEnvelope.js:10-23`:

```
... | pipeline_failed | ... | task_resumed | ... | agent_event | runtime_log
```

**Canonical consumer**: `sseClient.isEnvelope` accepts any of these
types structurally; `eventMappers.ts` would route them to no-op
defaults.

**Actual producer**: no `publishEvent('pipeline_failed', …)`,
no `publishEvent('task_resumed', …)`, no `publishEvent('agent_event', …)`
callsite exists in current source. Verified by `grep` over the source
tree.

**Evidence**:
- `backend/src/dto/eventEnvelope.js:10-23`
- `frontend/src/dto/event.ts:6-19`
- `grep` results: only `session_started|resumed`, `pipeline_completed`,
  `task_started|completed|failed|interrupted`, `gate_pending|resolved`,
  `runtime_log` have producers.

**Drift**: the discriminator union overstates the producer surface.
TypeScript types inherit the inflation.

See freeze I-2, `03_PIPELINE_GAPS.md G-2`.

---

#### DR-018 — `session_resumed` allocates a fresh sequence per reconnect

**Canonical producer**: `SdlcController.streamPipelineStatus:367`
publishes `session_started` or `session_resumed` after every
reconnect.

**Actual producer behaviour**: `publishEvent` always calls
`sequenceService.next`, which always increments. So every reconnect —
even a no-op one where `Last-Event-ID === HEAD.sequence` — allocates
a fresh sequence number.

**Drift**: idempotency is per `envelope.id` (UUID), not per
sequence number. Reconnect churn leaks sequences; over time
`AgentEvent.sequence` and "logical snapshots" drift.

**Evidence**:
- `backend/src/controllers/SdlcController.js:313-378`
- `backend/src/services/eventPublisher.js:17-28`
- `backend/src/services/sequence.js:42-49`

See freeze I-29, `03_PIPELINE_GAPS.md G-14`.

---

#### DR-019 — SSE replay drops non-canonical `AgentEvent` rows

**Canonical producer**: every `AgentEvent` row in the DB.

**Canonical consumer**: `SdlcController.streamPipelineStatus:340-357`
replay loop.

**Drift**: rows that lack BOTH `envelope` and `payload` are silently
skipped. Rows with `payload` but no `envelope` and `type !==
'gate_audit'` are rebuilt via `buildLegacyEnvelope` and forwarded,
but the FE reducer drops them silently (no per-type mapper).

**Evidence**:
- `backend/src/controllers/SdlcController.js:340-357`
- `backend/src/dto/eventEnvelope.js` (canonical shape)
- `frontend/src/store/eventMappers.ts` (per-type mappers)

See freeze I-3, `03_PIPELINE_GAPS.md G-6`.

---

## 3. PendingGate

### Canonical producer / consumer

**Producer**: `gateBridge.requestGate` (`backend/src/services/gateBridge.js:51-83`).
Writes both:

- in-memory `pending` Map (`gateBridge.js:28`) — for live
  `Promise`-based waits during a Claude SDK call.
- `PendingGate` DB row via `PendingGate.create(eventData)`
  (`gateBridge.js:88-89`).

**Consumer**: `gateBridge.resolveGate` (`gateBridge.js:154-194`)
mutates both: deletes from in-memory Map, updates DB row via
`PendingGate.resolve(approvalId, status, result)`
(`gateBridge.js:165`, `backend/src/models/PendingGate.js:25-33`).

### Observed drift

#### DR-010 — In-memory `pending` map and `PendingGate` DB row are dual truths

**Drift**: the same `approvalId` lives in two places, and they are
written together. After a backend restart the in-memory map is gone;
the DB row survives (`status='interrupted'` after
`markOrphanedPendingInterrupted`, gateBridge.js:226-228). Replay
queries (`findPersisted`, `listInterrupted`) recover from the DB but
the in-memory `hasPending` (gateBridge.js:196) returns `false`.

For `kind='release'` specifically: the in-memory entry is created
on `requestGate` (`gateBridge.js:51-83`) but is never awaited (no
SDK is paused). It is dropped when `resolveGate` is called from
`releaseManager.submitReleaseDecision`. The DB row is also
resolved. So `kind='release'` creates two durable records — a
`PendingGate` row AND a `HitlDecision` row.

**Evidence**:
- `backend/src/services/gateBridge.js:51-83, 154-194, 226-228`
- `backend/src/models/PendingGate.js:25-33`
- `backend/src/services/releaseManager.js:106-194`

See freeze I-30, `03_PIPELINE_GAPS.md G-3` (partial), `02_FLOW_DRIFT.md
DR-003`.

---

## 4. Approval

### Canonical producer / consumer

**Producer**:
- Structured HITL `submitStructuredDecision`
  (`SdlcWorkflowService.js:264-336`) writes one `HitlDecision` row
  with `decisionId` (idempotency key).
- Legacy `submitGateDecision` (`SdlcWorkflowService.js:185-231`)
  writes one `HitlDecision` row without `decisionId`.
- `resolveOutputReviewGate` (`SdlcWorkflowService.js:466-591`) writes
  one `HitlDecision` row per approve/reject on the always-on
  output-review gate.
- `_handleGateRejection` (`SdlcWorkflowService.js:426-456`) writes
  two rows: one for the reject and possibly one for the
  `escalation_required` state.
- `_autoApproveSafeOutput` (`SdlcWorkflowService.js:2123-2162`)
  writes one `auto_approve` row.

**Consumer**:
- `getAuditTrail` (`SdlcWorkflowService.js:752-923`) reads all
  HitlDecision rows for a project.
- `getFinalReviewPacket` (`workflowQueries.js:114-155`) reads
  HitlDecision rows filtered to the session.
- `getWorkflowMetrics` (`workflowQueries.js:157-239`) aggregates
  counts by `decision` / `action`.
- `releaseManager.submitReleaseDecision:46-47` checks
  `HitlDecision.findByDecisionId` for idempotency.

### Observed drift

#### DR-006 (recap) — `decision` / `action` strings are not validated

`decision ∈ {APPROVE, REJECT, CLARIFICATION, REQUEST_CHANGES}`,
`action ∈ {approve, reject, edit_approve, auto_approve,
escalation_required, release_approve, release_reject, answer}`.

`HitlDecision.action` is `String?` with no enum, no check constraint.
`HitlDecision.decision` is `String` (no enum either).

Drift: typos on producer side persist; consumers silently ignore
unknown values. See freeze I-17, this doc DR-006.

---

#### DR-016 — `reviewerId` always `'local-user-id'` (DR-006 sibling)

**Drift**: `authMiddleware` sets `req.user = { id: 'local-user-id', …}`
(`backend/src/middleware/authMiddleware.js:1-10`). Every `HitlDecision`
record writes `reviewerId: user?.id || null` (e.g.
`SdlcWorkflowService.js:212, 523`).

**Evidence**:
- `backend/src/middleware/authMiddleware.js:1-10`
- `backend/src/services/SdlcWorkflowService.js:204-230, 521-527`
- `backend/src/services/releaseManager.js:33-86`

**Drift**: the audit trail cannot distinguish reviewers; the
"approve" event is always authored by the same logical user.

See `03_PIPELINE_GAPS.md G-16`, freeze I-13.

---

## 5. OutputReview

### Canonical producer / consumer

**Producer**: `_saveAgentData` (`SdlcWorkflowService.js:2071-2087`)
creates one `output_review` gate per agent run whose type is in
`AGENT_GATES` (`backend/src/services/sdlcConstants.js:8-15`).

**Consumer**: `resolveOutputReviewGate` (`SdlcWorkflowService.js:466-591`)
is the only resolver. On `kind=output_review`,
`gateBridge.resolveGate` does NOT call
`taskLifecycle.transition(taskId, 'running', …)` (the agent thread
is already terminal at this point — gateBridge.js:167-169).

### Observed drift

None at the producer side. The drift is at the resolver path:
`_handleGateRejection` (called on reject) re-runs the same agent,
which produces a new `Task` row but does NOT reset `versionStatus`
on the predecessor. This is documented but unverified for every
rework path.

#### DR-013 (related) — `versionStatus` ↔ `executionStatus` desync

`Task.update({ version_status: 'committed' })` is set inside the
gate approval path (`SdlcWorkflowService.js:321, 495`). The
`taskLifecycle.transition` machinery operates on `executionStatus`,
not `versionStatus`. The two are independent writes from different
modules. The next agent's
`requireApprovedTask(taskId, …)` checks `versionStatus === 'committed'`
(SdlcWorkflowService.js:1602-1604). If the structured HITL path
commits but the runtime path fails to commit (e.g. session crash
between the two updates), the next agent sees stale state.

**Evidence**:
- `backend/src/services/SdlcWorkflowService.js:321, 495`
- `backend/src/services/SdlcWorkflowService.js:1602-1604`
- `backend/src/models/Task.js:214-220` (Task.commitTask).

See `03_PIPELINE_GAPS.md G-12, G-3` (related), `05_STATE_DRIFT.md
DR-013`.

---

## 6. HitlDecision

### Canonical producer / consumer

Already covered above (DR-006, DR-016).

### Observed drift

#### DR-006 + DR-016 (already documented above)

#### Question branch HitlDecision shape

`resolveApproval` (SdlcWorkflowService.js:361-408) writes a
`HitlDecision` with `decision='CLARIFICATION'` and `action='answer'`.
This is **not** in the documented `decision` enum used elsewhere
(`APPROVE` / `REJECT`). The shape is novel.

**Evidence**:
- `backend/src/services/SdlcWorkflowService.js:381-396`

**Drift**: consumers (`getAuditTrail`, `getWorkflowMetrics`) do not
recognise `decision='CLARIFICATION'` as a distinct value; their
counters lump it with `'APPROVE'` only when action is `approve` (see
`workflowQueries.js:187-192`). The clarification question's
"answer" semantics is therefore not surfaced as a separate metric.

---

## 7. Task

### Canonical producer / consumer

**Producer**: `models/Task.js` (create, update, commitTask) +
`workflowOrchestrator.run*Agent` (initial create with
`executionStatus='queued'`).

**Consumer**: every service that reads Task state — `getWorkflowStatus`,
`getPipelineResponse`, `_requireApprovedTask`, `_saveAgentData`,
`agentDispatcher.markTaskFailed`, `taskWorkerService`, etc.

### Observed drift

#### DR-011 — `Task.observability` has multiple writers (and no schema)

`Task.observability` (schema.prisma:106) is `String?` (JSON). It is
written by:

- `workflowOrchestrator.runArchitectureAgent:107` — `{ featureRequest }`.
- `workflowOrchestrator.runPOAgent:358` — `{ repo, featureRequest }`.
- `SdlcWorkflowService._saveAgentData:2011-2015` — merged with
  whatever the agent returned.
- `agentDispatcher.markTaskFailed:514-528` — adds `failure` block.
- `taskLifecycleService` does NOT write `observability` directly.

Five writers, no schema. Concurrent writes can lose updates (last
write wins on JSON merge). The `featureRequest` field in particular
appears in BOTH `Task.observability.featureRequest` AND as an
`AgentArtifact` of type `'feature_request'`.

**Evidence**:
- `backend/src/services/workflowOrchestrator.js:104-108, 356-361`
- `backend/src/services/SdlcWorkflowService.js:2011-2015, 514-528`
- `backend/src/models/Task.js:106` (storage type).

See `04_OWNERSHIP_DRIFT.md DR-011`.

#### DR-012 — `Task.status` bypasses the canonical state machine

`Task.status` (schema.prisma:67, free `String`, default `'pending'`)
is written by 8 callers via `Task.update({ status: … })`, bypassing
`taskLifecycle.transition`. See `03_PIPELINE_GAPS.md G-3`,
`05_STATE_DRIFT.md DR-012`.

The string `'PENDING_TOOL_APPROVAL'` (legacy langchain path,
SdlcWorkflowService.js:1440-1444) is not in any documented state
set.

#### DR-013 — `Task.versionStatus` independent of state machine

`Task.versionStatus` (`schema.prisma:75`, default `'committed'` —
note the default is `committed`!) is written by:

- `Task.create` (`workflowOrchestrator.js:97, 353, 448, 494, 578`)
  with `'draft'`.
- `Task.commitTask` (`Task.js:214-220`) with `'committed'`.
- `SdlcWorkflowService.js:321, 495` (with `version_status:
  'committed'`).

The default in the schema is `'committed'` for fresh tasks that
bypass `Task.create`. **NOT VERIFIED** whether any path bypasses
`Task.create`.

**Evidence**: `backend/prisma/schema.prisma:75` (default `'committed'`).

**Drift**: the schema-default-value is a footgun. `Task.update`
without an explicit `versionStatus` argument leaves the column at
`'committed'`. `requireApprovedTask` (SdlcWorkflowService.js:1602-1604)
trusts the column to mean "this task was approved."

---

## 8. Session (PipelineSession)

### Canonical producer / consumer

**Producer**:
- `workflowOrchestrator.runArchitectureAgent:84-88` and
  `runPOAgent:304-308` create `PipelineSession` rows with
  `status='running'`.
- `workflowOrchestrator` updates `repoPath`, `workingBranch`,
  `baseBranch` (lines 162-166, 330-334).
- `SdlcWorkflowService.resolveOutputReviewGate:558` updates
  `status='awaiting_release'`.
- `releaseManager.submitReleaseDecision:168` updates
  `status='completed'`, `outputDir`.

**Consumer**: every workflow query (`getWorkflowStatus`,
`getFinalReviewPacket`, `_getRepoContext`,
`workflowOrchestrator.runPOAgent:297-336`,
`SdlcWorkflowService.recoverInterruptedGates:1787-1798`, etc.).

### Observed drift

#### DR-015 — `PipelineSession.status='running'` can be stuck

`PipelineSession.status` only transitions `running →
awaiting_release → completed` (per `02_STATE_MACHINE.md` §4). A
session whose tasks all fail or get cancelled never has its
`PipelineSession.status` updated. It stays `'running'`
indefinitely. `countActive` (PipelineSession.js:48-59) does not
filter by `PipelineSession.status` — it counts every session that
has at least one task in `pending|processing`.

**Evidence**:
- `backend/src/services/workflowOrchestrator.js:74-83` (cap check
  via `countActive`).
- `backend/src/models/PipelineSession.js:48-59` (definition).
- `backend/src/services/SdlcWorkflowService.js:548-578`
  (running → awaiting_release).
- `backend/src/services/releaseManager.js:168` (awaiting_release
  → completed).

**Drift**: stuck sessions inflate `countActive` until manually
cleaned. NOT VERIFIED whether any cleanup path exists for stuck
sessions.

#### DR-008 — `featureRequest` dual storage

Already discussed. See `04_OWNERSHIP_DRIFT.md DR-008`.

---

## 9. Other observable contract drifts

### DR-009 — `cli_session_id` / `cli_total_cost_usd` orphan writes

`claudeCodeRunner.normalizeOutput:307-313` writes
`cli_session_id: meta.sessionId || null` and
`cli_total_cost_usd: meta.totalCostUsd ?? null` into
`output.observability` (which is later persisted to
`Task.observability`). No consumer reads these specific keys.

**Evidence**:
- `backend/src/agents/claudeCodeRunner.js:307-313`
- `grep -rn 'cli_session_id\|cli_total_cost_usd' backend/src` —
  no consumer found.

**Drift**: data is produced but never consumed. Single-owner
violation (the writer is `claudeCodeRunner`; no consumer).

See freeze I-8.

---

## 10. NOT VERIFIED

The following could not be fully confirmed from the source tree:

- The exact number of legacy `AgentEvent` rows currently in
  `backend/prisma/dev.db` without `envelope` (NOT inspected).
- Whether `validate.js`, `authService.js`, `agentParser.js` are
  reachable via any historical test setup (no importers found).
- Whether `_resumeInterruptedTask`'s `awaiting_gate → running`
  rejection is silently swallowed or surfaces to callers (logic
  suggests the latter; the catch is in `recoverInterruptedGates`
  at line 1794).
- Whether `PipelineSession.status` ever transitions back from
  `'awaiting_release'` to `'running'` (no path observed).