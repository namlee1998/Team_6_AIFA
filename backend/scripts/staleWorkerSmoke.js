#!/usr/bin/env node
/**
 * DMO-001 stale-worker recovery preflight.
 *
 * Simulates a task orphaned by a crashed worker (executionStatus=`running`, old
 * heartbeat, lock held by a dead worker) and asserts that sweepStale():
 *   1. moves it to a terminal state (`failed`) + appends a task_failed event,
 *   2. clears the lock, and
 *   3. does NOT touch a task with a fresh heartbeat (no false positives).
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.SMOKE_DATABASE_URL || 'file:./stale-smoke.db';
process.env.TASK_HEARTBEAT_STALE_MS = '1000'; // tiny threshold so the test is fast

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
const taskWorker = require('../src/services/taskWorkerService');

async function makeTask(projectId, { heartbeatAt }) {
  const id = uuidv4();
  await Task.create({ id, projectId, type: 'dev-agent', status: 'processing' });
  // Simulate a worker that claimed + started the task, then died.
  await prisma.task.update({
    where: { id },
    data: { executionStatus: 'running', lockedBy: 'dead-worker-123', lockedAt: new Date(), heartbeatAt },
  });
  return id;
}

(async () => {
  console.log('▶  AIFA stale-worker recovery preflight\n');
  let ok = true;
  try {
    const projectId = uuidv4();
    await Project.create({ id: projectId, name: `stale-${projectId.slice(0, 6)}` });

    const staleId = await makeTask(projectId, { heartbeatAt: new Date(Date.now() - 60_000) }); // 60s old → stale
    const freshId = await makeTask(projectId, { heartbeatAt: new Date() });                     // now → alive

    const reclaimed = await taskWorker.sweepStale();
    console.log(`   sweepStale reclaimed: ${reclaimed}`);

    const stale = await Task.findById(staleId);
    const fresh = await Task.findById(freshId);
    const events = await AgentEvent.list({ taskId: staleId, limit: 50 });
    const hasFailEvent = events.some((e) => e.type === 'task_failed');

    const staleOk = stale.executionStatus === 'failed' && stale.status === 'failed' && !stale.lockedBy && hasFailEvent;
    const freshOk = fresh.executionStatus === 'running' && !!fresh.lockedBy;

    console.log(`${staleOk ? '✅' : '❌'} stale task → executionStatus=${stale.executionStatus} status=${stale.status} lock=${stale.lockedBy || 'cleared'} failEvent=${hasFailEvent}`);
    console.log(`${freshOk ? '✅' : '❌'} fresh task untouched → executionStatus=${fresh.executionStatus} lock=${fresh.lockedBy || 'cleared'}`);

    ok = staleOk && freshOk && reclaimed === 1;
    console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'} — stale-worker recovery`);
  } catch (err) {
    ok = false;
    console.log(`\n❌ FAIL  ${err.message}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
