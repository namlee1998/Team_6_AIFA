#!/usr/bin/env node
/**
 * DMO-003 interrupted-gate auto-resume preflight.
 *
 * Runs PO until it parks at its clarification gate (executionStatus=awaiting_gate),
 * simulates a backend restart (drop the in-memory continuation + mark the pending
 * gate interrupted), then calls recoverInterruptedGates() and asserts:
 *   1. exactly the interrupted stage is re-dispatched (no new workflow/task),
 *   2. a fresh pending gate appears for the SAME task,
 *   3. answering it lets the stage complete — i.e. the user did not have to re-run.
 */

process.env.USE_MOCK_AGENTS = 'true';
process.env.EXECUTION_PATH = 'claude-code';
process.env.USE_MOCK_CLAUDE_CODE = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.SMOKE_DATABASE_URL || 'file:./resume-smoke.db';
process.env.GATE_TIMEOUT_MS = process.env.GATE_TIMEOUT_MS || '30000';

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
const svc = require('../src/services/SdlcWorkflowService');
const gateBridge = require('../src/services/gateBridge');

const FEATURE = { title: 'Add Google login', description: 'Google OAuth 2.0 sign-in.', priority: 'High' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeoutMs = 30000, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const poTasks = async (projectId) => (await Task.findByProjectId(projectId)).filter((t) => t.type === 'po-agent');

(async () => {
  console.log('▶  AIFA interrupted-gate auto-resume preflight\n');
  let ok = true;
  try {
    const projectId = uuidv4();
    await Project.create({ id: projectId, name: `resume-${projectId.slice(0, 6)}` });

    await svc.runPOAgent({ projectId, featureRequest: FEATURE, request: FEATURE.title, newWorkflow: true, user: null });

    // PO parks at its clarification gate.
    const poTask = await waitFor(async () => {
      const t = (await poTasks(projectId))[0];
      return t && t.executionStatus === 'awaiting_gate' ? t : null;
    }, { label: 'PO awaiting_gate' });
    const gatesBefore = gateBridge.listPending({ projectId });
    console.log(`   PO parked at gate (executionStatus=${poTask.executionStatus}, in-memory gates=${gatesBefore.length})`);

    // ── Simulate a backend restart ──
    gateBridge._clearAll();                              // in-memory continuation lost
    await gateBridge.markOrphanedPendingInterrupted();   // DB gate -> interrupted
    const liveAfterRestart = gateBridge.listPending({ projectId }).length;
    console.log(`   after 'restart': in-memory live gates=${liveAfterRestart} (continuation gone)`);

    // ── Recovery ──
    const resumed = await svc.recoverInterruptedGates();
    const poCountAfterResume = (await poTasks(projectId)).length;

    // A fresh pending gate should appear for the SAME PO task.
    const freshGate = await waitFor(async () => {
      const g = gateBridge.listPending({ projectId }).find((x) => x.taskId === poTask.id && x.status === 'pending');
      return g || null;
    }, { label: 'fresh PO gate after resume' });

    // recoverInterruptedGates is global; the point is the PO stage was re-dispatched
    // (a fresh gate appeared) WITHOUT creating a new workflow/task.
    const resumeOk = resumed >= 1 && poCountAfterResume === 1 && !!freshGate && freshGate.kind === 'question';
    console.log(`${resumeOk ? '✅' : '❌'} resumed=${resumed} · poTasks=${poCountAfterResume} (no new workflow) · freshGate=${freshGate?.kind}`);

    // Answer the fresh gate → the (only) PO stage completes.
    await svc.resolveApproval({ approvalId: freshGate.approvalId, answers: ['Any Google account'], user: null });
    const completed = await waitFor(async () => {
      const t = (await poTasks(projectId))[0];
      return t && t.status === 'completed' ? t : null;
    }, { label: 'PO completed after resume', timeoutMs: 30000 });
    const completeOk = !!completed;
    console.log(`${completeOk ? '✅' : '❌'} PO stage completed after answering the resumed gate (no full re-run)`);

    ok = resumeOk && completeOk;
    console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'} — interrupted-gate auto-resume`);
  } catch (err) {
    ok = false;
    console.log(`\n❌ FAIL  ${err.message}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  process.exit(ok ? 0 : 1);
})();
