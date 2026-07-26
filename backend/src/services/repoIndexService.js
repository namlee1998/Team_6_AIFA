// ── Repository shallow index ────────────────────────────────────────────────
// Walks the working tree to a configurable depth and returns a directory-only
// index. NEVER reads implementation source file contents. Cached per
// (repoPath, repoRevision, maxDepth); invalidated when the underlying repo or
// branch changes (HEAD SHA, working tree mtime, or branch name).
//
// Used by the Architecture Agent to scope Claude's exploration: the agent
// receives the index as data and may only `LS` paths in `scopeHints.targetFolders`.

const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_MAX_DEPTH = 2;
const MAX_INDEX_ENTRIES = 5000; // hard cap so a runaway repo doesn't blow memory
const ALLOWLISTED_MANIFESTS = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'tsconfig.json', 'jsconfig.json',
  'vite.config.js', 'vite.config.ts', 'vite.config.mjs',
  'next.config.js', 'next.config.mjs', 'next.config.ts',
  'nuxt.config.js', 'nuxt.config.ts',
  'pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
  'Cargo.toml', 'go.mod', 'go.sum',
  'README.md', 'README.rst', 'README',
  'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
  'composer.json', 'Gemfile',
]);

// Always skip — never let Claude see these even at the index level.
const DEFAULT_DENYLIST = new Set([
  'node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.svelte-kit',
  'dist', 'build', 'out', 'coverage', '.cache', '.parcel-cache',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.tox',
  'venv', '.venv', 'env', '.env', 'target', 'bin', 'obj',
  '.idea', '.vscode', '.DS_Store', '.gradle', '.terraform',
]);

/** Per-process cache: `${repoPath}|${revision}|${maxDepth}` → RepoIndex. */
const CACHE = new Map();

function gitRevParse(repoPath) {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', 'HEAD'], { cwd: repoPath, timeout: 5000 }, (err, stdout) => {
      if (err) resolve(null);
      else resolve(String(stdout || '').trim() || null);
    });
  });
}

async function treeMtime(repoPath) {
  try {
    const stat = await fs.stat(repoPath);
    return stat.mtimeMs;
  } catch (_) {
    return 0;
  }
}

async function readManifests(repoPath, entries) {
  const manifests = [];
  for (const e of entries) {
    if (e.type !== 'file') continue;
    if (ALLOWLISTED_MANIFESTS.has(e.name)) {
      manifests.push(e.path);
    }
  }
  // Also probe a handful of well-known root-level files even if not in entries
  for (const candidate of ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'README.md']) {
    const p = path.join(repoPath, candidate);
    try {
      const s = await fs.stat(p);
      if (s.isFile() && !manifests.includes(candidate)) manifests.push(candidate);
    } catch (_) { /* missing */ }
  }
  return manifests;
}

async function walkDir(absRoot, relRoot, currentDepth, maxDepth, out) {
  if (out.length >= MAX_INDEX_ENTRIES) return;
  let dirents;
  try {
    dirents = await fs.readdir(absRoot, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const d of dirents) {
    if (out.length >= MAX_INDEX_ENTRIES) return;
    if (d.name.startsWith('.') && d.name !== '.github') continue;
    if (DEFAULT_DENYLIST.has(d.name)) continue;
    const childRel = relRoot ? `${relRoot}/${d.name}` : d.name;
    if (d.isDirectory()) {
      out.push({ type: 'dir', path: childRel, name: d.name });
      if (currentDepth < maxDepth) {
        await walkDir(path.join(absRoot, d.name), childRel, currentDepth + 1, maxDepth, out);
      }
    } else if (d.isFile()) {
      out.push({ type: 'file', path: childRel, name: d.name });
    }
  }
}

/**
 * Build a shallow directory index for a repository path.
 * @param {string} repoPath absolute path to the working tree
 * @param {{ maxDepth?: number, sessionId?: string, projectId?: string }} [opts]
 * @returns {Promise<RepoIndex>}
 */
async function buildRepoIndex(repoPath, opts = {}) {
  if (!repoPath) {
    return { root: null, entries: [], manifests: [], revision: null, maxDepth: 0, builtAt: 0 };
  }
  const maxDepth = Number.isFinite(opts.maxDepth) ? Math.max(1, Math.min(4, opts.maxDepth)) : DEFAULT_MAX_DEPTH;
  const [revision, mtime] = await Promise.all([gitRevParse(repoPath), treeMtime(repoPath)]);
  const cacheKey = `${repoPath}|${revision || 'no-rev'}|${mtime || 0}|${maxDepth}`;
  const cached = CACHE.get(cacheKey);
  if (cached) return cached;

  const entries = [];
  await walkDir(repoPath, '', 1, maxDepth, entries);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifests = await readManifests(repoPath, entries);
  const index = {
    root: repoPath,
    entries,
    manifests,
    revision,
    mtime,
    maxDepth,
    builtAt: Date.now(),
  };
  CACHE.set(cacheKey, index);
  // Bound cache size
  if (CACHE.size > 64) {
    const firstKey = CACHE.keys().next().value;
    CACHE.delete(firstKey);
  }
  return index;
}

function clearCache() {
  CACHE.clear();
}

module.exports = {
  buildRepoIndex,
  clearCache,
  DEFAULT_DENYLIST,
  ALLOWLISTED_MANIFESTS,
  MAX_INDEX_ENTRIES,
};
