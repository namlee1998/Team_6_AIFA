# 07 — Release Rules

Rules governing the `FINAL_GATE` — the final human approval step before production deployment.

---

## Eligibility conditions

The "Approve Final Release" button is enabled (`releaseGate.eligible === true`) when ALL of:

1. `qaTask.status === 'completed'`
2. `qaTask.versionStatus === 'committed'`
3. QA gate passed — either:
   - `qaTask.result.gateRecommendation === 'PASS'`, OR
   - `test_run_report.executed === true && test_run_report.failed === 0 && test_run_report.total > 0`
4. `decisionsByTaskId[qaTask.id]?.decision === 'APPROVE'` (human clicked "Ship it")
5. `releaseGate.approvalBlocked === false` (no open release blockers)

Condition 3 has a fallback because a QA agent may produce `REWORK` label despite all tests passing (labelling gap in the prompt). Execution evidence supersedes the label.

---

## Release blocking severities

Evidence issues with these severities block the APPROVE button:
- `BLOCKER`
- `CRITICAL`
- `HIGH`

WARNING-level evidence issues do not block release.

---

## `submitReleaseDecision` server-side checks

Even if the UI button is enabled, the server re-validates before recording the decision:

```
1. decision ∈ ['APPROVE', 'REJECT']
2. decision_id (idempotency key) must be unique — replay safe
3. QA task must exist and be committed
4. No prior finalized release decision for this QA task
5. QA gate must pass (same fallback logic as eligibility)
6. If APPROVE: no open release blockers in evidence
7. Caller must have role 'owner' or 'admin'
```

Any failure throws HTTP 409.

---

## Release evidence summary

Built by `_buildReleaseEvidenceSummary(projectId)`:

```jsonc
{
  "feature": "Add Google login",
  "risk": "HIGH",
  "security_gate": "PASS",
  "qa_gate": "PASS" | "REWORK" | null,
  "sandbox_result": { "build_ok": true, "tests_ran": true },
  "open_blockers": []   // ← must be empty for APPROVE
}
```

---

## What happens on APPROVE

1. `HitlDecision` record created with `gate = 'FINAL_GATE'`, `decision = 'APPROVE'`.
2. `currentPhase` transitions to `'RELEASED'`.
3. `released` field on the board flow becomes `'RELEASED'`.
4. Board card: "This workflow has been released."
5. Download report button becomes available.
6. `workflowReport` generates the combined release report (JSON + Markdown).

---

## What happens on REJECT

1. `HitlDecision` record with `gate = 'FINAL_GATE'`, `decision = 'REJECT'`.
2. `currentPhase` → `'RELEASE_REJECTED'`.
3. `released` → `'RELEASE_REJECTED'`.
4. Board shows "Release rejected" state. No further progression.
5. To retry: a new full pipeline run must be started.

---

## UI states for the release card

| Condition | Badge | Button | Body text |
|-----------|-------|--------|-----------|
| `!eligible` | `Locked` 🔒 | Disabled | "Approve the completed release for production deployment." |
| `eligible && !approvalBlocked` | `Ready` 🚀 | Active (APPROVE + REJECT) | "All stages complete. Ready for production deployment." |
| `released === 'RELEASED'` | `Done` | Download report | "This workflow has been released." |
| `released === 'RELEASE_REJECTED'` | `Rejected` 🛑 | Disabled | "The release was rejected at the final review." |

---

## `currentPhase` transitions around FINAL_GATE

| Phase | Meaning | UI body text |
|-------|---------|--------------|
| `QA_REVIEW` | QA done, human hasn't clicked Ship it yet | review card shown |
| `FINAL_REVIEW` | QA approved, waiting for final release | "All agents done — approve the final release below." |
| `RELEASED` | Release approved | "This workflow has been released." |
| `RELEASE_REJECTED` | Release rejected | "This release was rejected." |

The header status line maps identically:
- `FINAL_REVIEW` → "⏱ Awaiting final release approval"
- `RELEASED` → "🚀 Released"
- `RELEASE_REJECTED` → "🛑 Release rejected"
