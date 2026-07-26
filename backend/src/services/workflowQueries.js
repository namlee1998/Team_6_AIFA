// ── Read-only query methods extracted from SdlcWorkflowService ───────────────
// These methods are self-contained (no `this._xxx` calls) and can be used as
// standalone functions or delegated to from the class.

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Task, AgentArtifact, HitlDecision, AgentEvent, PipelineSession } = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const repoService = require('./repoService');
const {
  FINAL_GATE,
  AGENT_POLICY,
  MAX_RETRY_PER_STEP,
  AGENT_GATES,
  NEXT_AGENT,
} = require('./sdlcConstants');

// Bypass auth — all roles permitted.
const MembershipService = {
  requireProjectRole: async () => ({ role: 'owner' }),
};

// ---------------------------------------------------------------------------
// Free helper functions (shared with SdlcWorkflowService)
// ---------------------------------------------------------------------------

/** SHA-256 content hash */
function contentHash(value) {
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

/** Build task result from artifacts for client consumption */
function buildTaskResult(task, artifacts = []) {
  const byType = {};
  for (const art of artifacts) {
    const artifactType = art.artifactType || art.type;
    if (!byType[artifactType]) byType[artifactType] = [];
    byType[artifactType].push(art);
  }

  return {
    agentType: task.type,
    artifacts: artifacts.map((a) => ({
      id: a.id,
      phase: a.phase || a.agentType,
      type: a.type || a.artifactType,
      key: a.key || a.artifactKey,
      title: a.title,
      contentText: a.contentText,
      contentJson: a.contentJson,
    })),
    ...task.result,
  };
}

async function resolveArtifactContent(artifact) {
  let contentText = artifact.contentText;
  let contentJson = artifact.contentJson;

  if (typeof contentText === 'string' && contentText.startsWith('FILE:')) {
    try {
      contentText = await fs.readFile(contentText.slice(5), 'utf8');
    } catch (_) {
      contentText = 'File not found';
    }
  }

  if (!contentText && contentJson?.file_path) {
    try {
      const raw = await fs.readFile(contentJson.file_path, 'utf8');
      try {
        contentJson = JSON.parse(raw);
      } catch (_) {
        contentText = raw;
        contentJson = null;
      }
    } catch (_) {
      contentText = 'File not found';
    }
  }

  return { contentText, contentJson };
}

async function formatArtifactForClient(artifact) {
  const { contentText, contentJson } = await resolveArtifactContent(artifact);
  return {
    id: artifact.id,
    taskId: artifact.taskId,
    projectId: artifact.projectId,
    phase: artifact.agentType,
    agentType: artifact.agentType,
    type: artifact.artifactType,
    artifactType: artifact.artifactType,
    key: artifact.artifactKey,
    artifactKey: artifact.artifactKey,
    title: artifact.title,
    contentText,
    contentJson,
    ordinal: artifact.ordinal,
    sourceArtifactId: artifact.sourceArtifactId,
    contentHash: artifact.contentHash,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Query methods
// ---------------------------------------------------------------------------

async function getFinalReviewPacket(sessionId, user) {
  const session = await PipelineSession.findById(sessionId);
  if (!session) throw new ApiError(404, 'Session not found');
  const projectId = session.projectId;
  if (user) {
    await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer']);
  }

  const poTask = await Task.findLatestBySession(sessionId, 'po-agent', 'completed', 'committed');
  const architectureTask = poTask?.sourceRunId ? await Task.findById(poTask.sourceRunId) : null;
  const [uxTask, devTask, qaTask] = await Promise.all([
    Task.findLatestBySession(sessionId, 'ux-agent', 'completed', 'committed'),
    Task.findLatestBySession(sessionId, 'dev-agent', 'completed', 'committed'),
    Task.findLatestBySession(sessionId, 'qa-agent', 'completed'),
  ]);

  const allArtifacts = (
    await Promise.all([
      architectureTask ? AgentArtifact.findByTaskId(architectureTask.id) : Promise.resolve([]),
      poTask ? AgentArtifact.findByTaskId(poTask.id) : Promise.resolve([]),
      uxTask ? AgentArtifact.findByTaskId(uxTask.id) : Promise.resolve([]),
      devTask ? AgentArtifact.findByTaskId(devTask.id) : Promise.resolve([]),
      qaTask ? AgentArtifact.findByTaskId(qaTask.id) : Promise.resolve([]),
    ])
  ).flat();

  const sessionTaskIds = new Set((await Task.findBySessionId(sessionId)).map((t) => t.id));
  const hitlDecisions = (await HitlDecision.findByProjectId(projectId)).filter((d) => sessionTaskIds.has(d.taskId));

  return {
    phases: {
      architecture: architectureTask ? { taskId: architectureTask.id, status: architectureTask.status, versionStatus: architectureTask.versionStatus } : null,
      po: poTask ? { taskId: poTask.id, status: poTask.status, versionStatus: poTask.versionStatus } : null,
      ux: uxTask ? { taskId: uxTask.id, status: uxTask.status, versionStatus: uxTask.versionStatus } : null,
      dev: devTask ? { taskId: devTask.id, status: devTask.status, versionStatus: devTask.versionStatus } : null,
      qa: qaTask ? { taskId: qaTask.id, status: qaTask.status, versionStatus: qaTask.versionStatus } : null,
    },
    artifacts: await Promise.all(allArtifacts.map((a) => formatArtifactForClient(a))),
    hitlDecisions,
    generatedAt: new Date().toISOString(),
  };
}

async function getWorkflowMetrics(projectId, user) {
  if (user) {
    await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer']);
  }

  const [tasks, hitlDecisions] = await Promise.all([
    Task.findByProjectId(projectId),
    HitlDecision.findByProjectId(projectId),
  ]);
  const sdlcTasks = tasks.filter((t) => ['architecture-agent', 'po-agent', 'ux-agent', 'dev-agent', 'qa-agent'].includes(t.type));
  const taskById = Object.fromEntries(sdlcTasks.map((t) => [t.id, t]));
  const gateDecisions = hitlDecisions.filter((d) => d.gate !== FINAL_GATE);

  const startTs = sdlcTasks.length ? Math.min(...sdlcTasks.map((t) => new Date(t.createdAt).getTime())) : null;
  const releaseDecision = [...hitlDecisions].reverse().find((d) => d.gate === FINAL_GATE) || null;
  const endTs = releaseDecision
    ? new Date(releaseDecision.createdAt).getTime()
    : (sdlcTasks.length ? Math.max(...sdlcTasks.map((t) => new Date(t.updatedAt).getTime())) : null);
  const cycleTimeSeconds = startTs && endTs ? Math.max(0, Math.round((endTs - startTs) / 1000)) : null;

  const timePerAgent = {};
  for (const stage of ['po-agent', 'ux-agent', 'dev-agent', 'qa-agent']) {
    const runs = sdlcTasks.filter((t) => t.type === stage && t.status === 'completed');
    const durations = runs.map((t) => Math.max(0, (new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime()) / 1000));
    timePerAgent[stage] = {
      runs: runs.length,
      avg_seconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    };
  }

  const autoApprovals = gateDecisions.filter((d) => d.action === 'auto_approve').length;
  const humanApprovals = gateDecisions.filter((d) => d.decision === 'APPROVE' && d.action !== 'auto_approve').length;
  const rejections = gateDecisions.filter((d) => d.decision === 'REJECT' && d.action !== 'escalation_required').length;
  const escalations = gateDecisions.filter((d) => d.action === 'escalation_required').length;
  const totalApprovals = autoApprovals + humanApprovals;
  const totalDecisions = totalApprovals + rejections + escalations;
  const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

  const rerunCountPerStage = {};
  const gateFailureReasons = {};
  for (const d of gateDecisions) {
    if (d.decision === 'REJECT' || d.action === 'escalation_required') {
      const stage = taskById[d.taskId]?.type || 'unknown';
      rerunCountPerStage[stage] = (rerunCountPerStage[stage] || 0) + 1;
      const reason = d.retryReason || 'other';
      gateFailureReasons[reason] = (gateFailureReasons[reason] || 0) + 1;
    }
  }

  const rejectedTaskIds = new Set(gateDecisions.filter((d) => d.decision === 'REJECT').map((d) => d.taskId));
  const falseAutoApprovals = gateDecisions.filter((d) => d.action === 'auto_approve' && rejectedTaskIds.has(d.taskId)).length;

  const devTask = await Task.findLatestByProject(projectId, 'dev-agent', 'completed', 'committed');
  const qaTask = await Task.findLatestByProject(projectId, 'qa-agent', 'completed');
  const buildResult = devTask?.approvedOutput?.build_result || devTask?.agentOutput?.build_result || null;
  const qaOutput = qaTask?.approvedOutput || qaTask?.agentOutput || {};
  const deadLetterTasks = sdlcTasks.filter((t) => (t.retryCount || 0) > MAX_RETRY_PER_STEP).length + escalations;

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    cycle_time_seconds: cycleTimeSeconds,
    time_per_agent: timePerAgent,
    auto_approval_rate: pct(autoApprovals, totalApprovals),
    human_rejection_rate: pct(rejections, totalDecisions),
    rerun_count_per_stage: rerunCountPerStage,
    gate_failure_reason_distribution: gateFailureReasons,
    build_pass: buildResult ? (buildResult.build_ok !== false && buildResult.tests_ran === true) : null,
    qa_gate: qaTask?.result?.gateRecommendation || null,
    requirement_coverage_percentage: qaOutput.coverage_summary?.percentage ?? null,
    false_auto_approval_rate: pct(falseAutoApprovals, autoApprovals),
    dead_letter_count: deadLetterTasks,
    counts: {
      total_runs: sdlcTasks.length,
      auto_approvals: autoApprovals,
      human_approvals: humanApprovals,
      rejections,
      escalations,
      total_decisions: totalDecisions,
    },
    agent_policy: AGENT_POLICY,
  };
}

async function getProjectTasks(projectId, user) {
  if (user) {
    await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer']);
  }
  return Task.findByProjectId(projectId);
}

async function getProjectHealth() {
  const prisma = require('../config/database');
  let dbStatus = 'ok';
  let dbError = null;
  let projectCount = 0;

  try {
    projectCount = await prisma.project.count();
  } catch (err) {
    dbStatus = 'error';
    dbError = err.message;
  }

  const envKeys = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    DEEPSEEK_API_KEY: !!process.env.DEEPSEEK_API_KEY,
    GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY,
    DATABASE_URL: !!process.env.DATABASE_URL,
    AUTO_APPROVE_TOOLS: process.env.AUTO_APPROVE_TOOLS === 'true',
  };

  return {
    db: {
      status: dbStatus,
      error: dbError,
      projectCount,
    },
    env: envKeys,
    timestamp: new Date().toISOString(),
  };
}

async function getProjectArtifacts(projectId, user) {
  if (user) {
    await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer']);
  }
  const artifacts = await AgentArtifact.findByProjectId(projectId);
  return {
    projectId,
    artifacts: await Promise.all(artifacts.map((artifact) => formatArtifactForClient(artifact))),
  };
}

async function listSessions(projectId, user) {
  if (user) {
    await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer']);
  }
  const sessions = await PipelineSession.findByProjectId(projectId);
  return sessions.map((s) => ({
    sessionId: s.id,
    projectId: s.projectId,
    title: s.title,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
}

async function getReleaseFile(sessionId, fileName, user) {
  const session = await PipelineSession.findById(sessionId);
  if (!session) throw new ApiError(404, 'Session not found');
  if (user) {
    await MembershipService.requireProjectRole(user.id, session.projectId, ['owner', 'admin', 'editor', 'viewer']);
  }
  if (!['final.md', 'qa-report.md'].includes(fileName)) {
    throw new ApiError(400, 'Only final.md and qa-report.md can be downloaded');
  }
  if (!session.outputDir) throw new ApiError(404, `${fileName} has not been generated yet`);
  const filePath = path.join(session.outputDir, fileName);
  if (!repoService.isWithinRepo(session.outputDir, fileName)) {
    throw new ApiError(400, 'Invalid release file path');
  }
  try {
    await fs.access(filePath);
  } catch (_) {
    throw new ApiError(404, `${fileName} has not been generated yet`);
  }
  return filePath;
}

async function getTaskEvents(taskId, { afterSequence = null, limit = 200 } = {}, user) {
  // ACCEPTANCE.md M4: auth is bypassed (CLAUDE.md §4). The
  // MembershipService stub remains for the other six call sites in this
  // file; do NOT reintroduce a requireProjectRole check here.
  void user;
  const task = await Task.findById(taskId);
  if (!task) throw new ApiError(404, 'Task not found');
  return AgentEvent.list({
    taskId,
    afterSequence: Number.isFinite(Number(afterSequence)) ? Number(afterSequence) : null,
    limit: Number(limit) || 200,
  });
}

module.exports = {
  // helper functions
  contentHash,
  buildTaskResult,
  resolveArtifactContent,
  formatArtifactForClient,

  // query methods
  getFinalReviewPacket,
  getWorkflowMetrics,
  getProjectTasks,
  getProjectHealth,
  getProjectArtifacts,
  listSessions,
  getReleaseFile,
  getTaskEvents,
};
