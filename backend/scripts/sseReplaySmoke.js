#!/usr/bin/env node
/**
 * DMO-004 SSE replay / reconnect preflight.
 *
 * Drives the SSE controller with a fake req/res and asserts:
 *   1. a fresh connect (after_sequence=0) replays ALL persisted AgentEvents,
 *      each frame carrying an `id:` = its sequence;
 *   2. a reconnect with Last-Event-ID=K replays ONLY events with sequence > K
 *      (no gap, no duplicate) — i.e. the stream is resumable.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.SMOKE_DATABASE_URL || 'file:./sse-smoke.db';

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
const { Project, Task } = require('../src/models');
const taskLifecycle = require('../src/services/taskLifecycleService');
const SdlcController = require('../src/controllers/SdlcController');

// Minimal SSE res capture; collects agent_event frames (id + type).
function makeRes() {
  const chunks = [];
  return {
    chunks,
    setHeader() {},
    flushHeaders() {},
    write(s) { chunks.push(s); return true; },
    end() {},
    parseAgentEventIds() {
      const text = chunks.join('');
      const ids = [];
      for (const block of text.split('\n\n')) {
        const lines = block.split('\n');
        const id = lines.find((l) => l.startsWith('id: '));
        const ev = lines.find((l) => l.startsWith('event: '));
        if (id && ev && ev.slice(7).trim() === 'agent_event') ids.push(Number(id.slice(4).trim()));
      }
      return ids;
    },
  };
}

function makeReq(taskId, afterSequence) {
  const handlers = {};
  return {
    params: { task_id: taskId },
    headers: {},
    query: { after_sequence: String(afterSequence) },
    user: null,
    on(ev, cb) { handlers[ev] = cb; },
    _close() { if (handlers.close) handlers.close(); },
  };
}

(async () => {
  console.log('▶  AIFA SSE replay / reconnect preflight\n');
  let ok = true;
  try {
    const projectId = uuidv4();
    await Project.create({ id: projectId, name: `sse-${projectId.slice(0, 6)}` });
    const taskId = uuidv4();
    await Task.create({ id: taskId, projectId, type: 'po-agent', status: 'pending' }); // seq 1 = task_queued
    // Append a handful of persisted events (seq 2..6).
    for (let i = 0; i < 5; i += 1) {
      await taskLifecycle.record(taskId, 'progress', { actor: 'po-agent', payload: { step: i } });
    }

    // 1) Fresh connect — should replay all sequences 1..6.
    const res1 = makeRes();
    const req1 = makeReq(taskId, 0);
    await SdlcController.streamStatus(req1, res1, (e) => { throw e; });
    req1._close();
    const ids1 = res1.parseAgentEventIds();
    const fullOk = ids1.length === 6 && ids1[0] === 1 && ids1[5] === 6
      && ids1.every((v, i) => i === 0 || v > ids1[i - 1]);
    console.log(`${fullOk ? '✅' : '❌'} fresh connect replayed sequences: [${ids1.join(', ')}]`);

    // 2) Reconnect at Last-Event-ID = 3 — should replay only 4,5,6.
    const res2 = makeRes();
    const req2 = makeReq(taskId, 3);
    await SdlcController.streamStatus(req2, res2, (e) => { throw e; });
    req2._close();
    const ids2 = res2.parseAgentEventIds();
    const resumeOk = ids2.length === 3 && ids2.every((v) => v > 3)
      && JSON.stringify(ids2) === JSON.stringify([4, 5, 6]);
    console.log(`${resumeOk ? '✅' : '❌'} reconnect from id=3 replayed only: [${ids2.join(', ')}] (no gap, no dup)`);

    ok = fullOk && resumeOk;
    console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'} — SSE replay / reconnect`);
  } catch (err) {
    ok = false;
    console.log(`\n❌ FAIL  ${err.message}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
