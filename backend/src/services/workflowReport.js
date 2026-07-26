// Release-bundle writer.
//
// Beginner reading guide: after an owner/admin approves release, this service
// combines resolved artifacts, audit events, evidence, and git metadata into
// final.md and qa-report.md. It writes into the server repo copy when available.
//
// On RELEASED, assemble a multi-part release bundle in the cloned repo:
//   1) working branch  2) commit/patch diff  3) final.md  4) QA report
//   5) release decision. final.md gathers the audit trail + PO/UX/DEV/QA
//   summaries + release evidence. FILE:<path> refs are resolved upstream
//   (artifacts arrive already resolved from getFinalReviewPacket).

const fs = require('fs/promises');
const path = require('path');
const repoService = require('./repoService');
const logger = require('../config/logger');

function section(title, body) {
  return `\n\n## ${title}\n\n${body || '_none_'}`;
}

function artifactText(artifacts, phase, type) {
  const a = (artifacts || []).find((x) => (x.phase === phase || x.agentType === phase) && (x.type === type || x.artifactType === type));
  if (!a) return null;
  if (typeof a.contentText === 'string' && a.contentText.trim()) return a.contentText;
  if (a.contentJson) return '```json\n' + JSON.stringify(a.contentJson, null, 2) + '\n```';
  return null;
}

function joinedArtifacts(artifacts, phase, types) {
  return types
    .map((type) => {
      const body = artifactText(artifacts, phase, type);
      return body ? `### ${type.replace(/_/g, ' ')}\n\n${body}` : null;
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Build the final.md markdown from the review packet, audit trail, and evidence. */
function buildFinalMarkdown({ projectId, session, repoContext, packet, audit, evidence, releaseDecision, diff }) {
  const artifacts = packet?.artifacts || [];
  const when = new Date().toISOString();
  let md = `# AIFA Release Report\n\n- Project: \`${projectId}\`\n- Generated: ${when}\n- Decision: **${releaseDecision?.decision || 'APPROVE'}**`;

  // T8 (B9) — spec §13 final.md mandates 10 sections. Each section is
  // present unconditionally (rendered as `_none_` when no data) so the
  // format is stable for downstream automation / PR templates.

  // 1. Repository — URL, base branch, working branch, commit SHA.
  md += section('Repository', (() => {
    const live = repoContext || {};
    const sha = (live.commitHash || '').slice(0, 7) || 'unknown';
    return [
      `- Repository URL: \`${live.repoUrl || '_none_'}\``,
      `- Base branch: \`${live.baseBranch || 'main'}\``,
      `- Working branch: \`${live.workingBranch || '_unknown_'}\``,
      `- Commit SHA: \`${sha}\``,
    ].join('\n');
  })());

  // 2. Feature Request — original user request (NOT the parsed JSON).
  md += section('Feature Request', evidence?.feature ? String(evidence.feature) : null);

  // 3. ARCH Output — full architecture_brief.
  md += section('ARCH Output (architecture.md)', joinedArtifacts(artifacts, 'architecture-agent', ['architecture_brief']));

  // 4. PO Output — full product-spec.md (prd + acceptance_criteria).
  md += section('PO Output (product-spec.md)', joinedArtifacts(artifacts, 'po-agent', ['prd', 'acceptance_criteria']));

  // 5. UX Output — full ux-design.md.
  md += section('UX Output (ux-design.md)', artifactText(artifacts, 'ux-agent', 'ux_spec'));

  // 6. DEV Output — diff summary + changed-file list. Prefer the
  // git-captured diff; fall back to the dev-agent.patch_diff artifact
  // (saved at approve time) when the live repo isn't available.
  const effectiveDiff = diff || artifactText(artifacts, 'dev-agent', 'patch_diff') || '';
  const changedFiles = effectiveDiff
    ? effectiveDiff.split('\n').filter((l) => l.startsWith('diff --git ')).map((l) => l.replace(/^diff --git a\//, '').split(' b/')[0])
    : [];
  md += section('DEV Output (diff + file list)', [
    changedFiles.length ? `Changed files (${changedFiles.length}):\n${changedFiles.map((f) => `  - \`${f}\``).join('\n')}` : null,
    effectiveDiff ? `\`\`\`diff\n${effectiveDiff.slice(0, 8000)}\n\`\`\`` : null,
  ].filter(Boolean).join('\n\n') || null);

  // 7. QA Output — full qa-report.md.
  md += section('QA Output (qa-report.md)', joinedArtifacts(artifacts, 'qa-agent', ['qa_report', 'test_run_report', 'ac_coverage_matrix']));

  // 8. Audit Trail — AgentEvents timeline (sorted ascending by timestamp).
  const events = (audit?.events || [])
    .slice()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((e) => `- \`${e.timestamp}\` **${e.action}** (${e.actor})${e.comment ? ` — ${e.comment}` : ''}`)
    .join('\n');
  md += section('Audit Trail', events);

  // 9. Human Decisions — clarification Q&A + approve/reject decisions.
  const decisions = packet?.hitlDecisions || [];
  const decisionLines = decisions.map((d) => {
    const when = d.createdAt || d.timestamp || 'unknown';
    const gate = d.gate || d.kind || 'gate';
    const decision = d.decision || d.action || 'unknown';
    const role = d.payload?.reviewer_role || d.actor || 'human';
    const comment = d.comment || d.payload?.comment || '';
    return `- \`${when}\` [${gate}] **${decision}** by \`${role}\`${comment ? ` — ${comment}` : ''}`;
  });
  md += section('Human Decisions', decisionLines.length ? decisionLines.join('\n') : null);

  // 10. Pipeline Summary — wall-clock duration, commit count, final status.
  md += section('Pipeline Summary', (() => {
    const startTs = audit?.events?.length
      ? new Date(audit.events.map((e) => e.timestamp).filter(Boolean).sort()[0]).getTime()
      : null;
    const endTs = releaseDecision?.createdAt
      ? new Date(releaseDecision.createdAt).getTime()
      : null;
    const duration = (startTs && endTs && endTs >= startTs)
      ? `${Math.round((endTs - startTs) / 1000)}s`
      : 'unknown';
    const commits = effectiveDiff ? effectiveDiff.split('\n').filter((l) => l.startsWith('commit ')).length : 0;
    return [
      `- Wall-clock duration: ${duration}`,
      `- Commit count: ${commits}`,
      `- Final status: **${session?.status || releaseDecision?.decision || 'APPROVE'}**`,
    ].join('\n');
  })());

  // Backward-compat: the original "Release Evidence" raw JSON block is
  // preserved at the end so any downstream consumer that still parses it
  // keeps working. Marked clearly so it's not confused with the spec sections.
  md += section('Release Evidence (raw)', '```json\n' + JSON.stringify(evidence || {}, null, 2) + '\n```');

  return md + '\n';
}

/**
 * Write the release bundle into a NEW subfolder of the project's uploaded
 * repo — `sessions/{slug}-{shortId}/` — rather than a single shared
 * `release/` directory. This is what lets several sessions on the same
 * uploaded project each keep their own release output without overwriting
 * one another (or the original upload).
 *
 * @returns {{ outputs: object[], finalMdPath: string, commitHash: string|null, diff: string, outputDir: string }}
 */
async function writeReleaseBundle({ projectId, session, repoContext, packet, audit, evidence, releaseDecision }) {
  const repoPath = repoContext?.repoPath || null;

  // Capture the diff first (DEV changes already committed during the run).
  let diff = '';
  let commitHash = null;
  if (repoPath) {
    try {
      const res = await repoService.commitAndDiff({ repoPath, branch: repoContext.baseBranch || 'main', message: 'aifa: pre-release snapshot' });
      diff = res.diff;
      commitHash = res.commitHash;
    } catch (e) {
      logger.warn('release bundle: diff capture failed', { projectId, error: e.message });
    }
  }

  const canonicalRepoPath = repoService.repoPathFor(projectId);
  const slug = repoService.slugify(session?.title || 'session', 'session');
  const shortId = String(session?.id || '').slice(0, 8) || Date.now().toString(36);
  const outputDir = path.join(canonicalRepoPath, 'sessions', `${slug}-${shortId}`);
  await fs.mkdir(outputDir, { recursive: true });

  // Copy the session's working tree (its code changes) alongside the report,
  // excluding git metadata — the canonical upload is left untouched.
  if (repoPath) {
    try {
      const entries = await fs.readdir(repoPath);
      await Promise.all(entries
        .filter((entry) => entry !== '.git')
        .map((entry) => fs.cp(path.join(repoPath, entry), path.join(outputDir, entry), { recursive: true })));
    } catch (e) {
      logger.warn('release bundle: working tree copy failed', { projectId, error: e.message });
    }
  }

  const finalMd = buildFinalMarkdown({ projectId, session, repoContext, packet, audit, evidence, releaseDecision, diff });
  const finalMdPath = path.join(outputDir, 'final.md');
  await fs.writeFile(finalMdPath, finalMd, 'utf8');

  // QA report as its own file for convenience.
  const qaReport = joinedArtifacts(packet?.artifacts || [], 'qa-agent', ['qa_report', 'test_run_report', 'ac_coverage_matrix'])
    || '_No QA evidence_';
  const qaPath = path.join(outputDir, 'qa-report.md');
  await fs.writeFile(qaPath, qaReport, 'utf8');

  // audit-trail.json — full audit timeline so consumers can replay/reconstruct
  // the session deterministically without hitting the database. The same
  // `audit` blob was already injected into final.md §8; persisting it as JSON
  // makes it machine-readable.
  const auditPath = path.join(outputDir, 'audit-trail.json');
  await fs.writeFile(auditPath, JSON.stringify(audit ?? {}, null, 2), 'utf8');

  const outputs = [
    { type: 'branch', value: repoContext?.workingBranch || null },
    { type: 'commit', value: commitHash },
    { type: 'output_dir', value: outputDir },
    { type: 'final_md', value: finalMdPath },
    { type: 'qa_report', value: qaPath },
    { type: 'audit_trail', value: auditPath },
    { type: 'release_decision', value: releaseDecision?.decision || 'APPROVE' },
  ];
  logger.info('release bundle written', { projectId, outputDir, finalMdPath, commitHash, branch: repoContext?.workingBranch || null });
  return { outputs, finalMdPath, commitHash, diff, outputDir };
}

/**
 * Locate a previously-written release bundle for the given session, if any.
 * Used by the release path to delete the old bundle before writing the new
 * one so the commit is "delete old + add new", not "append new".
 *
 * @param {string} sessionsRoot  absolute path to <canonicalRepoPath>/sessions
 * @param {string} sessionId
 * @returns {Promise<{ absolutePath: string, relativePath: string, slug: string, shortId: string } | null>}
 */
async function findPreviousBundle(sessionsRoot, sessionId) {
  if (!sessionsRoot || !sessionId) return null;
  const shortId = String(sessionId).slice(0, 8);
  let entries = [];
  try {
    entries = await fs.readdir(sessionsRoot);
  } catch (_err) {
    return null; // sessionsRoot missing — no prior bundle.
  }
  // Match a folder whose trailing -<shortId> suffix equals this session's
  // shortId. This is the same naming convention writeReleaseBundle uses at
  // line 164 (`${slug}-${shortId}`), so the match is exact.
  const match = entries.find((entry) => entry.endsWith(`-${shortId}`));
  if (!match) return null;
  const absolutePath = path.join(sessionsRoot, match);
  // Confirm ownership via .aifa-bundle-id (if present) so we never delete
  // another session's bundle that happens to share the shortId suffix.
  const markerPath = path.join(absolutePath, '.aifa-bundle-id');
  try {
    const marker = (await fs.readFile(markerPath, 'utf8')).trim();
    if (marker && marker !== sessionId) return null;
  } catch (_err) {
    // No marker — accept by naming convention. Older bundles predate the
    // marker; the shortId suffix match is still a reliable ownership signal.
  }
  return { absolutePath, relativePath: path.posix.join('sessions', match), slug: match, shortId };
}

/**
 * Stage a path for removal via `git rm -rf --cached` so the deletion shows
 * up in the next commit's diff. Errors are swallowed (best-effort): if the
 * path isn't tracked or isn't a repo, the on-disk fs.rm below still
 * guarantees the file is gone.
 *
 * @param {string} cwd      absolute path to the repo root
 * @param {string} relPath  relative path inside the repo
 */
async function removeGitTracked(cwd, relPath) {
  if (!cwd || !relPath) return;
  try {
    const { execFile } = require('child_process');
    await new Promise((resolve) => {
      execFile('git', ['rm', '-rf', '--cached', '--ignore-unmatch', relPath], { cwd, windowsHide: true }, () => resolve());
    });
  } catch (_err) {
    // best-effort
  }
}

module.exports = { writeReleaseBundle, buildFinalMarkdown, findPreviousBundle, removeGitTracked };
