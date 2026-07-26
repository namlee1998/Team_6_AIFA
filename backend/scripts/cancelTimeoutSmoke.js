#!/usr/bin/env node
/**
 * Cancel + execution-timeout preflight.
 *
 *  Cancel: a running task → cancelTask() moves it to `cancelled` (+ event, lock
 *          cleared); a second cancel is rejected (409).
 *  Timeout watchdog (taskWorker budget, gate-aware):
 *    - fires after the budget elapses,
 *    - a pause (human gate wait) does NOT consume the budget,
 *    - endRun() cancels a pending budget.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.SMOKE_DATABASE_URL || 'file:./cancel-smoke.db';

const path = require('path');
const { execSync } = require('child_process');

try {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: path.join(__dirname, '..'), stdio: 'ignore', env: process.env,
  });
} catch (e) {
  console.error('Failed to prepare the isolated smoke DB schema:', e.message);
  process.exit(1);
}

const { v4: uuidv4 } = require('uuid');
const prisma = require('../src/config/database');
const { Project, Task, AgentEvent } = require('../src/models');
const svc = require('../src/services/SdlcWorkflowService');
const taskWorker = require('../src/services/taskWorkerService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTask(projectId, executionStatus = 'running') {
  const id = uuidv4();
  await Task.create({ id, projectId, type: 'dev-agent', status: 'processing' });
  await prisma.task.update({ where: { id }, data: { executionStatus, lockedBy: 'w1', heartbeatAt: new Date() } });
  return id;
}

(async () => {
  console.log('▶  AIFA cancel + execution-timeout preflight\n');
  let ok = true;
  try {
    const projectId = uuidv4();
    await Project.create({ id: projectId, name: `cx-${projectId.slice(0, 6)}` });

    // ── Cancel ──
    const t = await newTask(projectId, 'running');
    await svc.cancelTask({ taskId: t, user: null, reason: 'user pressed cancel' });
    const after = await Task.findById(t);
    const ev = await AgentEvent.list({ taskId: t, limit: 50 });
    const cancelOk = after.executionStatus === 'cancelled' && after.status === 'cancelled'
      && !after.lockedBy && ev.some((e) => e.type === 'task_cancelled');
    console.log(`${cancelOk ? '✅' : '❌'} cancel → executionStatus=${after.executionStatus} status=${after.status} lock=${after.lockedBy || 'cleared'} event=${ev.some((e) => e.type === 'task_cancelled')}`);

    let rejected = false;
    try { await svc.cancelTask({ taskId: t, user: null }); } catch (e) { rejected = e.statusCode === 409 || /already/.test(e.message); }
    console.log(`${rejected ? '✅' : '❌'} second cancel rejected (already terminal)`);
    ok = ok && cancelOk && rejected;

    // ── Timeout watchdog: fires after budget ──
    const t1 = await newTask(projectId, 'running');
    let fired1 = false;
    await taskWorker.beginRun(t1, { budgetMs: 80, onTimeout: () => { fired1 = true; } });
    await sleep(180);
    console.log(`${fired1 ? '✅' : '❌'} budget watchdog fired after expiry`);
    await taskWorker.endRun(t1);

    // ── Timeout watchdog: pause (gate wait) does not consume budget ──
    const t2 = await newTask(projectId, 'running');
    let fired2 = false;
    await taskWorker.beginRun(t2, { budgetMs: 120, onTimeout: () => { fired2 = true; } });
    await sleep(40);
    taskWorker.pauseBudget(t2);          // enter gate
    await sleep(250);                     // long human wait — must NOT fire
    const pausedHeld = !fired2;
    taskWorker.resumeBudget(t2);          // resume; ~80ms remaining
    await sleep(160);
    const resumedFired = fired2;
    console.log(`${pausedHeld && resumedFired ? '✅' : '❌'} budget paused during gate wait, fired after resume (held=${pausedHeld}, firedAfterResume=${resumedFired})`);
    await taskWorker.endRun(t2);
    ok = ok && fired1 && pausedHeld && resumedFired;

    // ── endRun cancels a pending budget ──
    const t3 = await newTask(projectId, 'running');
    let fired3 = false;
    await taskWorker.beginRun(t3, { budgetMs: 60, onTimeout: () => { fired3 = true; } });
    await taskWorker.endRun(t3);
    await sleep(120);
    console.log(`${!fired3 ? '✅' : '❌'} endRun cancelled the pending budget (no fire)`);
    ok = ok && !fired3;

    console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'} — cancel + execution-timeout`);
  } catch (err) {
    ok = false;
    console.log(`\n❌ FAIL  ${err.message}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
