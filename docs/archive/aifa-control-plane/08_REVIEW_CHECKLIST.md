# 08 — Human Review Checklist

What a reviewer should check at each gate before clicking Approve.

---

## PO Gate — PRD review

**Click "View PRD" first.**

- [ ] Feature request is clearly understood
- [ ] PRD narrative is coherent and non-contradictory
- [ ] User stories follow "As a … I want … so that …" format
- [ ] Every acceptance criterion is specific and testable (not vague like "the UI should be nice")
- [ ] Each AC is ≥ 15 characters and describes a measurable outcome
- [ ] Scope defines what IS included in this release
- [ ] Out-of-scope boundaries prevent scope creep
- [ ] Risk classification level (`HIGH`/`LOW`) matches the feature (auth/payment/PII features must be `HIGH`)
- [ ] `required_gates` includes `'security'` for HIGH-risk features
- [ ] No INVALID badge on the card

**Feedback guidance:** Specify which AC numbers are unclear. "AC #3 must define success criteria with a specific HTTP status code" is good feedback. "Fix the ACs" is rejected as too vague.

---

## UX Gate — Design review

**Click "Open in Penpot" first.**

- [ ] All screens defined in `screens[]` are present in Penpot
- [ ] Each screen has a named route (e.g. `/login`, `/callback`)
- [ ] Element types are explicit (`button-google`, `error-banner`, etc.) — not generic "button"
- [ ] Color palette is defined (primary, error, background, text colors)
- [ ] Typography is defined (heading font, body font, sizes)
- [ ] User flow describes the full journey (entry → success → error paths)
- [ ] Component inventory lists reusable components
- [ ] No ambiguous elements that DEV could misinterpret
- [ ] No INVALID badge on the card

**Feedback guidance:** Reference specific screen names and element types. "The Login Page is missing an `error-banner` element for OAuth failure states" is actionable.

---

## DEV Gate — Code review

**Click "View diff" first.**

- [ ] One HTML/Python/JS file created per UX screen (not patching random existing files)
- [ ] Every UX element type is implemented with the correct HTML/CSS (`button-google` has Google "G" SVG, `error-banner` is dismissible, etc.)
- [ ] Backend routes implemented: OAuth initiation, callback, session check, sign-out
- [ ] `sandbox_result.build_ok === true` (build passed)
- [ ] `sandbox_result.tests_ran === true` (tests executed)
- [ ] `self_test_report` is present and non-empty
- [ ] All AC IDs from PO are referenced in `linked_ac_ids`
- [ ] Security notes present if risk is HIGH
- [ ] No hardcoded secrets, credentials, or debug tokens
- [ ] No TODO/FIXME left in production code paths
- [ ] No INVALID badge on the card

**Feedback guidance:** Reference specific file names and line ranges. "In `public/login.html`, the Google button is missing the `aria-label` attribute required by UX element spec."

---

## QA Gate — Test review

**Click "View tests" first.**

- [ ] Test cases target the DEV diff — not a re-run of pre-existing tests
- [ ] Every changed function has at least one corresponding test case
- [ ] Each test case has: `id`, `title`, `source_ac`, `steps`, `expected`, `actual`, `result`, `evidence`
- [ ] `test_run_report.executed === true`
- [ ] `test_run_report.failed === 0`
- [ ] `test_run_report.total` matches `test_cases.length`
- [ ] `ac_coverage_matrix` covers every AC from the PO phase
- [ ] `blocker_count === 0`
- [ ] Security-focused tests present for HIGH-risk features (session cookie attributes, token validation failure, secret not exposed)
- [ ] QA report summarises findings clearly
- [ ] `release_decision` is `'approve'` and `release_reason` explains why
- [ ] No INVALID badge on the card

**Feedback guidance:** Specify which AC is not covered or which scenario type is missing. "AC-3 (denied consent handling) has no test case for the error page rendering" is actionable.

---

## Final Release Gate — Release review

**Review the Final Review Packet first (`GET /final-review-packet/:project_id`).**

- [ ] All 4 phases have `status === 'completed'` and `versionStatus === 'committed'`
- [ ] Release evidence shows `open_blockers: []`
- [ ] QA gate is PASS (or all tests actually passed)
- [ ] Security gate is PASS (for HIGH-risk features)
- [ ] Sandbox build is passing
- [ ] Release reason from QA is clear and credible
- [ ] No unresolved escalations in the timeline
- [ ] Deployment target and environment are confirmed by the team

**Approval:** Click "Approve Final Release" — button is only enabled when all server-side preconditions pass.  
**Rejection:** Click "✕ Reject" with a comment explaining what must change before re-attempting release.

---

## Common rejection reasons and what to do

| Situation | Decision | Comment format |
|-----------|----------|----------------|
| AC is untestable | REQUEST_CHANGES on PO | "AC #N: [explain what's missing]" |
| UX screen missing element | REQUEST_CHANGES on UX | "Screen [name]: missing [element type] for [scenario]" |
| DEV patched wrong files | REQUEST_CHANGES on DEV | "Expected [filename] per UX screen [name], got [actual]" |
| Tests don't cover the diff | REQUEST_CHANGES on QA | "No test for [function name] changed in [file]" |
| Security issue in diff | REQUEST_CHANGES on DEV | "Hardcoded credential / missing auth check in [file:line]" |
