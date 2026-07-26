jest.mock('../../src/services/repoService', () => ({
  WORKSPACE_DIR: require('os').tmpdir(),
  commitAndDiff: jest.fn(),
  // T8 — the bundle writer needs repoPathFor to resolve the output dir.
  // Tests that exercise writeReleaseBundle will inject their own
  // repoContext OR rely on this fallback (which writes into tmpdir).
  repoPathFor: (projectId) => require('path').join(require('os').tmpdir(), projectId, 'repo'),
  slugify: (text) => String(text || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
}));
jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
}));

const { buildFinalMarkdown } = require('../../src/services/workflowReport');
const { writeReleaseBundle } = require('../../src/services/workflowReport');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

describe('workflowReport', () => {
  test('includes the required real-agent artifact contract in final.md', () => {
    const artifact = (phase, type, contentJson) => ({
      phase,
      type,
      contentJson,
    });
    const packet = {
      artifacts: [
        artifact('po-agent', 'prd', { title: 'Google login' }),
        artifact('po-agent', 'acceptance_criteria', ['User can sign in']),
        artifact('ux-agent', 'ux_spec', { screens: ['Login'] }),
        artifact('dev-agent', 'patch_diff', 'diff --git a/login.js b/login.js'),
        artifact('qa-agent', 'build_result', { build_ok: true }),
        artifact('qa-agent', 'self_test_report', { passed: 4 }),
        artifact('qa-agent', 'test_run_report', { total: 4, failed: 0 }),
        artifact('qa-agent', 'ac_coverage_matrix', [{ ac: 'AC-1', status: 'PASS' }]),
      ],
    };

    const markdown = buildFinalMarkdown({
      projectId: 'project-1',
      packet,
      audit: { events: [] },
      evidence: {},
      releaseDecision: { decision: 'APPROVE' },
      diff: '',
    });

    // T8 (B9) — spec §13 renames the agent sections; updated to match.
    expect(markdown).toContain('## PO Output (product-spec.md)');
    expect(markdown).toContain('### acceptance criteria');
    expect(markdown).toContain('## DEV Output (diff + file list)');
    expect(markdown).toContain('## QA Output (qa-report.md)');
    expect(markdown).toContain('### test run report');
    expect(markdown).toContain('### ac coverage matrix');
    expect(markdown).toContain('diff --git a/login.js b/login.js');
  });

  // T8 (B9) — verify all 10 spec §13 sections are rendered, in order,
  // even when some data is missing (graceful _none_ fallback).
  test('renders all 10 spec §13 sections unconditionally', () => {
    const packet = { artifacts: [], hitlDecisions: [] };
    const audit = {
      events: [
        { timestamp: '2026-07-01T00:00:00Z', action: 'agent_start', actor: 'ARCH' },
        { timestamp: '2026-07-01T00:00:30Z', action: 'agent_complete', actor: 'ARCH' },
      ],
    };
    const md = buildFinalMarkdown({
      projectId: 'p-empty',
      session: { id: 's1', status: 'completed' },
      repoContext: { repoUrl: 'https://x/y', baseBranch: 'main', workingBranch: 'aifa/x', commitHash: 'abcdef1234567' },
      packet,
      audit,
      evidence: { feature: 'Add Google login' },
      releaseDecision: { decision: 'APPROVE', createdAt: '2026-07-01T00:01:00Z' },
      diff: 'commit abc\ndiff --git a/foo b/foo',
    });
    const expectedSections = [
      '## Repository',
      '## Feature Request',
      '## ARCH Output (architecture.md)',
      '## PO Output (product-spec.md)',
      '## UX Output (ux-design.md)',
      '## DEV Output (diff + file list)',
      '## QA Output (qa-report.md)',
      '## Audit Trail',
      '## Human Decisions',
      '## Pipeline Summary',
    ];
    let cursor = 0;
    for (const sec of expectedSections) {
      const idx = md.indexOf(sec, cursor);
      expect(idx).toBeGreaterThanOrEqual(0);
      cursor = idx + sec.length;
    }
    // Spot-check Repository block contents.
    expect(md).toContain('https://x/y');
    expect(md).toContain('aifa/x');
    expect(md).toContain('abcdef1'); // short SHA
    // Feature Request renders as plain text, not JSON.
    expect(md).toContain('Add Google login');
    // Pipeline Summary line items.
    expect(md).toContain('Wall-clock duration: 60s');
    expect(md).toContain('Final status: **completed**');
  });

  test('writes final.md and qa-report.md when no repo clone is available', async () => {
    const projectId = `workflow-report-${Date.now()}`;
    const packet = {
      artifacts: [
        {
          phase: 'qa-agent',
          type: 'test_run_report',
          contentJson: { total: 1, failed: 0 },
        },
      ],
    };

    const bundle = await writeReleaseBundle({
      projectId,
      session: { id: 's-test', title: 'release test' },
      repoContext: null,
      packet,
      audit: { events: [] },
      evidence: {},
      releaseDecision: { decision: 'APPROVE' },
    });

    // Bundle path is `<tmpdir>/<project>/repo/sessions/release-test-<shortId>/`.
    expect(bundle.outputDir.startsWith(path.join(os.tmpdir(), projectId, 'repo', 'sessions'))).toBe(true);
    expect(bundle.finalMdPath.endsWith('final.md')).toBe(true);
    await expect(fs.readFile(bundle.finalMdPath, 'utf8')).resolves.toContain('AIFA Release Report');
    await expect(fs.readFile(path.join(bundle.outputDir, 'qa-report.md'), 'utf8'))
      .resolves.toContain('test run report');
    await fs.rm(path.join(os.tmpdir(), projectId), { recursive: true, force: true });
  });
});
