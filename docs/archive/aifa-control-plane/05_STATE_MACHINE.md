# 05 — State Machine

The workflow state machine is derived in `_deriveCurrentPhase()` in `SdlcWorkflowService.js`. States are not stored — they are computed from the task table + HITL decisions on every status poll.

---

## Phase states

```
BACKLOG
  └─► PO_RUNNING        PO agent executing
        ├─► PO_FAILED   PO task status = 'failed'
        └─► PO_REVIEW   PO completed, awaiting human APPROVE
              └─► UX_RUNNING        (skipped if route.has_ui === false)
                    ├─► UX_FAILED
                    └─► UX_REVIEW
                          └─► DEV_RUNNING
                                ├─► DEV_FAILED
                                └─► DEV_REVIEW
                                      └─► QA_RUNNING
                                            ├─► QA_FAILED
                                            └─► QA_REVIEW    QA completed, awaiting Ship it
                                                  └─► FINAL_REVIEW   QA approved, awaiting final release
                                                        ├─► RELEASED
                                                        └─► RELEASE_REJECTED
```

**Rework path:** Any stage can be re-run by submitting `REQUEST_CHANGES` → the owning worker re-runs from its approved upstream. The phase re-enters `*_RUNNING` for that stage.

---

## Phase derivation rules (in order)

```javascript
if (!poTask)                                        → 'BACKLOG'
if (poTask.status ∈ ['pending','processing'])       → 'PO_RUNNING'
if (poTask.status === 'failed')                     → 'PO_FAILED'
if (!humanApproved(poTask))                         → 'PO_REVIEW'
// UX (skip when route.has_ui === false)
if (!uxTask || uxTask.status ∈ ['pending','processing']) → 'UX_RUNNING'
if (uxTask.status === 'failed')                     → 'UX_FAILED'
if (!humanApproved(uxTask))                         → 'UX_REVIEW'
// DEV
if (!devTask || devTask.status ∈ ['pending','processing']) → 'DEV_RUNNING'
if (devTask.status === 'failed')                    → 'DEV_FAILED'
if (!humanApproved(devTask))                        → 'DEV_REVIEW'
// QA
if (!qaTask || qaTask.status ∈ ['pending','processing']) → 'QA_RUNNING'
if (qaTask.status === 'failed')                     → 'QA_FAILED'
if (!decisionsByTaskId[qaTask.id])                  → 'QA_REVIEW'
// Post-QA approval
if (releaseDecision?.decision === 'APPROVE')        → 'RELEASED'
if (releaseDecision?.decision === 'REJECT')         → 'RELEASE_REJECTED'
                                                    → 'FINAL_REVIEW'
```

`humanApproved(task)` = `decisionsByTaskId[task.id]?.decision === 'APPROVE'`

---

## Task-level states

Each `Task` record has two orthogonal state axes:

### `status` (execution lifecycle)
```
pending → processing → completed
                    └→ failed
```

### `executionStatus` (worker detail)
```
queued → running → done
               └→ failed
```

### `versionStatus` (HITL lifecycle)
```
draft → committed
```
A task becomes `committed` when its output is approved by a human. Downstream agents only read `committed` tasks as their source.

---

## Gate modes

| Mode | Constant | Behaviour |
|------|----------|-----------|
| `strict_manual` | GATE_MODE.STRICT_MANUAL | Always pause for human review — auto-approve never triggers |
| `confidence_based` | GATE_MODE.CONFIDENCE | Auto-approve when confidence ≥ 0.8 AND no BLOCKER violations |
| `auto_approve_safe` | GATE_MODE.AUTO_SAFE | Auto-approve when validation passes AND risk is LOW |

Default assignment:
| Agent | Gate mode |
|-------|-----------|
| intent-agent | strict_manual |
| po-agent | confidence_based |
| ux-agent | confidence_based |
| dev-agent | confidence_based |
| qa-agent | strict_manual |

In the demo board, `REVIEW_HOLD_ROLES` overrides po/ux/dev to `strict_manual` so each flow parks for review.

---

## Audit event types

Events stored in `AgentEvent` and surfaced on the timeline:

| Event | Actor | Meaning |
|-------|-------|---------|
| `task_queued` | ORCHESTRATOR | Task created |
| `task_started` | agent type | Agent began execution |
| `output_drafted` | agent type | Agent completed, output saved |
| `gate_hold` | ORCHESTRATOR | Gate paused for human review |
| `hitl_decision` | HUMAN | Human submitted APPROVE / REJECT / REQUEST_CHANGES |
| `auto_approve` | ORCHESTRATOR | Confidence-based auto-approval fired |
| `handoff_emitted` | ORCHESTRATOR | Approved output committed, next agent queued |
| `agent_started` | next agent | Next agent picked up the handoff |
| `task_failed` | agent type | Execution error |
| `escalation_required` | ORCHESTRATOR | Max retries exceeded |
| `release_decision` | HUMAN | Final APPROVE or REJECT at FINAL_GATE |

---

## `invalid` flag on phases

`phase.invalid` = true means the task completed but its output fails BLOCKER rules under the current contract. It is a **runtime re-check** — if gate rules changed after a task completed, the flag reflects the current rules, not the rules at completion time.

Logic:
1. If `AgentArtifact.hasInvalid(taskId)` is false → `invalid = false` (DB says clean, trust it).
2. If DB says INVALID → re-run `_validateGateOutput()` live → `invalid = true` only if any BLOCKER violation remains.

This prevents stale INVALID badges from persisting after rule changes.
