# 02 — Flow Drift (Phase 2)

> **Status:** READ-ONLY. For every pipeline step (Project, Architecture,
> PO, UX, DEV, QA, Release), the Expected Flow (per Phase-0 +
> Phase-1 baseline), the Actual Flow (per source), the Drift, the
> Evidence, the Risk, the Owner. No fixes.

Expected flow baseline:
`docs/engineering-freeze/04_AGENT_PIPELINE_BASELINE.md` and
`docs/engineering-audit/01_PIPELINE_TRACE.md`. Source citations use
the `backend/src/...` file paths.

---

## Project

### Expected flow

A user with no existing project can create one via
`POST /api/v1/projects` (`routes/projects.js:6`,
`ProjectController.create:controllers/ProjectController.js:22-38` →
`ProjectService.createProject`). Project creation is independent of
the SDLC chain — `run-architecture-agent` accepts an arbitrary
`project_id` (`SdlcController.runArchitectureAgent:32-65`).

### Actual flow

```
POST /api/v1/projects
   └─ authMiddleware → req.user = { id:'local-user-id', role:'authenticated' }
   └─ ProjectController.create → ProjectService.createProject(name, user)
      └─ stubbed MembershipService.createOwnerMembership (no-op)
      └─ prisma.project.create → id (UUID), name, description?, createdBy,
         createdAt, updatedAt
```

### Drift

No drift at the implementation level. The Project row created here
is decoupled from any subsequent `PipelineSession`; the SDLC
pipeline creates its own `PipelineSession` (workflowOrchestrator.js:84-88).

### Evidence

- `backend/src/routes/projects.js:6-9`
- `backend/src/controllers/ProjectController.js:22-38`
- `backend/src/services/ProjectService.js`
- `backend/src/models/Project.js`
- `backend/prisma/schema.prisma:24-34`

### Risk

None.

### Owner

- Service: `ProjectService`
- Controller: `ProjectController`

---

## Architecture

### Expected flow

`docs/engineering-freeze/04_AGENT_PIPELINE_BASELINE.md` "Stage 1 —
Architecture Agent (entry)."

```
POST /api/v1/sdlc/run-architecture-agent
  → validate body (project_id, feature_request.title, repo_url)
  → SdlcWorkflowService.runArchitectureAgent
  → workflowOrchestrator.runArchitectureAgent
  → PipelineSession.create + Task.create (architecture-agent)
  → repoService.cloneRepo|useLocalRepo|prepareSessionRepo
  → PipelineSession.update(repoPath, workingBranch, baseBranch)
  → repoIndexService.buildRepoIndex(repoPath, { maxDepth:2 })
  → scopeResolver.resolveScope({ repoIndex, featureRequest })
  → SdlcWorkflowService._runAgent → agentDispatcher.runAgent
     → EXECUTION_PATH selects: langchain|claude-code|codex
     → mock under USE_MOCK_AGENTS / USE_MOCK_CLAUDE_CODE
  → finishes via _saveAgentData:
     → AgentArtifact.bulkUpsert
     → Task.update(completed, output_content_hash, agentOutput, gateMode)
     → taskLifecycle.transition(task, 'completed')  → task_completed envelope
     → gateBridge.requestGate({ kind:'output_review' })
```

### Actual flow

The actual flow matches the expected one (per Phase-1
`01_PIPELINE_TRACE.md` Stage 1). The drifts below are about post-finish
behaviour, not the run itself.

### Drift items

#### DR-001 (Chain ownership contradiction)

After ARCH finishes, an output_review gate is created via
`_saveAgentData` (`SdlcWorkflowService.js:2071-2087`). The resolve path
(`resolveOutputReviewGate`, SdlcWorkflowService.js:466-591) is the
single owner for advancing the chain.

But the **legacy** `gate-decision` endpoint
(`SdlcController.submitGateDecision:151-178`) calls
`SdlcWorkflowService.submitGateDecision`
(`SdlcWorkflowService.js:185-231`). This path:

- does NOT call `_recordApprovedHandoff`.
- does NOT call `_startNextAgentIfAvailable`.
- on `REQUEST_CHANGES` calls `_rerunOwningWorker` directly
  (`SdlcWorkflowService.js:226-228`).

Two `output_review`-style gates, two lifecycle paths. The newer path
(`resolveOutputReviewGate`) is the documented one; the older
(`submitGateDecision`) is reachable.

**Evidence**:
- `SdlcWorkflowService.js:185-231` (legacy path).
- `SdlcWorkflowService.js:466-591` (canonical path).
- `backend/tests/integration/sdlc.handoff.test.js` (tests against the
  legacy path; see `04_AGENT_PIPELINE_BASELINE.md`).

**Risk**: a legacy gate-decision that approves never advances the
chain. A legacy gate-decision that rejects reruns in a way that
bypasses the structured HITL API. The legacy path is still routed
(`routes/sdlc.js:35`), still wired to a controller method, and still
covered by integration tests.

**Owner**: `SdlcWorkflowService.submitGateDecision` (legacy),
`SdlcWorkflowService.resolveOutputReviewGate` (canonical).
Phase-0/Phase-1 baseline document this only as the canonical path;
the legacy path is observable.

---

## PO

### Expected flow

`SdlcController.runPOAgent` returns **410** with
`PO_AGENT_ENTRY_REMOVED` (`SdlcController.js:76-82`). PO is reached
exclusively via auto-advance from Architecture
(`workflowOrchestrator.startNextAgentIfAvailable:597-656`) or via
rework from `submitStructuredDecision` reject.

### Actual flow

The 410 path is intact. Auto-advance from Architecture carries the
sessionId + featureRequest from `Task.observability`
(`workflowOrchestrator.runPOAgent:358`) so the second pipeline uses
the same `PipelineSession`.

### Drift

No drift at the chain level. The "PO auto-advance must carry
featureRequest from observability" is documented as a fix in
`workflowOrchestrator.js:626-638` and observed to work.

### Evidence

- `backend/src/controllers/SdlcController.js:76-82` (410).
- `backend/src/services/workflowOrchestrator.js:279-392` (runPOAgent).
- `backend/src/services/workflowOrchestrator.js:597-656`
  (startNextAgentIfAvailable).

### Risk

None.

### Owner

- `workflowOrchestrator.runPOAgent`

---

## UX

### Expected flow

Phase-0 baseline requires that UX receive the canonical
`project_definition` (Phase 2 plumbing per
`docs/architecture/A2A_PIPELINE_REDESIGN.md`). UX also receives PO
artifacts via `AgentArtifact.findByTaskId`.

### Actual flow

`workflowOrchestrator.runUXAgent:398-461`:

1. `requireApprovedTask(sourceTaskId, 'po-agent')`.
2. `requireUpstreamArtifact(sourceTask, 'ux-agent')`.
3. `archTask = Task.findLatestBySession(sourceTask.sessionId,
   'architecture-agent', 'completed', 'committed')`.
4. Resolve `archProjectDefinition` and load `archArtifacts` PLUS
   `poArtifacts`.
5. Dedupe by `contentHash`.
6. Build context with `project_definition`, `repoContext`,
   `previousDraft`.

### Drift

None at the chain level. The Phase-2 plumbing is implemented. The
only risk is that the `compactContext` whitelist in
`claudeCodeRunner.js:91-127` controls what lands in the AIFA
Context — for UX it's `['prd', 'user_stories',
'acceptance_criteria', 'risk_classification', 'feedbackPrompt',
'project_definition']`. The actual artifact outputs (e.g.
`ux_spec`, `user_flow`) are produced by the agent, not pre-seeded.

### Evidence

- `backend/src/services/workflowOrchestrator.js:398-461`
- `backend/src/agents/claudeCodeRunner.js:102-107`

### Risk

Cosmetic only. Phase-2 plumbing is consistent.

### Owner

- `workflowOrchestrator.runUXAgent`

---

## DEV

### Expected flow

Strict predecessor: UX (NOT PO). Per
`docs/engineering-freeze/04_AGENT_PIPELINE_BASELINE.md` Stage 4. The
orchestrator enforces this via `requireApprovedTask(...,'ux-agent', ...)`.

### Actual flow

`workflowOrchestrator.runDEVAgent:467-510`:

- `requireApprovedTask(sourceTaskId, 'ux-agent')` (line 471).
- `requireUpstreamArtifact(sourceTask, 'dev-agent')`.
- PO+UX artifacts are loaded; the run starts.

### Drift

None at the chain level. The chain is fixed. The DEV→QA handoff
depends on the `output_review` gate decision driving
`_recordApprovedHandoff` and `_startNextAgentIfAvailable`.

### Evidence

- `backend/src/services/workflowOrchestrator.js:467-510`

### Risk

None.

### Owner

- `workflowOrchestrator.runDEVAgent`

---

## QA

### Expected flow

QA is the canonical owner of validation evidence (Phase 3.6, per the
inline comment at `SdlcWorkflowService.js:1918-1933`). `risk_classification`,
`security_notes`, `security_gate`, `build_result`, `self_test_report`
all originate from QA. QA gate must pass for the FINAL_RELEASE gate
to be created.

### Actual flow

`workflowOrchestrator.runQAAgent:516-591` matches expected. QA output is
saved by `_saveAgentData`, and `QualityGateService.evaluate` is run
inside `_saveAgentData` for `qa-agent` only
(`SdlcWorkflowService.js:1849-1916`). After QA
`output_review` approve:

```
if (task.type === 'qa-agent'
    && qaGatePassed(refreshed)
    && refreshed.sessionId && refreshed.projectId) {
  const evidence = await this._buildReleaseEvidenceSummary(refreshed.sessionId);
  const repoContext = await this._getRepoContext(refreshed.projectId, refreshed.sessionId);
  if (!repoContext?.repoPath) throw 500 'Cannot create FINAL_RELEASE gate: ...'
  await PipelineSession.update(refreshed.sessionId, { status: 'awaiting_release' });
  gateBridge.requestGate({ … kind: 'release' … });
}
```

### Drift

None at the chain level. The QA→FINAL_RELEASE handoff is the canonical
§19.10 plumbing.

### Evidence

- `backend/src/services/workflowOrchestrator.js:516-591`
- `backend/src/services/SdlcWorkflowService.js:548-578`

### Risk

None.

### Owner

- `workflowOrchestrator.runQAAgent`
- `SdlcWorkflowService.resolveOutputReviewGate`

---

## Release

### Expected flow

Per `docs/fixbug/AUDIT_2026_07_09_FULL_PIPELINE.md §19` (referenced in
`releaseManager.js:106-191`):

> §19.4 A.3 — FINAL_RELEASE APPROVE branch:
>   - Pure packaging + publishing stage; never re-runs an agent.
>   - 1. Remove any previously-generated release bundle for THIS session.
>   - 2. Build the new bundle (final.md + qa-report.md + audit-trail.json).
>   - 3. Commit the bundle in the user's repo (add + commit mandatory; push best-effort).
>   - 4. Push (best-effort; commit is mandatory).
>   - 5. Flip the session to 'completed'.
>   - 6. Emit `pipeline_completed` — the only place this event fires now.

### Actual flow

`releaseManager.submitReleaseDecision:21-194`:

1. Membership gate (`['owner', 'admin']`) — stub returns `'owner'`.
2. Idempotency check via `HitlDecision.findByDecisionId`.
3. `qaGatePassed(qaTask)` + `evidence.open_blockers` check.
4. `HitlDecision.create({ gate:'FINAL_GATE', decisionId, ... })`.
5. APPROVE only:
   - `Promise.all([getFinalReviewPacket, getAuditTrail, getRepoContext])`.
   - `workflowReport.findPreviousBundle / removeGitTracked / fs.rm`.
   - `workflowReport.writeReleaseBundle` builds `final.md` (10
     sections per spec §13), `qa-report.md`, `audit-trail.json`.
   - `git add -A`, `git commit '[release][<shortId>] ...'`.
   - `git push` (best-effort; only if `GH_TOKEN`).
   - `PipelineSession.update({ status:'completed', outputDir })`.
   - `publishEvent('pipeline_completed', ...)` — **live only**.
   - **No `AgentEvent.create(envelope)` call**.

### Drift items

#### DR-002 (Single emitter for `pipeline_completed` — established but asymmetric persistence)

The §19.4 A.3 re-architecture explicitly transferred ownership of
the terminal event to `releaseManager`. **The single emitter
invariant is met.** The corresponding persistence invariant is NOT:
the `pipeline_completed` envelope is not persisted to `AgentEvent`.

**Evidence**:
- `releaseManager.js:170-186`
- `eventPublisher.js:17-28` (returns the envelope; no caller passes
  it to `AgentEvent.create`)
- `taskLifecycleService.transition`/`record` (which DO persist
  envelopes) are not called here

**Risk**: SSE replay on reconnect or audit-trail queries miss the
final terminal event. Live consumers see it; persisted history does
not. See `03_PIPELINE_GAPS.md G-1`; freeze I-1.

**Owner**: `releaseManager.submitReleaseDecision`

#### DR-003 (gateBridge dual write for `PendingGate`)

The §19.4 A.1 step was to "create the FINAL_RELEASE gate" via
`gateBridge.requestGate({ kind:'release' })`. The implementation
does this on line 559-577. However, `gateBridge.requestGate` itself
writes BOTH the in-memory `pending` map and a `PendingGate` DB row
(gateBridge.js:88-89 + 51-83). For `kind='release'`:

- the in-memory record is irrelevant (the SDK is not awaiting; the
  agent thread is gone after QA `output_review` approve).
- the DB row is durable but `findPersisted`
  (gateBridge.js:239-246) looks it up by `approvalId`. So the
  release gate IS retrievable later.

**Evidence**:
- `gateBridge.js:51-83` (requestGate creates DB row + in-memory
  Promise).
- `releaseManager.js:106-194` (only writes `HitlDecision` on
  resolution; never reads the `PendingGate` row for `kind=release`).

**Risk**: dual truth. The DB row for `kind=release` is created and
left in the table; the `HitlDecision` row at resolution time is the
only authoritative record. A reconcile step would observe a
`PendingGate` row with `status='resolved'` AND a `HitlDecision`
row with `gate='FINAL_GATE'`.

**Owner**: `gateBridge.requestGate`,
`releaseManager.submitReleaseDecision`

---

## Cross-flow observations

### Chain auto-advance is gated by `requireApprovedTask`

`workflowOrchestrator.startNextAgentIfAvailable:597-656` always calls
`requireUpstreamArtifact` (`workflowOrchestrator.js:228-273`).
Verified in `01_PIPELINE_TRACE.md` cross-cutting.

### `output_review` is the only gate kind that triggers chain auto-advance

`tool` and `question` gates from the Claude SDK are resolved by
`resolveApproval` (SdlcWorkflowService.js:348-419) but do NOT call
`_startNextAgentIfAvailable`. By design.

### `_resumeInterruptedTask` for boot recovery

`SdlcWorkflowService.recoverInterruptedGates:1787-1798` iterates
`Task.listByExecutionStatus('awaiting_gate')` and calls
`_resumeInterruptedTask`. This drives `agentDispatcher.runAgent`
which calls `taskLifecycle.transition(taskId, 'running', ...)`. The
matrix (`taskLifecycleService.js:11-21`) does not list
`awaiting_gate → running` as valid.

See `DR-014` in `05_STATE_DRIFT.md` for the full ownership and
recovery analysis.

### Per-stage events

| Stage        | Persisted AgentEvent types                                          | Live envelopes                                            |
| ------------ | ------------------------------------------------------------------- | --------------------------------------------------------- |
| Architecture | `task_queued`                                                       | `task_started`, `gate_pending`, `gate_resolved`, `runtime_log` |
| PO           | `task_queued`                                                       | same                                                       |
| UX           | `task_queued`                                                       | same                                                       |
| DEV          | `task_queued`                                                       | same                                                       |
| QA           | `task_queued`                                                       | same                                                       |
| Release      | (none directly — `HitlDecision` only)                              | `pipeline_completed` (live only; never persisted)         |
| SSE bootstrap | (none directly)                                                    | `session_started` / `session_resumed` (always persisted via `publishEvent`) |

The asymmetry is **DR-007 + DR-016** combined. Only `pipeline_completed`
publishes live-but-not-persisted.