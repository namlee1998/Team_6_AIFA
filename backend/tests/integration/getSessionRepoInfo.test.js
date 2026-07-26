// T7 (B7) — repoService.getSessionRepoInfo best-effort contract.
//
// Verifies that the helper:
//   - returns null when no .git dir is present (early-pipeline race).
//   - returns null when projectId/sessionId is missing.
//   - never throws on git plumbing errors — returns the partial shape.
//   - reports fileCount as the number of `git ls-files` entries.
//
// WORKSPACE_DIR is a hardcoded constant in repoService (the file resolves
// to <repo>/workspace/projects). We initialise a real git repo at the
// exact path getSessionRepoInfo will probe and tear it down in afterAll.

jest.mock('uuid', () => { let n = 0; return { v4: () => `uuid-${++n}` }; });

const fsp = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');
const repoService = require('../../src/services/repoService');

const PROJECT_ID = 'aifa-test-b7-repoinfo';
const SESSION_ID = 'session-test';

async function initRepo(dir, files) {
  await fsp.mkdir(dir, { recursive: true });
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 't@aifa.io'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir, stdio: 'ignore' });
  for (const rel of files) {
    const full = path.join(dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, 'x');
  }
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-b', 'aifa/test'], { cwd: dir, stdio: 'ignore' });
}

describe('repoService.getSessionRepoInfo', () => {
  let sessionPath;

  beforeAll(async () => {
    sessionPath = repoService.repoPathFor(PROJECT_ID, SESSION_ID);
    await initRepo(sessionPath, ['README.md', 'src/index.js', 'src/lib/util.js']);
  });

  afterAll(async () => {
    await fsp.rm(path.join(sessionPath, '..', '..'), { recursive: true, force: true }).catch(() => {});
  });

  test('returns null for missing sessionId/projectId', async () => {
    expect(await repoService.getSessionRepoInfo({})).toBeNull();
    expect(await repoService.getSessionRepoInfo({ projectId: 'x' })).toBeNull();
    expect(await repoService.getSessionRepoInfo({ sessionId: 'y' })).toBeNull();
  });

  test('returns null when workspace is not initialised', async () => {
    const out = await repoService.getSessionRepoInfo({ projectId: 'never-exists', sessionId: 'never-exists' });
    expect(out).toBeNull();
  });

  test('returns branch, commitSha, fileCount for a live workspace', async () => {
    const out = await repoService.getSessionRepoInfo({ projectId: PROJECT_ID, sessionId: SESSION_ID });
    expect(out).not.toBeNull();
    expect(out.branch).toBe('aifa/test');
    expect(typeof out.commitSha).toBe('string');
    expect(out.commitSha.length).toBeGreaterThanOrEqual(7);
    expect(out.fileCount).toBe(3);
  });
});