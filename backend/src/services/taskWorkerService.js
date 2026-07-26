// AIFA — internal task worker: atomic claim, heartbeat, stale-task recovery
// (roadmap DMO-001 / Day 2). The orchestrator runs agents in-process today, so
// this layer does NOT introduce a separate poll loop; instead it records WHICH
// worker owns a running task (lockedBy) and keeps a live heartbeat, so a task
// orphaned by a crashed/restarted process can be detected and reclaimed instead
// of hanging in `running` forever.
//
// Lifecycle from the orchestrator's view:
//   beginRun(taskId)  → claim the task for THIS worker + start the heartbeat
//   …agent executes (may pause at awaiting_gate; heartbeat keeps ticking)…
//   endRun(taskId)    → stop the heartbeat + release the lock (called from the
//                       canonical terminal points: _saveAgentData / _markTaskFailed)
//
// sweepStale() runs on boot and on an interval: any in-flight task whose
// heartbeat has expired (its worker died) is moved to a terminal state.

const crypto = require('crypto');
const prisma = require('../config/database');
const taskLifecycle = require('./taskLifecycleService');
const logger = require('../config/logger');

const WORKER_ID = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const HEARTBEAT_MS = Math.max(2000, Number(process.env.TASK_HEARTBEAT_MS) || 15000);
const STALE_MS = Math.max(HEARTBEAT_MS * 2, Number(process.env.TASK_HEARTBEAT_STALE_MS) || 60000);
// `awaiting_gate` is excluded — that task is waiting on a human, not on a worker;
// gateBridge owns its recovery (marks the pending gate interrupted on restart).
const IN_FLIGHT = ['dispatched', 'running'];

/** taskId -> { timer } for the heartbeat interval owned by this process. */
const RUNS = new Map();
let sweepTimer = null;

/** Atomically take ownership of a task for this worker. Returns true if claimed. */
async function claim(taskId) {
  const now = new Date();
  const res = await prisma.task.updateMany({
    where: {
      id: taskId,
      executionStatus: { in: ['queued', 'dispatched', 'running'] },
      OR: [{ lockedBy: null }, { lockedBy: WORKER_ID }],
    },
    data: { lockedBy: WORKER_ID, lockedAt: now, heartbeatAt: now, attempt: { increment: 1 } },
  });
  return res.count === 1;
}

async function heartbeat(taskId) {
  try {
    await prisma.task.updateMany({
      where: { id: taskId, lockedBy: WORKER_ID },
      data: { heartbeatAt: new Date() },
    });
  } catch (e) {
    logger.warn('task heartbeat failed', { taskId, error: e.message });
  }
}

async function release(taskId) {
  try {
    await prisma.task.updateMany({
      where: { id: taskId, lockedBy: WORKER_ID },
      data: { lockedBy: null, heartbeatAt: null },
    });
  } catch { /* best-effort */ }
}

/**
 * Claim + start the heartbeat for a task this worker is about to run.
 * @param {object} [opts]
 * @param {number} [opts.budgetMs]  execution-time budget; on expiry onTimeout() fires
 * @param {Function} [opts.onTimeout]
 */
async function beginRun(taskId, opts = {}) {
  const claimed = await claim(taskId);
  if (!claimed) {
    logger.warn('task could not be claimed (already locked by another worker)', { taskId, workerId: WORKER_ID });
  }
  // Replace any prior handle (defensive — a re-run of the same task id).
  endHeartbeat(taskId);
  const timer = setInterval(() => heartbeat(taskId), HEARTBEAT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  const run = { timer, budget: null };
  if (opts.budgetMs > 0 && typeof opts.onTimeout === 'function') {
    run.budget = { remainingMs: opts.budgetMs, startedAt: 0, handle: null, onExpire: opts.onTimeout };
  }
  RUNS.set(taskId, run);
  scheduleBudget(taskId);
  return claimed;
}

function endHeartbeat(taskId) {
  const run = RUNS.get(taskId);
  if (run) {
    clearInterval(run.timer);
    if (run.budget?.handle) clearTimeout(run.budget.handle);
    RUNS.delete(taskId);
  }
}

// ── Execution-time budget (gate-aware): counts only time the task is actively
//    running. pauseBudget()/resumeBudget() bracket each human gate wait so a long
//    HITL pause does NOT consume the agent's execution budget.
function scheduleBudget(taskId) {
  const run = RUNS.get(taskId);
  if (!run?.budget || run.budget.remainingMs <= 0 || run.budget.handle) return;
  run.budget.startedAt = Date.now();
  run.budget.handle = setTimeout(() => {
    const r = RUNS.get(taskId);
    if (r?.budget?.onExpire) {
      try { r.budget.onExpire(); } catch (e) { logger.warn('budget onExpire failed', { taskId, error: e.message }); }
    }
  }, run.budget.remainingMs);
  if (typeof run.budget.handle.unref === 'function') run.budget.handle.unref();
}

function pauseBudget(taskId) {
  const run = RUNS.get(taskId);
  if (!run?.budget?.handle) return;
  clearTimeout(run.budget.handle);
  run.budget.remainingMs -= (Date.now() - run.budget.startedAt);
  run.budget.handle = null;
}

function resumeBudget(taskId) {
  scheduleBudget(taskId);
}

/** Stop the heartbeat + release the lock. Idempotent. */
async function endRun(taskId) {
  endHeartbeat(taskId);
  await release(taskId);
}

/**
 * Reclaim tasks whose worker died mid-run: in-flight (`running`/`dispatched`)
 * with an expired/absent heartbeat → move to a terminal state so the workflow
 * does not hang. Returns the number reclaimed.
 */
async function sweepStale({ reason = 'stale worker — heartbeat expired' } = {}) {
  const cutoff = new Date(Date.now() - STALE_MS);
  const candidates = await prisma.task.findMany({
    where: {
      executionStatus: { in: IN_FLIGHT },
      OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: cutoff } }],
    },
    select: { id: true, executionStatus: true, type: true },
  });

  let reclaimed = 0;
  for (const t of candidates) {
    const terminal = t.executionStatus === 'dispatched' ? 'timeout' : 'failed';
    try {
      await taskLifecycle.transitionIfPresent(t.id, terminal, {
        actor: 'worker-sweeper',
        reason,
        eventType: terminal === 'timeout' ? 'task_timeout' : 'task_failed',
      });
      await prisma.task.update({
        where: { id: t.id },
        data: { status: 'failed', error: reason, lockedBy: null, heartbeatAt: null, finishedAt: new Date() },
      });
      reclaimed += 1;
      logger.warn('reclaimed stale task', { taskId: t.id, phase: t.type, terminal });
    } catch (e) {
      logger.warn('stale sweep failed for task', { taskId: t.id, error: e.message });
    }
  }
  return reclaimed;
}

function startSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => { sweepStale().catch(() => {}); }, STALE_MS);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

function stopSweeper() {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}

module.exports = {
  WORKER_ID,
  HEARTBEAT_MS,
  STALE_MS,
  claim,
  heartbeat,
  release,
  beginRun,
  endRun,
  pauseBudget,
  resumeBudget,
  sweepStale,
  startSweeper,
  stopSweeper,
};
