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
// Production code MUST NOT import this module. The single import lives inside
// releaseManager.js, guarded by `if (process.env.TEST_FINAL_GATE === 'true')`.

function fakeArtifact({ agentName, artifactName, artifactPath }) {
  return {
    agentName,
    artifactName,
    artifactPath,
    status: 'completed',
    versionStatus: 'committed',
    contentText: `# ${artifactName}\n\n(test fixture for Final Gate — ${agentName})`,
    contentJson: { agent: agentName, artifact: artifactName, testFixture: true },
    ordinal: 0,
    sourceArtifactId: null,
    contentHash: `test-${agentName}-${artifactName}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function getFakeFinalReviewPacket(sessionId /*, user */) {
  const now = new Date().toISOString();
  const fakeTaskId = (suffix) => `test-task-${suffix}`;

  return {
    phases: {
      architecture: { taskId: fakeTaskId('arch'), status: 'completed', versionStatus: 'committed' },
      po:           { taskId: fakeTaskId('po'),   status: 'completed', versionStatus: 'committed' },
      ux:           { taskId: fakeTaskId('ux'),   status: 'completed', versionStatus: 'committed' },
      dev:          { taskId: fakeTaskId('dev'),  status: 'completed', versionStatus: 'committed' },
      qa:           { taskId: fakeTaskId('qa'),   status: 'completed', versionStatus: 'committed' },
    },
    artifacts: [
      fakeArtifact({ agentName: 'po-agent',            artifactName: 'BRD',           artifactPath: '.aifa/po.md' }),
      fakeArtifact({ agentName: 'architecture-agent',  artifactName: 'Architecture',  artifactPath: '.aifa/architecture.md' }),
      fakeArtifact({ agentName: 'ux-agent',            artifactName: 'UX Spec',       artifactPath: '.aifa/ux.md' }),
      fakeArtifact({ agentName: 'dev-agent',           artifactName: 'Backend',       artifactPath: '.aifa/backend.md' }),
      fakeArtifact({ agentName: 'dev-agent',           artifactName: 'Frontend',      artifactPath: '.aifa/frontend.md' }),
      fakeArtifact({ agentName: 'qa-agent',            artifactName: 'qa-report',     artifactPath: '.aifa/qa-report.json' }),
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

async function getFakeRepoContext(projectId, sessionId) {
  return {
    projectId,
    sessionId,
    repoPath: null,
    workingBranch: 'test/final-gate',
    baseBranch: 'main',
    _testFixture: true,
  };
}

module.exports = {
  getFakeFinalReviewPacket,
  getFakeAuditTrail,
  getFakeRepoContext,
};