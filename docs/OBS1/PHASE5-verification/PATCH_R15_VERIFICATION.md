# PATCH_R15_VERIFICATION.md — OBS-01.10 R-15 (SessionRail PHASE_DOT_COLORS removal)

> **Status:** PATCH VERIFICATION. No new production code outside the drift lines.
> **Repair ID:** R-15 (LOW)
> **Brief:** `SessionRail.PHASE_DOT_COLORS` removed; per-agent dots consume `getRuntimeVisual(status).background` (the canonical source per contract §5.2.2 cross-page identity, §7 forbidden pattern "Duplicated CSS mapping", AC-13).
> **Plan reference:** `OBS1_PHASE510_PLAN.md §5`
> **Analysis reference:** `OBS1_PHASE510_ANALYSIS.md §4.4`
> **Verification brief:** `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md §3.2 (R-15)`

---

## 1. Evidence

### 1.1 Diff summary

| File | Change |
| ---- | ------ |
| `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx` | -10 / +9 lines. Removed `PHASE_DOT_COLORS` map (lines 12-20); added `getRuntimeVisual` to import; replaced usage at line 192 with `getRuntimeVisual(status).background`. |

### 1.2 Pre-patch state (drift evidence)

`SessionRail.tsx:12-20` (BEFORE R-15):

```ts
const PHASE_DOT_COLORS: Record<SessionState['pipelinePhases'][number]['status'], string> = {
  pending: 'bg-surface-container-high/70 text-on-surface-variant',
  running: 'bg-blue-500 text-white',
  gate_pending: 'bg-amber-500 text-white',
  awaiting_review: 'bg-amber-500 text-white',
  completed: 'bg-emerald-500 text-white',
  failed: 'bg-red-500 text-white',
  skipped: 'bg-outline text-on-surface-variant',
};
```

Usage at line 192:

```tsx
<span className={`flex items-center justify-center rounded text-[8px] font-bold ${PHASE_DOT_COLORS[status]}`} …>
```

The local map duplicated the canonical colour mapping with DIFFERENT values:
- `running`: local `bg-blue-500 text-white` (saturated) vs canonical `RUNTIME_VISUAL.running.background = 'bg-blue-500/20 text-blue-300'` (muted)
- `completed`: local `bg-emerald-500 text-white` vs canonical `bg-emerald-500/20 text-emerald-400`
- All other states similarly diverged.

This violated contract §7 forbidden pattern "Duplicated CSS mapping" and §5.2.2 cross-page identity.

### 1.3 Post-patch state (R-15 fix)

`SessionRail.tsx:7-18` (AFTER R-15):

```ts
import {
  countCompletedAgents,
  selectAgentPhaseStatus,
  getRuntimeVisual,  // NEW: canonical visual source
} from '@/store/runtimeSelectors';

// OBS-01.10 R-15: removed the local `PHASE_DOT_COLORS` map. The canonical
// runtime selector (`runtimeSelectors.ts`) is the SINGLE source of colour
// mapping per the canonical runtime contract §5.2.2 cross-page identity
// invariant and §7 forbidden pattern "Duplicated CSS mapping". Per-agent
// dots now consume `getRuntimeVisual(status).background` (the same value
// the Dashboard pipeline strip and the Agent Task card border use).
```

Usage at line 193:

```tsx
const status = selectAgentPhaseStatus(session, k);
// OBS-01.10 R-15: dots consume the canonical runtime visual
// (the same source Dashboard pipeline strip and Agent Task
// card border use). Cross-page identity is enforced by
// construction per contract §5.2.2.
const dotClass = getRuntimeVisual(status).background;
return (
  <span className={`flex items-center justify-center rounded text-[8px] font-bold ${dotClass}`} …>
```

### 1.4 Grep audit (post-R-15)

```
$ grep -rn "PHASE_DOT_COLORS" frontend/
frontend/src/store/runtimeSelectors.ts:23:// (`COLUMN_BORDER`, `TASK_ICON`, `PhaseChip`, `PHASE_DOT_COLORS`)
frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:13:// OBS-01.10 R-15: removed the local `PHASE_DOT_COLORS` map. The canonical
```

Only two references remain — both are documentation comments:
1. `runtimeSelectors.ts:23` — historical comment listing the formerly-local maps that were consolidated into the canonical `RUNTIME_VISUAL`. The comment itself is intentional documentation of the OBS-01.4 cleanup.
2. `SessionRail.tsx:13` — the R-15 fix comment.

No source-level usage of `PHASE_DOT_COLORS` remains.

---

## 2. Runtime Replay

### 2.1 Step-by-step trace

For each per-agent dot rendered by SessionRail:

| Step | Source | Selector | Visual map | Rendered class |
| ---- | ------ | -------- | ---------- | -------------- |
| 1 | `session.pipelinePhases[i].status` (post-R-23 patched) | `selectAgentPhaseStatus(session, k)` | `getRuntimeVisual(status).background` | `bg-blue-500/20 text-blue-300` (running) or canonical equivalent |
| 2 | Rendered at line 197: `<span className="… ${dotClass}">` | | | visible on left rail |
| 3 | Cross-page check: same value is used by `OverviewPage.tsx:259` (`visual.background`) and `SdlcDashboard/index.tsx:319` (`cardVisual.background`) | | | |

### 2.2 Visible UI effect (per state)

| State | Pre-R-15 dot class | Post-R-15 dot class (canonical) | Matches Dashboard / Agent Task? |
| ----- | ------------------ | ------------------------------- | :-----------------------------: |
| `pending` | `bg-surface-container-high/70 text-on-surface-variant` | `bg-surface-container text-on-surface-variant/60` | ✓ (same canonical) |
| `running` | `bg-blue-500 text-white` | `bg-blue-500/20 text-blue-300` | ✓ |
| `gate_pending` | `bg-amber-500 text-white` | `bg-amber-500/20 text-amber-400` | ✓ |
| `awaiting_review` | `bg-amber-500 text-white` | `bg-amber-500/20 text-amber-300` | ✓ |
| `completed` | `bg-emerald-500 text-white` | `bg-emerald-500/20 text-emerald-400` | ✓ |
| `failed` | `bg-red-500 text-white` | `bg-red-500/20 text-red-400` | ✓ |
| `skipped` | `bg-outline text-on-surface-variant` | `bg-outline-variant/30 text-on-surface-variant` | ✓ |

All 7 PhaseStatus values now use the canonical `RUNTIME_VISUAL[*].background` — identical to Dashboard pipeline strip + Agent Task card border.

### 2.3 Invariants satisfied

| Invariant | Status |
| --------- | :----: |
| §5.2.2 cross-page identity ("Dashboard pipeline strip, Agent Task card, and SessionRail dot MUST agree byte-for-byte") | ✓ — SessionRail now consumes the canonical source |
| AC-13 ("Dashboard, Agent Task, and Inspector MUST NEVER disagree") | ✓ |
| §7 forbidden pattern "Duplicated CSS mapping" | ✓ — local `PHASE_DOT_COLORS` removed |
| AC-20 ("No UI component may introduce a hardcoded colour string outside the Tailwind theme tokens. Every colour MUST come from the theme") | ✓ |

---

## 3. Regression

### 3.1 Test results

```
$ cd frontend && npx tsc --noEmit
(no output — clean)

$ cd frontend && npx eslint src/pages/SdlcDashboard/components/SessionRail.tsx
(no output — 0 errors, 0 warnings)

$ cd frontend && npx vitest run
Test Files  8 passed (8)
Tests       116 passed (116)
```

All 116 tests pass (90 cross-page identity tests + 13 R-23 mapper tests + 13 other tests). No regressions.

### 3.2 Per-file comparison

| Suite | Pre-R-15 | Post-R-15 | Δ |
| ----- | --------: | --------: | -: |
| `tests/runtimeSelectors.test.ts` (cross-page identity) | 90 | 90 | 0 |
| `tests/eventMappers.pipelinePhases.test.ts` | 13 | 13 | 0 |
| `tests/OverviewPage.test.tsx` | 3 | 3 | 0 |
| `tests/SdlcDashboard.test.tsx` | 2 | 2 | 0 |
| Other tests | 8 | 8 | 0 |
| **Total** | **116** | **116** | **0** |

Zero regressions.

### 3.3 Surfaces verified

| Surface | Status |
| ------- | :----: |
| FE `SessionRail.tsx` per-agent dot rendering | ✓ Consumes canonical `RUNTIME_VISUAL[*].background` |
| FE Dashboard pipeline strip (`OverviewPage.tsx:259`) | ✓ Unchanged — uses `getRuntimeVisual(status).background` |
| FE Agent Task card border (`SdlcDashboard/index.tsx:319`) | ✓ Unchanged — uses `getRuntimeVisual(ps).border` |
| FE Agent Task chip background (`SdlcDashboard/index.tsx:333`) | ✓ Unchanged — uses `getRuntimeVisual(ps).background` |
| FE Inspector (per contract §5.1.5 — gates only, no per-agent visuals) | ✓ Not affected |
| Tailwind theme tokens | ✓ All colors come from the theme — no hardcoded colour strings |

### 3.4 No new regressions

- All previously-passing FE tests continue to pass.
- The visible UI for `running` and other states CHANGES (saturated → muted palette) — this is the INTENDED fix per the contract §5.2.2 cross-page identity requirement. The visual change is a feature, not a regression.
- The `title` attribute on each dot (`${k} · ${status}`) is unchanged.
- Session-level `STATUS_BADGE` (line 31-38) is preserved — session-level status is a separate enum from per-agent runtime.

---

## 4. Acceptance criteria

| AC | Status | Evidence |
| -- | :----: | -------- |
| **AC-D1**: `PHASE_DOT_COLORS` is no longer declared in `SessionRail.tsx` | ✓ | `grep -rn "PHASE_DOT_COLORS" frontend/` shows only documentation comments; no source declaration or usage |
| **AC-D2**: SessionRail per-agent dot for `running` agent renders with `bg-blue-500/20 text-blue-300` (the canonical `RUNTIME_VISUAL.running.background`) | ✓ (logical) | `SessionRail.tsx:193` reads `getRuntimeVisual(status).background`; `runtimeSelectors.test.ts:980-987` asserts `RUNTIME_VISUAL.running.background === 'bg-blue-500/20 text-blue-300'` |
| **AC-D3**: SessionRail per-agent dot for `completed` agent renders with `bg-emerald-500/20 text-emerald-400` | ✓ (logical) | Same — `RUNTIME_VISUAL.completed.background` is asserted in `runtimeSelectors.test.ts:1004-1011` |
| **AC-D4**: All 5 dots visually match the corresponding Dashboard pipeline strip cell | ✓ | Both surfaces now consume the SAME `RUNTIME_VISUAL[*].background` value (enforced by construction — there is no per-surface override) |
| **AC-D5**: Pre-existing 103 frontend tests pass | ✓ | `Tests 116 passed (116)` — no test regressions; pre-existing 103 + 13 R-23 tests = 116 |
| **AC-D6**: `runtimeSelectors.test.ts` `RUNTIME_VISUAL[*].background` tests continue to pass | ✓ | 90 tests in `runtimeSelectors.test.ts` all pass; cross-page identity test (`runtimeSelectors.test.ts:628-702`) asserts `getRuntimeVisual(status)` returns identical value across Dashboard / Agent Task / Inspector consumers |

---

## 5. Remaining risks

### 5.1 Visible UI change is the intended fix

The SessionRail per-agent dot colour CHANGES from saturated (`bg-blue-500 text-white`) to muted (`bg-blue-500/20 text-blue-300`). This is the intended fix per the contract §5.2.2 cross-page identity requirement. No user-visible regression; the change brings the LEFT rail into visual agreement with the Dashboard pipeline strip and Agent Task card.

### 5.2 Session-level `STATUS_BADGE` unchanged

`SessionRail.tsx:31-38` defines `STATUS_BADGE` for session-level status (not per-agent runtime). This is OUT OF R-15 SCOPE per plan §5.2 ("Session-level status badge: Out of scope (`STATUS_BADGE[session.status]` at line 31-38 is session-level, NOT per-agent)"). The contract §5.1 covers per-agent runtime states; session-level is a separate enum documented in `05_CANONICAL_RUNTIME_STATE.md §2.12`. Future work may want to canonicalise session-level visuals too, but that is NOT R-15.

### 5.3 No source-level duplicate mapping remains

Verified via `grep -rn "PHASE_DOT_COLORS" frontend/`. Only documentation comments remain (intentional).

---

## 6. Sign-off for R-15

| Criterion | Status |
| --------- | :----: |
| Drift line identified by file:line | ✓ (`SessionRail.tsx:12-20` declaration + `:192` usage) |
| Evidence captured (pre/post diff) | ✓ |
| Local `PHASE_DOT_COLORS` removed | ✓ |
| Dots consume canonical `RUNTIME_VISUAL[*].background` | ✓ |
| Cross-page identity invariant restored | ✓ (Dashboard / Agent Task / SessionRail now agree) |
| No new regressions introduced | ✓ (116/116 tests pass; 0 regressions) |
| Other contracts / SSE / DTO / store ownership / selector ownership unchanged | ✓ |
| Tailwind theme tokens remain the single colour source | ✓ |
| Rollback path clear | ✓ (git revert of `SessionRail.tsx`) |

**R-15: COMPLETE.**

---

## 7. OBS-01.10 Completion

All four repair IDs are now closed:

| R-ID | Status | Verification report |
| ---- | :----: | ------------------- |
| R-25 (HIGH) | ✓ COMPLETE | `PATCH_R25_VERIFICATION.md` |
| R-24 (HIGH) | ✓ COMPLETE | `PATCH_R24_VERIFICATION.md` |
| R-23 (LOW) | ✓ COMPLETE | `PATCH_R23_VERIFICATION.md` |
| R-15 (LOW) | ✓ COMPLETE | `PATCH_R15_VERIFICATION.md` |

OBS-01 project-level completion criteria (per `OBS1_PHASE510_PLAN.md §8`):

| # | Criterion | Status |
| - | --------- | :----: |
| 1 | R-25 resolved | ✓ |
| 2 | R-24 resolved | ✓ |
| 3 | R-23 resolved | ✓ |
| 4 | R-15 resolved | ✓ |
| 5 | Runtime Contract still satisfied | ✓ — all invariants 1-20 verified |
| 6 | 116/116 tests pass (103 pre-existing + 13 R-23 mapper tests) | ✓ |
| 7 | No new Repair ID created | ✓ |
| 8 | Phase 5 verification still passes | ✓ — no regressions |

**OBS-01: CLOSED.**

---

## 8. References

- `OBS1_PHASE510_ANALYSIS.md` (Bước 1)
- `OBS1_PHASE510_PLAN.md` (Bước 4)
- `docs/OBS1/PHASE5-verification/01_VERIFICATION_REPORT.md` §10.4 (R-15 finding)
- `docs/OBS1/PHASE5-verification/03_REGRESSION_REPORT.md` §3.2 (R-15 regression)
- `docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md` §5.2.2, §7, AC-13, AC-20
- `frontend/src/pages/SdlcDashboard/components/SessionRail.tsx:7-18` (R-15 imports + comment) + `:188-198` (R-15 usage)
- `frontend/src/store/runtimeSelectors.ts:538-611` (`RUNTIME_VISUAL` canonical source)
- `frontend/tests/runtimeSelectors.test.ts:980-1027` (canonical visual map tests)

End of R-15 patch verification. **OBS-01 CLOSED.**