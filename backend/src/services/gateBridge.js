// Bridge between a live agent permission wait and persisted human approval.
//
// Beginner reading guide:
// - requestGate() persists PendingGate, moves the Task to awaiting_gate, and
//   returns an in-memory Promise awaited by the running agent.
// - resolveGate() resolves exactly once, persists the decision, and resumes Task.
// - after restart the Promise is gone; server boot marks old gates interrupted
//   and SdlcWorkflowService re-dispatches the affected stage.
//
// Lifecycle ownership (this file):
//   - requestGate() creates PendingGate row, sets up awaiter promise, calls
//     publishEvent('gate_pending', ...) so SSE consumers see the gate.
//   - resolveGate() calls PendingGate.resolve, runs taskLifecycle transition,
//     calls publishEvent('gate_resolved', ...), resolves the awaiter.
//
// Transport ownership lives in services/eventBus.js and services/eventPublisher.js.
// This file never constructs envelopes directly — only the publisher does.

const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const PendingGate = require('../models/PendingGate');
const taskLifecycle = require('./taskLifecycleService');
const { Task } = require('../models');
const { publishEvent } = require('./eventPublisher');
const { toGateType } = require('./toGateType');

/** approvalId -> pending record */
const pending = new Map();
/** taskId -> projectId (reverse lookup, set when requestGate is called) */
const taskToProject = new Map();

function defaultTimeout() {
  return Math.max(1000, Number(process.env.GATE_TIMEOUT_MS) || 600000);
}

/**
 * Create a pending gate and return a promise that resolves when a human (or the
 * watchdog) decides. The promise resolves to the raw decision object passed to
 * resolveGate, e.g. { action:'approve' } | { action:'reject', comment } |
 * { answers } | { timedOut:true }.
 *
 * @param {object} p
 * @param {string} p.taskId
 * @param {string} p.sessionId
 * @param {string} [p.projectId]
 * @param {string} p.role     owning role, e.g. 'dev-agent'
 * @param {'tool'|'question'|'output_review'|'release'} p.kind
 * @param {object} p.payload  rendered context (file_path, diff, questions, risk…)
 * @param {number} [p.timeoutMs]
 */
function requestGate({ taskId, sessionId, projectId = null, role, kind, payload = {}, timeoutMs }) {
  const approvalId = uuidv4();
  const ttl = Number.isFinite(timeoutMs) ? timeoutMs : defaultTimeout();

  const promise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Watchdog: auto-reject so the workflow never hangs. Resolve idempotently.
      if (pending.has(approvalId)) {
        resolveGate(approvalId, {
          action: 'reject',
          timedOut: true,
          comment: 'Auto-rejected: approval timed out',
        }).catch((err) => logger.warn('failed to resolve gate timeout', { approvalId, error: err.message }));
      }
    }, ttl);
    // Avoid keeping the event loop alive on this timer (tests / smoke).
    if (typeof timer.unref === 'function') timer.unref();

    pending.set(approvalId, {
      approvalId,
      taskId,
      sessionId: sessionId || null,
      projectId,
      role,
      kind,
      payload,
      status: 'pending',
      createdAt: new Date().toISOString(),
      timer,
      resolve,
    });
    if (projectId) taskToProject.set(taskId, projectId);
  });

  const eventData = { approvalId, taskId, projectId, sessionId, role, kind, payload, status: 'pending', createdAt: new Date().toISOString() };
  // Persistence is completed before SSE/subscriber notification. Callers that
  // drive an agent await `ready`, so a visible gate always has durable state.
  const ready = (async () => {
    await PendingGate.create(eventData);
    // The lifecycle transition `… -> awaiting_gate` is only meaningful when
    // the owning task still has a live in-process thread (or could plausibly
    // resume). Skip it for:
    //   1. Gate kinds that never pause a live thread — 'output_review' is
    //      always created post-completion; 'release' is a pure
    //      packaging+publishing stage.
    //   2. Tasks that have already reached a terminal executionStatus while
    //      the SDK was mid-flight (e.g. QA budget timeout fired before the
    //      in-flight `tool` decision returned). Without this guard,
    //      `taskLifecycle.transition` throws "Invalid task transition:
    //      timeout -> awaiting_gate" and the persisted PendingGate is left
    //      without an SSE `gate_pending` event.
    const skipByKind = kind === 'output_review' || kind === 'release';
    let skipByStatus = false;
    if (!skipByKind) {
      try {
        const current = await Task.findById(taskId);
        if (current && ['completed', 'failed', 'cancelled', 'timeout'].includes(current.executionStatus)) {
          skipByStatus = true;
        }
      } catch (_) {
        // If we can't read the task, fall through and let transitionIfPresent
        // surface the canonical error rather than silently masking it.
      }
    }
    if (!skipByKind && !skipByStatus) {
      await taskLifecycle.transitionIfPresent(taskId, 'awaiting_gate', {
        actor: role,
        payload: { approvalId, kind },
      });
    }
    if (sessionId && projectId) {
      const gateType = toGateType(role, kind);
      await publishEvent('gate_pending',
        { projectId, sessionId, taskId, role },
        {
          gate: {
            id: approvalId,
            type: gateType,
            kind,
            taskId,
            projectId,
            role,
            status: 'pending',
            payload,
            createdAt: eventData.createdAt,
          },
        },
      );
    }
    logger.info('gate_pending', { approvalId, taskId, role, kind });
  })();
  ready.catch((err) => logger.error('failed to persist pending gate', { approvalId, error: err.message }));
  // Remember `ready` on the record so resolveGate can wait for the awaiting_gate
  // transition to land before transitioning back to running (see resolveGate).
  const rec = pending.get(approvalId);
  if (rec) rec.ready = ready;
  return { approvalId, promise, ready };
}

/**
 * Resolve a pending gate exactly once. Returns true if this call woke the gate,
 * false if it was already resolved/absent (idempotent — no double action).
 */
async function resolveGate(approvalId, result = {}) {
  const rec = pending.get(approvalId);
  if (!rec) return false;
  // A fast resolve (e.g. an auto-approving drainer) can fire before requestGate's
  // async `ready` has run the running -> awaiting_gate transition. Await it first
  // so our awaiting_gate -> running transition can never be reordered ahead of it,
  // which would otherwise leave the task stuck in awaiting_gate.
  if (rec.ready) await rec.ready.catch(() => {});
  clearTimeout(rec.timer);
  rec.status = result.timedOut ? 'timed_out' : (result.action === 'reject' ? 'rejected' : 'resolved');
  pending.delete(approvalId);
  await PendingGate.resolve(approvalId, rec.status, result);
  // See requestGate: 'output_review' gates never moved the task to
  // awaiting_gate (it was already terminal/`completed`), so there is nothing
  // to resume here — resolveOutputReviewGate drives the next step directly.
  if (rec.kind !== 'output_review') {
    await taskLifecycle.transitionIfPresent(rec.taskId, 'running', {
      actor: 'human',
      payload: { approvalId, result, gateStatus: rec.status },
      eventType: 'gate_resolved',
    });
  }
  if (rec.sessionId && rec.projectId) {
    const decision = result?.action === 'reject'
      ? 'reject'
      : (result?.answers ? 'answer' : (result?.timedOut ? 'timeout' : 'approve'));
    await publishEvent('gate_resolved',
      { projectId: rec.projectId, sessionId: rec.sessionId, taskId: rec.taskId, role: rec.role },
      {
        gateId: approvalId,
        taskId: rec.taskId,
        decision,
        comment: result?.comment || undefined,
        resolvedAt: new Date().toISOString(),
      },
    );
  }
  logger.info('gate_resolved', { approvalId, taskId: rec.taskId, action: result.action || 'allow' });
  rec.resolve(result);
  return true;
}

function hasPending(approvalId) {
  return pending.has(approvalId);
}

function getPending(approvalId) {
  const rec = pending.get(approvalId);
  if (!rec) return null;
  // never leak the resolve fn / timer / ready promise
  const { resolve, timer, ready, ...safe } = rec;
  return safe;
}

/** List pending gates, optionally filtered by taskId or projectId. */
function listPending({ taskId = null, projectId = null } = {}) {
  const out = [];
  for (const rec of pending.values()) {
    if (taskId && rec.taskId !== taskId) continue;
    if (projectId && rec.projectId !== projectId) continue;
    const { resolve, timer, ready, ...safe } = rec;
    out.push(safe);
  }
  return out;
}

/** Test/cleanup helper — drop everything (does NOT resolve). */
function _clearAll() {
  for (const rec of pending.values()) clearTimeout(rec.timer);
  pending.clear();
}

async function markOrphanedPendingInterrupted() {
  return PendingGate.markPendingInterrupted();
}

async function listInterrupted(filters = {}) {
  try {
    return await PendingGate.listInterrupted(filters);
  } catch (err) {
    logger.warn('failed to list interrupted gates', { error: err.message });
    return [];
  }
}

async function findPersisted(approvalId) {
  try {
    return await PendingGate.findById(approvalId);
  } catch (err) {
    logger.warn('failed to read persisted gate', { approvalId, error: err.message });
    return null;
  }
}

module.exports = {
  requestGate,
  resolveGate,
  hasPending,
  getPending,
  listPending,
  listInterrupted,
  findPersisted,
  markOrphanedPendingInterrupted,
  _clearAll,
};
