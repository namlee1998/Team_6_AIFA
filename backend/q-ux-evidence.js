// Production-bug evidence harness for UX task 97ed3bd3.
// Captures per-stage SHA256 + length + first/last 200 chars so the FIRST
// stage whose hash differs from the upstream stage is the root cause.
//
// Output is intentionally verbose — written to /tmp/aifa-verify/runtime-evidence.md.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const TASK_ID = '97ed3bd3-4c10-460d-b5b2-b55f4927e5e8';
const SESSION_ID = '479aefb4-fac9-4cb1-bfed-49e22c19301f';
const OUT = '/tmp/aifa-verify/runtime-evidence.md';

function sha256(s) {
  if (s == null) return '<null>';
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}
function len(s) { return s == null ? 0 : String(s).length; }
function peek(s, n = 200) {
  if (s == null) return '<null>';
  const t = String(s);
  return { first: t.slice(0, n), last: t.length > n ? t.slice(-n) : '<short>' };
}
function asString(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

async function main() {
  const p = new PrismaClient();
  const lines = [];
  const stamp = new Date().toISOString();
  lines.push(`# Runtime evidence — UX task ${TASK_ID} (live pipeline)`);
  lines.push(`Captured at: ${stamp}`);
  lines.push('');

  // ── Layer 1 — Task row (executionStatus, observability, agentOutput)
  const task = await p.Task.findUnique({ where: { id: TASK_ID } });
  if (!task) { lines.push(`Task ${TASK_ID} not found in DB`); }
  else {
    lines.push(`## Layer 1 — Task row`);
    lines.push(`- type: ${task.type}`);
    lines.push(`- sessionId: ${task.sessionId}`);
    lines.push(`- projectId: ${task.projectId}`);
    lines.push(`- executionStatus: ${task.executionStatus}`);
    lines.push(`- versionStatus: ${task.versionStatus}`);
    lines.push(`- retryCount: ${task.retryCount}`);
    lines.push(`- startedAt: ${task.startedAt?.toISOString?.() || task.startedAt}`);
    lines.push(`- finishedAt: ${task.finishedAt?.toISOString?.() || task.finishedAt}`);
    lines.push(`- outputContentHash: ${task.outputContentHash}`);
    lines.push('');
    lines.push('### agentOutput');
    const ao = task.agentOutput;
    const aoStr = asString(ao);
    lines.push(`- type: ${typeof ao}`);
    lines.push(`- serialized length: ${len(aoStr)}`);
    lines.push(`- sha256: ${sha256(aoStr)}`);
    const peek1 = peek(aoStr, 200);
    lines.push(`- first 200: ${peek1.first}`);
    lines.push(`- last 200:  ${peek1.last}`);
    if (ao && typeof ao === 'object') {
      lines.push(`- top-level keys: ${Object.keys(ao).join(', ')}`);
      if (ao.html_mockup !== undefined) {
        lines.push(`- html_mockup.length: ${len(ao.html_mockup)}`);
        lines.push(`- html_mockup.sha256: ${sha256(ao.html_mockup)}`);
        lines.push(`- html_mockup last 200: ${String(ao.html_mockup).slice(-200)}`);
      }
      if (ao.screens !== undefined) {
        lines.push(`- screens.type: ${typeof ao.screens}`);
        lines.push(`- screens.value: ${JSON.stringify(ao.screens).slice(0,400)}`);
      }
      if (ao.component_inventory !== undefined) {
        lines.push(`- component_inventory.type: ${typeof ao.component_inventory}`);
        lines.push(`- component_inventory.value (truncated): ${JSON.stringify(ao.component_inventory).slice(0,400)}`);
      }
    }
    lines.push('');
    lines.push('### observability');
    const ob = task.observability;
    const obStr = asString(ob);
    lines.push(`- type: ${typeof ob}`);
    lines.push(`- serialized length: ${len(obStr)}`);
    lines.push(`- sha256: ${sha256(obStr)}`);
    lines.push(`- keys: ${ob && typeof ob === 'object' ? Object.keys(ob).join(', ') : 'n/a'}`);
    if (ob && typeof ob === 'object') {
      lines.push(`- cli_session_id: ${ob.cli_session_id}`);
      lines.push(`- cli_total_cost_usd: ${ob.cli_total_cost_usd}`);
      lines.push(`- num_turns: ${ob.num_turns}`);
      lines.push(`- stop_reason: ${ob.stop_reason}`);
      lines.push(`- runner: ${ob.runner}`);
      lines.push(`- output_contract: ${ob.output_contract}`);
    }
    lines.push('');
  }

  // ── Layer 2 — AgentArtifact rows
  const artifacts = await p.AgentArtifact.findMany({
    where: { taskId: TASK_ID },
    orderBy: [{ ordinal: 'asc' }, { createdAt: 'asc' }],
  });
  lines.push(`## Layer 2 — AgentArtifact rows (${artifacts.length})`);
  for (const a of artifacts) {
    lines.push(`### artifact_type=${a.artifactType} key=${a.artifactKey} status=${a.status}`);
    lines.push(`- contentText.length: ${len(a.contentText)}`);
    lines.push(`- contentJson.length: ${len(a.contentJson)}`);
    lines.push(`- contentText.sha256: ${sha256(a.contentText)}`);
    lines.push(`- contentJson.sha256: ${sha256(a.contentJson)}`);
    const ctPeek = peek(a.contentText, 200);
    lines.push(`- contentText first 200: ${ctPeek.first}`);
    lines.push(`- contentText last 200:  ${ctPeek.last}`);
    if (a.contentText && a.contentText.startsWith('FILE:')) {
      const filepath = a.contentText.slice('FILE:'.length);
      lines.push(`- FILE path: ${filepath}`);
      try {
        const stat = await fs.stat(filepath);
        lines.push(`- File exists: size=${stat.size}`);
        const raw = await fs.readFile(filepath, 'utf8');
        lines.push(`- File sha256: ${sha256(raw)}`);
        lines.push(`- File length: ${len(raw)}`);
        const filePeek = peek(raw, 200);
        lines.push(`- File first 200: ${filePeek.first}`);
        lines.push(`- File last 200:  ${filePeek.last}`);
      } catch (e) {
        lines.push(`- File read FAILED: ${e.message}`);
      }
    }
    if (a.contentJson) {
      let parsed = null;
      try { parsed = JSON.parse(a.contentJson); } catch (_) { parsed = null; }
      if (parsed) {
        lines.push(`- contentJson type: ${typeof parsed}${Array.isArray(parsed) ? ' (array)' : ''}`);
        if (Array.isArray(parsed)) {
          lines.push(`- contentJson array length: ${parsed.length}`);
          lines.push(`- first item: ${JSON.stringify(parsed[0]).slice(0,300)}`);
        } else {
          lines.push(`- contentJson keys: ${Object.keys(parsed).join(', ')}`);
        }
      }
    }
    lines.push('');
  }

  // ── Layer 3 — PendingGate rows
  const gates = await p.PendingGate.findMany({
    where: { taskId: TASK_ID },
    orderBy: { createdAt: 'asc' },
  });
  lines.push(`## Layer 3 — PendingGate rows (${gates.length})`);
  for (const g of gates) {
    lines.push(`### gate id=${g.id} kind=${g.kind} status=${g.status}`);
    lines.push(`- createdAt: ${g.createdAt?.toISOString?.() || g.createdAt}`);
    lines.push(`- approvalAction: ${g.action}`);
    lines.push(`- payload sha256: ${sha256(JSON.stringify(g.payload))}`);
    const payloadStr = asString(g.payload);
    lines.push(`- payload length: ${len(payloadStr)}`);
    lines.push(`- payload first 400: ${peek(payloadStr, 400).first}`);
    if (payloadStr && payloadStr.length > 400) {
      lines.push(`- payload last 200:  ${peek(payloadStr, 200).last}`);
    }
    lines.push('');
  }

  // ── Layer 4 — AgentEvent rows (sequence)
  const events = await p.AgentEvent.findMany({
    where: { taskId: TASK_ID },
    orderBy: [{ sequence: 'asc' }],
  });
  lines.push(`## Layer 4 — AgentEvent rows (${events.length})`);
  const seqSeen = new Set();
  let dupes = 0;
  for (const e of events) {
    if (seqSeen.has(e.sequence)) dupes += 1;
    seqSeen.add(e.sequence);
    lines.push(`- seq=${e.sequence} type=${e.type} subtype=${e.subtype || '-'} createdAt=${e.createdAt?.toISOString?.() || e.createdAt}`);
  }
  lines.push(`- duplicate sequences: ${dupes}`);
  lines.push('');

  // ── Layer 5 — HitlDecision rows (AskUserQuestion resolutions)
  const decisions = await p.HitlDecision.findMany({
    where: { taskId: TASK_ID },
    orderBy: { createdAt: 'asc' },
  });
  lines.push(`## Layer 5 — HitlDecision rows (${decisions.length})`);
  for (const d of decisions) {
    lines.push(`### decision ${d.id} action=${d.action} gateKind=${d.gateKind}`);
    lines.push(`- payload sha256: ${sha256(JSON.stringify(d.payload))}`);
    const payloadStr = asString(d.payload);
    lines.push(`- payload length: ${len(payloadStr)}`);
    lines.push(`- payload first 400: ${peek(payloadStr, 400).first}`);
    if (payloadStr && payloadStr.length > 400) {
      lines.push(`- payload last 200:  ${peek(payloadStr, 200).last}`);
    }
    lines.push('');
  }

  await fs.writeFile(OUT, lines.join('\n'), 'utf8');
  console.log(`Wrote ${lines.length} lines to ${OUT}`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
