#!/usr/bin/env node
/**
 * Debug-only: prepare a fresh DEV run trace.
 *
 * - Creates a NEW project, session, repo workspace.
 * - Hardcodes UX + PO artifacts directly into DB so DEV has full context.
 * - Calls SdlcWorkflowService.runDEVAgent() — the real pipeline path:
 *     runDEVAgent → workflowOrchestrator → _runAgent → agentDispatcher.runAgent
 *       → (claude-code) → claudeCodeRunner.runAgent → @anthropic-ai/claude-agent-sdk query()
 *
 * - Does NOT touch any source file.
 * - Does NOT mock any agent.
 * - Does NOT run QA / Release / Push.
 *
 * Usage:
 *   cd backend && USE_MOCK_CLAUDE_CODE=false EXECUTION_PATH=claude-code \
 *     DEBUG_CLAUDE_AGENT_SDK=1 NODE_ENV=development \
 *     node scripts/devOnlyTrace.js
 */

process.env.EXECUTION_PATH = 'claude-code';
process.env.USE_MOCK_CLAUDE_CODE = 'false';
process.env.USE_MOCK_AGENTS = 'false';
// Force a lower maxTurns so DEV exits inside this script's budget.
process.env.CLAUDE_CODE_DEV_MAX_TURNS = process.env.CLAUDE_CODE_DEV_MAX_TURNS || '12';
// Truncate the safety budget so a runaway is caught in <2 minutes.
process.env.CLAUDE_CODE_TIMEOUT_MS = process.env.CLAUDE_CODE_TIMEOUT_MS || '120000';
// We need the SDK to surface stderr so we can see CLI internal logs.
process.env.DEBUG_CLAUDE_AGENT_SDK = '1';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const T0 = Date.now();
const t = (label) => {
  const ms = Date.now() - T0;
  console.log(`[+${String(ms).padStart(6, ' ')}ms ${new Date().toISOString()}] ${label}`);
};

const prisma = require('../src/config/database');
const { Project, Task, AgentArtifact, AgentEvent, PipelineSession } = require('../src/models');
const svc = require('../src/services/SdlcWorkflowService');
const repoService = require('../src/services/repoService');

async function main() {
  t('STEP 1  Controller begins (script entry)');

  // 1.1 create a fresh project
  const projectId = uuidv4();
  const projectName = `dev-trace-${Date.now()}`;
  await Project.create({ id: projectId, name: projectName });
  t(`  -> Project.create id=${projectId} name=${projectName}`);

  // 1.2 prepare a fresh git repo
  const repoPath = path.join(repoService.WORKSPACE_DIR, projectId, 'sessions', '__pending__', 'repo');
  fs.mkdirSync(repoPath, { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'README.md'), '# Trace fixture\n');
  fs.writeFileSync(path.join(repoPath, 'frontend'), '');
  try { fs.unlinkSync(path.join(repoPath, 'frontend')); } catch (_) {}
  fs.mkdirSync(path.join(repoPath, 'frontend', 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'frontend', 'package.json'),
    '{"name":"trace","private":true,"dependencies":{"react":"^18"}}');
  fs.writeFileSync(path.join(repoPath, 'frontend', 'src', 'App.jsx'),
    'export default function App() { return <div>Hello trace</div>; }\n');
  execSync('git init -q -b aifa/feature && git add -A && git -c user.email=trace@local -c user.name=trace commit -q -m "init"', {
    cwd: repoPath, stdio: 'ignore',
  });
  t(`  -> fixture repo at ${repoPath}`);

  // 1.3 create a fresh session bound to the repo
  const sessionId = uuidv4();
  await PipelineSession.create({
    id: sessionId,
    projectId,
    title: 'trace-session',
    status: 'running',
    repoPath,
    workingBranch: 'aifa/feature',
    baseBranch: 'aifa/feature',
    outputDir: path.join(repoService.WORKSPACE_DIR, projectId, 'sessions', sessionId),
  });
  t(`  -> PipelineSession.create id=${sessionId} repoPath=${repoPath}`);

  // 1.4 create the upstream UX task (committed+completed) with all required artifacts
  const uxTaskId = uuidv4();
  await Task.create({
    id: uxTaskId,
    projectId,
    sessionId,
    type: 'ux-agent',
    status: 'completed',
    executionStatus: 'completed',
    versionStatus: 'committed',
    inputContentHash: 'fixture-ux-input',
    outputContentHash: 'fixture-ux-output',
    observability: { repo: { repoPath, workingBranch: 'aifa/feature', baseBranch: 'aifa/feature' } },
  });
  // explicitly update versionStatus because Task.create defaults to 'draft'
  await prisma.task.update({ where: { id: uxTaskId }, data: { versionStatus: 'committed', status: 'completed', executionStatus: 'completed' } });
  t(`  -> UX Task.create id=${uxTaskId} status=completed versionStatus=committed`);

  // 1.5 seed the required UX artifacts (per REQUIRED_OUTPUT_KEYS['ux-agent'])
  const uxArtifacts = [
    { key: 'ux_spec',          content: '# UX Spec\n\nSimple login button + dialog.', kind: 'text' },
    { key: 'user_flow',        content: '1. User opens app.\n2. User clicks login.\n3. Dialog appears.', kind: 'text' },
    { key: 'wireframe_spec',   content: '- Top bar with login button\n- Modal dialog with email/password', kind: 'text' },
    { key: 'screens',          content: [{ name: 'Home', purpose: 'Entry', elements: ['LoginBtn'] }], kind: 'json' },
    { key: 'component_inventory', content: 'Button, Input, Modal', kind: 'text' },
    { key: 'html_mockup',      content: '<div><button>Login</button></div>', kind: 'text' },
  ];
  for (const a of uxArtifacts) {
    await AgentArtifact.bulkUpsert([{
      id: uuidv4(),
      taskId: uxTaskId,
      projectId,
      agentType: 'ux-agent',
      artifactType: a.key,
      artifactKey: `${a.key}:${uxTaskId}`,
      title: a.key,
      status: 'VALID',
      contentText: a.kind === 'text' ? a.content : null,
      contentJson: a.kind === 'json' ? a.content : null,
      ordinal: 0,
      contentHash: require('crypto').createHash('sha256').update(JSON.stringify(a.content)).digest('hex'),
    }]);
  }
  t(`  -> UX artifacts inserted: ${uxArtifacts.map((a) => a.key).join(', ')}`);

  // 1.6 create a2a_handoff for UX → DEV with the integrity hash
  const uxOutputHash = require('crypto').createHash('sha256')
    .update(JSON.stringify({ ux: 'fixture' })).digest('hex');
  await prisma.task.update({ where: { id: uxTaskId }, data: { outputContentHash: uxOutputHash } });
  const handoffEnvelope = {
    handoff_id: uuidv4(),
    schema_version: 'a2a_handoff.v1',
    project_id: projectId,
    from_agent: 'ux-agent',
    to_agent: 'dev-agent',
    source_task_id: uxTaskId,
    target_task_id: null,
    attempt: 1,
    input_artifacts: uxArtifacts.map((a) => ({ key: a.key, hash: 'fixture' })),
    output_artifact: { task_id: uxTaskId, hash: uxOutputHash },
    approval: { approval_id: 'fixture', type: 'auto', confidence: 0.9 },
    contract: { required_downstream_inputs: ['ux_spec', 'wireframe_spec', 'risk_classification'] },
    integrity: { artifact_hash: 'fixture', created_at: new Date().toISOString() },
    created_at: new Date().toISOString(),
  };
  await AgentArtifact.bulkUpsert([{
    id: uuidv4(),
    taskId: uxTaskId,
    projectId,
    agentType: 'ux-agent',
    artifactType: 'a2a_handoff',
    artifactKey: `a2a_handoff:${uxTaskId}:dev-agent`,
    title: 'UX to DEV handoff',
    contentJson: handoffEnvelope,
    ordinal: 999,
    contentHash: require('crypto').createHash('sha256').update(JSON.stringify(handoffEnvelope)).digest('hex'),
  }]);
  t(`  -> UX a2a_handoff inserted (output_hash=${uxOutputHash.slice(0, 12)}…)`);

  // 1.7 create PO task (required because orchestrator fetches PO artifacts too)
  const poTaskId = uuidv4();
  await Task.create({
    id: poTaskId,
    projectId,
    sessionId,
    type: 'po-agent',
    status: 'completed',
    executionStatus: 'completed',
    versionStatus: 'committed',
    inputContentHash: 'fixture-po-input',
    outputContentHash: 'fixture-po-output',
    observability: { repo: { repoPath } },
  });
  await prisma.task.update({ where: { id: poTaskId }, data: { versionStatus: 'committed', status: 'completed', executionStatus: 'completed' } });
  for (const [k, c] of [
    ['prd', '# PRD\nAdd login button.'],
    ['user_stories', [{ id: 'US-1', role: 'user', want: 'login', so_that: 'I sign in' }]],
    ['acceptance_criteria', ['AC-1: User can click login button.']],
    ['scope', '- Login button\n- Login dialog'],
    ['out_of_scope', '- Backend OAuth'],
  ]) {
    await AgentArtifact.bulkUpsert([{
      id: uuidv4(), taskId: poTaskId, projectId, agentType: 'po-agent',
      artifactType: k, artifactKey: `${k}:${poTaskId}`, title: k,
      status: 'VALID',
      contentText: typeof c === 'string' ? c : null,
      contentJson: typeof c === 'string' ? null : c,
      ordinal: 0,
      contentHash: require('crypto').createHash('sha256').update(JSON.stringify(c)).digest('hex'),
    }]);
  }
  const poOutputHash = require('crypto').createHash('sha256').update('po').digest('hex');
  await prisma.task.update({ where: { id: poTaskId }, data: { outputContentHash: poOutputHash } });
  const poHandoff = {
    ...handoffEnvelope, handoff_id: uuidv4(),
    from_agent: 'po-agent', to_agent: 'dev-agent',
    source_task_id: poTaskId,
    output_artifact: { task_id: poTaskId, hash: poOutputHash },
    created_at: new Date().toISOString(),
  };
  await AgentArtifact.bulkUpsert([{
    id: uuidv4(), taskId: poTaskId, projectId, agentType: 'po-agent',
    artifactType: 'a2a_handoff',
    artifactKey: `a2a_handoff:${poTaskId}:dev-agent`,
    title: 'PO to DEV handoff',
    contentJson: poHandoff, ordinal: 999,
    contentHash: require('crypto').createHash('sha256').update(JSON.stringify(poHandoff)).digest('hex'),
  }]);
  t(`  -> PO Task.create + PO artifacts + PO a2a_handoff inserted`);

  // ─── Now invoke the REAL DEV pipeline ───────────────────────────────────────
  console.log('\n=== STEP 2  SdlcWorkflowService.runDEVAgent begins ===');
  t('STEP 2  Controller invokes SdlcWorkflowService.runDEVAgent');

  const devTask = await svc.runDEVAgent({
    projectId,
    sourceTaskId: uxTaskId,
    feedbackPrompt: '',
    previousDraft: null,
    user: null,
  });
  t(`  -> DEV Task created id=${devTask.id}`);

  // ─── Wait until the DEV task reaches a terminal state ───────────────────────
  console.log('\n=== STEP 3  Polling DEV task until terminal ===');
  t('STEP 3  Poll DEV executionStatus every 2 s');
  const deadline = Date.now() + 240 * 1000; // 4 minutes
  let lastState = null;
  while (Date.now() < deadline) {
    const cur = await prisma.task.findUnique({ where: { id: devTask.id } });
    const snap = `${cur.executionStatus}/${cur.status} err=${cur.error ? cur.error.slice(0, 80) : ''}`;
    if (snap !== lastState) {
      t(`  -> DEV state: ${snap}`);
      lastState = snap;
    }
    if (['completed', 'failed', 'cancelled', 'timeout'].includes(cur.executionStatus)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // ─── Emit dump of everything ────────────────────────────────────────────────
  console.log('\n=== STEP 4  Final dump ===');
  t('STEP 4  Dump all DB evidence');
  const finalDev = await prisma.task.findUnique({ where: { id: devTask.id } });
  console.log('TASK:', JSON.stringify({
    id: finalDev.id, status: finalDev.status, executionStatus: finalDev.executionStatus,
    error: finalDev.error,
    observability: finalDev.observability,
    agentOutput: finalDev.agentOutput,
    result: finalDev.result,
  }, null, 2));

  const arts = await prisma.agentArtifact.findMany({ where: { taskId: devTask.id } });
  console.log('DEV ARTIFACTS count=' + arts.length);
  for (const a of arts) console.log('  ', a.artifactType, a.artifactKey);

  const events = await prisma.agentEvent.findMany({
    where: { taskId: devTask.id }, orderBy: { sequence: 'asc' },
  });
  console.log('DEV EVENTS count=' + events.length);
  for (const e of events) {
    console.log(`  seq=${e.sequence} ${e.createdAt.toISOString()} type=${e.type} actor=${e.actor}`,
      `payload=${(e.payload || '').slice(0, 200)}`);
  }

  const gates = await prisma.pendingGate.findMany({ where: { taskId: devTask.id } });
  console.log('DEV PENDING GATES count=' + gates.length);
  for (const g of gates) console.log('  ', g.kind, g.role, g.status);

  const hitl = await prisma.hitlDecision.findMany({ where: { taskId: devTask.id } });
  console.log('DEV HITL count=' + hitl.length);

  // git state of the fixture repo
  console.log('GIT (inside fixture repo):');
  try {
    console.log('  status:', execSync('git status --porcelain', { cwd: repoPath }).toString().trim());
    console.log('  diff --stat:', execSync('git diff --stat HEAD', { cwd: repoPath }).toString().trim());
    console.log('  log -1:', execSync('git log -1 --oneline', { cwd: repoPath }).toString().trim());
  } catch (e) {
    console.log('  git error:', e.message);
  }

  t('STEP 5  Trace complete.');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  console.error(err.stack);
  process.exit(1);
});