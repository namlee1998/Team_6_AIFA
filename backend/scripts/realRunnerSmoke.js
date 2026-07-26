#!/usr/bin/env node
/**
 * Phase 1 — real Claude Agent SDK runner smoke (no DB/UI).
 *
 * Runs ONE real PO stage through claudeCodeRunner (the SDK adapter) with a fake
 * AIFA-shaped onGate, and verifies:
 *   1. canUseTool is wired to onGate (questions answered, tools gated),
 *   2. file paths reaching onGate are repo-RELATIVE (the Windows abs-path fix),
 *   3. the final output parses to agent-io.v3 with the role's required non-empty keys.
 *
 * Uses your local Claude Code login. Run: node scripts/realRunnerSmoke.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const runner = require('../src/agents/claudeCodeRunner');

const trunc = (v, n = 400) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}…` : s;
};

function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifa-real-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Demo app\n\nA small web app. We want to add Google login.\n');
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), "// app entry\nconsole.log('app');\n");
  return dir;
}

(async () => {
  console.log('▶  Real Claude Agent SDK runner smoke (PO stage)\n');
  const repoPath = fixtureRepo();
  console.log(`   fixture repo: ${repoPath}\n`);

  const seen = { questions: 0, tools: 0, absPaths: 0, relPaths: 0 };

  // Fake onGate with the SAME contract AIFA's _makeOnGate uses.
  const onGate = async (toolName, input) => {
    if (toolName === 'AskUserQuestion') {
      seen.questions += 1;
      const questions = input.questions || [];
      const answers = {};
      for (const qq of questions) answers[qq.question] = qq.options?.[0]?.label || 'ok';
      console.log(`🟣 question gate: ${trunc(questions.map((x) => x.question).join(' | '), 200)}`);
      console.log('   → answering:', JSON.stringify(answers));
      return { behavior: 'allow', updatedInput: { questions, answers } };
    }
    seen.tools += 1;
    const fp = input.file_path || '';
    const isAbs = path.isAbsolute(fp) || /^[a-zA-Z]:/.test(fp);
    if (fp) (isAbs ? seen.absPaths++ : seen.relPaths++);
    console.log(`🟡 tool gate: ${toolName} file_path=${trunc(fp, 120)} ${isAbs ? '⚠️ABS' : '(rel)'}`);
    return { behavior: 'allow' };
  };

  try {
    const { output, cliSessionId } = await runner.runAgent({
      role: 'po-agent',
      repoPath,
      taskId: 'real-smoke-po',
      context: {
        featureRequest: { title: 'Add Google login', description: 'Let users sign in with Google (OAuth 2.0).', priority: 'High' },
        repoContext: { repoPath },
      },
      onGate,
      onProgress: () => {},
      timeoutMs: Number(process.env.SPIKE_TIMEOUT_MS) || 300000,
    });

    const hasPrd = !!output.prd;
    const hasAc = output.acceptance_criteria != null;
    console.log('\n── findings ──────────────────────────────');
    console.log('question-gate calls:', seen.questions, '| tool-gate calls:', seen.tools,
      `| paths to gate: rel=${seen.relPaths} abs=${seen.absPaths}`);
    console.log('output keys:', Object.keys(output).slice(0, 18).join(', '));
    console.log('prd present:', hasPrd, '| acceptance_criteria present:', hasAc, '| session:', cliSessionId);

    const pass = hasPrd && hasAc && seen.absPaths === 0;
    console.log(`\n${pass ? '✅ PASS' : '⚠️  CHECK'} — real PO output conforms${seen.absPaths ? ' (but ABSOLUTE paths reached the gate!)' : ''}`);
    process.exit(pass ? 0 : 1);
  } catch (e) {
    console.error('\n❌ FAIL:', e.code || '', e.message);
    if (e.missing) console.error('   missing required keys:', e.missing.join(', '));
    if (e.rawResult) console.error('   raw result (first 600):', trunc(e.rawResult, 600));
    process.exit(1);
  }
})();
