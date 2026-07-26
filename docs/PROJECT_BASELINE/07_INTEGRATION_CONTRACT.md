# 07 — Integration Contract

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document.
> **Source of truth:** `docs/obs6/04_UI_VERIFICATION.md` (UI),
> `docs/obs8/04_DEMO_VERIFICATION.md` (demo / mock),
> `docs/obs9/04_INTEGRATION_VERIFICATION.md` (env / SDK).

---

## Canonical Owner

### UI (OBS-6)

`frontend/src/store/runtimeSelectors.ts` (sole owner of the 8 visual maps).
`frontend/src/components/ui/ActionSpinner.tsx` (shared spinner).
`frontend/src/components/ui/ApproveRejectButtons.tsx` (shared approve / reject).
`frontend/src/store/eventMappers.ts` (`mapGateResolved` clears
`pendingReleaseGateId` on release gate resolution).

### Demo / Mock (OBS-8)

`backend/scripts/_demoFlags.js` (`applyDemoFlags({interactiveGates})`
helper).
`backend/scripts/demoSmokeClaudeCode.js` (smoke harness).
`backend/scripts/resumeGateSmoke.js` (smoke harness).
`backend/scripts/realClaudeCodeSmoke.js` (real-SDK smoke harness, OBS-9).
`frontend/src/store/useWorkflowStore.ts` (named imports — Patch D-J).

### Integration / Env (OBS-9)

`backend/.env.example`, `docker-compose.yml`, `frontend/package.json`,
`frontend/vite.config.ts`, `backend/src/services/sdlcConstants.js`,
`backend/src/controllers/SdlcController.js` (`executeGitAction`),
`backend/src/services/SdlcWorkflowService.js` (dead imports removed).

## Source of Truth

### UI

- `frontend/src/store/runtimeSelectors.ts:540` — `RUNTIME_VISUAL` (frozen).
- `frontend/src/store/runtimeSelectors.ts` — `SESSION_STATUS_VISUAL`,
  `CONNECTION_VISUAL`, `GATE_TYPE_VISUAL`, `HISTORY_DECISION_VISUAL`,
  `OUTPUT_REVIEW_VISUAL`, `QUESTION_VISUAL`, `TOOL_GATE_VISUAL`.
- `frontend/src/components/ui/ActionSpinner.tsx` — shared spinner.
- `frontend/src/components/ui/ApproveRejectButtons.tsx` — shared buttons.
- `frontend/tests/visualMaps.snapshot.test.ts` — locks all 7 maps
  byte-for-byte.

### Demo / Mock

- `backend/scripts/_demoFlags.js` — `applyDemoFlags` helper.
- `backend/scripts/demoSmokeClaudeCode.js` — invokes
  `applyDemoFlags({interactiveGates})`.
- `backend/scripts/resumeGateSmoke.js` — invokes
  `applyDemoFlags({interactiveGates})`.

### Integration / Env

- `backend/.env.example:35` — `EXECUTION_PATH=claude-code`.
- `docker-compose.yml` — no `AGENTS_BASE_URL`, no
  `~/.codex/config.toml` mount.
- `frontend/package.json:6` — `"sideEffects": false`.
- `frontend/vite.config.ts` — no `GEMINI_API_KEY` define.
- `backend/src/services/sdlcConstants.js` — `AGENT_POLICY` carries
  `architecture-agent` (timeout 600s, max_attempts `MAX_RETRY_PER_STEP`);
  no `intent-agent`, no `ARCHITECTURE_GATE`, no `ARCH_OUTPUT_REVIEW`.
- `backend/src/controllers/SdlcController.js:700-817` —
  `executeGitAction` returns canonical `{status:'success', data:{message, output}}`.
- `backend/src/agents/claudeCodeRunner.js:516-521` — "INTENTIONAL cycle"
  comment marker.

## Producer

### UI

| Map / Component | Producer | File |
| --------------- | -------- | ---- |
| `RUNTIME_VISUAL` (7) | `runtimeSelectors.ts` | `frontend/src/store/runtimeSelectors.ts:540` |
| `SESSION_STATUS_VISUAL` (6) | `runtimeSelectors.ts` (U-B) | `frontend/src/store/runtimeSelectors.ts` |
| `CONNECTION_VISUAL` (4) | `runtimeSelectors.ts` (U-D) | `frontend/src/store/runtimeSelectors.ts` |
| `GATE_TYPE_VISUAL` (4) | `runtimeSelectors.ts` (U-E) | `frontend/src/store/runtimeSelectors.ts` |
| `HISTORY_DECISION_VISUAL` (3) | `runtimeSelectors.ts` (U-F) | `frontend/src/store/runtimeSelectors.ts` |
| `OUTPUT_REVIEW_VISUAL` (1) | `runtimeSelectors.ts` (U-H) | `frontend/src/store/runtimeSelectors.ts` |
| `QUESTION_VISUAL` (1) | `runtimeSelectors.ts` (U-I) | `frontend/src/store/runtimeSelectors.ts` |
| `TOOL_GATE_VISUAL` (1) | `runtimeSelectors.ts` (U-J) | `frontend/src/store/runtimeSelectors.ts` |
| `<ActionSpinner>` | shared UI | `frontend/src/components/ui/ActionSpinner.tsx` |
| `<ApproveRejectButtons>` | shared UI | `frontend/src/components/ui/ApproveRejectButtons.tsx` |
| `mapGateResolved` (clears `pendingReleaseGateId`) | `eventMappers.ts` (U-O) | `frontend/src/store/eventMappers.ts` |

### Demo / Mock

| Surface | Producer | File |
| ------- | -------- | ---- |
| `applyDemoFlags` | `_demoFlags.js` | `backend/scripts/_demoFlags.js` |
| `realClaudeCodeSmoke` | `realClaudeCodeSmoke.js` | `backend/scripts/realClaudeCodeSmoke.js` |

### Integration / Env

| Surface | Producer | File |
| ------- | -------- | ---- |
| Env flags | `.env.example` + `docker-compose.yml` | `backend/.env.example`; `docker-compose.yml` |
| `AGENT_POLICY` (incl. `architecture-agent`) | `sdlcConstants.js` (I-G) | `backend/src/services/sdlcConstants.js` |
| `executeGitAction` response shape | `SdlcController.js` (I-H) | `backend/src/controllers/SdlcController.js:700-817` |
| Tree-shaking declaration | `frontend/package.json` (D-F.3) | `frontend/package.json:6` |

## Consumer

### UI

| Consumer | Reads | File |
| -------- | ----- | ---- |
| SessionRail pills | `getSessionStatusVisual`, `getConnectionVisual` | `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx` |
| SessionPill | `getSessionStatusVisual(status).background` | `frontend/src/pages/SdlcDashboard/index.tsx:396-417` |
| ConnectionPill | `getConnectionVisual` | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx` |
| GateBadge | `getGateTypeVisual(kind)` | `frontend/src/pages/SdlcDashboard/OverviewPage.tsx` |
| Inspector tab badges | `getGateTypeVisual(kind)` | `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx` |
| DecisionsTab pill | `getHistoryDecisionVisual(decision)` | `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx` |
| ClarificationPanel | `QUESTION_VISUAL` | `frontend/src/pages/SdlcDashboard/components/ClarificationPanel.tsx` |
| ToolGatePanel | `TOOL_GATE_VISUAL` + `<ApproveRejectButtons>` | `frontend/src/pages/SdlcDashboard/components/ToolGatePanel.tsx` |
| OutputReviewInline | `OUTPUT_REVIEW_VISUAL` + `<ApproveRejectButtons>` | `frontend/src/pages/SdlcDashboard/components/InspectorPanel.tsx` |
| Loading surfaces | `<ActionSpinner>` | 5 components |

### Demo / Mock

| Consumer | Reads | File |
| -------- | ----- | ---- |
| `demoSmokeClaudeCode.js` | `applyDemoFlags({interactiveGates})` | `backend/scripts/demoSmokeClaudeCode.js` |
| `resumeGateSmoke.js` | `applyDemoFlags({interactiveGates})` | `backend/scripts/resumeGateSmoke.js` |
| Operators | `realClaudeCodeSmoke.js` exits 77 / 1 / 0 | `backend/scripts/realClaudeCodeSmoke.js` |

### Integration / Env

| Consumer | Reads | File |
| -------- | ----- | ---- |
| Backend startup | `process.env.EXECUTION_PATH` | `backend/src/services/agentDispatcher.js:305` |
| Smoke scripts | `process.env.USE_MOCK_CLAUDE_CODE` / `USE_MOCK_AGENTS` | `backend/scripts/*` |
| Frontend bundle | `process.env` (`vite.config.ts`) | `frontend/vite.config.ts` |

## Invariants

### UI

1. **One canonical source per visual surface** — per-agent phases
   (OBS-1), session status, connection state, gate type, history
   decision, and panel containers each have a single visual map.
2. **No inline visual duplication** — all drift components consume
   canonical maps via `getXxxVisual()`.
3. **Runtime animation contract preserved** — only `running` may carry
   `animate-spin` on `Loader2`; only session-level indicators may carry
   `animate-pulse`.
4. **Cross-page identity restored** — same gate kind renders same colour
   on OverviewPage and InspectorPanel; same session status renders
   same colour on SessionRail and SessionPill; same connection state
   renders same colour + animation everywhere.
5. **Decision-history palette unified** — `answer` decision is cyan
   (matches ClarificationPanel), `approve` is emerald, `reject` is red.
6. **`pending` vs `skipped` distinguishable** — `RUNTIME_VISUAL.skipped`
   foreground is `text-on-surface-variant/40` (was `/60` for `pending`).
7. **`pendingReleaseGateId` lifecycle** — cleared on every
   `gate_resolved` with `kind === 'release' || type === 'FINAL_RELEASE'`.
8. **No business logic changes** — OBS-5 HITL contract is unchanged;
   OBS-1.10 runtime contract is unchanged.

### Demo / Mock

1. **All `/demo/*` routes are unmounted** — `git diff obs1 -- backend/src/routes/sdlc.js`
   shows lines 99-102 removed.
2. **`demoBoardService.js` is deleted**.
3. **`MOCK_*` constants are deleted** from `sdlcConstants.js`,
   `workflowHelpers.js`, `SdlcWorkflowService.js`.
4. **`DEFAULT_MOCK_SCENARIO` literal removed** from `SdlcController.js`
   (Step-4 follow-up).
5. **FE wrappers deleted** — `seedDemoBoard`, `getDemoBoard`,
   `getDemoUxDoc`, `retryDemoFlow`, `BOARD_TIMEOUT_MS` removed;
   `CardAction`, `BoardCard`, `BoardPhase`, `BoardReleaseGate`,
   `BoardFlow`, `DemoBoard`, `UxDoc` types removed.
6. **`sideEffects: false`** declared at `frontend/package.json:6`.
7. **Named imports** in `useWorkflowStore.ts:13-19` —
   `{ startPipeline, resolveGate, resolveOutputReviewGate,
   resolveApproval, releaseDecision }`.

### Integration / Env

1. **`EXECUTION_PATH=claude-code` is canonical** across
   `.env.example`, `backend/.env`, `docker-compose.yml`.
2. **`USE_MOCK_CLAUDE_CODE=false`** is the default; smoke scripts
   may opt-in.
3. **`AGENTS_BASE_URL` is opt-in** (commented in `.env.example`).
4. **No `codex/config.toml` mount** in `docker-compose.yml`.
5. **No `socket.io-client`** in `frontend/package.json`.
6. **No `GEMINI_API_KEY` define** in `frontend/vite.config.ts`.
7. **`AGENT_POLICY` carries 5 roles** — `architecture-agent`,
   `po-agent`, `ux-agent`, `dev-agent`, `qa-agent` (no `intent-agent`).
8. **`executeGitAction` returns canonical envelope**
   `{status:'success', data:{message, output}}`.
9. **No `sdlcLegacy.ts`** — file deleted; re-export block removed from
   `sdlcApi.ts`.
10. **No `useAppStore.sseAbort`** — removed.
11. **No `import type * as api`** — 3 sites converted to named imports.
12. **Comment marker on lazy cycle** at
    `backend/src/agents/claudeCodeRunner.js:516-521`.

## Forbidden Ownership

### UI

- Hardcoded colour strings in JSX outside the Tailwind theme tokens.
- A second visual map for any of the 8 surfaces.
- Inline `animate-spin` outside `<ActionSpinner>` for runtime state
  elements.

### Demo / Mock

- Re-introducing any `/demo/*` HTTP route.
- Re-introducing `MOCK_*` constants.
- Re-introducing the legacy FE wrappers (`seedDemoBoard` etc.).

### Integration / Env

- `EXECUTION_PATH` other than `claude-code` (without an explicit
  `.env.example` + `docker-compose.yml` amendment).
- `socket.io-client` reintroduction.
- A second `package.json:sideEffects:false` declaration per
  frontend subtree.
- Re-introducing `intent-agent` or `ARCHITECTURE_GATE` /
  `ARCH_OUTPUT_REVIEW`.

## Deferred Drifts

- **I-L** — `_saveAgentData` whitelist trim
  (`SdlcWorkflowService.js:1941-1957`); requires
  `agentContract.REQUIRED_OUTPUT_KEYS` audit.
- **I-M** — locale cleanup (`docs/PROGRESS.md` already removed; i18n
  `chatbox.*` gap is harmless).

## Related OBS

- **OBS-6** — `docs/obs6/04_UI_VERIFICATION.md` (freezes the UI contract).
- **OBS-8** — `docs/obs8/04_DEMO_VERIFICATION.md` (freezes the
  demo / mock contract).
- **OBS-9** — `docs/obs9/04_INTEGRATION_VERIFICATION.md` (freezes the
  integration / env contract).

## Related Implementation Files

### UI

- `frontend/src/store/runtimeSelectors.ts`
- `frontend/src/store/eventMappers.ts`
- `frontend/src/components/ui/ActionSpinner.tsx`
- `frontend/src/components/ui/ApproveRejectButtons.tsx`
- `frontend/src/pages/SdlcDashboard/**`
- `frontend/tests/visualMaps.snapshot.test.ts`

### Demo / Mock

- `backend/scripts/_demoFlags.js`
- `backend/scripts/demoSmokeClaudeCode.js`
- `backend/scripts/resumeGateSmoke.js`
- `backend/scripts/realClaudeCodeSmoke.js`
- `frontend/src/store/useWorkflowStore.ts`

### Integration / Env

- `backend/.env.example`
- `docker-compose.yml`
- `frontend/package.json`
- `frontend/vite.config.ts`
- `backend/src/services/sdlcConstants.js`
- `backend/src/controllers/SdlcController.js`
- `backend/src/services/SdlcWorkflowService.js`
- `backend/src/agents/claudeCodeRunner.js`

End of Integration Contract.
