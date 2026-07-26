# Claude Output Parse Recovery Change Report

## Summary

```text
Task:          Recover malformed Claude final JSON without rerunning the full agent
Type:          bug
Risk:          HIGH
Files changed: 4
Tests added:   4
```

## Goal

Prevent an otherwise successful PO/UX/DEV/QA Claude run from failing only because
its final response wrapped or separated valid JSON unexpectedly, while preserving
the existing agent output contract, review gates, state transitions, and API shape.

## Affected Business Flow

- Agent execution and output normalization before intermediate review gates.
- Flow 4.3: Human Approves Agent Review.
- Flow 4.8: Timeline / Audit Trail failure diagnostics.

## What Changed

- The Claude output parser now checks every fenced block and balanced JSON object,
  then prefers a complete artifact envelope over small example objects.
- A parse failure with non-empty raw output triggers at most one repair call.
- The repair call has no allowed tools and independently denies every tool request.
- Repaired output still passes through the existing `normalizeOutput()` and
  `assertOutputConforms()` boundary before it can be persisted or reviewed.
- Terminal parse failures persist bounded raw, repair-result, and repair-error
  previews in the task's existing observability field.

## Why

- The prior parser only checked the first fenced block or one broad
  first-brace-to-last-brace slice, which fails when Claude emits multiple objects.
- Full agent reruns are unnecessary and may repeat tool side effects when only the
  final JSON formatting is invalid.
- The previous failure path attached `rawResult` to the in-memory error but did
  not persist it, leaving the actual parse failure impossible to diagnose later.

## Files Changed

| File | Change type | Summary |
|------|-------------|---------|
| `backend/src/agents/claudeCodeRunner.js` | bug fix | Robust candidate extraction, candidate ranking, and one tool-free repair attempt |
| `backend/src/services/SdlcWorkflowService.js` | observability | Persist bounded parse/repair diagnostics on terminal failure |
| `backend/tests/integration/claude-code-adapter.test.js` | tests | Cover multiple fences, multiple objects, braces in strings, and tool-free repair |
| `docs/aifa-control-plane/CHANGE_REPORT_2026-06-11_CLAUDE_OUTPUT_PARSE_RECOVERY.md` | docs | This implementation and verification report |

The worktree contained pre-existing changes in the three code/test files. This
report covers only the parse-recovery, diagnostics, and four focused test hunks.

## Root Causes Fixed

| # | Location | Symptom |
|---|----------|---------|
| 1 | `parseJsonObject()` first fenced-block handling | A later valid JSON block was ignored |
| 2 | `parseJsonObject()` first/last brace slicing | Multiple valid objects were concatenated into invalid JSON |
| 3 | Post-run parse boundary | Parse errors occurred after the SDK retry loop and had no format-only recovery |
| 4 | `_markTaskFailed()` observability | Raw and repair output details were lost after task failure |

## Contracts Affected

- Frontend API: unchanged.
- Backend route: unchanged.
- Agent output: unchanged; `agent-io.v3` validation remains mandatory.
- Database schema: unchanged; diagnostics use the existing observability field.
- Release/HITL gate: unchanged.
- State machine: unchanged.
- Claude live tool gate: unchanged; repair uses a separate deny-all tool callback.

## Risks

- Repair adds one extra model call only when the original final output is
  non-empty and cannot be parsed.
- A repair model could produce incomplete content; the existing contract rejects
  it before persistence.
- Raw-result previews may contain sensitive generated content; previews are
  bounded to 4,000 characters and remain in existing task observability.
- Real Claude repair behavior depends on the installed SDK/model and was not
  exercised by the deterministic automated suite.

## Verification

| Check | Command / Method | Result |
|-------|------------------|--------|
| Focused adapter tests | `npm.cmd test -- --runTestsByPath tests/integration/claude-code-adapter.test.js` | PASS: 17/17 |
| Backend test suite | `npm.cmd test` | PASS: 18 suites, 111/111 tests |
| Diff whitespace check | `git diff --check -- <changed code/test files>` | PASS |
| Manual real-Claude flow | Run a live agent that returns malformed final JSON | NOT RUN: requires a live Claude session and nondeterministic malformed output |

## Constraints Verified

- [x] No Prisma schema changes.
- [x] No backend API response shape changes.
- [x] No workflow state transition changes.
- [x] No HITL or release gate changes.
- [x] No agent output contract weakening.
- [x] Repair cannot use tools.
- [x] Shared `10_CHANGE_REPORT_TEMPLATE.md` remains unchanged.

## Known Limitations / Follow-Up

- Empty SDK result text cannot be repaired without inventing output, so it still
  fails with `CLAUDE_OUTPUT_PARSE_ERROR`.
- Repair is limited to one call and does not retry the full agent.
- The audit UI does not display raw-result previews; they are available through
  the persisted task observability data.

## Reviewer Notes

- Review the deny-all repair options and confirm that output still reaches
  `normalizeOutput()` before persistence.
- Review only the parse-recovery and diagnostics hunks because the worktree had
  unrelated pre-existing modifications.
