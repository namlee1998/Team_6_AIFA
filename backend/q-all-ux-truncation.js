// Audit ALL UX tasks across all projects — find any completed task with truncated html_mockup
const fs = require('fs/promises');
const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();
const OUT = '/tmp/aifa-verify/all-ux-truncation-audit.md';

function len(s) { return s == null ? 0 : String(s).length; }
function isValidHtml5(s) {
  if (!s) return false;
  const t = String(s).trim();
  return t.startsWith('<!DOCTYPE html>') && t.endsWith('</html>');
}
async function main() {
  const tasks = await p.Task.findMany({
    where: { type: 'ux-agent' },
    orderBy: { createdAt: 'desc' },
  });
  const lines = [];
  lines.push(`# All UX tasks — html_mockup truncation audit`);
  lines.push(`Captured at: ${new Date().toISOString()}`);
  lines.push(`Total UX tasks in DB: ${tasks.length}`);
  lines.push('');
  lines.push(`| task_id | status | agentOutput.html_mockup_len | ends with </html> | DB AgentArtifact.html_mockup file size |`);
  lines.push(`|---------|--------|-------------------------------|--------------------|-------------------------------------|`);
  let truncated = 0;
  let completedButTruncated = 0;
  for (const t of tasks) {
    const ao = t.agentOutput;
    let inMemHtml = null;
    if (ao && typeof ao === 'object' && ao.html_mockup !== undefined) {
      inMemHtml = String(ao.html_mockup);
    } else if (typeof ao === 'string') {
      try {
        const parsed = JSON.parse(ao);
        inMemHtml = parsed.html_mockup;
      } catch (_) {}
    }
    // Get DB artifact
    const artifacts = await p.AgentArtifact.findMany({
      where: { taskId: t.id, artifactType: 'html_mockup' },
    });
    let fileBytes = 0;
    let fileValid = false;
    if (artifacts[0]?.contentText?.startsWith('FILE:')) {
      try {
        const fpath = artifacts[0].contentText.slice(5);
        const stat = await fs.stat(fpath);
        fileBytes = stat.size;
        const raw = await fs.readFile(fpath, 'utf8');
        fileValid = isValidHtml5(raw);
      } catch (e) {}
    }
    const inMemValid = isValidHtml5(inMemHtml);
    const truncatedFlag = !fileValid;
    if (truncatedFlag) truncated++;
    if (t.executionStatus === 'completed' && truncatedFlag) completedButTruncated++;
    lines.push(`| ${t.id.slice(0,8)} | ${t.executionStatus} | ${len(inMemHtml)} | ${inMemValid} | ${fileBytes} (valid=${fileValid}) |`);
  }
  lines.push('');
  lines.push(`## Summary`);
  lines.push(`- Total UX tasks: ${tasks.length}`);
  lines.push(`- Truncated html_mockup (any status): ${truncated}`);
  lines.push(`- **COMPLETED BUT TRUNCATED: ${completedButTruncated}** <-- THIS IS THE BUG`);
  lines.push('');
  await fs.writeFile(OUT, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUT}`);
  console.log(`Summary: total=${tasks.length} truncated=${truncated} completed_but_truncated=${completedButTruncated}`);
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
