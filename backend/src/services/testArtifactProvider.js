// ── Test Artifact Provider (TEST_MODE only) ─────────────────────────────────
//
// This module exists solely to support TEST_FINAL_GATE=true. When that env var
// is set, releaseManager.js swaps its artifact loader for this provider so the
// Final Gate can be exercised end-to-end without running the SDLC pipeline,
// agents, or hitting the database.
//
// It mirrors the subset of `getFinalReviewPacket()` (workflowQueries.js) that
// releaseManager actually consumes: phases, artifacts, hitlDecisions.
//
// The `phase`/`agentType` and `type`/`artifactType` fields on each artifact
// MUST match the values that `buildFinalMarkdown` (workflowReport.js) looks
// up at runtime. Those keys come straight from the production AgentArtifact
// model — see formatArtifactForClient in workflowQueries.js. We reuse the
// same naming here so the production `artifactText()`/`joinedArtifacts()`
// helpers find the fake records without modification.
//
// Production code MUST NOT import this module. The single import lives inside
// releaseManager.js, guarded by `if (process.env.TEST_FINAL_GATE === 'true')`.

function fakeArtifact({ phase, type, title, contentText, contentJson }) {
  return {
    phase,
    agentType: phase,
    type,
    artifactType: type,
    title,
    contentText,
    contentJson: contentJson ?? null,
    ordinal: 0,
    sourceArtifactId: null,
    contentHash: `test-${phase}-${type}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _testFixture: true,
  };
}

async function getFakeFinalReviewPacket(sessionId /*, user */) {
  const now = new Date().toISOString();
  const fakeTaskId = (suffix) => `test-task-${suffix}`;

  // Coverage for every key that buildFinalMarkdown looks up:
  //   §3 architecture_brief
  //   §4 prd, acceptance_criteria
  //   §5 ux_spec
  //   §6 patch_diff
  //   §7 qa_report, test_run_report, ac_coverage_matrix
  return {
    phases: {
      architecture: { taskId: fakeTaskId('arch'), status: 'completed', versionStatus: 'committed' },
      po:           { taskId: fakeTaskId('po'),   status: 'completed', versionStatus: 'committed' },
      ux:           { taskId: fakeTaskId('ux'),   status: 'completed', versionStatus: 'committed' },
      dev:          { taskId: fakeTaskId('dev'),  status: 'completed', versionStatus: 'committed' },
      qa:           { taskId: fakeTaskId('qa'),   status: 'completed', versionStatus: 'committed' },
    },
    artifacts: [
      fakeArtifact({
        phase: 'architecture-agent',
        type: 'architecture_brief',
        title: 'Architecture Brief',
        contentText: '# Architecture Brief\n\n(test fixture — architecture_agent)',
      }),
      fakeArtifact({
        phase: 'po-agent',
        type: 'prd',
        title: 'Product Requirements',
        contentText: '# PRD\n\n(test fixture — po_agent)',
      }),
      fakeArtifact({
        phase: 'po-agent',
        type: 'acceptance_criteria',
        title: 'Acceptance Criteria',
        contentText: '# Acceptance Criteria\n\n- AC-1: Login button visible\n- AC-2: Dialog opens with email + password',
      }),
      fakeArtifact({
        phase: 'ux-agent',
        type: 'ux_spec',
        title: 'UX Spec',
        contentText: '# UX Spec\n\nPrimary CTA in the top-right opens a modal with email + password inputs.',
      }),
      fakeArtifact({
        phase: 'dev-agent',
        type: 'patch_diff',
        title: 'Patch Diff',
        contentText: 'diff --git a/frontend/src/LoginButton.jsx b/frontend/src/LoginButton.jsx\n+export default function LoginButton() {\n+  return <button id="login-btn">Log in</button>;\n+}\n',
      }),
      fakeArtifact({
        phase: 'qa-agent',
        type: 'qa_report',
        title: 'QA Report',
        contentText: '# QA Report\n\n(test fixture — qa_agent)\nAll tests pass.',
      }),
      fakeArtifact({
        phase: 'qa-agent',
        type: 'test_run_report',
        title: 'Test Run Report',
        contentJson: { executed: true, total: 4, passed: 4, failed: 0 },
      }),
      fakeArtifact({
        phase: 'qa-agent',
        type: 'ac_coverage_matrix',
        title: 'AC Coverage Matrix',
        contentJson: [{ ac_id: 'AC-1', status: 'COVERED' }, { ac_id: 'AC-2', status: 'COVERED' }],
      }),
    ],
    hitlDecisions: [],
    generatedAt: now,
    _testFixture: { sessionId, mode: 'TEST_FINAL_GATE' },
  };
}

async function getFakeAuditTrail(projectId /*, user, sessionId */) {
  return {
    projectId,
    events: [
      {
        timestamp: new Date().toISOString(),
        action: 'test_final_gate_started',
        actor: 'testArtifactProvider',
        comment: 'TEST_FINAL_GATE=true — synthetic audit trail',
      },
    ],
  };
}

// Test target — production code reads `remote.origin.url` from the local
// repo's git config (releaseManager.js line 220) and pushes via that URL
// using GH_TOKEN. We configure the local fixture repo so production pushes
// to this exact target.
const TEST_TARGET_REMOTE = 'https://github.com/namlee1998/test';

async function bootstrapFixtureRepo(repoPath, baseBranch) {
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  fs.mkdirSync(repoPath, { recursive: true });
  // Idempotent: only init when no .git exists.
  if (!fs.existsSync(require('path').join(repoPath, '.git'))) {
    execFileSync('git', ['init', '-q', '-b', baseBranch], { cwd: repoPath });
    execFileSync('git', ['config', 'user.name', 'AIFA Test'], { cwd: repoPath });
    execFileSync('git', ['config', 'user.email', 'test@aifa.io'], { cwd: repoPath });
    execFileSync('git', ['config', 'remote.origin.url', TEST_TARGET_REMOTE], { cwd: repoPath });
    execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'aifa: test fixture init'], { cwd: repoPath });
  } else {
    // Re-stamp origin in case previous fixture run set a different target.
    try { execFileSync('git', ['config', 'remote.origin.url', TEST_TARGET_REMOTE], { cwd: repoPath }); } catch (_) {}
  }
}

async function getFakeRepoContext(projectId, sessionId) {
  // Mirror production path resolution: workspace/projects/<id>/sessions/<sid>/repo
  const path = require('path');
  const repoPath = path.join(
    path.resolve(__dirname, '../../..'),
    'workspace',
    'projects',
    projectId,
    'sessions',
    sessionId,
    'repo',
  );
  await bootstrapFixtureRepo(repoPath, 'main');

  return {
    projectId,
    sessionId,
    repoPath,
    workingBranch: 'test/final-gate',
    baseBranch: 'main',
    repoUrl: TEST_TARGET_REMOTE,
    _testFixture: true,
  };
}

module.exports = {
  getFakeFinalReviewPacket,
  getFakeAuditTrail,
  getFakeRepoContext,
};