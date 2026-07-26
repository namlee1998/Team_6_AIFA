// ── Artifact persistence & handoff methods ───────────────────────────────────
// Methods that call `this._xxx` on the service instance receive it as `service`.

const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const { AgentArtifact } = require('../models');
const { WORKSPACE_DIR } = require('./sdlcConstants');
const { contentHash, resolveArtifactContent } = require('./workflowQueries');

/**
 * Build a context object from resolved artifacts — used by agent run methods
 * to construct the `context` parameter passed to `_runAgent`.
 *
 * Phase 2 (docs/architecture/A2A_PIPELINE_REDESIGN.md §8 Phase 2):
 * JSON-object artifacts (currently only `project_definition`) are passed
 * through as a structured object so downstream agents can read them
 * field-by-field. Other artifacts keep the historical wrapper
 * `[{ key, title, content }]` to remain backward-compatible with the
 * existing prompts and `compactContext` whitelists.
 */
async function buildContextFromArtifacts(artifacts, extras = {}) {
  const context = { ...extras };
  const resolved = await Promise.all(artifacts.map((art) => resolveArtifactContent(art)));
  artifacts.forEach((art, i) => {
    const raw = resolved[i].contentText !== null && resolved[i].contentText !== undefined
      ? resolved[i].contentText
      : resolved[i].contentJson;
    const isJsonObject = raw !== null && raw !== undefined
      && typeof raw === 'object'
      && !Array.isArray(raw);
    if (isJsonObject) {
      // Phase 2: a JSON-object artifact (project_definition) is the
      // canonical A2A contract — pass it through as a structured object
      // so downstream agents read fields directly. If extras already
      // seeded a value for this key, prefer the artifact (it is the
      // authoritative source from the DB).
      context[art.artifactType] = raw;
      return;
    }
    const content = raw ?? '';
    const existing = context[art.artifactType];
    if (existing === undefined || existing === null) {
      context[art.artifactType] = [{
        key: art.artifactKey,
        title: art.title,
        content,
      }];
    } else if (Array.isArray(existing)) {
      existing.push({
        key: art.artifactKey,
        title: art.title,
        content,
      });
    } else {
      // Pre-seeded scalar (e.g. architecture_brief from extras) — wrap the
      // pre-seeded value as the first entry, then append this artifact.
      context[art.artifactType] = [
        { key: `${art.artifactType}:extras`, title: null, content: existing },
        { key: art.artifactKey, title: art.title, content },
      ];
    }
  });
  return context;
}

/**
 * Write artifact content to disk and return a FILE: reference.
 */
async function writeArtifactToFile(projectId, taskId, filename, content) {
  const dir = path.join(WORKSPACE_DIR, projectId, taskId);
  await fs.mkdir(dir, { recursive: true });
  const filepath = path.join(dir, filename);
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await fs.writeFile(filepath, data, 'utf8');
  return `FILE:${filepath}`;
}

/**
 * Record an approved handoff artifact (a2a_handoff) for the next agent.
 * `nextAgentFn` is a reference to `service._nextAgentFor.bind(service)`.
 */
async function recordApprovedHandoff(task, approval, { nextAgentFn, writeFileFn }) {
  const nextAgent = nextAgentFn(task);
  if (!nextAgent) return;

  const artifacts = await AgentArtifact.findByTaskId(task.id);
  const outputArtifacts = artifacts.filter((artifact) => artifact.artifactType !== 'a2a_handoff');
  const envelope = {
    handoff_id: uuidv4(),
    schema_version: 'a2a_handoff.v1',
    project_id: task.projectId,
    from_agent: task.type,
    to_agent: nextAgent,
    source_task_id: task.id,
    target_task_id: null,
    attempt: (task.retryCount || 0) + 1,
    input_artifacts: outputArtifacts.map((artifact) => ({ key: artifact.artifactKey, hash: artifact.contentHash })),
    output_artifact: { task_id: task.id, hash: task.outputContentHash },
    approval: {
      approval_id: approval.id,
      type: approval.action || approval.decision,
      confidence: task.agentOutput?.confidence_score ?? null,
      validation_result_id: `validation:${task.id}`,
    },
    contract: {
      // Phase 2 (docs/architecture/A2A_PIPELINE_REDESIGN.md §8 Phase 2):
      // every downstream edge now also lists `project_definition` as a
      // required input. It is the canonical A2A contract from the
      // Architecture Agent and is consumed by every downstream agent
      // regardless of its direct predecessor. Phase 3 will gradually
      // shrink this list per agent as the prompts migrate.
      required_downstream_inputs: [
        'project_definition',
        ...(task.type === 'po-agent' && nextAgent === 'dev-agent'
          ? ['prd', 'acceptance_criteria', 'risk_classification']
          : ({
            'ux-agent': ['prd', 'acceptance_criteria', 'risk_classification'],
            'dev-agent': ['ux_spec', 'wireframe_spec', 'risk_classification'],
            'qa-agent': ['patch_diff', 'build_result', 'self_test_report', 'security_gate'],
          }[nextAgent] || [])),
      ],
    },
    integrity: {
      artifact_hash: contentHash(outputArtifacts.map((artifact) => artifact.contentHash)),
      created_at: new Date().toISOString(),
    },
    created_at: new Date().toISOString(),
  };

  await AgentArtifact.bulkUpsert([{
    id: uuidv4(),
    taskId: task.id,
    projectId: task.projectId,
    agentType: task.type,
    artifactType: 'a2a_handoff',
    artifactKey: `a2a_handoff:${task.id}:${nextAgent}`,
    title: `${envelope.from_agent} to ${envelope.to_agent} Handoff`,
    contentJson: envelope,
    ordinal: 999,
    contentHash: contentHash(envelope),
  }]);
}

module.exports = {
  buildContextFromArtifacts,
  writeArtifactToFile,
  recordApprovedHandoff,
};
