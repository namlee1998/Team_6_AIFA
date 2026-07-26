// ── Shared helper functions extracted from SdlcWorkflowService.js ──────────
const path = require('path');
const { ApiError, ERROR_CODES } = require('../middleware/errorHandler');
const { hasContent } = require('./agentContract');
const {
  NEXT_AGENT, GATE_MODE, DEFAULT_GATE_MODE, REVIEW_HOLDS,
  MOCK_REVIEW_STAGES, DEFAULT_MOCK_SCENARIO, MOCK_SCENARIO_PROFILES,
  VAGUE_REVIEW_COMMENTS,
} = require('./sdlcConstants');

// =============================================================================
// Scenario / Mock helpers
// =============================================================================

function resolveMockScenario() {
  return DEFAULT_MOCK_SCENARIO;
}

function buildScenarioBrief(scenario, task) {
  const profile = MOCK_SCENARIO_PROFILES[scenario] || MOCK_SCENARIO_PROFILES[DEFAULT_MOCK_SCENARIO];
  return {
    scenario,
    title: profile.title,
    stage: task.type,
    expected_outcome: profile.outcome,
    demo_signals: profile.signals,
  };
}

function applyScenarioNarrative(task, completedData, scenario, feedbackPrompt) {
  const profile = MOCK_SCENARIO_PROFILES[scenario] || MOCK_SCENARIO_PROFILES[DEFAULT_MOCK_SCENARIO];
  const stage = task.type.replace('-agent', '').toUpperCase();
  completedData.summary = `${profile.title}: ${stage} mock output prepared for the demo branch.`;
  completedData.scenario_brief = buildScenarioBrief(scenario, task);
  completedData.observability = {
    ...(completedData.observability || {}),
    trace_id: `mock-${scenario}-${task.type}`,
    scenario,
    feedback_received: Boolean(feedbackPrompt),
  };

  if (task.type === 'po-agent') {
    completedData.prd = `# ${profile.title}\n\nScenario intent: ${profile.outcome}\n\n${completedData.prd || ''}`;
    completedData.scope = `${completedData.scope || ''}\n\nDemo branch: ${profile.title}. Signals: ${profile.signals.join(', ')}.`;
  }

  if (task.type === 'ux-agent') {
    completedData.ux_spec = `# ${profile.title}\n\nUX focus for this branch: ${profile.outcome}\n\n${completedData.ux_spec || ''}`;
    if (Array.isArray(completedData.screens)) {
      completedData.screens = completedData.screens.map((screen) => ({
        ...screen,
        demo_scenario: scenario,
        demo_signal: profile.signals[0],
      }));
    }
  }

  if (task.type === 'dev-agent') {
    completedData.implementation_plan = `# ${profile.title}\n\nImplementation evidence expected: ${profile.signals.join(', ')}.\n\n${completedData.implementation_plan || ''}`;
    completedData.build_report = `${completedData.build_report || ''}\n\nDemo branch: ${profile.title}. Expected outcome: ${profile.outcome}`;
  }

  if (task.type === 'qa-agent') {
    completedData.qa_report = `# ${profile.title}\n\nQA branch result: ${profile.outcome}\n\n${completedData.qa_report || ''}`;
    completedData.release_reason = `${profile.title}: ${profile.outcome}`;
  }
}

// =============================================================================
// Classification helpers
// =============================================================================

function classifyFeatureRequest(featureRequest = {}) {
  const text = `${featureRequest.title || ''} ${featureRequest.description || ''}`.toLowerCase();
  const rules = [
    { tag: 'auth', keywords: ['login', 'signin', 'sign in', 'oauth', 'authentication', 'dang nhap'] },
    { tag: 'payment', keywords: ['payment', 'checkout', 'billing', 'refund', 'stripe'] },
    { tag: 'pii', keywords: ['profile', 'email', 'phone', 'address', 'personal data'] },
    { tag: 'admin', keywords: ['admin', 'permission', 'role', 'rbac'] },
  ];
  const riskTags = rules.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword))).map((rule) => rule.tag);
  const isHighRisk = riskTags.some((tag) => ['auth', 'payment', 'pii', 'admin'].includes(tag));
  if (riskTags.includes('auth')) riskTags.push('oauth', 'session');
  return {
    level: isHighRisk ? 'HIGH' : 'LOW',
    tags: [...new Set(riskTags)],
    required_gates: isHighRisk ? ['schema', 'validation', 'evidence', 'security', 'qa'] : ['schema', 'validation', 'evidence', 'qa'],
    classifier: 'mock-rule-based.v1',
    reason: isHighRisk
      ? 'Sensitive feature keywords require evidence-based review and a security checklist.'
      : 'No sensitive feature keyword was detected by the mock classifier.',
  };
}

/**
 * T4.1 — PO route classification. Decides whether a request needs a UI phase.
 * route ∈ { ui, backend, analysis, fullstack }. Only backend/analysis skip UX.
 * Default is fullstack (keeps the existing PO→UX→DEV→QA path) so unknown
 * requests never accidentally drop the design step.
 */
function classifyRoute(featureRequest = {}) {
  const text = `${featureRequest.title || ''} ${featureRequest.description || ''}`.toLowerCase();
  const uiKeywords = ['login', 'signin', 'sign in', 'sign-up', 'signup', 'page', 'screen', 'button', 'form',
    'ui', 'ux', 'frontend', 'front-end', 'dashboard', 'modal', 'layout', 'design', 'component', 'navbar', 'menu'];
  const backendKeywords = ['logging', 'log ', 'api', 'endpoint', 'database', 'migration', 'cron', 'queue',
    'webhook', 'cache', 'rate limit', 'background job', 'index', 'schema', 'service', 'pipeline'];
  const analysisKeywords = ['analy', 'report', 'metric', 'investigate', 'research', 'audit', 'benchmark', 'profiling'];

  const hasUI = uiKeywords.some((k) => text.includes(k));
  const hasBackend = backendKeywords.some((k) => text.includes(k));
  const isAnalysis = analysisKeywords.some((k) => text.includes(k));

  let route;
  if (hasUI && hasBackend) route = 'fullstack';
  else if (hasUI) route = 'ui';
  else if (isAnalysis && !hasBackend) route = 'analysis';
  else if (hasBackend) route = 'backend';
  else route = 'fullstack'; // safe default → keep UX

  return {
    route,
    has_ui: route === 'ui' || route === 'fullstack',
    classifier: 'mock-route.v1',
    reason: `Classified as "${route}" from request keywords.`,
  };
}

function firstContextValue(context, key) {
  const item = Array.isArray(context?.[key]) ? context[key][0] : null;
  return item?.content ?? null;
}

// =============================================================================
// Structured Feedback helpers
// =============================================================================

function normalizeStructuredFeedback(payload = {}, comment = '') {
  return {
    decision: 'reject_and_rerun',
    comment: String(comment || '').trim(),
    target_fields: Array.isArray(payload.target_fields) ? payload.target_fields.filter(Boolean) : [],
    blocking_issues: Array.isArray(payload.blocking_issues)
      ? payload.blocking_issues.map((issue) => ({
        severity: issue.severity || 'HIGH',
        issue: String(issue.issue || '').trim(),
        expected_fix: String(issue.expected_fix || '').trim(),
      })).filter((issue) => issue.issue || issue.expected_fix)
      : [],
    acceptance_checks: Array.isArray(payload.acceptance_checks) ? payload.acceptance_checks.filter(Boolean) : [],
    rerun_scope: 'same_agent_only',
  };
}

function validateStructuredFeedback(feedback) {
  if (feedback.comment.length < 10 || VAGUE_REVIEW_COMMENTS.has(feedback.comment.toLowerCase())) {
    throw new ApiError(422, 'Reviewer feedback must explain the requested direction in at least 10 characters.');
  }
  if (!feedback.blocking_issues.length || feedback.blocking_issues.some((issue) => !issue.issue || !issue.expected_fix)) {
    throw new ApiError(422, 'Add at least one blocking issue and the expected fix before rerunning the worker.');
  }
  if (!feedback.acceptance_checks.length) {
    throw new ApiError(422, 'Add at least one acceptance check so the rerun can be verified.');
  }
}

// =============================================================================
// JSON Patch helpers
// =============================================================================

/** Resolve an RFC 6902 JSON Pointer to its parent container + final key. */
function _resolvePointer(doc, pointer) {
  if (pointer === '') return { parent: null, key: null, target: doc };
  const parts = pointer.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let parent = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = Array.isArray(parent) ? Number(parts[i]) : parts[i];
    if (parent[key] === undefined) parent[key] = {};
    parent = parent[key];
  }
  const lastRaw = parts[parts.length - 1];
  const key = Array.isArray(parent) ? (lastRaw === '-' ? parent.length : Number(lastRaw)) : lastRaw;
  return { parent, key };
}

/** Minimal RFC 6902 JSON Patch applier (add / replace / remove). Returns a new doc. */
function applyJsonPatch(source, operations = []) {
  const doc = JSON.parse(JSON.stringify(source || {}));
  for (const op of operations) {
    if (!op || typeof op.path !== 'string') continue;
    const { parent, key } = _resolvePointer(doc, op.path);
    if (parent === null) continue;
    if (op.op === 'add' || op.op === 'replace') {
      if (Array.isArray(parent) && op.op === 'add') parent.splice(key, 0, op.value);
      else parent[key] = op.value;
    } else if (op.op === 'remove') {
      if (Array.isArray(parent)) parent.splice(key, 1);
      else delete parent[key];
    }
  }
  return doc;
}

// =============================================================================
// Workflow progression helpers
// =============================================================================

/**
 * The agent that follows a task. Per AIFA v2.1 the chain is fixed
 * ARCH → PO → UX → DEV → QA; no UX skip is permitted.
 */
function nextAgentFor(task) {
  return NEXT_AGENT[task?.type];
}

/**
 * Select one coherent workflow chain. A QA task from an older DEV run must
 * never appear beside the current DEV task.
 */
function selectCurrentTaskChain(tasks = []) {
  const latest = (type) => tasks.find((task) => task.type === type) || null;
  const architectureTask = latest('architecture-agent');
  const poTask = latest('po-agent');
  const uxTask = poTask
    ? tasks.find((task) => task.type === 'ux-agent' && task.sourceRunId === poTask.id) || null
    : null;
  const devSourceId = uxTask?.id;
  const devTask = devSourceId
    ? tasks.find((task) => task.type === 'dev-agent' && task.sourceRunId === devSourceId) || null
    : null;
  const qaTask = devTask
    ? tasks.find((task) => task.type === 'qa-agent' && task.sourceRunId === devTask.id) || null
    : null;

  return { architectureTask, poTask, uxTask, devTask, qaTask };
}

function deriveCurrentPhase(architectureTask, poTask, uxTask, devTask, qaTask, decisionsByTaskId, releaseDecision = null) {
  if (!architectureTask && !poTask) return 'BACKLOG';
  // Architecture (Phase §6): the architecture-agent approval is now a hard gate
  // before PO can start. The two left-standing predecessors (poTask or no chain
  // yet) collapse to BACKLOG because Architecture hasn't even been kicked off.
  if (architectureTask) {
    if (architectureTask.status === 'pending' || architectureTask.status === 'processing') return 'ARCHITECTURE_RUNNING';
    if (architectureTask.status === 'failed') return 'ARCHITECTURE_FAILED';
    if (!decisionsByTaskId[architectureTask?.id] || decisionsByTaskId[architectureTask?.id]?.decision !== 'APPROVE') return 'ARCHITECTURE_REVIEW';
  }
  if (!poTask) return 'BACKLOG';
  if (poTask.status === 'pending' || poTask.status === 'processing') return 'PO_RUNNING';
  if (poTask.status === 'failed') return 'PO_FAILED';
  if (!decisionsByTaskId[poTask?.id] || decisionsByTaskId[poTask?.id]?.decision !== 'APPROVE') return 'PO_REVIEW';
  if (!uxTask || uxTask.status === 'pending' || uxTask.status === 'processing') return 'UX_RUNNING';
  if (uxTask.status === 'failed') return 'UX_FAILED';
  if (!decisionsByTaskId[uxTask?.id] || decisionsByTaskId[uxTask?.id]?.decision !== 'APPROVE') return 'UX_REVIEW';
  if (!devTask || devTask.status === 'pending' || devTask.status === 'processing') return 'DEV_RUNNING';
  if (devTask.status === 'failed') return 'DEV_FAILED';
  if (!decisionsByTaskId[devTask?.id] || decisionsByTaskId[devTask?.id]?.decision !== 'APPROVE') return 'DEV_REVIEW';
  if (!qaTask || qaTask.status === 'pending' || qaTask.status === 'processing') return 'QA_RUNNING';
  if (qaTask.status === 'failed') return 'QA_FAILED';
  if (!decisionsByTaskId[qaTask?.id]) return 'QA_REVIEW';
  if (releaseDecision?.decision === 'APPROVE') return 'RELEASED';
  if (releaseDecision?.decision === 'REJECT') return 'RELEASE_REJECTED';
  return 'FINAL_REVIEW';
}

// =============================================================================
// Feature request retrieval helpers
// =============================================================================

async function getFeatureRequestFromIntentTask(task, deps = {}) {
  const { AgentArtifact, resolveArtifactContent } = deps;
  const featureArtifacts = await AgentArtifact.findByTaskIdAndType(task.id, 'feature_request');
  if (featureArtifacts.length > 0) {
    const resolved = await resolveArtifactContent(featureArtifacts[0]);
    const featureRequest = resolved.contentJson || resolved.contentText;
    if (featureRequest && typeof featureRequest === 'object' && featureRequest.title) {
      return featureRequest;
    }
    if (typeof featureRequest === 'string' && featureRequest.trim()) {
      return { title: 'Rework feature request', description: featureRequest };
    }
  }

  const assumptions = await AgentArtifact.findByTaskIdAndType(task.id, 'intent_assumptions');
  if (assumptions.length > 0) {
    const resolved = await resolveArtifactContent(assumptions[0]);
    if (resolved.contentText && resolved.contentText.trim()) {
      return {
        title: 'Rework feature request',
        description: resolved.contentText,
      };
    }
  }

  throw new ApiError(400, 'Cannot rework intent task: original feature request artifact is missing');
}

async function getFeatureRequestFromTask(task, deps = {}) {
  const { AgentArtifact, resolveArtifactContent } = deps;
  const featureArtifacts = await AgentArtifact.findByTaskIdAndType(task.id, 'feature_request');
  if (featureArtifacts.length > 0) {
    const resolved = await resolveArtifactContent(featureArtifacts[0]);
    if (resolved.contentJson?.title) return resolved.contentJson;
  }
  throw new ApiError(400, 'Cannot rework PO task: original feature request artifact is missing');
}

// =============================================================================
// Mock scenario shaping
// =============================================================================

/**
 * Shape a deterministic mock agent output for the single demo scenario
 * (`happy_path`): every stage is high-confidence + valid so the run reaches
 * Final Release. Reviewer feedback (HITL reject → rework) is still honored so
 * the human gate stays exercised. The synthetic bad-case scenarios of the old
 * system have been removed; failure-handling can be reintroduced later.
 */
function applyMockScenario(task, completedData, feedbackPrompt) {
  const scenario = resolveMockScenario();
  applyScenarioNarrative(task, completedData, scenario, feedbackPrompt);

  const markRework = () => {
    completedData.summary = `Mock ${task.type.replace('-agent', '').toUpperCase()} rework completed after applying reviewer feedback.`;
    completedData.rework_response = {
      worker: task.type,
      feedback_received: feedbackPrompt,
      changes_applied: [
        `Revisited the ${task.type.replace('-agent', '').toUpperCase()} output using the reviewer direction.`,
        'Regenerated the structured output and reran the applicable validation checks.',
      ],
      confidence_before: 0.58,
      confidence_after: 0.92,
    };
  };

  // Base confidence for the three review stages.
  if (MOCK_REVIEW_STAGES.includes(task.type)) {
    completedData.confidence_score = feedbackPrompt ? 0.92 : 0.95;
    if (feedbackPrompt) markRework();
  }

  // DEV security passes in scenario mode so each branch isolates its own
  // variable (confidence / evidence / QA / release).
  if (task.type === 'dev-agent') {
    completedData.security_notes = completedData.security_notes || {
      oauth_state_csrf: 'PASS', pkce: 'PASS', client_secret_frontend: 'PASS',
      redirect_uri_allow_list: 'PASS', session_cookie: 'PASS', account_linking: 'PASS',
      logout_and_error_paths: 'PASS', audit_logging: 'PASS',
    };
    completedData.security_gate = { recommendation: 'PASS', checklist_version: 'oauth-security.mock.v1', issues: [] };
  }

  // happy_path: every stage is already high-confidence + valid; nothing to override.
}

// =============================================================================
// Gate mode resolution
// =============================================================================

function resolveGateMode(task) {
  if (REVIEW_HOLDS.get(task.projectId)?.has(task.type)) return GATE_MODE.STRICT_MANUAL;
  return DEFAULT_GATE_MODE[task.type] || GATE_MODE.STRICT_MANUAL;
}

module.exports = {
  // Scenario / mock
  resolveMockScenario,
  buildScenarioBrief,
  applyScenarioNarrative,
  // Classification
  classifyFeatureRequest,
  firstContextValue,
  // Structured feedback
  normalizeStructuredFeedback,
  validateStructuredFeedback,
  // JSON Patch
  _resolvePointer,
  applyJsonPatch,
  // Workflow progression
  nextAgentFor,
  selectCurrentTaskChain,
  deriveCurrentPhase,
  // Feature request retrieval
  getFeatureRequestFromIntentTask,
  getFeatureRequestFromTask,
  // Mock scenario shaping
  applyMockScenario,
  // Gate mode
  resolveGateMode,
};
