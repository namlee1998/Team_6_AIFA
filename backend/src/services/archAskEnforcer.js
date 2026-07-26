// askEnforcer — orchestrator for the mandatory AskUserQuestion enforcement
// loop. The file is still named `archAskEnforcer` for backward compatibility
// with the original test suite (`backend/tests/integration/arch-mandatory-ask.test.js`),
// but the loop now applies to every role that produces structured output:
// `architecture-agent`, `po-agent`, `ux-agent`, `dev-agent`, `qa-agent`.
//
// Spec: when an agent's output has BLOCKER violations AND the SDK transcript
// did not include an AskUserQuestion call, the backend discards the output
// and re-runs the agent with explicit feedback listing the missing fields.
// After `<ROLE>_MAX_ASK_RETRIES` attempts without resolution, the task is
// marked FAILED with code `<ROLE>_MAX_RETRIES_EXCEEDED`.
//
// This module is pure orchestration: it does NOT talk to the DB, does NOT
// call gateBridge, does NOT touch scopeHints. It only mutates the
// `context.feedbackPrompt` passed to the runner so the next attempt sees
// the missing-field list as plain text in its prompt.

const {
  OUTPUT_CONTRACTS,
  ASK_RETRY_CAPS_BY_ROLE,
  ASK_RETRY_EXCEEDED_CODE_BY_ROLE,
} = require('./sdlcConstants');

const ARCH_TYPE = 'architecture-agent';

// Roles whose structured output is validated by OUTPUT_CONTRACTS and
// therefore participate in the AskUserQuestion enforcement loop. Anything
// outside this set is bypassed (single-shot runOnce).
const ENFORCED_ROLES = new Set([
  ARCH_TYPE,
  'po-agent',
  'ux-agent',
  'dev-agent',
  'qa-agent',
]);

function _violationFields(role, violations) {
  // violations: [{rule, severity, detail, ...}]
  // For ARCH we map rule suffixes back to architecture_contract field names so
  // the feedback prompt can list them by semantic key. For non-ARCH roles
  // the validator rule names already name the missing field directly.
  const fields = [];
  for (const v of violations) {
    const r = v.rule || '';
    if (role === ARCH_TYPE) {
      if (r.endsWith('_missing') && r !== 'architecture_contract_present') {
        const key = r.slice(0, -'_missing'.length);
        if (key !== 'repository') {
          fields.push({ key, kind: 'missing' });
        } else {
          fields.push({ key: 'repository.target_module', kind: 'missing' });
        }
      } else if (r.endsWith('_assumed_forbidden')) {
        const key = r.slice(0, -'_assumed_forbidden'.length);
        fields.push({ key, kind: 'assumed' });
      } else if (r === 'repository_target_module_missing') {
        fields.push({ key: 'repository.target_module', kind: 'missing' });
      } else if (r === 'architecture_contract_present') {
        fields.push({ key: 'architecture_contract', kind: 'missing' });
      }
    } else {
      // Plain string list of failing rules for non-ARCH roles.
      fields.push({ key: r, kind: 'missing' });
    }
  }
  return fields;
}

function _buildFeedbackBlock(role, fields) {
  if (!fields.length) return '';
  const intro = role === ARCH_TYPE
    ? 'Previous attempt failed.\nThe following mandatory information is still unresolved:'
    : `Previous attempt failed.\nThe ${role} output still has BLOCKER violations:`;
  const lines = [
    intro,
    ...fields.map((f) => `- ${f.key}`),
    'Do NOT guess the missing field. Call AskUserQuestion to obtain clarification from the operator before producing the output again.',
  ];
  return lines.join('\n');
}

function _runValidation(role, output) {
  const rules = OUTPUT_CONTRACTS[role] || [];
  const violations = [];
  for (const rule of rules) {
    // Honour `when` predicates: rules that the workflow only enforces
    // conditionally (e.g. `security_notes` is only required when QA's
    // risk_classification.required_gates includes 'security'). The
    // workflow orchestrator's _validateGateOutput respects this; the
    // enforcement loop must too, otherwise we over-retry on benign noise.
    if (rule.when && !rule.when(output || {})) continue;
    let passes = false;
    try {
      passes = !!rule.check(output || {});
    } catch (_) {
      passes = false;
    }
    if (!passes) {
      violations.push(rule);
    }
  }
  return violations;
}

/**
 * enforceAskUserQuestion({ task, context, runOnce })
 *
 * - runOnce: ({ context }) => Promise<{ output, toolCalls }>
 *
 * Returns { output, toolCalls, attempts, missingFields, role }.
 * Throws Error with code '<ROLE>_MAX_RETRIES_EXCEEDED' on exhaustion.
 *
 * If `task.type` is not in ENFORCED_ROLES (e.g. custom/internal tasks),
 * the wrapper is bypassed: the single runOnce({ context }) result is
 * returned unchanged.
 */
async function enforceAskUserQuestion({ task, context, runOnce }) {
  const role = task?.type;
  if (!role || !ENFORCED_ROLES.has(role)) {
    const r = await runOnce({ context });
    return {
      output: r.output,
      toolCalls: r.toolCalls || [],
      attempts: 1,
      missingFields: [],
      role,
    };
  }

  const cap = ASK_RETRY_CAPS_BY_ROLE[role] ?? 2;
  const exceededCode = ASK_RETRY_EXCEEDED_CODE_BY_ROLE[role] ?? 'MAX_RETRIES_EXCEEDED';

  let ctx = { ...(context || {}) };
  let lastOutput = null;
  let lastToolCalls = [];
  let lastViolations = [];

  for (let attempt = 1; attempt <= cap; attempt += 1) {
    const { output, toolCalls } = await runOnce({ context: ctx });
    lastOutput = output;
    lastToolCalls = toolCalls || [];

    const violations = _runValidation(role, output);
    const blockers = violations.filter((v) => v.severity === 'BLOCKER');
    lastViolations = blockers;

    // Case A: clean output, no BLOCKERs → return.
    if (blockers.length === 0) {
      return {
        output,
        toolCalls: lastToolCalls,
        attempts: attempt,
        missingFields: [],
        role,
      };
    }

    // Case B: BLOCKER present AND Claude called AskUserQuestion mid-run.
    // Per spec: "Không thay đổi gì" — whatever Claude produced goes to the
    // output-review gate as today.
    const asked = lastToolCalls.some((t) => t && t.name === 'AskUserQuestion');
    if (asked) {
      return {
        output,
        toolCalls: lastToolCalls,
        attempts: attempt,
        missingFields: _violationFields(role, blockers),
        role,
      };
    }

    // Case C: BLOCKER present AND no AskUserQuestion → retry with feedback
    // unless this was the final attempt.
    if (attempt < cap) {
      const fields = _violationFields(role, blockers);
      const block = _buildFeedbackBlock(role, fields);
      const existing = (ctx.feedbackPrompt || '').trim();
      ctx = {
        ...ctx,
        feedbackPrompt: existing ? `${existing}\n\n${block}` : block,
      };
    }
  }

  // Exhausted retries without resolution.
  // ARCH keeps the historical "mandatory project information" wording so the
  // existing test contract remains stable. Other roles get a role-prefixed
  // message that names the retry limit.
  const message = role === ARCH_TYPE
    ? `${role} failed to obtain mandatory project information after ${cap} attempts. No further retries.`
    : `${role} failed to obtain required clarification after ${cap} attempts. No further retries.`;
  const err = new Error(message);
  err.code = exceededCode;
  err.recoverable = false;
  err.attempts = cap;
  err.role = role;
  err.missingFields = _violationFields(role, lastViolations);
  err.lastOutput = lastOutput;
  // Attach for observability; agentDispatcher may surface this in agent-event log.
  throw err;
}

module.exports = {
  enforceAskUserQuestion,
  ENFORCED_ROLES,
  // exported for tests
  _runValidation,
  _violationFields,
  _buildFeedbackBlock,
};
