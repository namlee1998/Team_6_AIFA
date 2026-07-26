# 09 — Task Template

Standard format for any engineering change to the AIFA control plane. Must be filled out before writing code.

---

## Task header

```
ID:          AIFA-XXX
Title:       [verb + object, e.g. "Add retry budget to QA agent"]
Type:        bug | feature | refactor | chore
Risk:        LOW | MEDIUM | HIGH
Author:      
Date:        YYYY-MM-DD
```

---

## Problem statement

> One paragraph. What is broken or missing? What does the user experience? Reference the specific file and line if known.

Example:
> `releaseGate.eligible` in `SdlcWorkflowService.js:1805` reads `qaTask.result.gateRecommendation === 'PASS'` directly. When the QA agent produces `REWORK` despite all 25 tests passing (a labelling gap), the "Approve Final Release" button stays locked even though execution evidence confirms quality. User cannot proceed without a full re-run.

---

## Root cause

> One or two sentences. What is the actual cause of the problem?

---

## Proposed fix

> Describe the change in plain language before writing any code.

---

## Files to change

| File | Why |
|------|-----|
| `backend/src/services/SdlcWorkflowService.js` | Fix `releaseGate.eligible` condition |
| `backend/src/services/SdlcWorkflowService.js` | Fix `submitReleaseDecision` server-side check |

---

## Files NOT to change

List any files you initially considered but ruled out, and why. This prevents reviewers from asking "why didn't you also change X?"

---

## Test plan

- [ ] Run `npm test` in `backend/` — all existing tests pass
- [ ] Start backend locally and open `/aifa` board
- [ ] Manually verify: QA card with `REWORK` recommendation + all tests passing → release gate shows Ready
- [ ] Manually verify: QA card with actual failures → release gate stays Locked

---

## Rollback plan

> How to revert if the change causes a regression.

Example: `git revert <commit>` — the change is self-contained in one function. No DB migration needed.

---

## Constraints checklist

- [ ] Does NOT break SSE streaming (`stream_*` functions use `astream_events`)
- [ ] Does NOT change `_get_llm(model_config)` signature
- [ ] Does NOT use CSS Grid in `sdlc-pipeline` (Flexbox only)
- [ ] Does NOT hardcode production credentials
- [ ] Does NOT import `agent_1`, `agent_2`, or `agent_3`
- [ ] Does NOT rewrite `SdlcWorkflowService` wholesale (targeted edit only)
- [ ] Does NOT change API response shape without updating `sdlcApi.ts`
- [ ] Does NOT add REJECT to QA_GATE or REQUEST_CHANGES to FINAL_GATE
- [ ] Does NOT modify Prisma schema without explicit approval
