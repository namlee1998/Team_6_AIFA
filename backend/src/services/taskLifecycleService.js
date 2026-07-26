// Persisted execution-state machine for one Task.
//
// Beginner reading guide: transition() validates the state edge, updates Task,
// and appends an ordered AgentEvent in the same database transaction. Workflow
// phases such as PO_REVIEW are derived elsewhere from these task states.

const prisma = require('../config/database');
const logger = require('../config/logger');
const { publishEvent } = require('./eventPublisher');

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'timeout']);
const TRANSITIONS = {
  queued: new Set(['dispatched', 'running', 'cancelled']),
  dispatched: new Set(['running', 'cancelled', 'timeout']),
  running: new Set(['awaiting_gate', 'completed', 'failed', 'cancelled', 'timeout']),
  awaiting_gate: new Set(['running', 'failed', 'cancelled', 'timeout']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  timeout: new Set(),
};

const EVENT_BY_STATUS = {
  queued: 'task_queued',
  dispatched: 'task_dispatched',
  running: 'task_started',
  awaiting_gate: 'gate_pending',
  completed: 'task_completed',
  failed: 'task_failed',
  cancelled: 'task_cancelled',
  timeout: 'task_timeout',
};

// Map of lifecycle `type` strings → wire `EventType` discriminator.
const LIFECYCLE_TO_EVENTTYPE = {
  task_queued: 'task_started',         // queued ≈ started-from-scratch, surfaced as task_started
  task_dispatched: 'task_started',
  task_started: 'task_started',
  task_completed: 'task_completed',
  task_failed: 'task_failed',
  task_cancelled: 'task_interrupted',
  task_timeout: 'task_interrupted',
  gate_pending: 'gate_pending',
  gate_resolved: 'gate_resolved',
};

/**
 * Persist a pre-built canonical EventEnvelope into AgentEvent. The envelope
 * is supplied by the caller (allocated via publishEvent) so that
 * AgentEvent.sequence ALWAYS equals envelope.sequence — there is exactly
 * one per-session sequence source (eventPublisher / sequenceService).
 *
 * The DB `type` column carries the lifecycle audit type (e.g. 'task_started',
 * 'gate_pending'); the wire EventType lives inside the stored envelope and
 * is what replay re-emits byte-for-byte.
 */
async function appendEvent(tx, task, envelope, actor, lifecycleType) {
  return tx.agentEvent.create({
    data: {
      taskId: task.id,
      projectId: task.projectId,
      sessionId: envelope.sessionId,
      sequence: envelope.sequence,
      type: lifecycleType,
      actor,
      payload: JSON.stringify(envelope.payload ?? {}),
      envelope: JSON.stringify(envelope),
    },
  });
}

/**
 * Allocate + publish the canonical EventEnvelope for a lifecycle event.
 * Returns the envelope allocated by publishEvent — the caller persists the
 * same envelope to AgentEvent so replay re-emits it byte-for-byte identical
 * to the live wire frame. Never computes its own sequence.
 *
 * OBS-01.10 R-24: the wire envelope's `role` MUST equal `task.type` for
 * lifecycle envelopes (per docs/OBS1/phase1-runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md
 * §4.1.3–4.1.6, §7 forbidden pattern "`role: null` on lifecycle envelopes",
 * AC-08, §8 invariant 5). The FE mapper `inferAgentKey(env.role)` requires
 * a non-null role to resolve the agent key. Session-level envelopes
 * (`session_started`, `session_resumed`, `runtime_log`) legitimately carry
 * `role: null` — those are emitted elsewhere (SdlcController.js:369,
 * SdlcWorkflowService.js:510, Task.js:28) and are NOT routed through this
 * function.
 */
async function publishLifecycle(task, type, payload) {
  if (!task?.projectId) return null;
  if (!task?.sessionId) {
    // Lifecycle events are bound to a session; without one, publishEvent
    // (which requires base.sessionId) cannot allocate a sequence.
    return null;
  }
  const eventType = LIFECYCLE_TO_EVENTTYPE[type] || 'task_started';
  // Per-session sequence: sequenceService.next is the single source; this
  // module never computes its own sequence.
  return publishEvent(
    eventType,
    {
      projectId: task.projectId,
      sessionId: task.sessionId,
      taskId: task.id,
      // R-24: wire role MUST be the agent role (e.g. 'po-agent'), never null.
      // This unblocks FE mapper inferAgentKey(env.role) — see R-23.
      role: task.type,
    },
    payload,
  );
}

async function transition(taskId, nextStatus, {
  actor = 'system',
  reason = null,
  payload = {},
  eventType = null,
} = {}) {
  // Peek the task BEFORE the transaction so we can validate + allocate the
  // canonical envelope sequence (which itself does a prisma read via
  // sequenceService). With SQLite connection_limit=1, opening a nested
  // prisma read inside an active interactive transaction deadlocks.
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const current = task.executionStatus || 'queued';
  if (current === nextStatus) return task;
  if (!TRANSITIONS[current]?.has(nextStatus)) {
    throw new Error(`Invalid task transition: ${current} -> ${nextStatus}`);
  }

  const persistedType = eventType || EVENT_BY_STATUS[nextStatus] || 'task_transitioned';
  // Allocate the canonical envelope (and publish to the bus) BEFORE the
  // transaction so its sequence is reserved and AgentEvent.sequence equals
  // envelope.sequence. If the DB write rolls back, the live publish is
  // best-effort (same trade-off as _recordGateAudit).
  const envelope = await publishLifecycle(task, persistedType, {
    from: current,
    to: nextStatus,
    ...(reason ? { reason } : {}),
    ...payload,
  });

  const updated = await prisma.$transaction(async (tx) => {
    const updatedRow = await tx.task.update({
      where: { id: taskId },
      data: {
        executionStatus: nextStatus,
        ...(nextStatus === 'running' && !task.startedAt ? { startedAt: new Date() } : {}),
        ...(TERMINAL.has(nextStatus) ? { finishedAt: new Date() } : {}),
      },
    });
    if (envelope) {
      await appendEvent(tx, updatedRow, envelope, actor, persistedType);
    }
    return updatedRow;
  });
  return updated;
}

async function record(taskId, type, { actor = 'system', payload = {} } = {}) {
  // Peek outside the transaction so the publishEvent → sequenceService prisma
  // read doesn't deadlock against the open interactive transaction.
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const envelope = await publishLifecycle(task, type, payload);
  const updated = await prisma.$transaction(async (tx) => {
    if (envelope) {
      await appendEvent(tx, task, envelope, actor, type);
    }
    return task;
  });
  return updated;
}

async function transitionIfPresent(taskId, nextStatus, options = {}) {
  try {
    return await transition(taskId, nextStatus, options);
  } catch (error) {
    // Best-effort: this helper is used in race-prone paths where the task
    // may have been deleted, swept to a terminal state by the worker
    // sweeper, or marked timeout while the SDK was mid-flight. None of
    // these are caller bugs — they are concurrency windows we accept —
    // so swallow the canonical "task not transitionable" errors and
    // surface everything else.
    const msg = error?.message || '';
    if (msg.startsWith('Task not found:')) {
      logger.warn('task lifecycle transition skipped for missing task', { taskId, nextStatus });
      return null;
    }
    if (msg.startsWith('Invalid task transition:')) {
      logger.warn('task lifecycle transition skipped for terminal state', {
        taskId, nextStatus, error: msg,
      });
      return null;
    }
    throw error;
  }
}

module.exports = {
  TRANSITIONS,
  transition,
  transitionIfPresent,
  record,
};
