# 03 — Agent Contract

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document.
> **Source of truth:** `docs/OBS3/04_AGENT_VERIFICATION.md`.

---

## Canonical Owner

`backend/src/services/agentDispatcher.js` (dispatcher),
`backend/src/agents/claudeCodeRunner.js` (real Claude Code SDK adapter),
`backend/src/agents/codexRunner.js` (dormant legacy runner),
`backend/src/services/archAskEnforcer.js` (Architecture clarification
enforcer),
`backend/src/services/qaGate.js` (QA quality gate).

## Source of Truth

- `backend/src/services/agentDispatcher.js:305` — `EXECUTION_PATH` switch.
- `backend/src/services/agentDispatcher.js:331` — `runAgent` entry.
- `backend/src/services/agentDispatcher.js:562` — `handleTaskTimeout`
  (writes canonical `'timeout'`).
- `backend/src/services/taskWorkerService.js:160` — `sweepStale`
  (writes canonical terminal).
- `backend/src/agents/claudeCodeRunner.js:13` — polarity comment.

## Producer

| Surface | Producer | File |
| ------- | -------- | ---- |
| Agent execution lifecycle | `agentDispatcher.runAgent` | `backend/src/services/agentDispatcher.js:331` |
| Claude Code SDK integration | `claudeCodeRunner.runAgent` | `backend/src/agents/claudeCodeRunner.js` |
| Architecture clarification retries | `archAskEnforcer.enforceAskUserQuestion` | `backend/src/services/archAskEnforcer.js` |
| QA gate evaluation | `qaGate.qaGatePassed` | `backend/src/services/qaGate.js` |
| Worker claim + sweep | `taskWorkerService.claim` / `sweepStale` | `backend/src/services/taskWorkerService.js` |

## Consumer

| Consumer | Reads | File |
| -------- | ----- | ---- |
| `SdlcWorkflowService._runAgent` | calls `agentDispatcher.runAgent` | `backend/src/services/SdlcWorkflowService.js:744-998` |
| `taskLifecycle.transition` | invoked from `runAgent`, `markTaskFailed`, `handleTaskTimeout`, `sweepStale` | `backend/src/services/taskLifecycleService.js` |
| `gateBridge.requestGate` | invoked from `archAskEnforcer`, `qaGate` | `backend/src/services/gateBridge.js` |
| `taskLifecycle.publishLifecycle` | publishes canonical lifecycle envelope | `backend/src/services/taskLifecycleService.js:88-110` |

## Invariants

1. **`runAgent` is the sole entry point** for agent execution
   (`agentDispatcher.js:331`). `SdlcWorkflowService` delegates to it.
2. **`EXECUTION_PATH=claude-code` is the canonical execution path**
   (`obs9/04_INTEGRATION_VERIFICATION.md` §7). The default executor is
   the real Claude Code SDK.
3. **`handleTaskTimeout` writes canonical `'timeout'`**
   (`agentDispatcher.js:562`).
4. **`sweepStale` writes canonical terminal**
   (`taskWorkerService.js:160`).
5. **No legacy `'processing'` write** before
   `taskLifecycle.transition('running')` (OBS-3 Patch AG-D removed the
   legacy line at `agentDispatcher.js:312`).
6. **Double-mark race guard** (`terminalHandled` flag, OBS-3 Patch AG-E).
7. **Legacy LangChain path is dormant** (comment at
   `agentDispatcher.js:1-13` documents the dormancy).
8. **D-A2 (legacy `PENDING_TOOL_APPROVAL` write at
   `agentDispatcher.js:441-443`)** is deferred to OBS-AGENT.

## Forbidden Ownership

- Direct `Task.update({ executionStatus: ... })` outside
  `taskLifecycle.transition` (OBS-1 R-03).
- Multiple lifecycle envelopes for one transition (OBS-1 R-04).
- Adding a new agent role outside the 5 canonical roles
  (`architecture-agent`, `po-agent`, `ux-agent`, `dev-agent`,
  `qa-agent`).
- Re-introducing `intent-agent` (removed by OBS-9 I-G).

## Related OBS

- **OBS-3** — `docs/OBS3/04_AGENT_VERIFICATION.md` (freezes the contract).
- **OBS-9** — `docs/obs9/04_INTEGRATION_VERIFICATION.md` Patch I-G
  (removes `intent-agent`; adds `architecture-agent` to `AGENT_POLICY`).

## Related Implementation Files

- `backend/src/services/agentDispatcher.js`
- `backend/src/agents/claudeCodeRunner.js`
- `backend/src/agents/codexRunner.js`
- `backend/src/services/archAskEnforcer.js`
- `backend/src/services/qaGate.js`
- `backend/src/services/taskWorkerService.js`
- `backend/src/services/sdlcConstants.js` (AGENT_POLICY,
  EXECUTION_STATUS_TO_PHASE_STATUS)
- `backend/src/services/agentContract.js`
- `backend/src/agents/prompts/{architecture,po,ux,dev,qa}.prompt.md`

End of Agent Contract.
