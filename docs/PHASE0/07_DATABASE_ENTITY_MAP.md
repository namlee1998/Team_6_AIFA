# 07 — Database Entity Map (Frozen Baseline)

> **Status:** OBSERVATION ONLY.
> Source: `backend/prisma/schema.prisma` and the model classes in
> `backend/src/models/`. No analysis of correctness.

Database: SQLite via Prisma. URL is `env("DATABASE_URL")` (default
`file:./dev.db`). WAL mode + `connection_limit=1`
(`backend/src/config/database.js`).

The diagram below names every entity in the schema and its relations.
Cardinalities are taken from `schema.prisma`; defaults are noted where
present.

---

## 1. Schema diagram (logical)

```
Project ─────────────► PipelineSession ─────────► Task
   │                       │                        │
   │                       │                        ├─► AgentArtifact
   │                       │                        ├─► AgentEvent ──┐
   │                       │                        │                │
   ▼                       ▼                        ▼                ▼
(owning Project)      (owning Project)       FeatureBacklog    (per-session
                                                            sequence space)
                                                            stored on row)


Task ──────────────► AgentEvent (FK taskId, cascades on Task delete)
Task ──────────────► AgentArtifact (FK taskId)
Task ──────────────► FeatureBacklog (optional link)
Task ──────────────► HitlDecision (FK taskId — append-only audit)
PipelineSession ► Task (FK sessionId, NULL allowed for pre-session runs)

PendingGate (approvalId is PK, has Task.fk via taskId but no Prisma relation)
HitlDecision (FK taskId, has decisionId @unique idempotency key)

Document (FK projectId, optional folderId)
Folder (FK projectId, optional parentId — self-tree)
Testcase (FK taskId, FK projectId, direct prisma relationship via field)
SessionState (page-based, no FK)
```

Note: Prisma only declares FKs for the relationships listed above;
`PendingGate.taskId`, `HitlDecision.taskId`, `FeatureBacklog.taskId`,
`AgentArtifact.taskId` are stored as scalars without `references`
clauses.

---

## 2. Entities

### `Project`

Source: `schema.prisma:24-34`, `models/Project.js`

| Field        | Type          | Notes                                                |
| ------------ | ------------- | ---------------------------------------------------- |
| `id`         | String @id    | UUID                                                 |
| `name`       | String        |                                                      |
| `description`| String?       |                                                      |
| `createdBy`  | String?       |                                                      |
| `createdAt`  | DateTime      | default `now()`                                      |
| `updatedAt`  | DateTime      | updatedAt                                            |
| `tasks`      | Task[]        | relation                                             |
| `pipelineSessions` | PipelineSession[] | relation                                       |

### `PipelineSession`

Source: `schema.prisma:45-61`, `models/PipelineSession.js`

| Field         | Type        | Notes                                                              |
| ------------- | ----------- | ------------------------------------------------------------------ |
| `id`          | String @id  | UUID; returned to the FE on `runArchitectureAgent` for SSE             |
| `projectId`   | String      | FK → Project                                                       |
| `title`       | String?     | free-text                                                          |
| `status`      | String      | default `'running'`; transitions: running → `awaiting_release` → `completed` |
| `repoPath`    | String?     | per-session working tree path                                      |
| `workingBranch` | String?   | e.g. `aifa/<slug>`                                                 |
| `baseBranch`  | String?     | default `'main'`                                                   |
| `outputDir`   | String?     | set by `releaseManager` to the bundle directory                    |
| `createdAt`   | DateTime    | default `now()`                                                    |
| `updatedAt`   | DateTime    | updatedAt                                                          |
| `tasks`       | Task[]      | relation                                                           |
| `@@index([projectId])` |       |                                                                   |

Status transitions (from source):
- `running` (initial) → `awaiting_release` (after QA approve)
- `awaiting_release` → `completed` (after release APPROVE)
- See also `taskLifecycleService` for task-level states.

### `Task`

Source: `schema.prisma:63-101`, `models/Task.js`

`Task` is the core execution unit. One row per agent run.

| Field            | Type        | Notes |
| ---------------- | ----------- | ----- |
| `id`             | String @id  | UUID  |
| `projectId`      | String      | FK → Project                       |
| `sessionId`      | String?     | FK → PipelineSession               |
| `type`           | String      | `architecture-agent`, `po-agent`, `ux-agent`, `dev-agent`, `qa-agent`, or legacy `intent-agent`, `extract-flows`, `generate-testcases` (kept for historical rows) |
| `status`         | String      | defaults to `'pending'` |
| `promptProfile`  | String?     |       |
| `result`         | String?     | JSON string                          |
| `error`          | String?     |       |
| `inputContentHash` | String?  |       |
| `outputContentHash` | String? |       |
| `sourceRunId`    | String?     | predecessor Task.id                 |
| `versionStatus`  | String      | default `'committed'`               |
| `observability`  | String?     | JSON: `{ featureRequest?, repo?, failure?, ... }` |
| `agentOutput`    | String?     | JSON: raw agent output              |
| `approvedOutput` | String?     | JSON: human-approved output         |
| `outputVersion`  | Int         | default `0`; bumped on `edit_approve` |
| `retryCount`     | Int         | default `0`                         |
| `lastRetryReason`| String?     |       |
| `gateMode`       | String?     | `strict_manual` / `confidence_based` / `auto_approve_safe` |
| `executionStatus`| String      | default `'queued'`; state machine (see below) |
| `attempt`        | Int         | default `0`                         |
| `maxAttempts`    | Int         | default `1`                         |
| `lockedBy`       | String?     | worker id owning the run            |
| `lockedAt`       | DateTime?   |       |
| `heartbeatAt`    | DateTime?   |       |
| `startedAt`      | DateTime?   | set on first `running` transition  |
| `finishedAt`     | DateTime?   | set on terminal                     |
| `createdAt` / `updatedAt` | DateTime | |
| `@@index([projectId, sessionId])` | | |

Execution state machine (`taskLifecycleService.TRANSITIONS`):
```
queued        → dispatched / running / cancelled
dispatched    → running / cancelled / timeout
running       → awaiting_gate / completed / failed / cancelled / timeout
awaiting_gate → running / failed / cancelled / timeout
completed, failed, cancelled, timeout  (terminal)
```

Terminal set: `['completed', 'failed', 'cancelled', 'timeout']`
(taskLifecycleService.js:11).

### `AgentEvent`

Source: `schema.prisma:103-125`, `models/AgentEvent.js`

| Field        | Type        | Notes |
| ------------ | ----------- | ----- |
| `id`         | String @id  | UUID |
| `taskId`     | String      | FK → Task, cascade on delete |
| `projectId`  | String      | denormalised for project-scoped reads |
| `sessionId`  | String?     | used as part of the `@@unique` sequence space |
| `sequence`   | Int         | per-session monotonic |
| `type`       | String      | `task_queued` / `task_started` / `task_completed` / `task_failed` / `task_cancelled` / `task_timeout` / `gate_pending` / `gate_resolved` / `gate_audit` |
| `actor`      | String      | role / orchestrator / human / system |
| `payload`    | String?     | legacy JSON; superseded by `envelope` for current rows |
| `envelope`   | String?     | canonical EventEnvelope JSON; replay source-of-truth |
| `createdAt`  | DateTime    | default `now()` |
| `@@unique([sessionId, sequence])` |  | per-session sequence space invariant |
| `@@index([projectId, createdAt])` | | |
| `@@index([taskId, createdAt])`    | | |

`AgentEvent.list` (models/AgentEvent.js:52-67) is the read API used by
`SdlcController.streamPipelineStatus` for SSE replay.

### `AgentArtifact`

Source: `schema.prisma:127-148`, `models/AgentArtifact.js`

| Field             | Type        | Notes |
| ----------------- | ----------- | ----- |
| `id`              | String @id  | UUID  |
| `taskId`          | String      | FK → Task |
| `projectId`       | String?     | denormalised |
| `agentType`       | String?     | role |
| `artifactType`    | String      | canonical key (`prd`, `ux_spec`, `patch_diff`, `a2a_handoff`, `gate_evaluation`, …) |
| `artifactKey`     | String?     | e.g. `prd:<taskId>` |
| `title`           | String?     |       |
| `status`          | String      | default `'VALID'`; `'INVALID'` set when `_validateGateOutput` finds BLOCKER(s) (`SdlcWorkflowService.js:2050-2053`) |
| `contentJson`     | String?     | JSON or `{ file_path }` reference |
| `contentText`     | String?     | text or `FILE:<path>` reference |
| `ordinal`         | Int         | default `0` |
| `sourceArtifactId`| String?     |       |
| `contentHash`     | String?     | SHA-256 over text/json content |
| `createdAt` / `updatedAt` | DateTime | |

`AgentArtifact.findByTaskIdAndType(taskId, artifactType)` is the lookup
used by:
- `_requireApprovedTask` (a2a handoff check + invalid check)
- `requireUpstreamArtifact` (per-role predecessor artifacts)
- `resolveStructuredArtifact` (Phase 2 plumbing)

`AgentArtifact.hasInvalid(taskId)` and
`AgentArtifact.setStatusByTaskId(taskId, status)` are the validation
status APIs.

### `Document`

Source: `schema.prisma:150-161`, `models/Document.js`

| Field        | Type        | Notes |
| ------------ | ----------- | ----- |
| `id`         | String @id  | UUID |
| `projectId`  | String      |       |
| `fileName`   | String      |       |
| `fileType`   | String      |       |
| `filePath`   | String      |       |
| `fileSize`   | Int         |       |
| `folderId`   | String?     |       |
| `status`     | String      | default `'uploaded'` |
| `createdAt` / `updatedAt` | DateTime | |

### `Folder`

Source: `schema.prisma:163-171`, `models/Folder.js`

| Field      | Type        | Notes |
| ---------- | ----------- | ----- |
| `id`       | String @id  | UUID  |
| `projectId`| String      |       |
| `parentId` | String?     | self-tree |
| `name`     | String      |       |
| `sortOrder`| Int         | default `0` |
| `createdAt` / `updatedAt` | DateTime | |

### `Testcase`

Source: `schema.prisma:173-184`, `models/Testcase.js`

| Field          | Type     | Notes |
| -------------- | -------- | ----- |
| `id`           | String @id | UUID |
| `taskId`       | String   |       |
| `projectId`    | String   |       |
| `featureName`  | String   |       |
| `flowName`     | String   |       |
| `scenarioData` | String?  | JSON   |
| `automationYaml` | String? |       |
| `yamlFilename` | String?  |       |
| `createdAt` / `updatedAt` | DateTime | |

### `SessionState`

Source: `schema.prisma:186-196`, `models/SessionState.js`

| Field         | Type     | Notes |
| ------------- | -------- | ----- |
| `id`          | String @id | UUID (page-scoped) |
| `page`        | String   | route key |
| `userId`      | String   | always `'local-user-id'` in this build |
| `projectId`   | String?  |       |
| `selectedDocIds` | String? | JSON |
| `taskId`      | String?  |       |
| `metadata`    | String?  | JSON |
| `createdAt` / `updatedAt` | DateTime | |

### `HitlDecision`

Source: `schema.prisma:198-215`, `models/HitlDecision.js`

Append-only audit row for human-in-the-loop decisions.

| Field              | Type        | Notes |
| ------------------ | ----------- | ----- |
| `id`               | String @id  | UUID |
| `workflowRunId`    | String?     | uses `projectId` (per SdlcWorkflowService.js:206, releaseManager.js:80) |
| `taskId`           | String      |       |
| `projectId`        | String?     |       |
| `gate`             | String?     | `REQUIREMENT_GATE` / `UX_GATE` / `DEV_GATE` / `QA_GATE` / `FINAL_GATE` / `ARCH_OUTPUT_REVIEW` / `..._OUTPUT_REVIEW` / `..._CLARIFY` etc. |
| `decision`         | String      | `APPROVE` / `REJECT` / `CLARIFICATION` / `REQUEST_CHANGES` |
| `comment`          | String?     |       |
| `reviewerId`       | String?     |       |
| `decisionId`       | String?     | @unique — idempotency key for structured HITL |
| `action`           | String?     | `approve` / `reject` / `edit_approve` / `auto_approve` / `escalation_required` / `release_approve` / `release_reject` / `answer` |
| `baseOutputVersion`| Int?        | optimistic lock value the decision was made against |
| `retryReason`      | String?     | `schema_invalid` / `ac_not_measurable` / `coverage_gap` / `build_fail` / `quality_low` / `other` |
| `jsonPatch`        | String?     | JSON string of RFC 6902 ops |
| `payload`          | String?     | JSON: validation result / structured feedback / release outputs / etc. |
| `createdAt`        | DateTime    | default `now()` |

The `HitlDecision.findByDecisionId(decisionId)` lookup drives
idempotency for structured HITL + `releaseManager.submitReleaseDecision`.

### `PendingGate`

Source: `schema.prisma:217-233`, `models/PendingGate.js`

| Field       | Type        | Notes |
| ----------- | ----------- | ----- |
| `approvalId`| String @id  | UUID  |
| `taskId`    | String      |       |
| `projectId` | String?     |       |
| `role`      | String      | role that requested the gate |
| `kind`      | String      | `tool` / `question` / `output_review` / `release` |
| `payload`   | String      | JSON-encoded (gate type-specific payload) |
| `status`    | String      | default `'pending'`; transitions to `'resolved'` / `'rejected'` / `'timed_out'` / `'interrupted'` |
| `resolution`| String?     | JSON-encoded decision object |
| `createdAt` / `updatedAt` | DateTime | |
| `resolvedAt`| DateTime?   |       |
| `@@index([taskId])` / `@@index([projectId])` / `@@index([status])` | | |

Lifecycle ownership (`gateBridge.js`):
- `requestGate` → `PendingGate.create({ status:'pending' })`.
- `resolveGate` → `PendingGate.resolve(approvalId, status, resolution)`.
- `markPendingInterrupted` (boot-time) → all `status='pending'` → `'interrupted'`.

### `FeatureBacklog`

Source: `schema.prisma:235-245`, `models/FeatureBacklog.js`

| Field        | Type        | Notes |
| ------------ | ----------- | ----- |
| `id`         | String @id  | UUID  |
| `projectId`  | String      |       |
| `taskId`     | String?     | populated when SDLC picks up the backlog item |
| `title`      | String      |       |
| `description`| String?     |       |
| `priority`   | String      | default `'medium'` |
| `status`     | String      | default `'draft'`; can be `'TODO'` / `'REVIEW'` / etc. |
| `createdAt` / `updatedAt` | DateTime | |

`FeatureBacklog.linkTask` ties a backlog row to a Task at the start of
the pipeline (in `workflowOrchestrator.runArchitectureAgent` /
`runPOAgent`).

`FeatureBacklog.updateStatusByTaskId(taskId, status)` is called on every
task lifecycle event (`markTaskFailed`, `handleTaskTimeout`,
`cancelTask`, `_saveAgentData`).

---

## 3. Cross-entity relations (summary table)

| Left                | Right               | Cardinality | Mechanism                                                                                  |
| ------------------- | ------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `Project`           | `Task`              | 1..n        | `Task.projectId` is scalar (not a Prisma `references`); no cascade                          |
| `Project`           | `PipelineSession`   | 1..n        | `@@index` on `PipelineSession.projectId`, no cascade                                         |
| `Project`           | `Document`          | 1..n        | `Document.projectId` scalar                                                                  |
| `Project`           | `Folder`            | 1..n        | `Folder.projectId` scalar                                                                    |
| `Project`           | `Testcase`          | 1..n        | `Testcase.projectId` scalar                                                                  |
| `Project`           | `FeatureBacklog`    | 1..n        | `FeatureBacklog.projectId` scalar                                                            |
| `PipelineSession`   | `Task`              | 1..n        | `Task.sessionId` scalar (Prisma `references`); Task.sessionId nullable for pre-session runs |
| `Task`              | `AgentEvent`        | 1..n        | `Task.events` Prisma relation; cascade on delete                                            |
| `Task`              | `AgentArtifact`     | 1..n        | `Task.artifacts` Prisma relation                                                              |
| `HitlDecision`      | `Task`              | n..1        | `HitlDecision.taskId` scalar (no Prisma `references`)                                       |
| `PendingGate`       | `Task`              | n..1        | `PendingGate.taskId` scalar (no Prisma `references`)                                       |
| `Document`          | `Folder`            | n..1        | `Document.folderId` scalar                                                                   |
| `Folder`            | `Folder` (parent)   | n..1 self   | `Folder.parentId` scalar                                                                     |

There is no `references` declaration on `Task → PipelineSession` in
the schema; the FK is logical only.

---

## 4. Where each entity is written

| Entity          | Writers (file paths)                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `Project`       | `controllers/ProjectController.js` via `ProjectService` (legacy CRUD)                                      |
| `PipelineSession` | `workflowOrchestrator.runArchitectureAgent`, `runPOAgent`, `releaseManager.submitReleaseDecision` (status); `services/SdlcWorkflowService.resolveOutputReviewGate` (status: `awaiting_release`) |
| `Task`          | `models/Task.js` (`create`, `update`, `commitTask`, `deleteById`); `taskLifecycleService` (transitions); `taskWorkerService` (locks / heartbeats); `taskLifecycleService.transition`/`transitionIfPresent`/`record` |
| `AgentEvent`    | `models/Task.js` (initial `task_queued`), `taskLifecycleService.appendEvent` inside `prisma.$transaction` (every transition / record), `SdlcWorkflowService._recordGateAudit`, `agentDispatcher` for state changes |
| `AgentArtifact` | `SdlcWorkflowService._saveAgentData.bulkUpsert`, `artifactManager.recordApprovedHandoff` (a2a_handoff envelope), `AgentArtifact.setStatusByTaskId` |
| `Document`      | `controllers/DocumentController.js` via `DocumentService`                                                   |
| `Folder`        | `controllers/FolderController.js` via `FolderService`                                                       |
| `Testcase`      | legacy; not written by any current SDLC orchestrator path                                                   |
| `SessionState`  | `controllers/SessionStateController.js` via `SessionStateService`                                            |
| `HitlDecision`  | `SdlcWorkflowService.submitGateDecision`, `submitStructuredDecision`, `resolveOutputReviewGate`, `_handleGateRejection`, `_autoApproveSafeOutput`; `releaseManager.submitReleaseDecision` |
| `PendingGate`   | `gateBridge.requestGate` (create), `gateBridge.resolveGate` (resolve), `gateBridge.markOrphanedPendingInterrupted` (boot) |
| `FeatureBacklog`| `controllers/SdlcController` (Kanban CRUD), `SdlcWorkflowService.submitStructuredDecision` (status moves), `taskLifecycle` side-effects (`markTaskFailed`, `handleTaskTimeout`, `cancelTask`) |

---

## 5. Where each entity is read

| Entity          | Readers (file paths)                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Project`       | every controller (projectId scope), `SdlcWorkflowService.getPipelineResponse` (projectId)                                                                       |
| `PipelineSession` | `workflowOrchestrator.runPOAgent` (countActive / create / findById), `SdlcWorkflowService._getRepoContext` (repoPath lookup), `releaseManager.submitReleaseDecision`, `SdlcController.streamPipelineStatus` (resolves sessionId), every action that reads session status |
| `Task`          | core — read by every gate, every workflow orchestrator call, `agentDispatcher`, `taskWorkerService.claim/sweepStale`, `releaseManager.submitReleaseDecision`, `SdlcWorkflowService.getWorkflowStatus`, `submitGateDecision`, `_requireApprovedTask`, `_makeOnGate`, `_recordGateAudit` |
| `AgentEvent`    | `SdlcController.streamPipelineStatus` (replay), `AgentEvent.maxSequence` (sequenceService seed), `AgentEvent.list` (per-task legacy route `/sdlc/tasks/:task_id/events`) |
| `AgentArtifact` | `artifactManager.buildContextFromArtifacts`, `requireUpstreamArtifact`, `_requireApprovedTask` (a2a handoff + invalid check), `getProjectArtifacts`, `getTaskStatus`, `_saveAgentData` |
| `HitlDecision`  | `SdlcWorkflowService.getAuditTrail`, `getWorkflowStatus`, `getFinalReviewPacket`, `releaseManager.submitReleaseDecision`, `interventions.test.js`, `gateBridge.subscribeProject.test.js` |
| `PendingGate`   | `gateBridge.findPersisted` / `listInterrupted`, `SdlcController.listPendingApprovals`, `SdlcWorkflowService.listPendingGates`, `getAllInterventions`        |
| `Document`/`Folder`/`Tree` | `controllers/*.js`                                                                          |
| `SessionState`  | `SessionStateController` only (frontend UX state persistence)                                                                                                |
| `FeatureBacklog`| Kanban CRUD, `linkTask` at SDLC start                                                                                                                          |

---

## 6. Logical MVCC / concurrency surface

- SQLite WAL + `connection_limit=1`
  (`backend/src/config/database.js:1-37`).
- Per-worker lock on Task (`lockedBy`, `heartbeatAt`) — single-process
  worker ownership; not multi-process.
- The `AgentEvent.sessionId-sequence` unique constraint is the
  per-session sequence invariant.
- The `Task.versionStatus` is `'committed'` after a human-approved
  gate decision; `_requireApprovedTask` enforces
  `task.status === 'completed' && task.versionStatus === 'committed'`
  before launching the downstream agent.
- `HitlDecision.decisionId` uniqueness is the idempotency key.

---

## 7. Things the schema does NOT model

- No FK constraint from `PendingGate.taskId` / `HitlDecision.taskId` to
  `Task.id` (managed in code).
- No FK constraint from `AgentEvent.sessionId` to `PipelineSession.id`.
- `PendingGate.resolution` is a JSON string; the shape is determined by
  `gateBridge.resolveGate` (kind-specific).
- `PipelineSession.outputDir` is the bundle location, set by
  `releaseManager`.
- There is no `Workflow` table; workflow runs are derived from
  `Task WHERE sessionId = ?` and `HitlDecision WHERE taskId IN (?)`.
- There is no `Agent` table; role identity is encoded in
  `Task.type` and `HitlDecision.gate` (string).