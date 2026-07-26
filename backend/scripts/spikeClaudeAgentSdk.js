#!/usr/bin/env node
/**
 * Phase 0 — Claude Agent SDK spike (per docs/HANDOVER spec).
 *
 * Goal: verify the REAL behaviour of @anthropic-ai/claude-agent-sdk against the
 * local Claude Code login, before wiring it into the workflow. We confirm:
 *   1. query({ prompt, options }) runs with options.cwd = a repo fixture,
 *   2. canUseTool fires for tool permissions (Write/Edit/Bash...),
 *   3. canUseTool fires for AskUserQuestion (clarifying questions) and we can
 *      answer it,
 *   4. we can return allow / deny,
 *   5. we can read the final message and find structured output,
 *   6. we log the REAL message + canUseTool input shapes so the adapter doesn't
 *      have to guess.
 *
 * Run: node scripts/spikeClaudeAgentSdk.js
 * Auth: uses your local Claude Code login (no ANTHROPIC_API_KEY required).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const trunc = (v, n = 600) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? `${s.slice(0, n)}…<truncated ${s.length - n}>` : s;
};

function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifa-spike-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Spike fixture\n\nA tiny repo for the AIFA Claude Agent SDK spike.\n');
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), "console.log('hello from fixture');\n");
  return dir;
}

(async () => {
  console.log('▶  Claude Agent SDK spike\n');

  let query;
  try {
    ({ query } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch (e) {
    console.error('❌ Could not import @anthropic-ai/claude-agent-sdk:', e.message);
    console.error('   Install it first: cd backend && npm i @anthropic-ai/claude-agent-sdk');
    process.exit(1);
  }

  const repoPath = makeFixtureRepo();
  console.log(`   fixture repo: ${repoPath}\n`);

  const seen = { askUserQuestion: 0, toolPermission: 0, denied: 0, messageTypes: {} };
  let toolApprovals = 0;

  // canUseTool: the SAME role AIFA's onGate plays. Log everything, answer the
  // clarifying question, approve the first write, deny a Bash to prove deny works.
  const canUseTool = async (toolName, input, opts) => {
    if (toolName === 'AskUserQuestion') {
      seen.askUserQuestion += 1;
      console.log('🟣 canUseTool[AskUserQuestion] input =', trunc(input, 1200));
      const questions = input.questions || [];
      const answers = {};
      for (const q of questions) {
        const first = (q.options || [])[0]?.label || 'ok';
        answers[q.question] = first;
      }
      console.log('   → answering with first option(s):', JSON.stringify(answers));
      return { behavior: 'allow', updatedInput: { questions, answers } };
    }

    seen.toolPermission += 1;
    console.log(`🟡 canUseTool[${toolName}] input =`, trunc(input, 800),
      opts?.suggestions ? `(suggestions: ${opts.suggestions.length})` : '');

    if (toolName === 'Bash') {
      seen.denied += 1;
      console.log('   → DENY (spike proves deny path for Bash)');
      return { behavior: 'deny', message: 'Bash denied by spike policy' };
    }
    toolApprovals += 1;
    console.log('   → ALLOW');
    return { behavior: 'allow', updatedInput: input };
  };

  const prompt = [
    'You are setting up this small repo. Do these steps:',
    '1. FIRST call the AskUserQuestion tool to ask me whether the config format should be JSON or YAML (give those two options).',
    '2. Then create a file `config.<ext>` in the repo root in the chosen format with a single sample setting `appName: aifa-spike`.',
    '3. Then try to run `ls` via the Bash tool (this will be denied — that is expected).',
    '4. Finally, reply with EXACTLY one fenced ```json block: {"ok": true, "format": "<the chosen format>", "wrote": "<the filename>"}.',
    'Keep everything minimal.',
  ].join('\n');

  const TIMEOUT_MS = Number(process.env.SPIKE_TIMEOUT_MS) || 180000;
  const started = Date.now();
  let finalText = '';

  try {
    const q = query({
      prompt,
      options: {
        cwd: repoPath,
        permissionMode: 'default',
        canUseTool,
        // keep it bounded
        ...(process.env.SPIKE_MODEL ? { model: process.env.SPIKE_MODEL } : {}),
      },
    });

    const timer = setTimeout(() => { try { q.interrupt?.(); } catch {} }, TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();

    for await (const message of q) {
      seen.messageTypes[message.type] = (seen.messageTypes[message.type] || 0) + 1;
      if (message.type === 'system') {
        console.log(`⚙  system/${message.subtype || ''}`, trunc(message, 300));
      } else if (message.type === 'assistant' || message.type === 'user') {
        const blocks = message.message?.content || [];
        for (const b of Array.isArray(blocks) ? blocks : []) {
          if (b.type === 'text') console.log(`💬 ${message.type}.text:`, trunc(b.text, 300));
          else if (b.type === 'tool_use') console.log(`🔧 ${message.type}.tool_use:`, b.name, trunc(b.input, 200));
          else console.log(`▫  ${message.type}.${b.type}`);
        }
      } else if (message.type === 'result') {
        finalText = message.result || '';
        console.log(`🏁 result/${message.subtype || ''}`, '| is_error:', message.is_error,
          '| cost$:', message.total_cost_usd, '| turns:', message.num_turns);
      } else {
        console.log(`▫  message.type=${message.type}`);
      }
    }
    clearTimeout(timer);
  } catch (e) {
    console.error('\n❌ query failed:', e.message);
    console.error('   (auth? run `claude login`. Or set SPIKE_MODEL / ANTHROPIC_API_KEY.)');
    process.exit(1);
  }

  // Parse the final structured block.
  let parsed = null;
  const fenced = finalText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  try { parsed = JSON.parse((fenced?.[1] || finalText).trim()); } catch {}

  const wroteConfig = fs.readdirSync(repoPath).find((f) => /^config\.(json|ya?ml)$/i.test(f));

  console.log('\n── Spike findings ──────────────────────────────');
  console.log('message types seen:', JSON.stringify(seen.messageTypes));
  console.log('AskUserQuestion canUseTool calls:', seen.askUserQuestion);
  console.log('tool-permission canUseTool calls:', seen.toolPermission, '| approvals:', toolApprovals, '| denies:', seen.denied);
  console.log('config file written to repo:', wroteConfig || '(none)');
  console.log('final structured output parsed:', parsed ? JSON.stringify(parsed) : '(not parseable)');
  console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const pass = seen.askUserQuestion >= 1 && seen.toolPermission >= 1;
  console.log(`\n${pass ? '✅ PASS' : '⚠️  PARTIAL'} — canUseTool ${pass ? 'fired for both questions AND tools' : 'did not fire for both (see log above)'}`);
  console.log('\nKeep the log above: it is the real canUseTool/message shape the adapter must read.');
  process.exit(0);
})();
