#!/usr/bin/env node
/**
 * T8.1 — claude-code path preflight smoke.
 *
 * Drives the SDLC workflow through the NEW claude-code execution path
 * (EXECUTION_PATH=claude-code, USE_MOCK_CLAUDE_CODE=true) in-process. Unlike the
 * langchain smoke, agent work flows through onGate, so this script also resolves
 * the pending gates (PO clarification question + DEV write approval) to prove
 * the gate bridge / HITL wiring end-to-end.
 *
 * Exit code 0 = all scenarios PASS.
 */

process.env.USE_MOCK_AGENTS = 'true';
process.env.EXECUTION_PATH = 'claude-code';
process.env.USE_MOCK_CLAUDE_CODE = 'true';
// This preflight explicitly proves the question/tool gate bridge. Production
// remains non-interactive unless its own environment enables these gates.
process.env.CLAUDE_CODE_INTERACTIVE_GATES = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.DATABASE_URL = process.env.SMOKE_DATABASE_URL || 'file:./smoke.db';
process.env.GATE_TIMEOUT_MS = process.env.GATE_TIMEOUT_MS || '30000';

const path = require('path');
const fs = require('fs');
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
const { Project } = require('../src/models');
const svc = require('../src/services/SdlcWorkflowService');
const repoService = require('../src/services/repoService');
const prisma = require('../src/config/database');

const FEATURE = { title: 'Add Google login', description: 'Allow users to sign in with their Google account via OAuth 2.0.', priority: 'High' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newProject(name) {
  const id = uuidv4();
  await Project.create({ id, name: `cc-${name}-${id.slice(0, 6)}` });
  return id;
}

// Background gate drainer: approve tool writes, answer questions with option 1.
function startGateDrainer(projectId) {
  let stopped = false;
  (async () => {
    while (!stopped) {
      const gates = await svc.listPendingGates({ projectId });
      for (const g of gates) {
        try {
          if (g.kind === 'question') {
            const opt = g.payload?.questions?.[0]?.options?.[0]?.label || 'Any Google account';
            await svc.resolveApproval({ approvalId: g.approvalId, answers: [opt], user: null });
          } else {
            await svc.resolveApproval({ approvalId: g.approvalId, action: 'approve', comment: 'approved by smoke', user: null });
          }
        } catch { /* already resolved */ }
      }
      await sleep(150);
    }
  })();
  return () => { stopped = true; };
}

async function waitFor(projectId, predicate, { timeoutMs = 60000, label = 'condition' } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await svc.getWorkflowStatus(projectId, null);
    if (predicate(last)) return last;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${label}. Last phase: ${last?.currentPhase}`);
}

async function happyPath() {
  process.env.MOCK_SCENARIO = 'happy_path';
  const projectId = await newProject('happy');
  const stop = startGateDrainer(projectId);
  try {
    await svc.runPOAgent({ projectId, featureRequest: FEATURE, request: FEATURE.title, newWorkflow: true, user: null });
    const s = await waitFor(projectId, (w) => w.phases.qa?.status === 'completed', { label: 'QA completed', timeoutMs: 90000 });

    // DEV must have exercised the write-approval gate (google.js written to sandbox).
    const devAudit = svc._getGateAudit(s.phases.dev.taskId);
    const approved = devAudit.some((e) => e.kind === 'GATE_DECISION' && /approved/.test(e.detail));
    if (!approved) throw new Error('DEV write-approval gate was not exercised');
    const sandboxFile = path.join(repoService.WORKSPACE_DIR, projectId, 'sandbox', 'dev-agent', 'src', 'auth', 'google.js');
    if (!fs.existsSync(sandboxFile)) throw new Error('Approved DEV file was not written to the sandbox');

    await svc.submitStructuredDecision({ taskId: s.phases.qa.taskId, decisionId: uuidv4(), action: 'approve', user: null });
    const rel = await svc.submitReleaseDecision({ projectId, decisionId: uuidv4(), decision: 'APPROVE', user: null });

    const fin = await svc.getWorkflowStatus(projectId, null);
    if (fin.currentPhase !== 'RELEASED') throw new Error(`Expected RELEASED, got ${fin.currentPhase}`);
    const finalMd = (rel.releaseOutputs || []).find((o) => o.type === 'final_md');
    if (!finalMd || !fs.existsSync(finalMd.value)) throw new Error('final.md was not written');
    return 'PO clarify + DEV gate approved → RELEASED + final.md written';
  } finally { stop(); }
}

const SCENARIOS = [['happy_path', happyPath]];

(async () => {
  console.log('▶  AIFA claude-code preflight smoke (EXECUTION_PATH=claude-code)\n');
  const results = [];
  for (const [name, fn] of SCENARIOS) {
    const started = Date.now();
    try {
      const detail = await fn();
      console.log(`✅ PASS  ${name.padEnd(20)} ${detail}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      results.push(true);
    } catch (err) {
      console.log(`❌ FAIL  ${name.padEnd(20)} ${err.message}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      results.push(false);
    } finally { delete process.env.MOCK_SCENARIO; }
  }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} claude-code scenarios passed.`);
  await prisma.$disconnect().catch(() => {});
  process.exit(passed === results.length ? 0 : 1);
})();
