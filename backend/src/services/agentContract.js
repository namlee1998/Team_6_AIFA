// Small, explicit agent I/O boundary shared by every execution adapter.
//
// Beginner reading guide: REQUIRED_OUTPUT_KEYS is the minimum shape accepted
// from deterministic mock output, the real Claude Agent SDK runner, and the
// Python/LangChain service. Detailed semantic/risk rules live in
// SdlcWorkflowService.OUTPUT_CONTRACTS (gate-output.v5).
//
// An adapter returns a plain object containing at least the role's required
// output keys below. tests/integration/agent-contract.test.js catches drift at
// this boundary before incomplete output reaches persistence or downstream.
//
// Keep this contract deliberately small. Do not duplicate richer gate rules.

const AGENT_CONTRACT_VERSION = 'agent-io.v5';

// architecture-agent emits ONE artifact: `architecture_contract` (alias of the
// former `project_definition` A2A Contract). The 6 legacy derived fields
// (architecture_brief, repository_summary, technology_stack,
// technical_decisions, top-level constraints, repository_routing) have been
// collapsed: the contract now carries everything downstream agents need and
// is the only key persisted by the artifact manager. See
// docs/fixbug/AUDIT_2026_07_25_ARCH_COLLAPSE.md §1.
const REQUIRED_OUTPUT_KEYS = {
  'architecture-agent': [
    'architecture_contract',
  ],
  'po-agent': ['prd', 'user_stories', 'acceptance_criteria', 'scope', 'out_of_scope'],
  'ux-agent': ['ux_spec', 'user_flow', 'wireframe_spec', 'screens', 'component_inventory', 'html_mockup'],
  'dev-agent': [
    'implementation_plan', 'patch_diff', 'changed_files',
  ],
  'qa-agent': [
    'test_cases', 'qa_report', 'ac_coverage_matrix', 'test_run_report',
    'release_reason', 'blocker_count',
    'build_result', 'self_test_report', 'linked_ac_ids',
    'risk_classification', 'risk_assessment',
    'security_notes', 'security_gate',
  ],
};

// Strict subset of REQUIRED_OUTPUT_KEYS that assertOutputConforms must
// enforce. For architecture-agent this is the single A2A Contract key.
const STRICT_OUTPUT_KEYS = {
  'architecture-agent': ['architecture_contract'],
};

// Per spec §6.1: clarification_questions is NOT a post-mortem JSON field.
// The platform uses mid-run AskUserQuestion for human clarification. We expose
// this here so workflow code can reference the canonical invariant without
// hard-coding string literals scattered across the codebase.
const FORBIDDEN_OUTPUT_KEYS = ['clarification_questions'];

function hasContent(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.every(hasContent);
  if (value && typeof value === 'object') {
    const values = Object.values(value);
    return values.length > 0 && values.some(hasContent);
  }
  return value !== undefined && value !== null;
}

/**
 * Check an agent output against the role contract.
 *
 * For most roles, all entries in REQUIRED_OUTPUT_KEYS are required. For
 * roles that have a STRICT_OUTPUT_KEYS override (currently only
 * `architecture-agent`), only the strict subset is enforced — the rest of
 * the entries are documentation and tolerate being absent or empty.
 *
 * Numeric zero and boolean false remain valid values; empty
 * strings/arrays/objects do not.
 *
 * @returns {{ ok: boolean, missing: string[], empty: string[] }}
 */
function assertOutputConforms(role, output) {
  const required = STRICT_OUTPUT_KEYS[role] || REQUIRED_OUTPUT_KEYS[role] || [];
  const out = output || {};
  const missing = required.filter((key) => out[key] === undefined || out[key] === null);
  const empty = required.filter((key) => !missing.includes(key) && !hasContent(out[key]));
  return { ok: missing.length === 0 && empty.length === 0, missing, empty };
}

// Mandatory fields the Architecture Agent must fill in `project_definition`
// before ARCH can Complete. Each entry is `{value, source, status}`:
//   - value:   <string|object|array>
//   - source:  'user' | 'agent' | 'inferred'
//   - status:  'confirmed' | 'missing' | 'assumed'
// For mandatory fields status='missing' blocks; status='assumed' is forbidden
// (the deterministic rule that blocks hallucinated tech-stack decisions).
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

// Optional fields that may carry status='assumed'. These never block ARCH.
const PROJECT_DEFINITION_OPTIONAL_KEYS = ['assumptions'];

function getProjectDefinitionEntry(pd, key) {
  if (!pd || typeof pd !== 'object') return null;
  const e = pd[key];
  return e && typeof e === 'object' && 'status' in e ? e : null;
}

/**
 * Validate the architecture_contract object produced by the Architecture
 * Agent. The contract is structurally identical to the legacy
 * project_definition ({value, source, status} per mandatory field), so the
 * helper name and field names are kept for diff stability.
 *
 * Returns:
 *   {
 *     ok: boolean,                           // true when no mandatory field
 *                                           // is missing or assumed
 *     missing: [{key, reason}],              // mandatory fields whose value
 *                                           // is missing/empty or status='missing'
 *     empty: [{key}],                        // mandatory fields with no value
 *     assumedOnMandatory: [{key}],           // mandatory fields with status='assumed'
 *   }
 *
 * The validator is purely deterministic — it does not consult scopeHints
 * or confidence, only the {value, source, status} metadata.
 */
function assertProjectDefinitionConforms(pd) {
  const missing = [];
  const empty = [];
  const assumedOnMandatory = [];
  if (!pd || typeof pd !== 'object') {
    return {
      ok: false,
      missing: PROJECT_DEFINITION_MANDATORY_KEYS.map((key) => ({ key, reason: 'architecture_contract is missing' })),
      empty: [],
      assumedOnMandatory: [],
    };
  }
  for (const key of PROJECT_DEFINITION_MANDATORY_KEYS) {
    const e = getProjectDefinitionEntry(pd, key);
    if (!e) {
      missing.push({ key, reason: 'field is missing or has no {value, source, status} metadata' });
      continue;
    }
    if (e.status === 'missing') {
      missing.push({ key, reason: 'status=missing (AskUserQuestion required)' });
      continue;
    }
    if (e.status === 'assumed') {
      assumedOnMandatory.push({ key });
      continue;
    }
    if (!hasContent(e.value)) {
      empty.push({ key });
    }
  }
  return {
    ok: missing.length === 0 && empty.length === 0 && assumedOnMandatory.length === 0,
    missing,
    empty,
    assumedOnMandatory,
  };
}

/**
 * T2 (B1) — defensive normalizer for `clarification_questions`.
 *
 * Frontend ClarificationPanel and spec §6.1 expect object form:
 *   [{question, header?, options?}, ...]
 *
 * Agents may still return `string[]` or partial objects during migration.
 * This helper always returns a non-empty array of objects, never throws,
 * and never silently drops content (drops only with a warn log when the
 * question text is missing entirely).
 *
 * - `string[]` entries become `{question: str}` objects.
 * - Bare strings / numbers / null / undefined are coerced where possible.
 * - Items without a recognizable question text are dropped with a warning.
 *
 * Kept here despite FORBIDDEN_OUTPUT_KEYS: the wire-contract rejection runs
 * in claudeCodeRunner.normalizeOutput (forces the field to []), but the
 * normalizer is still used by tests and any adapter that opts to surface
 * pre-rejection input defensively.
 */
function normalizeClarificationQuestions(raw, { logger = console } = {}) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out = [];
  for (const item of raw) {
    if (item == null) continue;
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) out.push({ question: text });
      continue;
    }
    if (typeof item === 'object') {
      const question = typeof item.question === 'string' ? item.question.trim() : '';
      if (!question) {
        logger.warn?.('clarification_questions: dropping item without question field', { item });
        continue;
      }
      const header = typeof item.header === 'string' && item.header.trim() ? item.header.trim() : undefined;
      let options;
      if (Array.isArray(item.options) && item.options.length > 0) {
        options = item.options
          .filter((o) => o && typeof o === 'object')
          .map((o) => ({
            label: typeof o.label === 'string' ? o.label.trim() : '',
            description: typeof o.description === 'string' ? o.description.trim() : undefined,
          }))
          .filter((o) => o.label);
        if (options.length === 0) options = undefined;
      }
      out.push(
        options
          ? (header ? { question, header, options } : { question, options })
          : (header ? { question, header } : { question })
      );
    }
  }
  return out;
}

module.exports = {
  AGENT_CONTRACT_VERSION,
  REQUIRED_OUTPUT_KEYS,
  STRICT_OUTPUT_KEYS,
  FORBIDDEN_OUTPUT_KEYS,
  PROJECT_DEFINITION_MANDATORY_KEYS,
  PROJECT_DEFINITION_OPTIONAL_KEYS,
  getProjectDefinitionEntry,
  assertProjectDefinitionConforms,
  assertOutputConforms,
  hasContent,
  normalizeClarificationQuestions,
};
