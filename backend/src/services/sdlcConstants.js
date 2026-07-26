// ── Shared constants for the SDLC workflow modules ──────────────────────────
const path = require('path');
const { hasContent } = require('./agentContract');

const WORKSPACE_DIR = path.join(__dirname, '../../../workspace/projects');

// ── Agent Gates ──────────────────────────────────────────────────────────────
const AGENT_GATES = {
  'architecture-agent': 'ARCHITECTURE_GATE',
  'intent-agent': 'REQUIREMENT_GATE',
  'po-agent': 'REQUIREMENT_GATE',
  'ux-agent': 'UX_GATE',
  'dev-agent': 'DEV_GATE',
  'qa-agent': 'QA_GATE',
};

const OUTPUT_REVIEW_GATE_TYPE = {
  'architecture-agent': 'ARCH_OUTPUT_REVIEW',
  'po-agent': 'PO_OUTPUT_REVIEW',
  'ux-agent': 'UX_OUTPUT_REVIEW',
  'dev-agent': 'DEV_OUTPUT_REVIEW',
  'qa-agent': 'QA_OUTPUT_REVIEW',
};

// Frozen spec §6: clarification gates carry the same kind='question' but
// are routed to one of these per-role gate types so the FE can dispatch by
// gate.kind without needing role-specific branches.
const CLARIFY_GATE_TYPE = {
  'architecture-agent': 'AGENT_CLARIFY',
  'po-agent': 'PO_CLARIFY',
  'ux-agent': 'UX_CLARIFY',
  'dev-agent': 'DEV_CLARIFY',
  'qa-agent': 'QA_CLARIFY',
};

const NEXT_AGENT = {
  'architecture-agent': 'po-agent',
  'intent-agent': 'po-agent',
  'po-agent': 'ux-agent',
  'ux-agent': 'dev-agent',
  'dev-agent': 'qa-agent',
  'qa-agent': null,
};

const NODE_TARGET = {
  'intent-agent': 'intent_node',
  'po-agent': 'po_agent',
  'ux-agent': 'ux_agent',
  'dev-agent': 'dev_agent',
  'qa-agent': 'qa_agent',
};

const REWORK_TARGETS = {
  po_agent: { sourceType: 'intent-agent', run: 'runPOAgent' },
  ux_agent: { sourceType: 'po-agent', run: 'runUXAgent' },
  dev_agent: { sourceType: 'ux-agent', run: 'runDEVAgent' },
  qa_agent: { sourceType: 'dev-agent', run: 'runQAAgent' },
};

// ── Gate Modes ───────────────────────────────────────────────────────────────
const GATE_MODE = {
  STRICT_MANUAL: 'strict_manual',
  CONFIDENCE: 'confidence_based',
  AUTO_SAFE: 'auto_approve_safe',
};

const DEFAULT_GATE_MODE = {
  'intent-agent': GATE_MODE.STRICT_MANUAL,
  'po-agent': GATE_MODE.STRICT_MANUAL,
  'ux-agent': GATE_MODE.STRICT_MANUAL,
  'dev-agent': GATE_MODE.STRICT_MANUAL,
  'qa-agent': GATE_MODE.STRICT_MANUAL,
};

const REVIEW_HOLDS = new Map();

// ── Gate Configuration ───────────────────────────────────────────────────────
const GATE_CONFIG = {
  AUTO_APPROVE_CONFIDENCE: 0.8,
  BLOCKING_SEVERITY: 'BLOCKER',
  RELEASE_BLOCKING_SEVERITIES: ['BLOCKER', 'CRITICAL', 'HIGH'],
};

const AUTO_APPROVE_CONFIDENCE = GATE_CONFIG.AUTO_APPROVE_CONFIDENCE;

// ── Output Contract ──────────────────────────────────────────────────────────
const OUTPUT_CONTRACT_VERSION = 'gate-output.v5';

const _acList = (o) => (Array.isArray(o.acceptance_criteria) ? o.acceptance_criteria : []);
const _matrix = (o) => (Array.isArray(o.ac_coverage_matrix) ? o.ac_coverage_matrix : []);

// AIFA v2.1 §3: the architecture-agent output is validated against the
// versioned output contract in gateManager.validateGateOutput. The
// contract iterates rules and calls rule.check(o, task) — so every entry
// here must expose a `check` function.
//
// Architecture Contract (the A2A contract) is the *only* structured output
// for the architecture stage. Each mandatory field carries `{value, source,
// status}` metadata. BLOCKER rules inspect each entry's `status`
// deterministically. The 6 legacy derived fields (architecture_brief,
// repository_routing, technical_decisions, repository_summary,
// technology_stack, top-level constraints) have been removed from the
// contract: their content was redundant with the contract itself and they
// caused the artifact manager to persist 7 rows where 1 suffices.
const PROJECT_DEFINITION_MANDATORY_KEYS = [
  'project_type',
  'language',
  'framework',
  'runtime',
  'package_manager',
  'build_system',
  'deployment_target',
  'repository',
  'constraints',
  'out_of_scope',
];

function pdEntry(pd, key) {
  if (!pd || typeof pd !== 'object') return null;
  const e = pd[key];
  return e && typeof e === 'object' && 'status' in e ? e : null;
}

function pdEntryValue(pd, key) {
  const e = pdEntry(pd, key);
  return e ? e.value : null;
}

function _pdFieldMissing(o, key) {
  const e = pdEntry(o.architecture_contract, key);
  if (!e) return true;
  if (e.status === 'missing') return true;
  return !hasContent(e.value);
}

function _pdFieldAssumedForbidden(o, key) {
  const e = pdEntry(o.architecture_contract, key);
  return e && e.status === 'assumed';
}

// OBS-01.10 R-25: canonical executionStatus → visible PhaseStatus mapping.
// Per docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md §7
// "Deriving runtime from `Task.status` (legacy)" is FORBIDDEN. The SSE
// snapshot's pipelinePhases[i].status MUST be sourced from the canonical
// machine (`Task.executionStatus`), not from the legacy `Task.status`.
//
// The mapping collapses the 8 canonical `executionStatus` values onto the 7
// FE-visible `PhaseStatus` values (per `frontend/src/services/api/sdlcApi.ts:73`
// and `frontend/src/store/runtimeSelectors.ts:61-68`):
//   queued       → pending     (canonical initial)
//   dispatched   → pending     (reserved; matrix permits but no producer)
//   running      → running
//   awaiting_gate → gate_pending
//   completed    → completed
//   failed       → failed
//   cancelled    → skipped     (FE projection collapses with timeout)
//   timeout      → skipped     (FE projection collapses with cancelled)
const EXECUTION_STATUS_TO_PHASE_STATUS = Object.freeze({
  queued: 'pending',
  dispatched: 'pending',
  running: 'running',
  awaiting_gate: 'gate_pending',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'skipped',
  timeout: 'skipped',
});

/**
 * Project a single phaseData entry (built by `mapPhase` in
 * `SdlcWorkflowService.getWorkflowStatus:1151-1172`) onto the FE-visible
 * `PhaseStatus` value used by the canonical runtime selector.
 *
 * Precedence:
 *   1. If `phaseData.executionStatus` is set (the canonical machine), the
 *      visible status is the canonical mapping above. This is the contract-
 *      mandated source per OBS-01.10 R-25.
 *   2. If `phaseData.executionStatus` is null/undefined, fall back to the
 *      legacy `phaseData.status` field. Schema default is `'queued'`, so this
 *      branch is unreachable for tasks created via the schema default; it
 *      exists only as a defensive guard.
 *   3. The `awaitingReview` projection (legacy contract for output_review
 *      gates per `OBS1_PHASE510_ANALYSIS.md §4.1`) is applied LAST and
 *      overrides the canonical mapping. This preserves the existing
 *      behaviour where a task with `awaitingReview === true` shows as
 *      `gate_pending` regardless of `executionStatus`.
 *
 * @param {string} agentName - one of 'Architecture' | 'PO' | 'UX' | 'DEV' | 'QA'
 * @param {{ taskId?: string, status?: string, executionStatus?: string|null,
 *           versionStatus?: string, awaitingReview?: boolean, invalid?: boolean
 *         }|null} phaseData
 * @param {boolean} [isSkipped=false]
 * @returns {{ agent: string, status: string, taskId?: string,
 *             awaitingReview?: boolean, invalid?: boolean }}
 */
function toPhaseStatus(agentName, phaseData, isSkipped = false) {
  if (isSkipped && !phaseData) return { agent: agentName, status: 'skipped' };
  if (!phaseData) return { agent: agentName, status: 'pending' };
  // R-25: read the canonical machine first.
  let status;
  if (phaseData.executionStatus && EXECUTION_STATUS_TO_PHASE_STATUS[phaseData.executionStatus] !== undefined) {
    status = EXECUTION_STATUS_TO_PHASE_STATUS[phaseData.executionStatus];
  } else if (typeof phaseData.status === 'string') {
    // Defensive fallback for legacy callers that omit `executionStatus`.
    status = phaseData.status;
  } else {
    status = 'pending';
  }
  // Preserve the awaitingReview projection (canonical projection of the
  // output_review gate path — see OBS1_PHASE510_ANALYSIS.md §4.1 and the
  // contract §4 evidence gaps "gated vs ungated output_review").
  if (phaseData.awaitingReview) status = 'gate_pending';
  return {
    agent: agentName,
    status,
    taskId: phaseData.taskId,
    awaitingReview: phaseData.awaitingReview,
    invalid: phaseData.invalid,
  };
}

const PROJECT_DEFINITION_RULES = [
  {
    rule: 'architecture_contract_present',
    severity: 'BLOCKER',
    detail: 'architecture_contract is missing or empty',
    check: (o) => hasContent(o.architecture_contract),
  },
  // Per-key BLOCKER: each mandatory field must have a non-empty value AND
  // status !== 'missing'.
  ...PROJECT_DEFINITION_MANDATORY_KEYS.map((key) => ({
    rule: `${key}_missing`,
    severity: 'BLOCKER',
    detail: `architecture_contract.${key} is missing or has status=missing`,
    check: (o) => !_pdFieldMissing(o, key),
  })),
  // Mandatory fields may NOT be `assumed`. They must be `confirmed` (user
  // input or repo-derived). This is the deterministic enforcement against
  // hallucination — Claude cannot silently pick framework=FastAPI without
  // calling AskUserQuestion.
  ...PROJECT_DEFINITION_MANDATORY_KEYS.map((key) => ({
    rule: `${key}_assumed_forbidden`,
    severity: 'BLOCKER',
    detail: `architecture_contract.${key} has status=assumed but is mandatory; AskUserQuestion required`,
    check: (o) => !_pdFieldAssumedForbidden(o, key),
  })),
  // Nested: repository.target_module must be present.
  {
    rule: 'repository_target_module_missing',
    severity: 'BLOCKER',
    detail: 'architecture_contract.repository.target_module is missing',
    check: (o) => hasContent(pdEntryValue(o.architecture_contract, 'repository')?.target_module),
  },
];

const PO_RULES = [
  {
    rule: 'prd_present', severity: 'BLOCKER', detail: 'PRD is empty',
    check: (o) => typeof o.prd === 'string' && o.prd.trim().length > 0
  },
  {
    rule: 'user_stories_present', severity: 'BLOCKER', detail: 'No user stories',
    check: (o) => Array.isArray(o.user_stories) && o.user_stories.length > 0
  },
  {
    rule: 'ac_present', severity: 'BLOCKER', detail: 'No acceptance criteria',
    check: (o) => _acList(o).length > 0
  },
  {
    rule: 'ac_testable', severity: 'BLOCKER',
    detail: 'Acceptance criteria are present but none are concrete/testable enough',
    check: (o) => _acList(o).length === 0 || _acList(o).some((a) => String(a).trim().length >= 15)
  },
  {
    rule: 'ac_measurable', severity: 'WARNING',
    detail: (o) => `${_acList(o).filter((a) => String(a).trim().length < 12).length} acceptance criteria look too vague to test`,
    check: (o) => _acList(o).every((a) => String(a).trim().length >= 12)
  },
  {
    rule: 'scope_present', severity: 'BLOCKER', detail: 'Scope is empty',
    check: (o) => hasContent(o.scope)
  },
  {
    rule: 'out_of_scope_present', severity: 'BLOCKER', detail: 'Out-of-scope boundaries are empty',
    check: (o) => hasContent(o.out_of_scope)
  },
];

const UX_RULES = [
  {
    rule: 'ux_spec_present', severity: 'BLOCKER', detail: 'UX spec is empty',
    check: (o) => typeof o.ux_spec === 'string' && o.ux_spec.trim().length > 0
  },
  {
    rule: 'user_flow_present', severity: 'BLOCKER', detail: 'User flow is empty',
    check: (o) => hasContent(o.user_flow)
  },
  {
    rule: 'wireframe_present', severity: 'BLOCKER', detail: 'Wireframe specification is empty',
    check: (o) => hasContent(o.wireframe_spec)
  },
  {
    rule: 'screens_present', severity: 'BLOCKER', detail: 'No screens supplied',
    check: (o) => Array.isArray(o.screens) && o.screens.length > 0
  },
  {
    rule: 'components_present', severity: 'BLOCKER', detail: 'Component inventory is empty',
    check: (o) => hasContent(o.component_inventory)
  },
  {
    // BUG: claudeCodeRunner can persist a UX run whose html_mockup was cut off
    // mid-CSS/markup when the SDK emits subtype='success' but stop_reason='error'
    // or the run was interrupted before the closing </html> was written. The
    // runner's normalizeOutput does not re-validate field completeness, and the
    // existing UX_RULES never inspected html_mockup, so a truncated mockup
    // reached AgentArtifact with status=VALID and executionStatus=completed.
    // The repair path (claudeCodeRunner.repairRawOutput) only runs when the
    // *outer* JSON parse fails, not when an individual field is partial.
    // Guard: a complete HTML5 mockup starts with <!DOCTYPE html> and ends with
    // </html>. If either is missing, downstream DEV/QA receive an incomplete
    // artifact. Mark BLOCKER so output_review surfaces the issue to the human
    // reviewer instead of silently passing.
    rule: 'html_mockup_is_complete_html5', severity: 'BLOCKER',
    detail: 'html_mockup is not a complete HTML5 document (missing <!DOCTYPE html> at start or </html> at end)',
    check: (o) => {
      const html = typeof o.html_mockup === 'string' ? o.html_mockup.trim() : '';
      if (!html) return false;
      return html.startsWith('<!DOCTYPE html>') && html.endsWith('</html>');
    },
  },
];

const DEV_RULES = [
  {
    rule: 'implementation_plan_present', severity: 'BLOCKER', detail: 'Implementation plan is empty',
    check: (o) => hasContent(o.implementation_plan)
  },
  {
    rule: 'patch_present', severity: 'BLOCKER', detail: 'No code patch produced',
    check: (o) => (o.patch_diff || o.mock_code_diff || '').trim().length > 0
  },
  {
    rule: 'changed_files_present', severity: 'BLOCKER', detail: 'No changed files supplied',
    check: (o) => Array.isArray(o.changed_files) && o.changed_files.length > 0
  },
  {
    rule: 'patch_format', severity: 'WARNING', detail: 'patch_format is not defined',
    check: (o) => !!o.patch_format
  },
];

const QA_RULES = [
  {
    rule: 'test_cases_present', severity: 'BLOCKER',
    detail: (o) => `${Array.isArray(o.test_cases) ? o.test_cases.length : 0} detailed test cases supplied`,
    check: (o) => Array.isArray(o.test_cases) && o.test_cases.length > 0
  },
  {
    rule: 'coverage_present', severity: 'BLOCKER', detail: 'No AC coverage matrix',
    check: (o) => _matrix(o).length > 0
  },
  {
    rule: 'coverage_complete', severity: 'BLOCKER',
    detail: (o) => `${_matrix(o).filter((r) => r.covered !== true).length} acceptance criteria are not covered`,
    check: (o) => _matrix(o).every((r) => r.covered === true)
  },
  {
    rule: 'tests_executed', severity: 'BLOCKER', detail: 'Tests were not actually executed',
    check: (o) => (o.test_run_report || {}).executed === true
  },
  {
    rule: 'test_count_consistent', severity: 'BLOCKER', detail: 'Detailed test case count does not match the test run total',
    check: (o) => Array.isArray(o.test_cases) && Number(o.test_run_report?.total) === o.test_cases.length
  },
  {
    rule: 'test_evidence_present', severity: 'BLOCKER', detail: 'Test execution evidence/logs are empty',
    check: (o) => hasContent(o.test_run_report?.logs || o.test_run_report?.evidence)
  },
  {
    rule: 'tests_passed', severity: 'BLOCKER',
    detail: (o) => `${(o.test_run_report || {}).failed || 0} test(s) failed`,
    check: (o) => ((o.test_run_report || {}).failed || 0) === 0
  },
  {
    rule: 'no_blockers', severity: 'BLOCKER',
    detail: (o) => `${o.blocker_count || 0} blocker(s) present`,
    check: (o) => (o.blocker_count || 0) === 0
  },
  {
    rule: 'qa_report_present', severity: 'BLOCKER', detail: 'QA report is empty',
    check: (o) => hasContent(o.qa_report)
  },
  // ── Phase 3.6: validation evidence promoted to QA ───────────────────────────
  // These artifacts were previously emitted by DEV. After Phase 3.6 they are
  // QA's canonical output. The Release Manager consumes them from QA output;
  // DEV no longer emits any of these fields.
  {
    rule: 'build_result_present', severity: 'BLOCKER', detail: 'QA build_result is missing',
    check: (o) => hasContent(o.build_result)
  },
  {
    rule: 'self_test_report_present', severity: 'BLOCKER', detail: 'QA self_test_report is missing',
    check: (o) => hasContent(o.self_test_report)
  },
  {
    rule: 'linked_ac_ids_present', severity: 'BLOCKER', detail: 'AC traceability is missing',
    check: (o) => Array.isArray(o.linked_ac_ids) && o.linked_ac_ids.length > 0
  },
  {
    rule: 'risk_classification_present', severity: 'BLOCKER', detail: 'Risk classification is incomplete',
    check: (o) => hasContent(o.risk_classification?.level) && Array.isArray(o.risk_classification?.required_gates) && o.risk_classification.required_gates.length > 0
  },
  {
    rule: 'risk_assessment_present', severity: 'BLOCKER', detail: 'Risk assessment is empty',
    check: (o) => hasContent(o.risk_assessment)
  },
  {
    rule: 'security_notes', severity: 'BLOCKER', detail: 'High-risk QA output is missing security notes',
    when: (o) => !!o.risk_classification?.required_gates?.includes('security'),
    check: (o) => !!o.security_notes
  },
  {
    rule: 'security_gate', severity: 'BLOCKER', detail: 'Security gate must PASS for high-risk QA output',
    when: (o) => !!o.risk_classification?.required_gates?.includes('security'),
    check: (o) => o.security_gate?.recommendation === 'PASS'
  },
  {
    rule: 'release_reason', severity: 'BLOCKER', detail: 'Release recommendation has no justification',
    check: (o) => !!(o.release_reason && o.release_reason.trim())
  },
  {
    rule: 'quality_gate_pass', severity: 'BLOCKER',
    detail: (o, task) => `Quality gate is ${(task?.result?.gateRecommendation) || o.gate_evaluation?.recommendation || 'unknown'}, expected PASS`,
    check: (o, task) => {
      const recommendation = (task?.result?.gateRecommendation) || o.gate_evaluation?.recommendation;
      if (recommendation === 'PASS') return true;
      const tr = o.test_run_report || {};
      return tr.executed === true && typeof tr.failed === 'number' && tr.failed === 0 && (tr.total || 0) > 0;
    }
  },
];

const OUTPUT_CONTRACTS = {
  version: OUTPUT_CONTRACT_VERSION,
  'architecture-agent': PROJECT_DEFINITION_RULES,
  'po-agent': PO_RULES,
  'ux-agent': UX_RULES,
  'dev-agent': DEV_RULES,
  'qa-agent': QA_RULES,
};

// ── Retry / Policy ───────────────────────────────────────────────────────────
const MAX_RETRY_PER_STEP = 3;
// Hard cap for AskUserQuestion enforcement retries. After this many
// attempts without resolving all BLOCKERs, the task is marked FAILED.
// Distinct from MAX_RETRY_PER_STEP which governs the inner per-step retry
// budget used by other retry paths. Per-role caps let non-ARCH retries
// stay bounded (downstream BLOCKERs are cheaper than ARCH's
// project_definition surface).
const ARCH_MAX_ASK_RETRIES = 3;
const PO_MAX_ASK_RETRIES = 2;
const UX_MAX_ASK_RETRIES = 2;
const DEV_MAX_ASK_RETRIES = 2;
const QA_MAX_ASK_RETRIES = 2;

const ASK_RETRY_CAPS_BY_ROLE = {
  'architecture-agent': ARCH_MAX_ASK_RETRIES,
  'po-agent': PO_MAX_ASK_RETRIES,
  'ux-agent': UX_MAX_ASK_RETRIES,
  'dev-agent': DEV_MAX_ASK_RETRIES,
  'qa-agent': QA_MAX_ASK_RETRIES,
};

// Per-role throw code when a role exhausts retries. Used by the
// AskUserQuestion enforcement loop to surface the exhausted state.
const ASK_RETRY_EXCEEDED_CODE_BY_ROLE = {
  'architecture-agent': 'ARCH_MAX_RETRIES_EXCEEDED',
  'po-agent': 'PO_MAX_RETRIES_EXCEEDED',
  'ux-agent': 'UX_MAX_RETRIES_EXCEEDED',
  'dev-agent': 'DEV_MAX_RETRIES_EXCEEDED',
  'qa-agent': 'QA_MAX_RETRIES_EXCEEDED',
};
const RETRY_REASONS = ['schema_invalid', 'ac_not_measurable', 'coverage_gap', 'build_fail', 'quality_low', 'other'];

const AGENT_POLICY = {
  'po-agent': { max_attempts: MAX_RETRY_PER_STEP, timeout_seconds: 180 },
  'ux-agent': { max_attempts: MAX_RETRY_PER_STEP, timeout_seconds: 240 },
  'dev-agent': { max_attempts: MAX_RETRY_PER_STEP, timeout_seconds: 1800 },
  'qa-agent': { max_attempts: 2, timeout_seconds: 900 },
};

const FINAL_GATE = 'FINAL_GATE';
const RELEASE_DECISIONS = ['APPROVE', 'REJECT'];
const MOCK_REVIEW_STAGES = ['po-agent', 'ux-agent', 'dev-agent'];
const DEFAULT_MOCK_SCENARIO = 'happy_path';
const VAGUE_REVIEW_COMMENTS = new Set(['rework', 'fix', 'bad', 'wrong', 'redo', 'do again', 'lam lai', 'sua lai']);

const MOCK_SCENARIO_PROFILES = {
  happy_path: {
    title: 'Happy path release',
    outcome: 'All worker gates pass and the final release can be approved.',
    signals: ['high confidence', 'complete evidence', 'QA pass'],
  },
};

module.exports = {
  WORKSPACE_DIR,
  AGENT_GATES,
  OUTPUT_REVIEW_GATE_TYPE,
  CLARIFY_GATE_TYPE,
  NEXT_AGENT,
  NODE_TARGET,
  REWORK_TARGETS,
  GATE_MODE,
  DEFAULT_GATE_MODE,
  REVIEW_HOLDS,
  GATE_CONFIG,
  AUTO_APPROVE_CONFIDENCE,
  OUTPUT_CONTRACT_VERSION,
  OUTPUT_CONTRACTS,
  PROJECT_DEFINITION_MANDATORY_KEYS,
  PROJECT_DEFINITION_RULES,
  pdEntry,
  pdEntryValue,
  EXECUTION_STATUS_TO_PHASE_STATUS,
  toPhaseStatus,
  _acList,
  _matrix,
  MAX_RETRY_PER_STEP,
  ARCH_MAX_ASK_RETRIES,
  PO_MAX_ASK_RETRIES,
  UX_MAX_ASK_RETRIES,
  DEV_MAX_ASK_RETRIES,
  QA_MAX_ASK_RETRIES,
  ASK_RETRY_CAPS_BY_ROLE,
  ASK_RETRY_EXCEEDED_CODE_BY_ROLE,
  RETRY_REASONS,
  AGENT_POLICY,
  FINAL_GATE,
  RELEASE_DECISIONS,
  MOCK_REVIEW_STAGES,
  DEFAULT_MOCK_SCENARIO,
  VAGUE_REVIEW_COMMENTS,
  MOCK_SCENARIO_PROFILES,
};
