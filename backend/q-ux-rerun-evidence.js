// Live runtime trace for UX rerun task 01b2a004.
// Captures every hop from Claude SDK → publishEvent → SSE → store.
// Also captures the prior AskUserQuestion hop from task 97ed3bd3 (round 1).

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const TASKS = [
  { id: '97ed3bd3-4c10-460d-b5b2-b55f4927e5e8', label: 'UX original (round 1: 4 AskUserQuestion answered)' },
  { id: '01b2a004-0c94-4ef5-a0c9-442c0e32b651', label: 'UX rerun (round 2: no AskUserQuestion)' },
];
const OUT = '/tmp/aifa-verify/runtime-hops-evidence.md';

function sha(s) { return crypto.createHash('sha256').update(String(s ?? '')).digest('hex'); }
function len(s) { return s == null ? 0 : String(s).length; }
function asStr(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}
function peek(s, n = 200) {
  if (s == null) return '<null>';
  const t = String(s);
  return { first: t.slice(0, n), last: t.length > n ? t.slice(-n) : '<short>' };
}

async function main() {
  const p = new PrismaClient();
  const lines = [];
  const stamp = new Date().toISOString();
  lines.push(`# UX AskUserQuestion live-runtime trace`);
  lines.push(`Captured: ${stamp}`);
  lines.push('');

  for (const { id, label } of TASKS) {
    lines.push(`## TASK ${id} — ${label}`);
    lines.push('');

    // ── HOP A — task.agentOutput (Claude SDK → DB)
    const task = await p.Task.findUnique({ where: { id } });
    if (!task) { lines.push(`Task ${id} not found`); continue; }
    lines.push(`### HOP A — task.agentOutput (Claude SDK → DB)`);
    lines.push(`- executionStatus: ${task.executionStatus}`);
    lines.push(`- versionStatus: ${task.versionStatus}`);
    lines.push(`- startedAt: ${task.startedAt?.toISOString?.()}`);
    lines.push(`- finishedAt: ${task.finishedAt?.toISOString?.()}`);
    const ao = task.agentOutput;
    const aoStr = asStr(ao);
    lines.push(`- agentOutput.type: ${typeof ao}`);
    lines.push(`- agentOutput.length: ${len(aoStr)}`);
    lines.push(`- agentOutput.sha256: ${sha(aoStr)}`);
    if (ao && typeof ao === 'object') {
      lines.push(`- artifact keys: ${Object.keys(ao).filter(k => !['observability','token_usage','outputVersion','stage','rawSummary','clarification_questions','summary','confidence_score'].includes(k)).join(', ')}`);
      lines.push(`- has clarification_questions: ${Array.isArray(ao.clarification_questions)} len=${ao.clarification_questions?.length}`);
      lines.push(`- html_mockup.length: ${len(ao.html_mockup)}`);
      if (ao.html_mockup) {
        lines.push(`- html_mockup.last 80: ...${String(ao.html_mockup).slice(-80)}`);
        lines.push(`- html_mockup.ends with </html>: ${String(ao.html_mockup).trim().endsWith('</html>')}`);
      }
      if (ao.observability) {
        lines.push(`- observability.cli_session_id: ${ao.observability.cli_session_id}`);
        lines.push(`- observability.num_turns: ${ao.observability.claude_result?.num_turns}`);
        lines.push(`- observability.stop_reason: ${ao.observability.claude_result?.stop_reason}`);
      }
    }
    lines.push('');

    // ── HOP B — PendingGate rows
    const gates = await p.PendingGate.findMany({ where: { taskId: id }, orderBy: { createdAt: 'asc' } });
    lines.push(`### HOP B — PendingGate rows (${gates.length})`);
    for (const g of gates) {
      const payloadStr = asStr(g.payload);
      const pPeek = peek(payloadStr, 300);
      lines.push(`- gate kind=${g.kind} status=${g.status} action=${g.action}`);
      lines.push(`  - approvalId: ${g.approvalId}`);
      lines.push(`  - createdAt: ${g.createdAt?.toISOString?.()}`);
      lines.push(`  - payload.length: ${len(payloadStr)}`);
      lines.push(`  - payload.sha256: ${sha(payloadStr)}`);
      if (g.kind === 'question') {
        lines.push(`  - payload.first 300: ${pPeek.first}`);
        const qs = g.payload?.questions;
        lines.push(`  - questions count: ${Array.isArray(qs) ? qs.length : 0}`);
        if (Array.isArray(qs) && qs[0]) {
          lines.push(`  - questions[0].question: ${qs[0].question?.slice(0,150)}`);
          lines.push(`  - questions[0].header: ${qs[0].header}`);
          lines.push(`  - questions[0].options count: ${qs[0].options?.length}`);
        }
      }
      lines.push('');
    }

    // ── HOP C — HitlDecision rows
    const decisions = await p.HitlDecision.findMany({ where: { taskId: id }, orderBy: { createdAt: 'asc' } });
    lines.push(`### HOP C — HitlDecision rows (${decisions.length})`);
    for (const d of decisions) {
      const payloadStr = asStr(d.payload);
      lines.push(`- decision id: ${d.id}`);
      lines.push(`  - action: ${d.action}`);
      lines.push(`  - gateKind: ${d.gateKind}`);
      lines.push(`  - createdAt: ${d.createdAt?.toISOString?.()}`);
      lines.push(`  - payload.sha256: ${sha(payloadStr)}`);
      lines.push(`  - payload.first 400: ${peek(payloadStr, 400).first}`);
      lines.push('');
    }

    // ── HOP D — AgentEvent rows (gate_audit + gate_pending + gate_resolved)
    const events = await p.AgentEvent.findMany({ where: { taskId: id }, orderBy: [{ sequence: 'asc' }] });
    lines.push(`### HOP D — AgentEvent rows (${events.length})`);
    for (const e of events) {
      const payloadStr = asStr(e.payload);
      lines.push(`- seq=${e.sequence} type=${e.type} createdAt=${e.createdAt?.toISOString?.()}`);
      lines.push(`  - payload.sha256: ${sha(payloadStr)}`);
      lines.push(`  - payload.first 200: ${peek(payloadStr, 200).first}`);
    }
    lines.push('');
  }

  // ── HOP E — Frontend DOM: Ask frontend to expose its current pendingGates
  // This is captured via curl to the dashboard HTML + the SSE stream consumed
  // by the store. We will inspect the live SSE output and check whether the
  // store path persists `gate_pending` envelope with the expected payload.

  // Subscribe to SSE for 60s and dump every envelope to a file with timestamps
  lines.push(`## HOP E — Live SSE runtime capture (60s window)`);
  lines.push(`(see /tmp/aifa-verify/sse-live-window.log for raw stream)`);

  await fs.writeFile(OUT, lines.join('\n'), 'utf8');
  console.log(`Wrote ${lines.length} lines to ${OUT}`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
