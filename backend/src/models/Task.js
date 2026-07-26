const prisma = require('../config/database');
const { publishEvent } = require('../services/eventPublisher');

function serializeJson(value, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || typeof value === 'string') return value;
  return JSON.stringify(value);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

class TaskModel {
  static async create(data) {
    // Allocate the canonical task_queued envelope BEFORE the transaction so
    // it carries the per-session sequence; the envelope is then persisted to
    // AgentEvent in the same transaction as the Task row.
    const envelope = data.sessionId
      ? await publishEvent(
        'task_started',
        { projectId: data.projectId, sessionId: data.sessionId, taskId: data.id, role: null },
        { stage: data.type, lifecycleType: 'task_queued' },
      )
      : null;
    const record = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          id: data.id,
          projectId: data.projectId,
          sessionId: data.sessionId || null,
          type: data.type,
          status: data.status || 'pending',
          promptProfile: data.promptProfile,
          result: serializeJson(data.result),
          error: data.error,
          inputContentHash: data.inputContentHash || null,
          outputContentHash: data.outputContentHash || null,
          sourceRunId: data.sourceRunId || null,
          versionStatus: data.versionStatus || 'draft',
          observability: serializeJson(data.observability, '{}'),
          gateMode: data.gateMode || null,
          executionStatus: data.executionStatus || 'queued',
          attempt: data.attempt || 0,
          maxAttempts: data.maxAttempts || 1,
        },
      });
      if (envelope) {
        await tx.agentEvent.create({
          data: {
            taskId: task.id,
            projectId: task.projectId,
            sessionId: envelope.sessionId,
            sequence: envelope.sequence,
            type: 'task_queued',
            actor: 'orchestrator',
            payload: JSON.stringify({ stage: task.type }),
            envelope: JSON.stringify(envelope),
          },
        });
      } else {
        // Pre-session-bound task (legacy tests only) — fall back to a
        // legacy AgentEvent row carrying no envelope and an arbitrary
        // sequence. The legacy replay fallback in SdlcController reads
        // these rows through the controller's legacy replay helper.
        await tx.agentEvent.create({
          data: {
            taskId: task.id,
            projectId: task.projectId,
            sessionId: null,
            sequence: 1,
            type: 'task_queued',
            actor: 'orchestrator',
            payload: JSON.stringify({ stage: task.type }),
          },
        });
      }
      return task;
    });
    return this._map(record);
  }

  static async findById(id) {
    const data = await prisma.task.findUnique({ where: { id } });
    return this._map(data);
  }

  static async findByIdWithDocument(id) {
    return this.findById(id);
  }

  static async update(id, data) {
    const mapped = {
      updatedAt: data.updated_at ? new Date(data.updated_at) : new Date(),
      status: data.status,
      result: data.result === undefined ? undefined : serializeJson(data.result),
      error: data.error,
      versionStatus: data.version_status || data.versionStatus,
      observability: data.observability === undefined ? undefined : serializeJson(data.observability),
      outputContentHash: data.output_content_hash || data.outputContentHash,
      sourceRunId: data.source_run_id || data.sourceRunId,
      // Structured HITL fields
      agentOutput: data.agentOutput === undefined ? undefined : serializeJson(data.agentOutput),
      approvedOutput: data.approvedOutput === undefined ? undefined : serializeJson(data.approvedOutput),
      outputVersion: data.outputVersion,
      retryCount: data.retryCount,
      lastRetryReason: data.lastRetryReason,
      gateMode: data.gateMode,
      executionStatus: data.executionStatus,
      attempt: data.attempt,
      maxAttempts: data.maxAttempts,
      lockedBy: data.lockedBy,
      lockedAt: data.lockedAt,
      heartbeatAt: data.heartbeatAt,
      startedAt: data.startedAt,
      finishedAt: data.finishedAt,
    };
    Object.keys(mapped).forEach(k => mapped[k] === undefined && delete mapped[k]);

    // Use updateMany so a missing row doesn't throw P2025 — the caller
    // typically races with cleanup paths and would otherwise blow up.
    const result = await prisma.task.updateMany({
      where: { id },
      data: mapped,
    });
    if (result.count === 0) return null;
    const record = await prisma.task.findUnique({ where: { id } });
    return this._map(record);
  }

  static async listByExecutionStatus(executionStatus) {
    const data = await prisma.task.findMany({
      where: { executionStatus },
      orderBy: { createdAt: 'asc' },
    });
    return (data || []).map(this._map);
  }

  static async findByProjectId(projectId) {
    const data = await prisma.task.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' }
    });
    return (data || []).map(this._map);
  }

  static async findBySessionId(sessionId) {
    const data = await prisma.task.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' }
    });
    return (data || []).map(this._map);
  }

  static async list(filters = {}) {
    const limit = Number.isFinite(filters.limit) ? filters.limit : 50;
    const take = Math.max(1, Math.min(limit, 200));

    const where = {};
    if (filters.type)      where.type = filters.type;
    if (filters.status)    where.status = filters.status;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.sinceDate) where.createdAt = { gte: new Date(filters.sinceDate) };

    const data = await prisma.task.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take
    });
    return (data || []).map(this._map);
  }

  static async deleteById(id) {
    await prisma.task.delete({ where: { id } });
  }

  static async findLatestByProject(projectId, type, status = null, versionStatus = null) {
    const where = { projectId };
    if (type) where.type = type;
    if (status) where.status = status;
    if (versionStatus) where.versionStatus = versionStatus;

    const data = await prisma.task.findFirst({
      where,
      // T5: deterministic tie-break (id) so two same-type tasks created in the
      // same millisecond (fast mock reruns) always resolve to the same "latest".
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    return this._map(data);
  }

  /** Same as findLatestByProject, scoped to one pipeline session instead of
   * the whole project — needed once a project can have several sessions
   * running concurrently. */
  static async findLatestBySession(sessionId, type, status = null, versionStatus = null) {
    const where = { sessionId };
    if (type) where.type = type;
    if (status) where.status = status;
    if (versionStatus) where.versionStatus = versionStatus;

    const data = await prisma.task.findFirst({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    return this._map(data);
  }

  static async commitTask(id) {
    const record = await prisma.task.update({
      where: { id },
      data: { versionStatus: 'committed' }
    });
    return this._map(record);
  }

  static _map(row) {
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      sessionId: row.sessionId || null,
      type: row.type,
      status: row.status,
      promptProfile: row.promptProfile,
      result: parseJson(row.result),
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      inputContentHash: row.inputContentHash || null,
      outputContentHash: row.outputContentHash || null,
      sourceRunId: row.sourceRunId || null,
      versionStatus: row.versionStatus || 'committed',
      observability: parseJson(row.observability, {}),
      agentOutput: parseJson(row.agentOutput, null),
      approvedOutput: parseJson(row.approvedOutput, null),
      outputVersion: row.outputVersion ?? 0,
      retryCount: row.retryCount ?? 0,
      lastRetryReason: row.lastRetryReason || null,
      gateMode: row.gateMode || null,
      executionStatus: row.executionStatus || 'queued',
      attempt: row.attempt ?? 0,
      maxAttempts: row.maxAttempts ?? 1,
      lockedBy: row.lockedBy || null,
      lockedAt: row.lockedAt || null,
      heartbeatAt: row.heartbeatAt || null,
      startedAt: row.startedAt || null,
      finishedAt: row.finishedAt || null,
    };
  }
}

module.exports = TaskModel;
