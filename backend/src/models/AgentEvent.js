const prisma = require('../config/database');

function parseJson(value, fallback = {}) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

class AgentEventModel {
  /**
   * Persist a runtime event.
   *
   * Canonical only: caller MUST supply a `sequence` allocated by
   * sequenceService.next (the single allocator). Stores the FULL envelope
   * as JSON so replay is byte-for-byte identical to what was published.
   */
  static async create(args) {
    const { envelope, taskId, projectId, sessionId = null, type, actor = 'system', payload = {}, sequence } = args;

    if (!Number.isFinite(sequence)) {
      throw new Error('AgentEvent.create: sequence is required (allocated by sequenceService.next)');
    }

    const data = {
      taskId,
      projectId,
      sessionId: sessionId ?? null,
      sequence,
      type,
      actor,
      payload: JSON.stringify(payload || {}),
      envelope: envelope ? JSON.stringify(envelope) : null,
    };

    const row = await prisma.agentEvent.create({ data });
    return this._map(row);
  }

  /**
   * Read events. Two filters:
   *   - Per-task (legacy): { taskId, afterSequence, limit }
   *   - Per-session (canonical): { sessionId, afterSequence, limit }
   *
   * When `sessionId` is provided the row's stored envelope is preferred over
   * the bare payload so the wire format is identical to what was published
   * live.
   */
  static async list({ taskId = null, sessionId = null, projectId = null, afterSequence = null, limit = 200 } = {}) {
    const rows = await prisma.agentEvent.findMany({
      where: {
        ...(taskId ? { taskId } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(taskId && Number.isFinite(afterSequence) ? { sequence: { gt: afterSequence } } : {}),
        ...(sessionId && Number.isFinite(afterSequence) ? { sequence: { gt: afterSequence } } : {}),
      },
      orderBy: sessionId
        ? { sequence: 'asc' }
        : (taskId ? { sequence: 'asc' } : { createdAt: 'asc' }),
      take: Math.max(1, Math.min(Number(limit) || 200, 500)),
    });
    return rows.map((r) => this._map(r));
  }

  /** Highest persisted sequence for a session; 0 if none. */
  static async maxSequence({ sessionId, projectId = null }) {
    if (!sessionId) return 0;
    const row = await prisma.agentEvent.findFirst({
      where: { sessionId, ...(projectId ? { projectId } : {}) },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    return row?.sequence ?? 0;
  }

  static _map(row) {
    const envelope = parseJson(row.envelope, null);
    return {
      id: row.id,
      taskId: row.taskId,
      projectId: row.projectId,
      sessionId: row.sessionId ?? null,
      sequence: row.sequence,
      type: row.type,
      actor: row.actor,
      payload: parseJson(row.payload),
      envelope,                       // full canonical EventEnvelope if stored, else null
      createdAt: row.createdAt,
    };
  }
}

module.exports = AgentEventModel;