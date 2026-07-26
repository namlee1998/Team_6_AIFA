# 10 — Change Report Template

Fill this out after completing any control-plane change. It becomes the PR description and feeds the CHANGELOG.

---
## Summary

```
PR:          #
Task:        AIFA-XXX
Type:        bug | feature | refactor | chore
Risk:        LOW | MEDIUM | HIGH
Files changed: N
Tests added:   N
```

---

## What changed

> Bullet points only. What does the system do differently now? Focus on behaviour, not implementation.

Example:
- `releaseGate.eligible` now treats a QA run as passing when `test_run_report.executed && failed === 0`, even if `gateRecommendation === 'REWORK'`
- `submitReleaseDecision` applies the same fallback — no more 409 when all tests passed
- "Approve Final Release" button unlocks correctly after QA "Ship it" approval

---

## Why

> One sentence per bullet above, explaining the motivation.

---

## Files changed

| File | Change type | Summary |
|------|-------------|---------|
| `backend/src/services/SdlcWorkflowService.js` | bug fix | `releaseGate.eligible` + `submitReleaseDecision` fallback |

---

## Root causes fixed

> If this is a bug fix, list every independent source of the bug that was addressed.

Example:
| # | Location | Symptom |
|---|----------|---------|
| 1 | `quality_gate_pass` rule | QA card badge INVALID |
| 2 | `phase.invalid` runtime re-check | QA card badge INVALID |
| 3 | `submitGateDecision` hard block | Cannot approve QA ("Ship it") |
| 4 | `releaseGate.eligible` | Final Release button stays Locked |
| 5 | `submitReleaseDecision` | Click Approve → HTTP 409 |

---

## Tests

- [ ] All existing tests pass (`npm test`)
- [ ] New tests added for changed behaviour (if applicable)
- [ ] Manual smoke test performed on the board

Describe any manual test steps:
```
1. Seed board: POST /demo/seed-board?reset=true
2. Advance workflow to QA phase (or use existing completed QA task)
3. Verify INVALID badge absent on QA card
4. Click "Ship it" → confirm no 409
5. Verify "Approve Final Release" button is Ready
6. Click Approve → confirm RELEASED state
```

---

## Constraints verified

- [ ] SSE streaming intact (no `astream_events` refactor)
- [ ] `_get_llm(model_config)` signature unchanged
- [ ] No Prisma schema changes
- [ ] API response shape unchanged (or `sdlcApi.ts` updated)
- [ ] No REJECT on QA_GATE, no REQUEST_CHANGES on FINAL_GATE

---

## CHANGELOG entry

```markdown
### [X.Y.Z] — YYYY-MM-DD

#### Fixed
- releaseGate.eligible now accepts QA runs where all tests passed even when
  gateRecommendation is REWORK (labelling gap in QA prompt). Fixes "Locked"
  Final Release button after valid QA approval.
- submitReleaseDecision no longer throws 409 for the same condition.
- phase.invalid badge now re-validates live against current gate rules instead
  of trusting potentially-stale DB status.
```

---

## Known limitations / follow-up

> Anything this change does NOT fix, and any follow-up tasks created.

---

## Reviewer notes

> Anything the reviewer should pay special attention to.
