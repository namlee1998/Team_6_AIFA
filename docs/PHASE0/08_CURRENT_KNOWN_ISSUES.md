# 08 — Current Known Issues (Frozen Baseline)

> **Status:** OBSERVATION ONLY. No new bug hunting.
> Each item below summarises a directly observable structural issue seen
> while reading the code. NO FIX. NO JUDGMENT.

Each entry documents:
- **Title**
- **Evidence** (file + line + observation)
- **Files**
- **Risk** (what is observably affected, NOT what is conjectured)

---

## I-1. `pipeline_completed` envelope is not persisted to `AgentEvent`

### Evidence

`backend/src/services/releaseManager.js:173-186`:

```js
await publishEvent(
  'pipeline_completed',
  { projectId, sessionId, taskId: qaTask.id, role: 'release' },
  {
    qaResult: { … },
  },
);
```

The call goes through `eventPublisher.publishEvent` which (per the
service's own contract) is supposed to persist the envelope to
`AgentEvent` via the `taskLifecycleService.publishLifecycle` path. But
this call site does NOT pass the returned envelope to
`AgentEvent.create` — it is "fire-and-forget" through the bus. There is
no `AgentEvent.create({...})` call in `releaseManager.submitReleaseDecision`.

### Effect on tables / wire
- Live SSE consumers see the `pipeline_completed` envelope.
- The `AgentEvent` table does NOT have a row with `type='pipeline_completed'`
  on APPROVE rows written this way.
- Replay (`AgentEvent.list({ sessionId, afterSequence })`) will therefore
  omit the final terminal envelope for sessions whose APPROVE happened in
  this build.

### Files
- `backend/src/services/releaseManager.js:106-191`
- `backend/src/services/eventPublisher.js:17-28`
- `backend/src/services/eventEnvelope.js:34-45`

### Risk
- Reconnect / late subscribers miss the terminal event on replay.
- The audit-trail timeline (`getAuditTrail`) does not include a
  `pipeline_completed` record purely sourced from the persisted row.
- All other lifecycle envelopes that reach `AgentEvent` are persisted by
  `taskLifecycleService.appendEvent` because they go through
  `transition` (which holds the prisma transaction open). `pipeline_completed`
  does not go through `transition` and is therefore the only event type
  in the canonical union whose persistence is asymmetric with the rest.

---

## I-2. `pipeline_failed` and `task_resumed` are declared but never emitted

### Evidence
- `backend/src/dto/eventEnvelope.js:11-23` lists
  `pipeline_failed | pipeline_completed | task_started | task_completed |
  task_failed | task_interrupted | task_resumed | …` as the EventType
  union.
- `releaseManager` only emits `pipeline_completed`.
- No `publishEvent('pipeline_failed', ...)` call exists in current source.
- No `publishEvent('task_resumed', ...)` call exists in current source.
- The `agent_event` type also has no producer in current source.

### Effect
- The discriminated union is wider than the produced set.
- Reconnect subscribers must expect these types per the contract but
  never see them; the FE `dto/event.ts` declares them in the TypeScript
  union.

### Files
- `backend/src/dto/eventEnvelope.js:11-23`
- `frontend/src/dto/event.ts:6-19`

### Risk
- Pure type-discriminator mismatch; no functional failure observed in the
  reviewed code.

---

## I-3. SSE replay drops non-canonical `AgentEvent` rows

### Evidence

`backend/src/controllers/SdlcController.js:340-357` only forwards
`row.envelope` verbatim; for legacy rows that lack `row.envelope`, it
rebuilds envelopes only for `row.type === 'gate_audit'` (mapping to
`runtime_log`). All other `row.type` values without `envelope` are
silently dropped from replay.

### Files
- `backend/src/controllers/SdlcController.js:340-357`

### Risk
- Pre-transport-refactor rows (`type='agent_event'` or any other
  pre-EventEnvelope string) are no longer surfaced to FE on reconnect.
- No public log of dropped rows; replay appears truncated.

---

## I-4. CORS bypass for loopback origins lets dev origins through without explicit allow-list

### Evidence

`backend/src/server.js:67-83`:

```js
if (NODE_ENV !== 'production') {
  allowedOrigins.add('http://localhost:5173');
  allowedOrigins.add('http://localhost:3000');
}

const corsConfig = {
  origin(origin, callback) {
    const isLocalDevOrigin = NODE_ENV !== 'production'
      && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
    if (!origin || allowedOrigins.has(origin) || isLocalDevOrigin) { … }
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
};
```

The `isLocalDevOrigin` branch accepts **any** `localhost`/`127.0.0.1`
port in non-production — not just 5173/3000.

### Files
- `backend/src/server.js:60-83`

### Risk
- Any local listener (sidecar, spoofed browser extension, malicious
  proxy on a localhost port) inherits FE credentials when not in
  production. There is no production risk because the branch is gated by
  `NODE_ENV !== 'production'`.

---

## I-5. `arch_runtime.js` exists at the backend root

### Evidence

`backend/arch_runtime.js:1-40`: standalone script that imports
`./src/agents/claudeCodeRunner`, runs `runAgent` against a hand-coded
"Add login page" feature request, logs the result, and exits. It is not
wired into `package.json` (no `scripts.arch_runtime`), is not referenced
by any other file, and is not a router entrypoint.

### Files
- `backend/arch_runtime.js`

### Risk
- Drift: the runner has been modified since the script was written; the
  runner signature has remained compatible so far, but the script is
  effectively dead code from the production system's perspective.

---

## I-6. Hardcoded "owner" role in inline `MembershipService` stubs

### Evidence

`backend/src/services/SdlcWorkflowService.js:20-31`:

```js
const MembershipService = {
  requireProjectRole: async () => ({ role: 'owner' }),
  listAccessibleProjectIds: async () => [],
  getUserProjectRole: async () => 'owner',
  createOwnerMembership: async () => { },
};
```

`backend/src/services/releaseManager.js:33-38`: same stub, redclared.

### Files
- `backend/src/services/SdlcWorkflowService.js:20-31`
- `backend/src/services/releaseManager.js:33-38`
- `backend/src/services/workflowQueries.js:19-22`
- `backend/src/middleware/authMiddleware.js:1-10`

### Risk
- The orchestrator cannot distinguish roles. The `release_gate.canDecide`
  field returned from `getWorkflowStatus`
  (SdlcWorkflowService.js:1212-1213) and the owner/admin check in
  `releaseManager.submitReleaseDecision` (releaseManager.js:42-44) both
  always succeed because the role is always `'owner'`. The role-based
  branches exist but never fire a different branch.

---

## I-7. `socketService.js` is deleted but referenced historically

### Evidence
- `git status` shows `D backend/src/services/socketService.js`.
- No current source imports it.

### Risk
- Any out-of-tree docs or commit messages may still mention socket.io
  or old "auth-bypass" policies tied to it.

---

## I-8. `cli_session_id`, `cli_total_cost_usd` carried in observability but not consumed

### Evidence

`backend/src/agents/claudeCodeRunner.js:307-313`:

```js
output.observability = {
  ...(output.observability || {}),
  runner: 'claude-agent-sdk',
  cli_session_id: meta.sessionId || null,
  cli_total_cost_usd: meta.totalCostUsd ?? null,
  output_contract: AGENT_CONTRACT_VERSION,
};
```

The fields are written to `Task.observability` (`models/Task.js:106` —
observability is serialized as JSON). No read site for these specific
keys was found in any controller or service during the freeze review.

### Files
- `backend/src/agents/claudeCodeRunner.js:307-313`
- `backend/src/models/Task.js:106`

### Risk
- Storage of values with no readers.

---

## I-9. `sessionId`-less tasks still write a `task_queued` AgentEvent

### Evidence

`backend/src/models/Task.js:67-83` (the else branch of the envelope
guard):

```js
} else {
  // Pre-session-bound task (legacy tests only) — fall back to a
  // legacy AgentEvent row carrying no envelope and an arbitrary
  // sequence. The legacy replay fallback in SdlcController reads
  // these rows through the controller's legacy replay helper.
  await tx.agentEvent.create({
    data: {
      taskId: task.id,
      projectId: task.projectId,
      sessionId: null,
      sequence: 1,                             // <-- hardcoded
      type: 'task_queued',
      actor: 'orchestrator',
      payload: JSON.stringify({ stage: task.type }),
    },
  });
}
```

Every pre-session-bound task writes a row with `sequence: 1` and
`sessionId: null`. The replay fallback ignores these rows because
`AgentEvent.list({ sessionId, ... })` filters by sessionId and they
won't match.

### Files
- `backend/src/models/Task.js:67-83`

### Risk
- Legacy rows accumulate; replay never surfaces them.

---

## I-10. `socketService.js` deletion: no SSE-equivalent boot re-subscription

### Evidence

Live wire consumers used to attach via Socket.IO. Now SSE is the only
path. There is no server-side "join session on creation" step; the
frontend decides when to open `eventStream.subscribe`. If the user
never opens `/sdlc/build?sessionId=...` after kicking off a run, no
session_started event is published for that live session and the SSE
will not deliver anything for it.

### Files
- `frontend/src/store/useWorkflowStore.ts:155-187`

### Risk
- Functional, not a bug in code: the user MUST open the SSE connection
  for any live state to surface.

---

## I-11. Folder-upload removal leaves `Project` `description` un-fillable from any UI

### Evidence

The controller routes for `/api/v1/projects` are PATCH/POST and accept
`name`. The folder-upload flow that originally created projects (the
"Open folder" UI) is removed (HTTP 410 on `POST /sdlc/upload-repo`).
No replacement project-creation UI is wired in any source comment or
file.

### Files
- `backend/src/routes/projects.js`
- `backend/src/controllers/ProjectController.js`
- `frontend/src/components/layout/dialogs/ImportProjectDialog.tsx`

### Risk
- UI may depend on dialogs the backend no longer serves; no
  out-of-tree evidence reviewed.

---

## I-12. `Task.create` and `AgentEvent` write in the SAME transaction, but `envelope.id` is allocated BEFORE the tx

### Evidence

`backend/src/services/eventPublisher.js:17-28`:

```js
async function publishEvent(type, base, payload) {
  if (!base || !base.projectId) throw ...;
  if (!base.sessionId) throw ...;
  const sequence = await sequenceService.next(base.sessionId, base.projectId);
  const envelope = createEnvelope(type, base, payload, sequence);
  eventBus.publish(envelope);
  return envelope;
}
```

This fires `eventBus.publish(envelope)` BEFORE any DB write has
happened. The bus subscribers see the envelope, but the transactional
`Task.create` path (models/Task.js:25-87) writes the row only if
`Task.create` succeeds. If the `prisma.$transaction` rolls back after
the sequence was allocated, a sequence is consumed but no row is
written. Subsequent `AgentEvent.list({ sessionId, afterSequence })`
will see a gap.

### Files
- `backend/src/services/eventPublisher.js:17-28`
- `backend/src/models/Task.js:25-87`
- `backend/src/services/taskLifecycleService.js:95-141`

### Risk
- Per-session sequence counter drift on rolled-back transactions.
  The current build is single-process and SQLite, so this is
  observable but not load-tested.

---

## I-13. `MembershipService` is required at the function level but stubbed at the module level

### Evidence

`backend/src/services/releaseManager.js:33-41`:

```js
const MembershipService = {
  requireProjectRole: async () => ({ role: 'owner' }),
  ...
};
const membership = user
  ? await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer'])
  : null;
```

`user` is always truthy (the local-dummy middleware always sets
`req.user`), so the `user ?` ternary always takes the truthy branch and
always gets `{ role: 'owner' }` back.

### Files
- `backend/src/services/releaseManager.js:33-41`
- `backend/src/middleware/authMiddleware.js:1-10`

### Risk
- Inconsistent user data shapes — `user.id === 'local-user-id'` and the
  reviewer / approver identity is never actually stored from a real
  auth source. `HitlDecision.reviewerId` ends up as `null` in every
  record created today.

---

## I-14. `prettier` and `eslint` coverage inconsistent across the codebase

### Evidence

`.prettierrc` exists at root; `eslint.config.js` lives in
`frontend/`. Neither has been wired into the backend lint pipeline at the
time of review. The `lint-results.txt` file in `frontend/` is a
historical artifact (~18K bytes).

### Files
- `frontend/eslint.config.js`, `frontend/.prettierrc`,
  `frontend/lint-results.txt`

### Risk
- Style drift; lint noisy only at the FE boundary.

---

## I-15. `package.json` scripts are partial

### Evidence

`backend/package.json` exposes `dev`, `test`, no `start`, no `lint`,
no `db:push`. `frontend/package.json` has `dev`, `test`, `build`,
`typecheck`. No top-level `package.json` script wires the two
together.

### Files
- `backend/package.json`
- `frontend/package.json`

### Risk
- Manual orchestration: `npm run dev` in `backend/` + `npm run dev` in
  `frontend/` + (if needed) `python main.py` for the agents service.

---

## I-16. Project `description` is stored but unused by agent prompts

### Evidence

`backend/prisma/schema.prisma:27`: `Project.description String?` is
written. No read of this field is found in any of the agent prompts
under `backend/src/agents/prompts/` (only `featureRequest` /
`feedbackPrompt` / `repoContext` flows into the AIFA context).

### Files
- `backend/prisma/schema.prisma:27`
- `backend/src/agents/prompts/architecture.prompt.md`
  (referenced indirectly)

### Risk
- Pure: dead column.

---

## I-17. `Decision.action` value space is over-loaded

### Evidence

`backend/prisma/schema.prisma:209` defines
`action String?` with no check constraint or enum. Consumers in
`getAuditTrail`, `decisionState`, `agentDispatcher`, etc., branch on
strings: `auto_approve`, `release_approve`, `release_reject`,
`escalation_required`, `edit_approve`, `approve`, `reject`, `answer`.

### Files
- `backend/prisma/schema.prisma:209`
- `backend/src/services/SdlcWorkflowService.js:779-784`
- `backend/src/services/releaseManager.js:83`

### Risk
- Stringly-typed decisions; typos not caught at DB layer.

---

## I-18. `repoInfo.commitSha` derivation is best-effort and may return stale values

### Evidence

`backend/src/services/repoService.js:49-68`:

```js
async function getSessionRepoInfo({ projectId, sessionId } = {}) {
  …
  const sha = (await git(['rev-parse', '--short', 'HEAD'], repoPath)).trim();
  if (sha) commitSha = sha;
  …
}
```

The SHA is read from whatever is on HEAD at the time of call. The
`_buildSessionRepoInfo` wrapper
(`SdlcWorkflowService.js:1334-1342`) does NOT verify that the SHA
matches the `release_outputs.commit` referenced by the post-release
envelope (`releaseManager.js:178` writes `commitSha: 'see session.repoInfo'`).

### Files
- `backend/src/services/repoService.js:49-68`
- `backend/src/services/SdlcWorkflowService.js:1334-1342`
- `backend/src/services/releaseManager.js:178-184`

### Risk
- The `pipeline_completed.qaResult.commitSha` field is a placeholder
  string `'see session.repoInfo'`. The place it points to (`repoInfo`)
  is best-effort and may not match the actual release commit. The
  contract does not promise identity between them.

---

## I-19. `Sessions` controller shadows the SDK routes

### Evidence

`backend/src/routes/index.js:18` registers `/sessions` (the
session-state persistence route) BEFORE the same path is mounted under
`/sdlc/sessions/...`. The router mount order means
`/api/v1/sessions/:page` resolves to `SessionStateController`, while
`/api/v1/sdlc/sessions/:session_id/...` resolves to `SdlcController`.

### Files
- `backend/src/routes/index.js:12-18`

### Risk
- The two namespaces are distinct (one is `/sessions/:page`, the other
  is `/sdlc/sessions/:session_id/...`). No collision at runtime, but
  the conceptual name overlap is observable.

---

## I-20. `_runAgent` always uses the per-task worker lock regardless of `EXECUTION_PATH`

### Evidence

`backend/src/services/agentDispatcher.js:319-325` (runAgent calls
`taskWorker.beginRun(task.id, { budgetMs, onTimeout })` UNCONDITIONALLY
for every path (mock, codex, claude-code, langchain). The
multi-process story in the comments is single-process by design.

### Files
- `backend/src/services/agentDispatcher.js:319-325`

### Risk
- Horizontal scaling is unimplemented. Multiple backend instances
  running on the same DB would race on the per-task lock; current
  design assumes one process.

---

## I-21. `featureRequest` is persisted on the Task observability but also on AgentArtifact

### Evidence

`workflowOrchestrator.runArchitectureAgent:106-108` persists
`{ featureRequest }` on the task's `observability`. The AgentArtifact
table also carries `feature_request` rows (per `_saveAgentData`
artifactTypes list, `SdlcWorkflowService.js:1829`).

### Files
- `backend/src/services/workflowOrchestrator.js:104-108`
- `backend/src/services/SdlcWorkflowService.js:1829`

### Risk
- Two sources of truth for the same data.

---

## I-22. `releaseManager` does NOT persist `pipeline_completed` (mentioned above as I-1)

I-1 already covers this; listed again here to anchor that
`pipeline_completed` is the ONLY canonical event type the codebase
emits live-but-not-persisted. No fix.

---

## I-23. `Mock_*` flags have inconsistent names

### Evidence

`USE_MOCK_AGENTS` vs `USE_MOCK_CLAUDE_CODE` vs
`MOCK_SCENARIO`. Three separate flags for overlapping concerns.

### Files
- `backend/src/services/agentDispatcher.js:383`
- `backend/src/agents/claudeCodeRunner.js:514`
- `backend/src/services/sdlcConstants.js:447-449`

### Risk
- Operationally confusing.

---

## I-24. Frontend `useWorkflowStore` uses a module-level `Set` for envelope dedup

### Evidence

`frontend/src/store/useWorkflowStore.ts:60-72`:

```ts
let lastSeenEnvelopeId: string | null = null;
const seenEnvelopeIds = new Set<string>();
const SEEN_ENVELOPE_LIMIT = 1000;
const lastSeenSequenceBySession = new Map<string, number>();
const sseUnsubscribeFns = new Map<string, () => void>();
```

These module-level structures survive across React component
unmount/remount; `resetAll` clears them but a full page reload
re-creates them fresh.

### Files
- `frontend/src/store/useWorkflowStore.ts:60-72`

### Risk
- After a non-resetting remount, the in-memory dedup set can include
  stale entries from a previous user session. The LRU bound (1000)
  mitigates but does not eliminate this.

---

## I-25. `releaseGate.canDecide` always evaluates against `owner`

### Evidence

`backend/src/services/SdlcWorkflowService.js:1212-1213`:

```js
canDecide: ['owner', 'admin'].includes(membership?.role),
```

combined with `I-6` / `I-13` → `membership?.role === 'owner'` always,
so `canDecide` is always `true`.

### Files
- `backend/src/services/SdlcWorkflowService.js:1212-1213`
- `backend/src/services/SdlcWorkflowService.js:1132-1134`

### Risk
- UI sees always-true; the role-based branch never narrows.

---

## I-26. Order-of-operations: Sentry.init at module load time

### Evidence

`backend/src/server.js:21-31`: Sentry is initialised when
`./src/server.js` is required. `require.main === module` check is at
the bottom.

### Files
- `backend/src/server.js:21-31, 178-180`

### Risk
- Tests that require `app` (the export at line 182) without running
  `startServer()` still trigger Sentry init. Sentry is a no-op when
  `SENTRY_DSN=''`. Tests should not have side effects at require time.

---

## I-27. `agentOutput` field on Task may equal the full completedData (including non-payload metadata)

### Evidence

`backend/src/services/SdlcWorkflowService.js:2025-2034`:

```js
await Task.update(task.id, {
  status: 'completed',
  output_content_hash: outputHash,
  result: taskResult,
  observability,
  // Structured HITL (plan 2.4): …
  agentOutput: completedData,
  gateMode: this._resolveGateMode(task),
});
```

`completedData` is the full agent output — including `summary`,
`token_usage`, `observability`, etc. The field is later shipped via
`getTaskStatus` → SSE → frontend `agentStates.agentOutput` (full copy).
Some of those fields are not exposed to FE; some are metadata.

### Files
- `backend/src/services/SdlcWorkflowService.js:2025-2034`
- `backend/src/controllers/SdlcController.js:444` (returns
  `agent_output: task.agentOutput || null`)

### Risk
- Wire-shape coupling; minor.

---

## I-28. `arrangeCurrentPhase` collapses the BACKLOG edge case for ARCH-only-no-PO

### Evidence

`backend/src/services/workflowHelpers.js:237-262`:

```js
function deriveCurrentPhase(architectureTask, poTask, …) {
  if (!architectureTask && !poTask) return 'BACKLOG';
  if (architectureTask) {
    if (architectureTask.status === 'pending' || architectureTask.status === 'processing') return 'ARCHITECTURE_RUNNING';
    if (architectureTask.status === 'failed') return 'ARCHITECTURE_FAILED';
    if (!decisionsByTaskId[architectureTask?.id] || decisionsByTaskId[architectureTask?.id]?.decision !== 'APPROVE') return 'ARCHITECTURE_REVIEW';
  }
  if (!poTask) return 'BACKLOG';
  …
}
```

When ARCH exists with no PO task AND ARCH is already approved (a
post-1.0 race or pre-Phase-2 data), the function still returns
`BACKLOG` because `poTask` is null. There is a documented comment in
`SdlcWorkflowService.getWorkflowStatus:1106-1109` about the "fresh
session stuck on backlog" symptom.

### Files
- `backend/src/services/workflowHelpers.js:237-262`
- `backend/src/services/SdlcWorkflowService.js:1106-1109` (comment)

### Risk
- Phase string confusion; no auto-advance bug.

---

## I-29. `_session_resumed` envelope ALWAYS allocates a new sequence

### Evidence

`backend/src/controllers/SdlcController.js:313-378`:

```js
const cursorRaw = req.headers['last-event-id'] ?? req.query.after_sequence ?? 0;
let lastSeq = Number.isFinite(Number(cursorRaw)) ? Number(cursorRaw) : 0;
…
await publishEvent(snapshotType, …);
```

`publishEvent` always calls `sequenceService.next` which always
increments. So every reconnect allocates a new sequence for the same
logical "session_resumed" event, even if the cursor and the snapshot
are identical.

### Files
- `backend/src/controllers/SdlcController.js:313-378`
- `backend/src/services/sequence.js:42-49`

### Risk
- Sequence consumption on every reconnect. Idempotency is per
  `Last-Event-ID`, not per sequence value, so functionally fine but
  counter leaks under reconnect churn.

---

## I-30. `feature_request` artifact persisted by ARCH will be re-written by every later agent that has it in `artifactTypes`

### Evidence

`SdlcWorkflowService._saveAgentData:1829`: `feature_request` is in the
master `artifactTypes` list. Every agent's save loop, when
`completedData.feature_request` is set (only the architecture / po path
seeds it via `buildMockOutput:168-170` and `agentDispatcher.js:447-449`),
upserts a row keyed by `${artType}:${task.id}`.

### Files
- `backend/src/services/SdlcWorkflowService.js:1829`
- `backend/src/services/agentDispatcher.js:447-449` &
  `agentDispatcher.buildMockOutput:168-170`

### Risk
- Multiple agents writing the same artifactType key on different tasks
  is fine because the key is per-task. The `feature_request` itself
  is rewritten if a non-ARCH agent happens to receive it in
  `completedData`.

---

## Summary table

| ID    | Title                                                                                              | Surface                                   |
| ----- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| I-1   | `pipeline_completed` envelope not persisted to `AgentEvent`                                      | SSE replay, audit trail                   |
| I-2   | `pipeline_failed` / `task_resumed` / `agent_event` declared but never emitted                    | type discriminator union                  |
| I-3   | SSE replay drops non-canonical `AgentEvent` rows                                                 | SSE replay                                |
| I-4   | CORS `isLocalDevOrigin` allows any loopback port in dev                                         | dev / non-prod                             |
| I-5   | `arch_runtime.js` orphan script at backend root                                                  | drift                                     |
| I-6   | Inline `MembershipService` stubs hardcode `owner`                                               | role enforcement                          |
| I-7   | `socketService.js` deleted (no live references)                                                  | docs                                      |
| I-8   | `cli_session_id` / `cli_total_cost_usd` written, no reader                                       | observability                             |
| I-9   | Pre-session-bound tasks write a hardcoded `sequence: 1`                                          | legacy replay                             |
| I-10  | No server-side session-start subscription; SSE is client-driven                                   | live SSE lifecycle                        |
| I-11  | Folder-upload removal leaves project creation open-ended in UI                                    | UI ↔ backend                               |
| I-12  | Sequence allocation is non-transactional with `Task.create` / `AgentEvent.create`                  | sequence drift                            |
| I-13  | `user.id === 'local-user-id'` always; `reviewerId` always `null`                                 | audit trail                               |
| I-14  | Lint coverage inconsistent                                                                        | tooling                                   |
| I-15  | No top-level orchestration script                                                                 | dev workflow                              |
| I-16  | `Project.description` unused by agent prompts                                                    | dead column                               |
| I-17  | `HitlDecision.action` is `String?`, no check                                                     | type safety                               |
| I-18  | `pipeline_completed.qaResult.commitSha` is a placeholder string                                   | released-bundle wire shape                |
| I-19  | `/sessions/...` vs `/sdlc/sessions/...` namespace overlap                                        | routes                                    |
| I-20  | Single-process assumption (worker lock is per-process)                                           | horizontal scale                          |
| I-21  | `featureRequest` persisted twice (Task observability + AgentArtifact)                             | redundancy                               |
| I-22  | duplicate of I-1                                                                                  | reference                                 |
| I-23  | Mock flag names inconsistent                                                                     | ops                                       |
| I-24  | Module-level dedup Sets survive unmount-remount                                                  | FE SSE dedup                              |
| I-25  | `releaseGate.canDecide` always true                                                              | UI gating                                 |
| I-26  | Sentry.init at module require time                                                                | test cleanliness                          |
| I-27  | `agentOutput` carries more than wire-only fields                                                  | wire shape                                |
| I-28  | `deriveCurrentPhase` collapses `BACKLOG` when ARCH-only-no-PO is approved (commented)             | phase string                              |
| I-29  | `session_resumed` snapshot allocates a new sequence per reconnect                                | sequence drift                            |
| I-30  | `feature_request` artifact written by multiple agents                                          | artifact dedup                            |

NO FIX IS PROPOSED FOR ANY OF THESE IN THIS PHASE. They are observations
for the Phase-1 audit.