// ── Gate evaluation & validation logic ───────────────────────────────────────
// Pure computation functions extracted from SdlcWorkflowService.
// No `this` context required — all dependencies are imported directly.

const gateBridge = require('./gateBridge');
const { AUTO_APPROVE_CONFIDENCE, GATE_MODE, OUTPUT_CONTRACTS } = require('./sdlcConstants');

/**
 * T5.1 — map a contract rule to one of the three validation layers.
 */
function layerOf(ruleName) {
  const RISK = new Set(['security_notes', 'security_gate', 'quality_gate_pass']);
  const SEMANTIC = new Set(['ac_testable', 'ac_measurable', 'coverage_complete', 'tests_passed',
    'no_blockers', 'release_reason', 'linked_ac', 'build_ok', 'build_tests']);
  if (RISK.has(ruleName)) return 'risk';
  if (SEMANTIC.has(ruleName)) return 'semantic';
  return 'schema';
}

/**
 * Validate agent output against the versioned output contract rules.
 */
function validateGateOutput(task, output) {
  const out = output || {};
  const rules = OUTPUT_CONTRACTS[task.type] || [];
  const violations = [];

  for (const rule of rules) {
    if (rule.when && !rule.when(out, task)) continue;
    if (rule.check(out, task)) continue;
    const detail = typeof rule.detail === 'function' ? rule.detail(out, task) : rule.detail;
    const inspect = typeof rule.inspect === 'function' ? rule.inspect(out, task) : null;
    violations.push({
      rule: rule.rule,
      detail,
      severity: rule.severity,
      layer: layerOf(rule.rule),
      ...(inspect ? { inspect } : {}),
    });
  }

  const blockers = violations.filter((v) => v.severity === 'BLOCKER');
  return { ok: blockers.length === 0, violations };
}

/**
 * T5.1 — group a role validation into three layers (schema/semantic/risk).
 */
function threeLayerSummary(task, output) {
  const { violations } = validateGateOutput(task, output);
  const byLayer = { schema: [], semantic: [], risk: [] };
  for (const v of violations) byLayer[v.layer || 'schema'].push(v);
  const layerOk = (arr) => !arr.some((v) => v.severity === 'BLOCKER');
  return {
    schema: { ok: layerOk(byLayer.schema), violations: byLayer.schema },
    semantic: { ok: layerOk(byLayer.semantic), violations: byLayer.semantic },
    risk: { ok: layerOk(byLayer.risk), violations: byLayer.risk },
    ok: violations.filter((v) => v.severity === 'BLOCKER').length === 0,
  };
}

/**
 * T5 — evaluate gate policy: check confidence, validation, and security.
 * Returns { recommendation, confidence, issues, ... }.
 */
function evaluateGatePolicy(task) {
  const output = task.agentOutput || {};
  const validation = validateGateOutput(task, output);
  const confidence = Number(output.confidence_score ?? 0.95);
  const lowConfidence = !Number.isFinite(confidence) || confidence < AUTO_APPROVE_CONFIDENCE;
  const warnings = validation.violations.filter((violation) => violation.severity === 'WARNING');
  const securityIssues = Array.isArray(output.security_gate?.issues) ? output.security_gate.issues : [];
  const needsHuman = task.gateMode === GATE_MODE.STRICT_MANUAL || !validation.ok || warnings.length > 0 || lowConfidence || securityIssues.length > 0;
  const reasons = [];
  const issues = [];
  if (task.gateMode === GATE_MODE.STRICT_MANUAL) reasons.push('This gate always requires a human decision.');
  if (lowConfidence) {
    reasons.push(`Confidence ${confidence.toFixed(2)} is below the ${AUTO_APPROVE_CONFIDENCE.toFixed(2)} threshold.`);
    issues.push({
      code: 'low_confidence',
      severity: 'WARNING',
      detail: `The ${task.type.replace('-agent', '').toUpperCase()} worker returned confidence ${confidence.toFixed(2)}. The required threshold is ${AUTO_APPROVE_CONFIDENCE.toFixed(2)}.`,
      suggestedAction: 'Tell the worker what to improve and send the output back for a new run.',
    });
  }
  if (!validation.ok) reasons.push('Validation found blocking issues.');
  if (warnings.length > 0) reasons.push(`Validation found ${warnings.length} warning(s).`);
  for (const violation of validation.violations) {
    issues.push({
      code: violation.rule,
      severity: violation.severity,
      detail: violation.detail,
      suggestedAction: 'Include this issue in the reviewer feedback before rerunning the worker.',
    });
  }
  for (const issue of securityIssues) {
    issues.push({
      code: issue.code || 'security_review',
      severity: issue.severity || 'HIGH',
      detail: issue.detail || 'Security evidence requires human review.',
      suggestedAction: issue.expected_fix || 'Send the security requirement back to DEV and rerun the build checks.',
    });
  }

  return {
    complexity: task.type.replace('-agent', ''),
    gateType: task.gateMode,
    score: Math.round(confidence * 100),
    confidence,
    recommendation: needsHuman ? 'HOLD' : 'PASS',
    summary: reasons.join(' ') || 'Confidence and validation checks passed. Safe to auto-approve.',
    issues,
    validation,
    layers: threeLayerSummary(task, output),
  };
}

/**
 * Check if there's a pending question-type gate for a project.
 */
function getPendingQuestionGate(projectId, taskIds = null) {
  const gates = gateBridge.listPending({ projectId }).filter((gate) => gate.kind === 'question');
  const scoped = taskIds ? gates.filter((g) => taskIds.has(g.taskId)) : gates;
  return scoped[0] || null;
}

module.exports = {
  layerOf,
  validateGateOutput,
  threeLayerSummary,
  evaluateGatePolicy,
  getPendingQuestionGate,
};
