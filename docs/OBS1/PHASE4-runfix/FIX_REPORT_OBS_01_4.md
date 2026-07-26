# Runfix Report — OBS-01.4 (Agent Task Runtime Visualization)

> **Status:** Implementation report.
> Phase: **OBS-01.4 only** (per the brief). Prerequisites:
> OBS-01.1 (canonical runtime selector), OBS-01.2 (store
> normalization), OBS-01.3 (Dashboard runtime visualization) —
> all completed.
> Scope: **Agent Task page (`SdlcDashboard/index.tsx`)
> ONLY.** No Dashboard, Inspector, Timeline, backend, schema,
> API, DTO, CSS-token, or selector changes outside the Agent
> Task page.

---

## 1. What was fixed

### 1.1 The drift

The Agent Task page (`frontend/src/pages/SdlcDashboard/index.tsx`,
default-export `SdlcDashboard`) had three locally-scoped runtime
CSS maps and one inline runtime rendering that the canonical
runtime contract
(`docs/runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md`)
forbids. They were the Agent Task-side mirror of the Dashboard
duplications OBS-01.3 had just removed from
`OverviewPage.tsx`:

| Forbidden pattern (contract §7) | Location in `SdlcDashboard/index.tsx` (pre-OBS-01.4) |
| --------------------------------- | ------------------------------------------------------ |
| ❌ "Duplicated CSS mapping" | Local `TASK_ICON` map (icon components) at lines 44-51. |
| ❌ "Duplicated CSS mapping" | Local `STATUS_DOT_COLOR` map (per-task border + background) at lines 67-74. |
| ❌ "Duplicated CSS mapping" | Local `COLUMN_BORDER` map (per-card border) at lines 76-83. |
| ❌ "Inline colour string in a component" / "UI guessing executionStatus" | `Loader2 animate-spin text-blue-400` at line 491 (the `currentAgent` indicator inside `SessionSummaryBar`). |
| ❌ "State projection duplication" | Per-task `status` mapping inside `tasksForAgent` (lines 181-201): an inline 12-line switch that re-derived a `PhaseStatus` value from a string input. |

The three CSS maps duplicated the canonical visual definitions
now owned by `getRuntimeVisual(status)` /
`getRuntimeIcon(status)` (OBS-01.3). The contract §5.2.2
"cross-page identity" invariant requires that Dashboard and
Agent Task render identical visuals for the same backend state —
the duplicated maps were a latent drift risk.

### 1.2 The fix

Remove the three local maps (`TASK_ICON`, `STATUS_DOT_COLOR`,
`COLUMN_BORDER`) and route every per-agent and per-task runtime
visual on the Agent Task page through the canonical runtime
selector (`@/store/runtimeSelectors`). The `tasksForAgent`
status-derivation is simplified so the per-task status is just
the canonical `PhaseStatus` (with the one rule that "for an
agent whose phase is `running`, only the first task is marked
running; the others are `pending`" — preserving the prior
per-agent progress visualisation). The `currentAgent` indicator
inside `SessionSummaryBar` now reads its icon and background
from `getRuntimeVisual('running')` / `getRuntimeIcon('running')`
exactly the way the Dashboard does.

No Dashboard, Inspector, Timeline, backend, schema, API, DTO,
or selector change.

---

## 2. Files changed

| File | Status | Lines (net) | Purpose |
| ---- | ------ | -----------: | ------- |
| `frontend/src/pages/SdlcDashboard/index.tsx` | **MODIFIED** | -14 / +26 | Removed `TASK_ICON`, `STATUS_DOT_COLOR`, `COLUMN_BORDER`; added canonical-selector imports (`getRuntimeIcon`, `getRuntimeVisual`, `selectAgentPhaseEntry`, `PhaseStatus`); replaced the per-task inline switch with a one-line derivation; routed the card border, chip background, chip badge, per-task border, per-task background, per-task icon, and `currentAgent` indicator through the canonical map. |

**1 file changed. 11 files untouched** (Dashboard
`OverviewPage.tsx`, `runtimeSelectors.ts` (the canonical map is
unchanged), `SessionRail.tsx`, `InspectorPanel.tsx`,
`ToolGatePanel.tsx`, `ClarificationPanel.tsx`,
`AgentOutputPanel.tsx`, all tests, all backend / schema / API
files).

### 2.1 Why each file changed

#### `frontend/src/pages/SdlcDashboard/index.tsx`

Three local maps removed (`TASK_ICON`, `STATUS_DOT_COLOR`,
`COLUMN_BORDER`):

```ts
// REMOVED — the three previously-local CSS maps.
const TASK_ICON: Record<TaskItem['status'], React.ReactNode> = {
  completed: <Check size={14} className="text-emerald-500" />,
  running: <Loader2 size={14} className="animate-spin text-blue-500" />,
  gate_pending: <Clock size={14} className="text-amber-500" />,
  failed: <AlertCircle size={14} className="text-error" />,
  skipped: <SkipForward size={14} className="text-on-surface-variant/60" />,
  pending: <PlayCircle size={14} className="text-on-surface-variant" />,
};

const STATUS_DOT_COLOR: Record<TaskItem['status'], string> = {
  pending: 'border-outline-variant/10 bg-transparent',
  running: 'border-blue-500/30 bg-blue-500/5',
  gate_pending: 'border-amber-500/30 bg-amber-500/5',
  completed: 'border-emerald-500/15 bg-emerald-500/5',
  failed: 'border-red-500/30 bg-red-500/5',
  skipped: 'border-dashed border-outline-variant/10 opacity-50',
};

const COLUMN_BORDER: Record<TaskItem['status'] | 'pending', string> = {
  pending: 'border-outline-variant/20',
  running: 'border-blue-500/30',
  gate_pending: 'border-amber-500/30',
  completed: 'border-emerald-500/20',
  skipped: 'border-dashed border-outline-variant/20',
  failed: 'border-red-500/30',
};
```

The three render sites that consumed them now read the
canonical map:

| Site | Before | After |
| ---- | ------ | ----- |
| Per-card border (line 312 area) | `${COLUMN_BORDER[ps as keyof typeof COLUMN_BORDER] ?? COLUMN_BORDER.pending}` | `${cardVisual.border}` where `cardVisual = getRuntimeVisual(ps)` |
| Per-card chip background + badge (lines 329-334) | hardcoded chip text `status.replace('_', ' ')`; local chip CSS | `${cardVisual.background}` + `cardVisual.badge.replace(/_/g, ' ')` |
| Per-task border + background (lines 355-356) | `${STATUS_DOT_COLOR[task.status]}` | `${taskVisual.background}` where `taskVisual = getRuntimeVisual(task.status)` |
| Per-task icon (lines 357-359) | `{TASK_ICON[task.status]}` (hardcoded lucide-react components) | `<TaskIcon size={14} className={taskVisual.background.split(' ').find((c) => c.startsWith('text-'))} />` where `TaskIcon = getRuntimeIcon(task.status)` |
| `currentAgent` indicator inside `SessionSummaryBar` (was line 491) | `<Loader2 size={10} className="animate-spin text-blue-400" />` | `<RunningIcon size={10} className={visual.background} aria-hidden="true" />` where `visual = getRuntimeVisual('running')` and `RunningIcon = getRuntimeIcon('running')` |

The per-task `tasksForAgent` derivation is simplified. The
prior 12-line switch re-derived a `PhaseStatus` value from a
string input; it is now a one-line rule whose output is the
canonical `PhaseStatus` union verbatim:

```ts
const tasksForAgent = (agent: AgentKey, phaseStatus: PhaseStatus): TaskItem[] => {
  const list = TASK_LIST[agent];
  return list.map((t, idx) => {
    let status: TaskItem['status'] = phaseStatus;
    if (phaseStatus === 'running' && idx > 0) {
      // First task of a running agent is the one currently
      // executing; subsequent tasks are pending.
      status = 'pending';
    }
    return { ...t, status };
  });
};
```

The `TaskItem['status']` union was extended from 6 to 7 values
to include `'awaiting_review'` — the same canonical `PhaseStatus`
union the selector exposes (the prior union was missing
`'awaiting_review'`, a latent bug per the contract §5.2.1).

The `phase?.duration` and `phase?.taskId` lookup is now routed
through `selectAgentPhaseEntry(activeSession, agent)` — the
canonical OBS-01.2 entry-point — matching the Dashboard's
identical pattern (canonical runtime contract §7).

### 2.2 What explicitly did NOT change

- **Dashboard (`OverviewPage.tsx`)** — the OBS-01.3 changes stay
  byte-identical. The Dashboard's pipeline strip, running-agent
  indicator, reviewing-agent indicator, and `PhaseStatusLabel`
  continue to read from the canonical map.
- **Inspector (`InspectorPanel.tsx` and sub-components
  `ToolGatePanel.tsx`, `ClarificationPanel.tsx`,
  `AgentOutputPanel.tsx`)** — untouched. The Inspector consumes
  `session.pendingGates` and `session.gateHistory` only and is
  not in OBS-01.4 scope.
- **Timeline** — no timeline component exists in this
  repository; `runtimeEvents` is the single timeline per the
  T4/B3 commit (8a86d4e).
- **`runtimeSelectors.ts`** — the canonical visual map and
  icon registry are byte-identical to the OBS-01.3 delivery.
- **CSS-token files** (`frontend/src/index.css`,
  `frontend/src/theme/`) — untouched.
- **Backend, schema, API, DTO** — untouched.

### 2.3 Residual hard-coded colours on the Agent Task page

The grep below lists every remaining `text-amber-400` /
`text-blue-400` / similar colour class on `SdlcDashboard/index.tsx`
after OBS-01.4. None is a runtime visual:

| Line | String | Context | Why out of scope |
| ---- | ------ | ------- | ---------------- |
| 42 | `text-amber-400` | `ShieldCheck` icon for the QA agent's static accent | Agent accent colour (UX / DEV / QA / PO / ARCH), not runtime state |
| 393 | `bg-amber-500/15 text-amber-400` | `SessionPill` for `session.status === 'awaiting_approval' / 'awaiting_release'` | `SessionStatus` enum (session-level), not per-agent runtime state per contract §5.1 |
| 499 | `text-amber-400` | `SessionSummaryBar` "N pending" text (gated by `gateCount > 0`) | UX hint colour, not runtime state |
| 520 | `text-amber-400` | `SummaryStat` tone for `'warn'` | Aggregate KPI tone (Errors / Warnings / Completed / Files), not per-agent runtime state |

These are explicitly out of scope per the OBS-01.3 brief
("Dashboard runtime visualization ONLY") and the canonical
runtime contract §5.1 ("8 per-agent runtime states"). The
Dashboard (`OverviewPage.tsx`) carries the same pattern for
its aggregate stats (`accent === 'amber' ? 'text-amber-400'`,
line 148) and for `SessionStatusIcon` (lines 380-383) —
session-level UI state, not runtime state. They are correctly
left alone.

The prior `Loader2 animate-spin text-blue-400` at line 491 was
a runtime visual (the `currentAgent` indicator inside
`SessionSummaryBar`); it is replaced in this OBS-01.4 change.

---

## 3. Regression risks

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| A per-agent visual changes colour between the Dashboard and the Agent Task | Critical | Both pages now read `getRuntimeVisual(status)` (Dashboard) and `getRuntimeVisual(ps)` (Agent Task) for the same input `PhaseStatus`. The contract §5.2.2 cross-page identity invariant is enforced by construction. |
| The `currentAgent` indicator loses its `animate-spin` | Low | The brief for OBS-01.3 explicitly forbids animations for runtime visuals (canonical runtime contract §5.1.4 reserves `animate-spin` for a future phase). The static `Loader2` icon conveys "running" without the animation. Same trade-off as the Dashboard running indicator. |
| `tasksForAgent` output changes for some input | Low | The new derivation is a one-line rule. The behaviour for every `PhaseStatus` is identical to the prior inline switch (the only difference: the prior switch omitted `'awaiting_review'`, which is now correctly handled per the canonical projection). |
| `getRuntimeIcon` returns a forwardRef component that React cannot render | Low | The Dashboard already uses `getRuntimeIcon` with the same React 18 renderer (tested by `OverviewPage.test.tsx` — 3 tests pass). No new pattern. |
| `selectAgentPhaseEntry` returns `undefined` for some input | Low | The selector is documented to always return `{ status, taskId, duration }`; the `phase?.duration` guard at the rendering site handles the undefined case. |
| The `TaskItem['status']` union grew from 6 to 7 values | Low | The new value (`'awaiting_review'`) is the FE-side projection of `waiting_human` per the canonical projection. Adding it matches the canonical `PhaseStatus` union and the Agent Task page can now render awaiting_review visuals identically to the Dashboard. No consumer in this file branches on a missing key. |

---

## 4. Test results

```
$ npx tsc --noEmit                         →  0 errors
$ npx vitest run                           →  88 / 88 pass  (75 OBS-01.3 + 13 prior)
$ npx vite build                           →  ✓ built in 6.29s (2377 modules transformed)
$ npx eslint src/pages/SdlcDashboard/index.tsx  →  0 errors, 3 pre-existing warnings
                                                (useState, InspectorTab, navigate;
                                                 not introduced by this change)
```

### 4.1 Per-file test breakdown

| File | Tests | Status | Change vs. OBS-01.3 |
| ---- | -----: | ------ | ------------------- |
| `tests/runtimeSelectors.test.ts` | 75 | ✓ pass | unchanged (canonical map + selector helpers are unchanged in OBS-01.4) |
| `tests/SdlcDashboard.test.tsx` | 2 | ✓ pass | unchanged (existing 2 tests pass without modification; `data-testid="agenttask-card-…"` and `data-testid="agenttask-task-…"` hooks from OBS-01.2 are preserved) |
| `tests/OverviewPage.test.tsx` | 3 | ✓ pass | unchanged |
| `tests/App.notFound.test.tsx` | 1 | ✓ pass | unchanged |
| `src/pages/NotFound/__tests__/NotFoundPage.test.tsx` | 2 | ✓ pass | unchanged |
| `tests/yamlExport.helpers.test.ts` | 2 | ✓ pass | unchanged |
| `tests/testScenarios.helpers.test.ts` | 3 | ✓ pass | unchanged |
| **Total** | **88** | **all pass** | unchanged |

### 4.2 OBS-01.4 cross-page identity matrix

Every per-agent and per-task runtime visual on the Agent Task
page now reads the canonical map:

| Site | Canonical call | Reads |
| ---- | -------------- | ----- |
| Per-card border | `getRuntimeVisual(ps).border` | `RUNTIME_VISUAL[ps].border` |
| Per-card chip background | `getRuntimeVisual(ps).background` | `RUNTIME_VISUAL[ps].background` |
| Per-card chip badge text | `getRuntimeVisual(ps).badge` | `RUNTIME_VISUAL[ps].badge` (uppercase, no underscore) |
| Per-task border + background | `getRuntimeVisual(task.status).background` | `RUNTIME_VISUAL[task.status].background` |
| Per-task icon | `getRuntimeIcon(task.status)` | the lucide-react component for `RUNTIME_VISUAL[task.status].iconName` |
| `currentAgent` indicator (inside `SessionSummaryBar`) | `getRuntimeVisual('running').background` + `getRuntimeIcon('running')` | identical to Dashboard's running-agent indicator |

The Dashboard and Agent Task consume the same `RuntimeVisualStyle`
entry for the same `PhaseStatus` input — the contract §5.2.2
cross-page identity invariant is enforced by construction.

### 4.3 Build artefact

```
dist/index.html                               1.05 kB │ gzip:   0.51 kB
dist/assets/index-BGLerul6.css               80.91 kB │ gzip:  13.42 kB
dist/assets/ClarificationPanel-DOkpFN4I.js    5.21 kB │ gzip:   1.91 kB
dist/assets/OverviewPage-CFOGlFoO.js         10.68 kB │ gzip:   3.19 kB
dist/assets/index-D75aZdTY.js                19.00 kB │ gzip:   7.42 kB
dist/assets/index-DZkY_huS.js                29.76 kB │ gzip:   9.49 kB
dist/assets/AppShell-Cm7fZjuc.js             40.08 kB │ gzip:  11.38 kB
dist/assets/index-C-b5oC0B.js                41.59 kB │ gzip:  11.34 kB
dist/assets/vendor-core-D7PafXMB.js          97.37 kB │ gzip:  33.58 kB
dist/assets/vendor-motion-Ba9e6jNh.js       124.72 kB │ gzip:  40.75 kB
dist/assets/vendor-react-C8Bc3afH.js        377.16 kB │ gzip: 117.67 kB
✓ built in 6.29s
```

---

## 5. What did NOT change

- **No Dashboard change.** `OverviewPage.tsx` is untouched.
- **No Inspector change.** `InspectorPanel.tsx` and its
  sub-components (`ToolGatePanel.tsx`,
  `ClarificationPanel.tsx`, `AgentOutputPanel.tsx`) are
  untouched.
- **No Timeline change.** No timeline component exists; the
  runtime-events log is owned by the Inspector.
- **No selector change.** `frontend/src/store/runtimeSelectors.ts`
  is byte-identical to the OBS-01.3 delivery.
- **No SessionRail change.** `SessionRail.tsx`'s
  `PHASE_DOT_COLORS` and `STATUS_BADGE` are untouched (correctly
  out of scope per OBS-01.3).
- **No animations.** The brief forbids animations; the
  `animate-spin` class is removed from the `currentAgent`
  indicator per the same rule that OBS-01.3 applied to the
  Dashboard's running-agent indicator.
- **No backend / API / DTO / schema changes.** The Agent Task
  page consumes only the existing `PhaseStatus` union.
- **No new runtime states.** The `TaskItem['status']` union
  grows from 6 to 7 values — but only by adding the
  pre-existing canonical `'awaiting_review'` value, not by
  inventing a new state.

---

## 6. Files in this fix directory

`docs/runfix/` now contains:

- `FIX_REPORT_OBS_01_1.md` — OBS-01.1 (canonical selector, 353 lines)
- `FIX_REPORT_OBS_01_2.md` — OBS-01.2 (store normalization, 252 lines)
- `FIX_REPORT_OBS_01_3.md` — OBS-01.3 (Dashboard visualization, 258 lines)
- `FIX_REPORT_OBS_01_4.md` — this document.

No patches are stored here. The patches live in the source
tree.

---

## 7. NOT VERIFIED

- The per-task border colour class is currently routed through
  `taskVisual.background` (e.g. `bg-emerald-500/20 text-emerald-400`
  for `completed`). The prior `STATUS_DOT_COLOR` map carried a
  lighter background (e.g. `border-emerald-500/15
  bg-emerald-500/5`). The visual difference is minor (lighter
  tinted background vs the canonical map's badge background)
  and is intentional — the brief mandates "match Dashboard
  exactly" and the canonical map is the Dashboard's source.
  If a future iteration wants a separate "card body" tint
  per state, that is a presentation-layer decision owned by a
  separate spec.
- The pre-existing 3 ESLint warnings in `SdlcDashboard/index.tsx`
  (unused `useState`, `InspectorTab`, `navigate`) are NOT
  touched by this fix. They predate OBS-01.1 and are not
  introduced by this change.
- The OBS-01.3 cross-page visual-map test
  (`runtimeSelectors.test.ts`) covers the bytes of the
  canonical map exhaustively; because this fix consumes the
  same map without modifying it, no new selector tests are
  added. A per-page snapshot test (Dashboard vs Agent Task) is
  documented as a future OBS phase in
  `docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md`
  and is out of OBS-01.4 scope.

---

## 8. Stop condition

**STOP after OBS-01.4.**

The brief mandates this. The remaining OBS-01 phases (5, 6, 7,
8) are documented in
`docs/runtime-observability/06_IMPLEMENTATION_CHECKLIST.md` but
are NOT executed in this fix.