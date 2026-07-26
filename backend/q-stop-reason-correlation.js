// Investigate correlation between observability.claude_result fields and html_mockup validity
const fs = require('fs/promises');
const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();
const OUT = '/tmp/aifa-verify/stop-reason-correlation.md';

function safeStr(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}
function isValidHtml5(s) {
  if (!s) return false;
  const t = String(s).trim();
  return t.startsWith('<!DOCTYPE html>') && t.endsWith('</html>');
}
function parseObs(obsRaw) {
  if (!obsRaw) return {};
  if (typeof obsRaw === 'object') return obsRaw;
  try { return JSON.parse(obsRaw); } catch (_) { return {}; }
}

async function main() {
  const tasks = await p.Task.findMany({
    where: { type: 'ux-agent' },
    orderBy: { createdAt: 'desc' },
  });
  const lines = [];
  lines.push(`# Correlation: observability.claude_result.* × html_mockup validity × executionStatus`);
  lines.push(`Captured: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`| task_id | execStatus | cli_session_id | subtype | stop_reason | num_turns | is_error | html_valid |`);
  lines.push(`|---------|------------|----------------|---------|-------------|-----------|----------|-----------|`);

  for (const t of tasks) {
    const obs = parseObs(t.observability);
    let html = null;
    if (t.agentOutput) {
      if (typeof t.agentOutput === 'object') html = t.agentOutput.html_mockup;
      else { try { html = JSON.parse(t.agentOutput).html_mockup; } catch (_) {} }
    }
    const artifacts = await p.AgentArtifact.findMany({
      where: { taskId: t.id, artifactType: 'html_mockup' },
    });
    let valid = false;
    if (artifacts[0]?.contentText?.startsWith('FILE:')) {
      try {
        const raw = await fs.readFile(artifacts[0].contentText.slice(5), 'utf8');
        valid = isValidHtml5(raw);
      } catch (_) {}
    }
    const cr = obs.claude_result || {};
    const sessId = obs.cli_session_id ? obs.cli_session_id.slice(0, 8) : '-';
    lines.push(`| ${t.id.slice(0,8)} | ${t.executionStatus} | ${sessId} | ${cr.subtype || '-'} | ${cr.stop_reason || '-'} | ${cr.num_turns ?? '-'} | ${obs.is_error ?? '-'} | ${valid} |`);
  }
  lines.push('');
  lines.push(`## Pattern summary`);
  const completedWithStopReasonError = tasks.filter(t => {
    const obs = parseObs(t.observability);
    return t.executionStatus === 'completed' && obs.claude_result?.stop_reason === 'error';
  });
  const completedValid = tasks.filter(t => {
    let html = null;
    if (t.agentOutput && typeof t.agentOutput === 'object') html = t.agentOutput.html_mockup;
    if (typeof t.agentOutput === 'string') { try { html = JSON.parse(t.agentOutput).html_mockup; } catch(_){} }
    return t.executionStatus === 'completed' && html && isValidHtml5(html);
  });
  const completedButNotValid = tasks.filter(t => {
    let html = null;
    if (t.agentOutput && typeof t.agentOutput === 'object') html = t.agentOutput.html_mockup;
    if (typeof t.agentOutput === 'string') { try { html = JSON.parse(t.agentOutput).html_mockup; } catch(_){} }
    return t.executionStatus === 'completed' && html && !isValidHtml5(html);
  });
  lines.push(`- Total UX tasks: ${tasks.length}`);
  lines.push(`- Completed with stop_reason='error': ${completedWithStopReasonError.length}`);
  lines.push(`- Completed with valid html_mockup: ${completedValid.length}`);
  lines.push(`- Completed with INVALID html_mockup: ${completedButNotValid.length} <-- THIS IS THE BUG IF > 0`);

  // Also look at completed tasks' stop_reason distribution
  const stopReasonDist = {};
  for (const t of tasks) {
    const obs = parseObs(t.observability);
    const sr = obs.claude_result?.stop_reason || 'null';
    const k = `${t.executionStatus} | stop_reason=${sr}`;
    stopReasonDist[k] = (stopReasonDist[k] || 0) + 1;
  }
  lines.push('');
  lines.push(`## executionStatus × stop_reason distribution`);
  for (const [k, v] of Object.entries(stopReasonDist)) lines.push(`- ${k}: ${v}`);

  await fs.writeFile(OUT, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUT}`);
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
