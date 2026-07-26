// ── Scope Resolver ─────────────────────────────────────────────────────────
// Pure function: maps (repoIndex + featureRequest + optional languageHint)
// → scopeHints the Architecture Agent consumes. Replaces keyword-only
// guessing with a small set of deterministic rules and falls back safely
// when confidence is low.

const DEFAULT_IGNORE_GLOBS = [
  'node_modules/', 'dist/', 'build/', '.next/', 'out/', 'coverage/',
  '.cache/', '__pycache__/', '.pytest_cache/', '.mypy_cache/',
  'venv/', '.venv/', 'target/', 'bin/', 'obj/',
  '.git/', '.hg/', '.svn/', '.idea/', '.vscode/',
];

const LANGUAGE_PATTERNS = [
  [/\b(react|jsx|tsx)\b/, 'react'],
  [/\b(vue|nuxt)\b/, 'vue'],
  [/\b(svelte|sveltekit)\b/, 'svelte'],
  [/\b(angular)\b/, 'angular'],
  [/\b(next\.?js|nextjs)\b/, 'next'],
  [/\b(node|express|nest|fastify|koa)\b/, 'node'],
  [/\b(python|flask|django|fastapi)\b/, 'python'],
  [/\b(go|gin|gorm|fiber)\b/, 'go'],
  [/\b(rust|actix|axum)\b/, 'rust'],
  [/\b(java|spring|kotlin)\b/, 'java'],
  [/\b(ruby|rails|sinatra)\b/, 'ruby'],
  [/\b(php|laravel|symfony)\b/, 'php'],
];

const FRONTEND_KW = /\b(frontend|ui|page|button|screen|form|modal|toast|nav|menu|css|tailwind|styling|react|vue|svelte|component|widget|drawer|dialog|hero|layout|theme|color|icon|font|fontend|font-end)\b/;
const BACKEND_KW = /\b(backend|api|server|endpoint|route|controller|service|orm|db|migration|auth|login|signup|password|token|jwt|session|middleware|graphql|rest|crud|repository|model|schema|db_|database)\b/;
const AUTH_KW = /\b(auth|login|signup|signin|password|token|jwt|session|oauth|sso|2fa|mfa|credential)\b/;
const TEST_KW = /\b(test|spec|jest|vitest|pytest|cypress)\b/;

const FRONTEND_CANDIDATES = [
  'src/components', 'src/pages', 'src/views', 'src/screens', 'src/frontend',
  'web/src/components', 'web/src/pages', 'web/src/views',
  'app/components', 'app/pages', 'app/views',
  'packages/web/src/components', 'packages/web/src/pages',
  'client/src/components', 'client/src/pages',
];
const BACKEND_CANDIDATES = [
  'src/api', 'src/server', 'src/services', 'src/routes', 'src/controllers',
  'src/middleware', 'src/repositories', 'src/models', 'src/db', 'src/database',
  'server', 'api', 'app/api', 'app/server',
  'packages/api/src/routes', 'packages/api/src/controllers', 'packages/api/src/services',
  'backend/src/controllers', 'backend/src/services', 'backend/src/routes',
];
const AUTH_CANDIDATES = [
  'src/auth', 'src/middleware/auth', 'src/services/auth', 'src/components/auth',
  'src/pages/auth', 'src/views/auth', 'src/screens/auth',
  'app/auth', 'app/(auth)', 'app/(authentication)',
];
const TEST_CANDIDATES = [
  'src/__tests__', 'src/test', 'tests', 'test', '__tests__', 'spec',
];

function detectLanguageHint(text, override) {
  if (override && typeof override === 'string') return override.toLowerCase().trim();
  for (const [re, lang] of LANGUAGE_PATTERNS) {
    if (re.test(text)) return lang;
  }
  return null;
}

function pickExisting(candidates, repoEntriesSet) {
  const hits = [];
  for (const c of candidates) {
    const normalized = c.replace(/\/$/, '');
    if (repoEntriesSet.has(normalized)) hits.push(c);
  }
  return hits;
}

function topLevelDirs(entries) {
  const top = new Set();
  for (const e of entries) {
    if (e.type !== 'dir') continue;
    const first = e.path.split('/')[0];
    if (first) top.add(first);
  }
  return [...top].sort();
}

/**
 * @param {{
 *   repoIndex: { entries: Array<{ type: 'dir'|'file', path: string, name: string }>, manifests?: string[] } | null,
 *   featureRequest: { title?: string, description?: string, language?: string } | null,
 *   options?: { maxTargetFolders?: number },
 * }} args
 * @returns {{
 *   languageHint: string | null,
 *   targetFolders: string[],
 *   ignoreGlobs: string[],
 *   confidence: number,
 *   reason: string,
 * }}
 */
function resolveScope({ repoIndex, featureRequest, options = {} }) {
  const featureText = `${featureRequest?.title || ''} ${featureRequest?.description || ''}`.toLowerCase();
  const override = featureRequest?.language || featureRequest?.languageHint;
  const languageHint = detectLanguageHint(featureText, override);

  const entries = Array.isArray(repoIndex?.entries) ? repoIndex.entries : [];
  const repoEntriesSet = new Set(entries.filter((e) => e.type === 'dir').map((e) => e.path));
  const maxTargetFolders = Math.max(1, Math.min(8, options.maxTargetFolders || 5));

  const collected = [];
  const reasons = [];

  if (AUTH_KW.test(featureText)) {
    const hits = pickExisting(AUTH_CANDIDATES, repoEntriesSet);
    if (hits.length) { collected.push(...hits); reasons.push('auth-keyword'); }
  }
  if (FRONTEND_KW.test(featureText)) {
    const hits = pickExisting(FRONTEND_CANDIDATES, repoEntriesSet);
    if (hits.length) { collected.push(...hits); reasons.push('frontend-keyword'); }
  }
  if (BACKEND_KW.test(featureText)) {
    const hits = pickExisting(BACKEND_CANDIDATES, repoEntriesSet);
    if (hits.length) { collected.push(...hits); reasons.push('backend-keyword'); }
  }
  if (TEST_KW.test(featureText)) {
    const hits = pickExisting(TEST_CANDIDATES, repoEntriesSet);
    if (hits.length) { collected.push(...hits); reasons.push('test-keyword'); }
  }

  // Dedup, preserve order, cap.
  const targetFolders = [...new Set(collected)].slice(0, maxTargetFolders);

  // Fallback: if nothing matched, use top-level dirs (excluding denylist) or `src/`.
  if (targetFolders.length === 0) {
    if (repoEntriesSet.size > 0) {
      const top = topLevelDirs(entries).filter((d) => !DEFAULT_IGNORE_GLOBS.some((g) => g.startsWith(d + '/') || g === d + '/'));
      if (top.length > 0) {
        targetFolders.push(...top.slice(0, 3));
        reasons.push('top-level-fallback');
      }
    }
    if (targetFolders.length === 0 && repoEntriesSet.has('src')) {
      targetFolders.push('src');
      reasons.push('src-fallback');
    }
  }

  // Confidence: high when language + matched folders, low when both absent.
  let confidence = 0.4;
  if (languageHint) confidence += 0.25;
  if (targetFolders.length > 0) {
    const allExist = targetFolders.every((f) => repoEntriesSet.has(f.replace(/\/$/, '')));
    if (allExist) confidence += 0.25;
  }
  // Ambiguity penalty
  if (targetFolders.length >= 4) confidence -= 0.1;
  if (!languageHint && targetFolders.length === 0) confidence -= 0.2;
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));

  return {
    languageHint,
    targetFolders,
    ignoreGlobs: [...DEFAULT_IGNORE_GLOBS],
    confidence,
    reason: reasons.join(',') || 'default',
  };
}

module.exports = {
  resolveScope,
  DEFAULT_IGNORE_GLOBS,
  LANGUAGE_PATTERNS,
};
