// I5: drift guard for the versioned agent output contracts. If a role's
// required-field shape changes, this snapshot must be updated *and* the
// OUTPUT_CONTRACT_VERSION bumped — otherwise the handoff contract silently
// drifts from what downstream agents and the gate assume.

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

const SdlcWorkflowService = require('../../src/services/SdlcWorkflowService');

const EXPECTED_VERSION = 'gate-output.v5';

// Frozen expectation of rule name → severity per role.
const EXPECTED = {
  'architecture-agent': {
    // A2A Contract — project_definition is the only required structured
    // output. Per-field BLOCKERs enforce the {value, source, status}
    // metadata model (missing or assumed on mandatory fields is BLOCKER).
    project_definition_present: 'BLOCKER',
    project_type_missing: 'BLOCKER', project_type_assumed_forbidden: 'BLOCKER',
    language_missing: 'BLOCKER', language_assumed_forbidden: 'BLOCKER',
    framework_missing: 'BLOCKER', framework_assumed_forbidden: 'BLOCKER',
    runtime_missing: 'BLOCKER', runtime_assumed_forbidden: 'BLOCKER',
    package_manager_missing: 'BLOCKER', package_manager_assumed_forbidden: 'BLOCKER',
    build_system_missing: 'BLOCKER', build_system_assumed_forbidden: 'BLOCKER',
    deployment_target_missing: 'BLOCKER', deployment_target_assumed_forbidden: 'BLOCKER',
    repository_missing: 'BLOCKER', repository_assumed_forbidden: 'BLOCKER',
    constraints_missing: 'BLOCKER', constraints_assumed_forbidden: 'BLOCKER',
    out_of_scope_missing: 'BLOCKER', out_of_scope_assumed_forbidden: 'BLOCKER',
    repository_target_module_missing: 'BLOCKER',
    // Derived fields demoted to WARNING — documentation only.
    architecture_brief_present: 'WARNING',
    repository_routing_present: 'WARNING',
    technical_decisions_present: 'WARNING',
    repository_summary_present: 'WARNING',
    technology_stack_present: 'WARNING',
  },
  'po-agent': {
    prd_present: 'BLOCKER', user_stories_present: 'BLOCKER', ac_present: 'BLOCKER',
    ac_testable: 'BLOCKER', ac_measurable: 'WARNING', scope_present: 'BLOCKER',
    out_of_scope_present: 'BLOCKER',
  },
  'ux-agent': {
    ux_spec_present: 'BLOCKER', user_flow_present: 'BLOCKER', wireframe_present: 'BLOCKER',
    screens_present: 'BLOCKER', components_present: 'BLOCKER',
    html_mockup_is_complete_html5: 'BLOCKER',
  },
  'dev-agent': {
    implementation_plan_present: 'BLOCKER', patch_present: 'BLOCKER', changed_files_present: 'BLOCKER',
    patch_format: 'WARNING',
  },
  'qa-agent': {
    test_cases_present: 'BLOCKER', coverage_present: 'BLOCKER', coverage_complete: 'BLOCKER', tests_executed: 'BLOCKER',
    test_count_consistent: 'BLOCKER', test_evidence_present: 'BLOCKER', tests_passed: 'BLOCKER',
    no_blockers: 'BLOCKER', qa_report_present: 'BLOCKER',
    // Phase 3.6: validation evidence promoted from DEV to QA.
    build_result_present: 'BLOCKER', self_test_report_present: 'BLOCKER',
    linked_ac_ids_present: 'BLOCKER', risk_classification_present: 'BLOCKER',
    risk_assessment_present: 'BLOCKER', security_notes: 'BLOCKER', security_gate: 'BLOCKER',
    // Phase 3.6: release_decision removed from QA (Release Manager owns it).
    release_reason: 'BLOCKER',
    quality_gate_pass: 'BLOCKER',
  },
};

const shapeOf = (rules) => Object.fromEntries(rules.map((r) => [r.rule, r.severity]));

describe('I5 — versioned output contract drift guard', () => {
  test('contract version is the expected version', () => {
    expect(SdlcWorkflowService.OUTPUT_CONTRACT_VERSION).toBe(EXPECTED_VERSION);
    expect(SdlcWorkflowService.OUTPUT_CONTRACTS.version).toBe(EXPECTED_VERSION);
  });

  test.each(Object.keys(EXPECTED))('%s required-field shape is unchanged', (role) => {
    const rules = SdlcWorkflowService.OUTPUT_CONTRACTS[role];
    expect(rules).toBeDefined();
    expect(shapeOf(rules)).toEqual(EXPECTED[role]);
  });

  test('validator still flags a structurally complete PO output as ok', () => {
    const res = SdlcWorkflowService._validateGateOutput(
      { type: 'po-agent' },
      {
        prd: 'A real PRD body',
        user_stories: ['As a user, I can complete the feature.'],
        acceptance_criteria: ['AC-1: something measurable and clear'],
        scope: 'Implement the requested feature.',
        out_of_scope: 'No unrelated changes.',
      },
    );
    expect(res.ok).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  test('validator flags BLOCKER violations for an empty PO output', () => {
    const res = SdlcWorkflowService._validateGateOutput({ type: 'po-agent' }, {});
    expect(res.ok).toBe(false);
    expect(res.violations.map((v) => v.rule)).toEqual(expect.arrayContaining(['prd_present', 'ac_present']));
  });

  test('QA report totals do not replace the required detailed test cases', () => {
    const res = SdlcWorkflowService._validateGateOutput(
      { type: 'qa-agent' },
      {
        test_cases: [],
        test_run_report: { executed: true, total: 21, failed: 0 },
        ac_coverage_matrix: [{ ac_id: 'AC-1', covered: true }],
        blocker_count: 0,
        release_reason: 'All reported checks passed.',
        gate_evaluation: { recommendation: 'PASS' },
      },
    );

    expect(res.ok).toBe(false);
    expect(res.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'test_cases_present', severity: 'BLOCKER' }),
    ]));
  });
});
