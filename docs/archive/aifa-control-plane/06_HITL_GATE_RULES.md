# 06 — HITL Gate Rules

All rules governing when gates pause, what decisions are allowed, and how output is validated.

---

## Gate identifiers

| Agent | Gate name |
|-------|-----------|
| intent-agent | `REQUIREMENT_GATE` |
| po-agent | `REQUIREMENT_GATE` |
| ux-agent | `UX_GATE` |
| dev-agent | `DEV_GATE` |
| qa-agent | `QA_GATE` |
| Final release | `FINAL_GATE` |

---

## Allowed decisions per gate

| Gate | APPROVE | REJECT | REQUEST_CHANGES |
|------|---------|--------|-----------------|
| REQUIREMENT_GATE | ✓ | ✓ | ✓ |
| UX_GATE | ✓ | ✓ | ✓ |
| DEV_GATE | ✓ | ✓ | ✓ |
| QA_GATE | ✓ | — | ✓ |
| FINAL_GATE | ✓ | ✓ | — |

**Never add REJECT to QA_GATE.** `REQUEST_CHANGES` re-runs the QA agent; `APPROVE` ("Ship it") advances to FINAL_GATE.  
**Never add REQUEST_CHANGES to FINAL_GATE.** Only APPROVE or REJECT.

---

## Gate evaluation flow

```
Agent completes
      │
      ▼
_validateGateOutput(task, agentOutput)
      │   runs OUTPUT_CONTRACTS rules for this agent type
      ▼
violations[] classified as BLOCKER / WARNING / INFO
      │
      ├── any BLOCKER? → artifact stored as INVALID
      │                → awaitingReview = true (force human)
      │
      └── no BLOCKER → _evaluateGatePolicy(task)
                │         checks confidence score vs AUTO_APPROVE_CONFIDENCE (0.8)
                ▼
            gateMode === confidence_based AND confidence ≥ 0.8?
                │ yes → auto-approve (emit hitl_decision action='auto_approve')
                └ no  → pause for human review
```

---

## `_validateGateOutput` rules

See `04_AGENT_CONTRACT.md` for the full per-agent rule list.

Key principles:
- Rules with `when(output)` are conditional — they only fire when the condition is true.
- A BLOCKER violation sets `ok = false` and stores the artifact as `INVALID`.
- WARNING violations are noted but do not block the gate.
- The `quality_gate_pass` rule for QA has a **fallback**: if `test_run_report.executed === true && failed === 0 && total > 0`, treat as PASS even if `gateRecommendation` says `REWORK`.

---

## `phase.invalid` badge logic

The board card shows a red `INVALID` badge when `phase.invalid === true`. This is computed live on each status poll:

```
AgentArtifact.hasInvalid(taskId) === false  →  invalid = false  (fast path)
AgentArtifact.hasInvalid(taskId) === true   →  re-run _validateGateOutput live
                                                 any BLOCKER? → invalid = true
                                                 no BLOCKER?  → invalid = false (stale DB, ignore)
```

This means: fixing gate rules fixes the INVALID badge for already-completed tasks on the next poll — no re-run needed.

---

## Approve button blocking

The APPROVE button on a card is `disabled` when `card.invalid === true`. The `invalid` flag propagates from `phase.invalid`.

---

## Structured HITL (patch + field-level feedback)

Endpoint: `POST /tasks/:task_id/decision`

Actions:
- `approve` — mark output as accepted, commit, queue next agent.
- `reject_and_rerun` — attach blocking issues as feedback, re-run the owning agent.
- `patch_and_approve` — apply a JSON Patch to the output, then approve.

Feedback is stored as `lastRetryReason` and passed as `feedbackPrompt` to the next agent run.

Structured feedback requires a non-vague comment. Vague comments (`"rework"`, `"fix"`, `"bad"`, `"lam lai"`, etc.) are rejected with 400.

---

## Auto-approve conditions

Auto-approve fires when ALL of:
1. Gate mode is `confidence_based` (not `strict_manual`)
2. `output.confidence_score >= 0.8`
3. No BLOCKER violations in `_validateGateOutput`
4. `REVIEW_HOLDS` for this project does not include this agent type

In demo mode, `REVIEW_HOLD_ROLES = ['po-agent', 'ux-agent', 'dev-agent']` disables auto-approve for those stages.

---

## Retry policy

| Agent | Max attempts | On exceed |
|-------|-------------|-----------|
| po-agent | 3 | `escalation_required` event, workflow blocked |
| ux-agent | 3 | same |
| dev-agent | 3 | same |
| qa-agent | 2 | same |

Retry reasons allowed in structured feedback: `schema_invalid`, `ac_not_measurable`, `coverage_gap`, `build_fail`, `quality_low`, `other`.

---

## Rework target mapping

`REQUEST_CHANGES` on a task re-runs the **owning** agent (not a generic LLM router):

| Task type rejected | Agent re-run | Source task type |
|-------------------|--------------|-----------------|
| po-agent | runPOAgent | intent-agent |
| ux-agent | runUXAgent | po-agent |
| dev-agent | runDEVAgent | ux-agent |
| qa-agent | runQAAgent | dev-agent |

The re-run uses the most recent committed output of the source type.
