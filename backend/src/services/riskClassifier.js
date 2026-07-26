// AIFA PHASE 2 — riskClassifier (T2.1).
//
// Classify a DEV tool action into one of three risk tiers so the gate layer can
// decide WITHOUT asking a human on every action:
//   auto     — safe, proceed and only audit (new file in an allowed feature dir;
//              edit test/docs/mock files).
//   approval — risky, must pause for a human (delete; auth/security/payment;
//              env/config; DB migration; dependency/package; out-of-scope edit).
//   block    — never allowed (write outside repo; read a secret; edit .env;
//              push straight to main; mass delete).
//
// Control by RISK, not mechanically per action (strategy item 3).

const path = require('path');

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'create_file', 'str_replace']);
const DELETE_TOOLS = new Set(['Delete', 'Remove', 'rm']);

// Path category matchers (matched against a normalised, forward-slash rel path).
const TEST_DOCS_MOCK = /(^|\/)(tests?|__tests__|spec|specs|docs?|mock|mocks|fixtures|examples?)(\/|$)|\.(test|spec)\.[a-z]+$|\.md$/i;
const SECURITY_SENSITIVE = /(^|\/)(auth|oauth|security|session|login|signin|password|crypto|payment|billing|checkout|stripe)(\/|$)/i;
const ENV_CONFIG = /(^|\/)(\.env(\..*)?|config|configuration|settings)(\/|$)|\.(env|ini|conf|config)$|(^|\/)(next\.config|vite\.config|webpack\.config)/i;
const MIGRATION = /(^|\/)(migrations?|prisma\/migrations)(\/|$)|\.sql$|schema\.prisma$/i;
const DEPENDENCY = /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile)$/i;
const SECRET = /(^|\/)\.env(\..*)?$|\.pem$|(^|\/)id_(rsa|dsa|ecdsa|ed25519)$|\.p12$|\.pfx$|\.key$|(^|\/)credentials(\.json)?$|(^|\/)\.git-credentials$/i;

function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isOutsideRepo(relPath) {
  const p = norm(relPath);
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) return true; // absolute or drive-letter
  // any segment that climbs above the repo root
  const segments = p.split('/');
  let depth = 0;
  for (const seg of segments) {
    if (seg === '..') { depth -= 1; if (depth < 0) return true; } else if (seg && seg !== '.') depth += 1;
  }
  return false;
}

/**
 * @param {string} toolName  e.g. 'Write' | 'Edit' | 'Delete' | 'Bash'
 * @param {object} input     tool input; uses input.file_path / input.command / input.content
 * @param {object} scope     { allowedDirs?: string[], featurePaths?: string[] }
 * @returns {{ tier: 'auto'|'approval'|'block', reason: string, category: string }}
 */
function classifyAction(toolName, input = {}, scope = {}) {
  const filePath = input.file_path || input.path || input.target || '';
  const rel = norm(filePath);
  const command = String(input.command || '').trim();

  // ----- Shell / command tools: only the safest reads auto-pass -----
  if (toolName === 'Bash' || toolName === 'Shell' || toolName === 'run_command') {
    if (/\b(git\s+push|--force|push\s+.*\bmain\b)/i.test(command)) {
      return { tier: 'block', reason: 'Pushing to main is not allowed', category: 'push_main' };
    }
    if (/\brm\s+-rf?\b|\bdel\s+\/[sq]/i.test(command)) {
      return { tier: 'block', reason: 'Mass delete is not allowed', category: 'mass_delete' };
    }
    return { tier: 'approval', reason: 'Shell commands require human approval', category: 'shell' };
  }

  // ----- BLOCK tier (never allowed) -----
  if (rel && isOutsideRepo(filePath)) {
    return { tier: 'block', reason: 'Writing outside the repo is not allowed', category: 'outside_repo' };
  }
  if (SECRET.test(rel)) {
    // editing/reading .env or key material
    return { tier: 'block', reason: 'Reading or editing secret/.env files is not allowed', category: 'secret' };
  }

  // ----- DELETE → approval (single file) -----
  if (DELETE_TOOLS.has(toolName) || input.op === 'delete' || input.delete === true) {
    return { tier: 'approval', reason: 'Deleting a file requires human approval', category: 'delete' };
  }

  // ----- WRITE/EDIT tiering by path category -----
  if (WRITE_TOOLS.has(toolName)) {
    if (SECURITY_SENSITIVE.test(rel)) {
      return { tier: 'approval', reason: 'Editing auth/security/payment code requires human approval', category: 'security' };
    }
    if (ENV_CONFIG.test(rel)) {
      return { tier: 'approval', reason: 'Editing env/config requires human approval', category: 'config' };
    }
    if (MIGRATION.test(rel)) {
      return { tier: 'approval', reason: 'Editing a DB migration/schema requires human approval', category: 'migration' };
    }
    if (DEPENDENCY.test(rel)) {
      return { tier: 'approval', reason: 'Changing dependencies requires human approval', category: 'dependency' };
    }
    // test / docs / mock edits are safe
    if (TEST_DOCS_MOCK.test(rel)) {
      return { tier: 'auto', reason: 'Editing test/docs/mock files is safe', category: 'test_docs_mock' };
    }
    // new file inside an allowed feature directory is safe
    const featurePaths = Array.isArray(scope.featurePaths) ? scope.featurePaths : [];
    const inFeature = featurePaths.length === 0 || featurePaths.some((dir) => rel.startsWith(norm(dir)));
    const isExisting = input.is_new === false || input.exists === true;
    if (inFeature && !isExisting) {
      return { tier: 'auto', reason: 'Creating a new file in the feature scope is safe', category: 'new_feature_file' };
    }
    if (!inFeature) {
      return { tier: 'approval', reason: 'Editing a file outside the feature scope requires human approval', category: 'out_of_scope' };
    }
    // editing an existing in-scope, non-sensitive file → approval (conservative)
    return { tier: 'approval', reason: 'Modifying an existing file requires human approval', category: 'modify_existing' };
  }

  // ----- Unknown tools default to approval (safe-by-default) -----
  return { tier: 'approval', reason: `Unrecognised tool ${toolName} requires human approval`, category: 'unknown' };
}

module.exports = { classifyAction };
