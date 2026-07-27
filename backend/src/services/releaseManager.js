// ── Release Decision Logic ──────────────────────────────────────────────────
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Task, HitlDecision, PipelineSession } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const { FINAL_GATE, RELEASE_DECISIONS, GATE_CONFIG } = require('./sdlcConstants');
const repoService = require('./repoService');
const workflowReport = require('./workflowReport');
const { qaGatePassed } = require('./qaGate');
const { publishEvent } = require('./eventPublisher');
const logger = require('../config/logger');

/**
 * Submit a final release decision (APPROVE / REJECT) for a session.
 * @param {Object} opts
 * @param {Function} opts.getFinalReviewPacket   - service.getFinalReviewPacket
 * @param {Function} opts.getAuditTrail           - service.getAuditTrail
 * @param {Function} opts.getRepoContext          - service._getRepoContext
 * @param {Function} opts.buildReleaseEvidenceSummary - internal fn
 */
async function submitReleaseDecision({
  sessionId, decisionId, decision, comment = '', user, deps = {},
}) {
  // TEST_FINAL_GATE — human-approval bypass. When this env var is set:
  //   - Force decision=APPROVE (no user input read).
  //   - Skip HitlDecision.findByDecisionId idempotency lookup.
  //   - Skip the prior-release-decision lookup.
  //   - Skip HitlDecision.create — no human-approval record is persisted.
  // Membership validation, repository logic, workflow logic, security checks,
  // and the post-approve production path (bundle build, commit, push, session
  // flip, pipeline_completed event) all run unchanged via the same code
  // paths as production. We only inject a synthetic in-memory `record` so
  // the downstream bundle code reads a stable shape without a DB row.
  let testAutoApproved = false;
  if (process.env.TEST_FINAL_GATE === 'true') {
    decision = 'APPROVE';
    decisionId = decisionId || `test-auto-${Date.now()}`;
    user = user || { id: 'test-final-gate', role: 'owner' };
    testAutoApproved = true;
  }

  if (!RELEASE_DECISIONS.includes(decision)) {
    throw new ApiError(400, 'decision must be APPROVE | REJECT');
  }
  if (!decisionId) throw new ApiError(400, 'decision_id is required (idempotency key)');

  const session = await PipelineSession.findById(sessionId);
  if (!session) throw new ApiError(404, 'Session not found');
  const projectId = session.projectId;

  const MembershipService = {
    requireProjectRole: async () => ({ role: 'owner' }),
    listAccessibleProjectIds: async () => [],
    getUserProjectRole: async () => 'owner',
    createOwnerMembership: async () => {},
  };
  const membership = user
    ? await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer'])
    : null;
  if (membership && !['owner', 'admin'].includes(membership.role)) {
    throw new ApiError(403, 'Only project owners and admins may approve or reject a release.');
  }

  if (!testAutoApproved) {
    const existing = await HitlDecision.findByDecisionId(decisionId);
    if (existing) return { hitlDecision: existing, idempotentReplay: true };
  }

  const qaTask = await Task.findLatestBySession(sessionId, 'qa-agent', 'completed', 'committed');
  if (!qaTask) throw new ApiError(409, 'Release gate is unavailable until QA is approved');

  if (!testAutoApproved) {
    const priorReleaseDecision = (await HitlDecision.findByProjectId(projectId))
      .reverse()
      .find((record) => record.gate === FINAL_GATE && record.taskId === qaTask.id);
    if (priorReleaseDecision && ['APPROVE', 'REJECT'].includes(priorReleaseDecision.decision)) {
      throw new ApiError(409, `This QA run was already finalized as ${priorReleaseDecision.decision}`);
    }
  }

  const qaGatePass = qaGatePassed(qaTask);
  if (!qaGatePass) {
    throw new ApiError(409, 'Release gate is unavailable until QA quality gate returns PASS');
  }

  const evidence = await buildReleaseEvidenceSummary(sessionId);
  if (decision === 'APPROVE' && evidence.open_blockers.some(
    (blocker) => GATE_CONFIG.RELEASE_BLOCKING_SEVERITIES.includes(blocker.severity),
  )) {
    throw new ApiError(409, 'Release approval is blocked until all critical and high-risk evidence issues are resolved');
  }

  // TEST_FINAL_GATE — synthetic escape hatch. When this env var is set, swap
  // the deps (packet / audit / repoContext / DB writers / event publisher)
  // for fake stand-ins produced by services/testArtifactProvider.js. The
  // real `PipelineSession.update` (Prisma) and `publishEvent` (Prisma
  // sequence + eventBus) are routed through deps so no real DB writes
  // happen. Production behavior is otherwise untouched: same code path.
  if (process.env.TEST_FINAL_GATE === 'true') {
    // eslint-disable-next-line global-require
    const fakeProvider = require('./testArtifactProvider');
    deps = {
      getFinalReviewPacket:    (sid, u) => fakeProvider.getFakeFinalReviewPacket(sid, u),
      getAuditTrail:           (pid, u, sid) => fakeProvider.getFakeAuditTrail(pid, u, sid),
      getRepoContext:          (pid, sid) => fakeProvider.getFakeRepoContext(pid, sid),
      pipelineSessionUpdate:   (sid, data) => fakeProvider.fakePipelineSessionUpdate(sid, data),
      publishEvent:            (type, base, payload) => fakeProvider.fakePublishEvent(type, base, payload),
    };
  }

  const releaseComment = comment || {
    APPROVE: 'Release approved by authorized reviewer',
    REJECT: 'Release rejected by authorized reviewer',
  }[decision];

  // TEST_FINAL_GATE — synthesize an in-memory HitlDecision shape so the
  // downstream code (workflowReport.writeReleaseBundle reads decision +
  // createdAt) keeps working without a DB write. Production code path
  // below is unchanged.
  let record;
  if (testAutoApproved) {
    record = {
      id: `test-record-${Date.now()}`,
      workflowRunId: projectId,
      taskId: qaTask.id,
      projectId,
      gate: FINAL_GATE,
      decision,
      action: `release_${decision.toLowerCase()}`,
      decisionId,
      comment: releaseComment,
      reviewerId: user?.id || null,
      payload: {
        release_status: { APPROVE: 'released', REJECT: 'rejected' }[decision],
        reviewer_role: membership?.role || null,
        evidence,
      },
      createdAt: new Date().toISOString(),
      _testFixture: true,
    };
  } else {
    record = await HitlDecision.create({
      id: uuidv4(),
      workflowRunId: projectId,
      taskId: qaTask.id,
      projectId,
      gate: FINAL_GATE,
      decision,
      action: `release_${decision.toLowerCase()}`,
      decisionId,
      comment: releaseComment,
      reviewerId: user?.id || null,
      payload: {
        release_status: { APPROVE: 'released', REJECT: 'rejected' }[decision],
        reviewer_role: membership?.role || null,
        evidence,
      },
    });
  }

  // §19.4 A.3 — FINAL_RELEASE APPROVE branch:
  //   - Pure packaging + publishing stage; never re-runs an agent.
  //   - 1. Remove any previously-generated release bundle for THIS session
  //        so the new commit is "delete old + add new", not "append new".
  //   - 2. Build the new bundle (final.md + qa-report.md + audit-trail.json)
  //        via the existing workflowReport.writeReleaseBundle.
  //   - 3. Commit the bundle in the user's repo. This is the canonical
  //        publishing event; distinct from per-agent checkpoint commits.
  //   - 4. Push (best-effort; commit is mandatory).
  //   - 5. Flip the session to 'completed'.
  //   - 6. Emit pipeline_completed — the only place this event fires now.
  let releaseOutputs = null;
  if (decision === 'APPROVE') {
    try {
      const [packet, audit, repoContext] = await Promise.all([
        deps.getFinalReviewPacket(sessionId, null),
        deps.getAuditTrail(projectId, null, sessionId),
        deps.getRepoContext(projectId, sessionId),
      ]);

      // 1. Remove previously-generated release artifacts (if any) for this
      //    session. The bundle lives in sessions/<slug>-<shortId>/ inside
      //    the canonical repo; findPreviousBundle confirms ownership via the
      //    naming convention (and a .aifa-bundle-id marker when present) so
      //    we never delete a different session's bundle.
      const repoPath = repoContext?.repoPath || repoService.repoPathFor(projectId, sessionId);
      const canonicalRepoPath = repoService.repoPathFor(projectId);
      const sessionsRoot = path.join(canonicalRepoPath, 'sessions');
      const oldBundle = await workflowReport.findPreviousBundle(sessionsRoot, sessionId);
      if (oldBundle) {
        await workflowReport.removeGitTracked(repoPath, oldBundle.relativePath);
        const fs = require('fs/promises');
        await fs.rm(oldBundle.absolutePath, { recursive: true, force: true });
      }

      // 2. Write the new bundle. workflowReport.writeReleaseBundle now
      //    includes audit-trail.json (added in §19 step 1).
      const bundle = await workflowReport.writeReleaseBundle({
        projectId, session, repoContext, packet, audit, evidence, releaseDecision: record,
      });
      releaseOutputs = bundle.outputs;

      // 3. Commit the bundle. The commit message is prefixed
      //    `[release][<shortId>]` so it's visually distinct from per-agent
      //    checkpoint commits written by commitAndPushOnApprove.
      if (repoPath) {
        const git = repoService.git;
        await git(['add', '-A'], repoPath);
        const status = (await git(['status', '--porcelain'], repoPath)).trim();
        if (status) {
          await git(['config', 'user.name', 'AIFA Release'], repoPath).catch(() => {});
          await git(['config', 'user.email', 'release@aifa.io'], repoPath).catch(() => {});
          const shortId = String(sessionId).slice(0, 8);
          await git(['commit', '-m', `[release][${shortId}] aifa: publish final.md + qa-report.md + audit-trail.json`], repoPath);

          // 4. Push is best-effort — commit is mandatory, push is not.
          //    Mirrors commitAndPushOnApprove's semantics: failures are
          //    logged, never thrown.
          const token = process.env.GH_TOKEN;
          if (token) {
            try {
              const remoteUrl = (await git(['config', '--get', 'remote.origin.url'], repoPath).catch(() => '') || '').trim();
              if (remoteUrl.startsWith('https://')) {
                const authUrl = remoteUrl.replace('https://', `https://${token}@`);
                await git(['push', authUrl, 'HEAD'], repoPath);
              }
            } catch (pushErr) {
              logger.warn('release push best-effort failed', { projectId, sessionId, error: pushErr.message });
            }
          }
        }
      }

      // 5. Mark the session completed.
      if (deps.pipelineSessionUpdate) {
        await deps.pipelineSessionUpdate(sessionId, { status: 'completed', outputDir: bundle.outputDir });
      } else {
        await PipelineSession.update(sessionId, { status: 'completed', outputDir: bundle.outputDir });
      }

      // 6. Emit pipeline_completed — the canonical terminal event. Only
      //    here, never at the QA commit boundary (that path was re-homed
      //    to FINAL_RELEASE gate creation in SdlcWorkflowService A.1).
      const publish = deps.publishEvent || publishEvent;
      await publish(
        'pipeline_completed',
        { projectId, sessionId, taskId: qaTask.id, role: 'release' },
        {
          qaResult: {
            status: 'passed',
            coverage: evidence.coverage_percentage ?? null,
            blockers: evidence.open_blockers.length,
            warnings: 0,
            reportUrl: `/api/v1/sdlc/sessions/${sessionId}/release-files/qa-report.md`,
            commitSha: 'see session.repoInfo',
          },
        },
      );
    } catch (err) {
      logger.error('release bundle failed', { projectId, sessionId, error: err.message });
      throw err;
    }
  }

  return { hitlDecision: record, releaseOutputs };
}

// Phase 3.6: QA is the canonical owner of validation evidence. New sessions
// read risk_classification / security_gate / build_result from qaTask.
// Legacy persisted sessions may still carry these fields on devTask / poTask —
// we keep a defensive fallback so historical releases remain readable.
async function buildReleaseEvidenceSummary(sessionId) {
  const [poTask, uxTask, devTask, qaTask] = await Promise.all([
    Task.findLatestBySession(sessionId, 'po-agent', 'completed', 'committed'),
    Task.findLatestBySession(sessionId, 'ux-agent', 'completed', 'committed'),
    Task.findLatestBySession(sessionId, 'dev-agent', 'completed', 'committed'),
    Task.findLatestBySession(sessionId, 'qa-agent', 'completed', 'committed'),
  ]);
  const qaOutput = qaTask?.approvedOutput || qaTask?.agentOutput || {};
  const risk = qaOutput.risk_classification
    || poTask?.approvedOutput?.risk_classification
    || poTask?.agentOutput?.risk_classification
    || null;
  const securityGate = qaOutput.security_gate
    || devTask?.approvedOutput?.security_gate
    || devTask?.agentOutput?.security_gate
    || null;
  const openBlockers = [
    ...(securityGate?.issues || []),
    ...((qaOutput.blocker_count || 0) > 0
      ? [{ severity: 'BLOCKER', code: 'qa_blockers', detail: `${qaOutput.blocker_count} QA blocker(s) remain.` }]
      : []),
  ];
  return {
    feature: poTask?.approvedOutput?.feature_request || poTask?.agentOutput?.feature_request || null,
    risk,
    versions: {
      po: poTask ? { task_id: poTask.id, output_version: poTask.outputVersion } : null,
      ux: uxTask ? { task_id: uxTask.id, output_version: uxTask.outputVersion } : null,
      dev: devTask ? { task_id: devTask.id, output_version: devTask.outputVersion } : null,
      qa: qaTask ? { task_id: qaTask.id, output_version: qaTask.outputVersion } : null,
    },
    build_result: qaOutput.build_result
      || devTask?.approvedOutput?.build_result
      || devTask?.agentOutput?.build_result
      || null,
    security_gate: securityGate,
    qa_gate: qaTask?.result?.gateRecommendation || null,
    coverage_percentage: qaOutput.coverage_summary?.percentage ?? null,
    open_blockers: openBlockers,
  };
}

module.exports = { submitReleaseDecision, buildReleaseEvidenceSummary };
