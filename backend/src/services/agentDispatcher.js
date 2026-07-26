// ── Agent Execution Pipeline ────────────────────────────────────────────────
// Pure execution: build mock output, run Claude Code / Codex, mark failures,
// handle timeouts. Does NOT create tasks or orchestrate workflow transitions.
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const { Task, AgentEvent, FeatureBacklog } = require('../models');
const taskLifecycle = require('./taskLifecycleService');
const taskWorker = require('./taskWorkerService');
const { ApiError, ERROR_CODES } = require('../middleware/errorHandler');
const { assertOutputConforms, hasContent } = require('./agentContract');
const { NODE_TARGET, AGENT_POLICY } = require('./sdlcConstants');
const logger = require('../config/logger');

// =============================================================================
// Build mock output
// =============================================================================

/**
 * I4: the mock implementation of the agent contract `run({task, context}) ->
 * output`. Pure builder — reads mock-data, applies the role/scenario shaping,
 * and returns the agent output WITHOUT touching the DB.
 */
async function buildMockOutput(task, context, deps = {}) {
  const { classifyFeatureRequestFn, firstContextValueFn } = deps;
  const mockDir = path.join(__dirname, '../../../mock-data', task.type);
  const files = await fs.readdir(mockDir).catch(() => []);

  const completedData = {
    summary: 'Mock execution completed via Hybrid Mock Mode.',
    token_usage: { input: 1250, output: 450 },
    observability: { trace_id: 'mock-trace-123' },
  };

  for (const file of files) {
    if (!file.endsWith('.md') && !file.endsWith('.json')) continue;
    const key = file.replace(/\.(md|json)$/, '');
    const ext = path.extname(file);
    const content = await fs.readFile(path.join(mockDir, file), 'utf8');
    if (ext === '.json') {
      try {
        completedData[key] = JSON.parse(content);
      } catch (parseErr) {
        throw new ApiError(
          500,
          `Malformed mock JSON in ${task.type}/${file}: ${parseErr.message}`,
          ERROR_CODES.MOCK_PARSE_ERROR,
          `${task.type.replace('-agent', '').toUpperCase()}_RUNNING`,
        );
      }
    } else {
      completedData[key] = content;
    }
  }

  const roleDefaults = {
    'architecture-agent': (() => {
      const scopeHints = context.scopeHints || null;
      const targetFolders = Array.isArray(scopeHints?.targetFolders) && scopeHints.targetFolders.length
        ? scopeHints.targetFolders
        : ['src/'];
      const primary = targetFolders[0];
      const languageHint = scopeHints?.languageHint || 'unknown';
      const ignoreGlobs = Array.isArray(scopeHints?.ignoreGlobs) && scopeHints.ignoreGlobs.length
        ? scopeHints.ignoreGlobs.slice(0, 8)
        : ['node_modules/', 'dist/', 'build/'];

      // Architecture Contract (A2A Contract) — every mandatory field carries
      // {value, source, status} metadata so the BLOCKER validators can
      // accept it deterministically. assumptions is allowed status='assumed'
      // because it is optional. This is the SINGLE artifact the
      // architecture-agent now emits; the 6 legacy derived fields
      // (architecture_brief, repository_summary, technology_stack,
      // technical_decisions, top-level constraints, repository_routing)
      // have been collapsed into this object.
      const architecture_contract = {
        project_type:      { value: 'web_app',                                          source: 'agent',    status: 'confirmed' },
        language:          { value: languageHint,                                       source: 'inferred', status: 'confirmed' },
        framework:         { value: 'unknown',                                          source: 'agent',    status: 'confirmed' },
        runtime:           { value: 'unknown',                                          source: 'agent',    status: 'confirmed' },
        package_manager:   { value: 'npm',                                              source: 'inferred', status: 'confirmed' },
        build_system:      { value: 'npm scripts',                                      source: 'inferred', status: 'confirmed' },
        deployment_target: { value: 'node-server',                                      source: 'agent',    status: 'confirmed' },
        repository:        { value: { target_module: primary, search_scope: targetFolders.join(','), ignore: ignoreGlobs }, source: 'agent', status: 'confirmed' },
        constraints:       { value: ['Mock constraint generated for contract validation.'], source: 'agent', status: 'confirmed' },
        out_of_scope:      { value: ['Explicitly excluded by user (mock default).'],        source: 'agent', status: 'confirmed' },
        assumptions:       { value: ['Mock assumption generated for contract validation.'], source: 'agent', status: 'assumed' },
      };

      return {
        // The A2A Contract — sole structured output for ARCH.
        architecture_contract,
      };
    })(),
    'po-agent': {
      prd: `# ${context.featureRequest?.title || 'Feature'}\n\nMock PRD generated for contract validation.`,
      user_stories: [
        {
          id: 'US-001', role: 'user', want: 'complete the requested flow',
          so_that: 'the feature can be validated end-to-end',
          acceptance_criteria: ['AC-1: Happy path is supported', 'AC-2: Validation is testable'],
        },
      ],
      acceptance_criteria: ['AC-1: Happy path is supported', 'AC-2: Validation is testable'],
      scope: '- Include the requested user flow.',
      out_of_scope: '- Exclude unrelated product changes.',
    },
    'ux-agent': {
      ux_spec: '# UX Spec\n\nMock UX spec generated for contract validation.',
      user_flow: '- User opens the flow\n- User completes the flow',
      wireframe_spec: '- Screen 1: entry\n- Screen 2: success',
      component_inventory: '- Button\n- Form\n- Confirmation panel',
      screens: [{ name: 'Entry Screen', purpose: 'Capture the initial action', elements: ['Primary CTA', 'Input field'], states: ['loading', 'error', 'success'] }],
      html_mockup: '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>Mock UX</title></head>\n<body><main id="root"><h1>Mock mockup</h1><button type="button">Primary CTA</button></main></body>\n</html>',
    },
    'dev-agent': {
      implementation_plan: '# Implementation plan\n\n1. Update the relevant files.\n2. Run the contract checks.',
      mock_code_diff: 'diff --git a/src/app.js b/src/app.js\n--- a/src/app.js\n+++ b/src/app.js\n@@ -1 +1 @@\n-console.log("old")\n+console.log("new")\n',
      patch_diff: 'diff --git a/src/app.js b/src/app.js\n--- a/src/app.js\n+++ b/src/app.js\n@@ -1 +1 @@\n-console.log("old")\n+console.log("new")\n',
      changed_files: [{ path: 'src/app.js', reason: 'Contract validation placeholder', change_type: 'modify' }],
    },
    'qa-agent': {
      test_cases: [{ id: 'TC-001', source_ac: 'AC-1', title: 'Happy path', type: 'functional', priority: 'High', precondition: 'Feature is available', steps: ['Open the flow', 'Complete the flow'], expected_result: 'The feature succeeds', status: 'Passed' }],
      qa_report: '# QA report\n\nMock QA report generated for contract validation.',
      ac_coverage_matrix: [{ ac: 'AC-1: Happy path is supported', ac_id: 'AC-1', test_case_ids: ['TC-001'], covered: true }],
      test_run_report: { executed: true, total: 1, passed: 1, failed: 0, duration_ms: 25, logs: 'Mock test runner passed.' },
      release_reason: 'All mock validation checks passed.',
      blocker_count: 0,
      // Phase 3.6: QA is the canonical owner of the validation-evidence
      // cluster. DEV no longer emits any of these fields.
      build_result: { build_ok: true, tests_ran: true, tests_passed: 1, tests_failed: 0, logs: 'Mock build passed.' },
      self_test_report: { executed: true, passed: 1, failed: 0, evidence: 'Mock QA self-test run.' },
      linked_ac_ids: ['AC-1'],
      risk_classification: { level: 'LOW', required_gates: ['schema', 'validation', 'evidence', 'qa'], classifier: 'mock-rule-based.v1' },
      risk_assessment: 'LOW risk for contract validation.',
    },
  };

  Object.entries(typeof roleDefaults[task.type] === 'function' ? roleDefaults[task.type]() : (roleDefaults[task.type] || {})).forEach(([key, value]) => {
    if (completedData[key] === undefined || completedData[key] === null || completedData[key] === '') {
      completedData[key] = value;
    }
  });

  // Phase A: architecture-agent persists ONLY architecture_contract. Do NOT
  // inject feature_request for the architecture fallback — it would produce a
  // second persisted artifact row. Downstream PO seeding of feature_request
  // is a Phase B consumer concern and must not bleed into Architecture
  // persistence.
  if (task.type === 'po-agent' && context.featureRequest) {
    completedData.feature_request = context.featureRequest;
  }
  if (task.type === 'architecture-agent' && !hasContent(completedData.architecture_contract)) {
    const feature = context.featureRequest || {};
    const fallbackContract = {
      project_type:      { value: 'web_app',                                          source: 'agent',    status: 'assumed' },
      language:          { value: context.scopeHints?.languageHint || 'unknown',       source: 'inferred', status: 'assumed' },
      framework:         { value: 'unknown',                                          source: 'agent',    status: 'assumed' },
      runtime:           { value: 'unknown',                                          source: 'agent',    status: 'assumed' },
      package_manager:   { value: 'npm',                                              source: 'inferred', status: 'assumed' },
      build_system:      { value: 'npm scripts',                                      source: 'inferred', status: 'assumed' },
      deployment_target: { value: 'node-server',                                      source: 'agent',    status: 'assumed' },
      repository:        { value: { target_module: 'src/', search_scope: 'src/' },     source: 'agent',    status: 'assumed' },
      constraints:       { value: [feature.description || 'Preserve existing behavior outside the requested scope.'], source: 'agent', status: 'assumed' },
      out_of_scope:      { value: ['Explicitly excluded by user.'],                   source: 'agent',    status: 'assumed' },
      assumptions:       { value: [`# Architecture contract fallback: ${feature.title || 'Requested feature'}`, '', feature.description || '', '- Validate routing decisions at the architecture review gate.'], source: 'agent', status: 'assumed' },
    };
    completedData.architecture_contract = fallbackContract;
    completedData.clarifying_questions = completedData.clarifying_questions || [];
  }

  if (task.type === 'architecture-agent' && context.scopeHints) {
    completedData.observability = {
      ...(completedData.observability || {}),
      scopeHints: context.scopeHints,
    };
  }

  if (task.type === 'po-agent' && context.po_clarification) {
    const c = context.po_clarification;
    completedData.assumptions = [
      ...(Array.isArray(completedData.assumptions) ? completedData.assumptions : []),
      c.defaulted
        ? `Assumption (no answer given, default used): ${c.answer}`
        : `Clarified with reviewer: ${c.answer}`,
    ];
    completedData.prd = `${completedData.prd || ''}\n\n## Clarification\n- ${c.defaulted ? 'Default assumption' : 'Reviewer answer'}: ${c.answer}`;
  }

  const feedbackPrompt = context.feedbackPrompt?.trim();
  const inheritedRisk = firstContextValueFn ? firstContextValueFn(context, 'risk_classification') : null;
  const riskClassification = task.type === 'po-agent' && classifyFeatureRequestFn
    ? classifyFeatureRequestFn(context.featureRequest)
    : (inheritedRisk || { level: 'LOW', tags: [], required_gates: ['schema', 'validation', 'evidence', 'qa'], classifier: 'mock-rule-based.v1' });

  if (task.type !== 'architecture-agent') {
    completedData.workflow_policy = {
      auto_approve_threshold: 0.8,
      required_gates: riskClassification.required_gates,
      max_retry_per_step: 3,
    };
  }

  // Phase 3.6: risk_classification is QA-only canonical. PO and DEV MUST NOT
  // emit it. UX does not carry it either — only QA.
  if (task.type === 'qa-agent') {
    completedData.risk_classification = riskClassification;
  }

  if (task.type === 'dev-agent') {
    completedData.patch_diff = completedData.mock_code_diff;
    // Phase 3.6: self_test_report moved to QA. DEV no longer emits it.
  }

  if (task.type === 'qa-agent') {
    completedData.blocker_count = completedData.blocker_count ?? 0;
    // Phase 3.6: security_notes / security_gate moved to QA (was DEV).
    // Condition on QA's own risk_classification now.
    const qaRisk = completedData.risk_classification || riskClassification;
    const securityRequired = Array.isArray(qaRisk?.required_gates) && qaRisk.required_gates.includes('security');
    const securityPassed = !securityRequired || !!feedbackPrompt;
    completedData.security_notes = securityPassed ? {
      oauth_state_csrf: 'PASS', pkce: 'PASS', client_secret_frontend: 'PASS',
      redirect_uri_allow_list: 'PASS', session_cookie: 'PASS', account_linking: 'PASS',
      logout_and_error_paths: 'PASS', audit_logging: 'PASS',
    } : null;
    completedData.security_gate = securityPassed
      ? { recommendation: 'PASS', checklist_version: 'oauth-security.mock.v1', issues: [] }
      : { recommendation: 'HOLD', checklist_version: 'oauth-security.mock.v1', issues: [{ code: 'oauth_state_csrf_missing', severity: 'HIGH', detail: 'Google OAuth callback evidence does not show state validation against the login session.', expected_fix: 'Add state generation and callback validation, rerun build tests, and attach the updated security notes.' }] };
    completedData.ac_coverage_matrix = (completedData.ac_coverage_matrix || []).map((row) => ({
      requirement_id: row.requirement_id || row.ac_id,
      requirement: row.requirement || row.ac,
      ux_covered: true,
      dev_implemented: true,
      test_exists: (row.test_case_ids || []).length > 0,
      test_result: row.covered ? 'PASS' : 'FAIL',
      evidence_ref: `DEV:${task.sourceRunId || 'approved'}:${firstContextValueFn ? firstContextValueFn(context, 'patch_diff') ? 'patch_diff' : 'mock_code_diff' : 'mock_code_diff'}`,
      ...row,
    }));
    completedData.coverage_summary = {
      covered: completedData.ac_coverage_matrix.filter((row) => row.covered).length,
      total: completedData.ac_coverage_matrix.length,
      percentage: completedData.ac_coverage_matrix.length
        ? Math.round((completedData.ac_coverage_matrix.filter((row) => row.covered).length / completedData.ac_coverage_matrix.length) * 100)
        : 0,
    };
    completedData.dev_evidence_ref = {
      task_id: task.sourceRunId,
      patch_diff_present: !!firstContextValueFn && !!firstContextValueFn(context, 'patch_diff'),
      build_result_present: !!firstContextValueFn && !!firstContextValueFn(context, 'build_result'),
      security_gate: firstContextValueFn ? firstContextValueFn(context, 'security_gate') : null,
    };
  }

  return completedData;
}

// =============================================================================
// Run Claude Code path
// =============================================================================

async function runClaudeCodePath(task, context, deps = {}) {
  const { getRepoContext, makeOnGate } = deps;
  const claudeCodeRunner = require('../agents/claudeCodeRunner');
  const repoContext = getRepoContext ? await getRepoContext(task.projectId, task.sessionId) : null;
  const repoPath = repoContext?.repoPath || null;
  const onGate = makeOnGate ? makeOnGate(task.id, task.type, {
    projectId: task.projectId,
    sessionId: task.sessionId,
    scope: { featurePaths: ['src/', 'tests/', 'docs/'] },
  }) : undefined;

  const runOnce = ({ context: ctx }) => claudeCodeRunner.runAgent({
    role: task.type, repoPath, taskId: task.id, context: ctx, onGate,
  });

  // Every role whose output is validated by OUTPUT_CONTRACTS (architecture,
  // po, ux, dev, qa) goes through the AskUserQuestion enforcement loop. The
  // loop is bypassed for non-validated roles internally — see
  // archAskEnforcer.ENFORCED_ROLES.
  const { enforceAskUserQuestion } = require('./archAskEnforcer');
  const { output, attempts } = await enforceAskUserQuestion({ task, context, runOnce });
  if (attempts > 1 && process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.warn(`[agentDispatcher] ${task.type} retried ${attempts - 1} times before acceptance`);
  }
  return output;
}

// =============================================================================
// Main agent runner
// =============================================================================

async function runAgent(task, context, userId = null, deps = {}) {
  const {
    saveAgentData, markTaskFailed, handleTaskTimeout,
    getRepoContext, makeOnGate, buildMockOutputFn,
  } = deps;

  await Task.update(task.id, { status: 'processing' });
  await taskLifecycle.transition(task.id, 'running', {
    actor: task.type,
    payload: { stage: task.type },
  });

  const budgetMs = (AGENT_POLICY[task.type]?.timeout_seconds || 0) * 1000;
  await taskWorker.beginRun(task.id, {
    budgetMs,
    onTimeout: () => {
      const timeoutFn = handleTaskTimeout || (() => Promise.resolve());
      return timeoutFn(task).catch((e) => console.error('[SDLC] timeout handler failed:', e));
    },
  });

  const executionPath = process.env.EXECUTION_PATH || 'langchain';

  // Codex CLI path
  if (executionPath === 'codex') {
    try {
      const codexRunner = require('../agents/codexRunner');
      const repoContext = getRepoContext ? await getRepoContext(task.projectId, task.sessionId) : null;
      const repoPath = repoContext?.repoPath || null;
      const onGate = makeOnGate ? makeOnGate(task.id, task.type, {
        projectId: task.projectId,
        sessionId: task.sessionId,
        scope: { featurePaths: ['src/', 'tests/', 'docs/'] },
      }) : undefined;
      const onProgress = (event) => console.log('[codexRunner:progress]', event.data?.slice?.(0, 100));

      const { output } = await codexRunner.runAgent({
        role: task.type, repoPath, taskId: task.id, context, onGate, onProgress,
      });
      if (saveAgentData) await saveAgentData(task, output, userId);
      return;
    } catch (err) {
      console.error(`[runAgent] codex path failed for task ${task.id}:`, err);
      if (markTaskFailed) await markTaskFailed(task, err);
      return;
    }
  }

  // Claude Code path
  if (executionPath === 'claude-code') {
    try {
      const completedData = await runClaudeCodePath(task, context, { getRepoContext, makeOnGate });
      if (saveAgentData) await saveAgentData(task, completedData, userId);
      return;
    } catch (err) {
      console.error(`[runAgent] claude-code path failed for task ${task.id}:`, err.message, {
        code: err.code,
        missing: err.missing,
        empty: err.empty,
        recoverable: err.recoverable,
        subtype: err.subtype,
        stopReason: err.stopReason,
        numTurns: err.numTurns,
      });
      if (err.rawResult) {
        console.error(`[runAgent] claude-code rawResult (first 2000 chars) for task ${task.id}:`, String(err.rawResult).slice(0, 2000));
      }
      if (err.repairResult) {
        console.error(`[runAgent] claude-code repairResult (first 2000 chars) for task ${task.id}:`, String(err.repairResult).slice(0, 2000));
      }
      if (err.stack) console.error(`[runAgent] stack:`, err.stack.split('\n').slice(0, 5).join('\n'));
      if (markTaskFailed) await markTaskFailed(task, err);
      return;
    }
  }

  // Hybrid Mock Mode (langchain path, default)
  if (process.env.USE_MOCK_AGENTS === 'true') {
    try {
      console.log(`[SDLC] Running in MOCK mode for agent ${task.type}`);
      const completedData = buildMockOutputFn
        ? await buildMockOutputFn(task, context)
        : await buildMockOutput(task, context, deps);
      if (saveAgentData) await saveAgentData(task, completedData, userId);
      return;
    } catch (err) {
      console.error(`[runAgent] Mock mode failed for task ${task.id}:`, err);
      if (err.code === ERROR_CODES.MOCK_PARSE_ERROR) {
        if (markTaskFailed) await markTaskFailed(task, err);
        return;
      }
    }
  }

  // Real agent path
  try {
    const AgentService = require('./AgentService');
    const response = await AgentService.runAgent({
      sessionId: task.id,
      nodeTarget: NODE_TARGET[task.type],
      userId,
      projectId: task.projectId,
      context,
    });

    let buffer = '';
    let completedData = null;
    let requiresActionData = null;
    let agentError = null;

    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      let currentEvent = null;
      for (const line of lines) {
        if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
        else if (line.startsWith('data: ') && currentEvent) {
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'error') agentError = data.message || 'Agent error';
            else if (currentEvent === 'completed') completedData = data;
            else if (currentEvent === 'requires_action') requiresActionData = data;
          } catch (_) { /* ignore parse errors */ }
        }
      }
    });

    response.data.on('end', async () => {
      try {
        if (agentError) throw new Error(agentError);
        if (requiresActionData) {
          console.log(`[runAgent] Task ${task.id} requires tool approval.`);
          const prisma = require('../config/database');
          await prisma.task.update({
            where: { id: task.id },
            data: { status: 'PENDING_TOOL_APPROVAL', error: null, agentOutput: JSON.stringify(requiresActionData) },
          });
          return;
        }
        if (!completedData) throw new Error('Agent returned no data');
        // Phase A: architecture-agent persists ONLY architecture_contract.
        // Mirrors the mock-path narrowing above so both execution paths honor
        // the single-artifact contract. Downstream PO seeding of
        // feature_request is a Phase B consumer concern.
        if (task.type === 'po-agent' && context.featureRequest) {
          completedData.feature_request = context.featureRequest;
        }
        const conformance = assertOutputConforms(task.type, completedData);
        if (!conformance.ok) {
          const parts = [
            conformance.missing.length ? `missing: ${conformance.missing.join(', ')}` : null,
            conformance.empty.length ? `empty: ${conformance.empty.join(', ')}` : null,
          ].filter(Boolean);
          const err = new Error(`Agent output violates ${task.type} contract (${parts.join('; ')})`);
          err.code = 'AGENT_OUTPUT_CONTRACT_INVALID';
          err.recoverable = true;
          throw err;
        }
        if (saveAgentData) await saveAgentData(task, completedData, userId);
      } catch (err) {
        console.error(`[runAgent] Failed for task ${task.id}:`, err);
        if (markTaskFailed) await markTaskFailed(task, err);
      }
    });

    response.data.on('error', async (err) => {
      if (markTaskFailed) await markTaskFailed(task, new Error(`Stream error: ${err.message}`));
    });
  } catch (err) {
    if (markTaskFailed) await markTaskFailed(task, err);
  }
}

// =============================================================================
// Mark task failed
// =============================================================================

async function markTaskFailed(task, error) {
  const current = await Task.findById(task.id).catch((e) => {
    logger.warn('markTaskFailed: Task.findById failed', { taskId: task.id, error: e.message });
    return null;
  });
  if (current?.status === 'completed' && current?.versionStatus === 'committed') {
    logger.error('ignored failure after task was already completed and committed', {
      taskId: task.id, phase: task.type, code: error.code || null, error: error.message,
    });
    return;
  }
  const TERMINAL_STATES = ['completed', 'failed', 'cancelled', 'timeout'];
  if (current && TERMINAL_STATES.includes(current.executionStatus)) {
    logger.warn('markTaskFailed: task already terminal, skipping failed transition', {
      taskId: task.id, currentState: current.executionStatus, error: error.message,
    });
    return;
  }
  if (!current) {
    // The row was deleted between Task assignment and the failure path
    // (project cleanup, retry, etc.). Nothing to update; release the worker
    // lock so the next attempt can run.
    logger.warn('markTaskFailed: task row missing, skipping DB update', {
      taskId: task.id, phase: task.type, error: error.message,
    });
    try {
      await taskLifecycle.transitionIfPresent(task.id, 'failed', {
        actor: task.type, reason: error.message,
      });
    } catch (_) { /* best-effort */ }
    await taskWorker.endRun(task.id).catch(() => {});
    return;
  }

  const errMsg = error.code ? `[${error.code}] ${error.message}` : error.message;
  const failureObservability = {
    ...(current?.observability || {}),
    failure: {
      code: error.code || null, message: error.message,
      recoverable: error.recoverable ?? null, subtype: error.subtype || null,
      numTurns: error.numTurns ?? null, stopReason: error.stopReason || null,
      exitCode: error.exitCode ?? null, signal: error.signal || null,
      stderrPreview: typeof error.stderr === 'string' ? error.stderr.slice(0, 2000) : null,
      stdoutPreview: typeof error.stdout === 'string' ? error.stdout.slice(0, 2000) : null,
      rawResultPreview: typeof error.rawResult === 'string' ? error.rawResult.slice(0, 4000) : null,
      repairResultPreview: typeof error.repairResult === 'string' ? error.repairResult.slice(0, 4000) : null,
      repairError: error.repairError || null,
      failedAt: new Date().toISOString(),
    },
  };
  logger.error('task failed', {
    taskId: task.id, phase: task.type, code: error.code || null,
    recoverable: error.recoverable ?? null, error: error.message,
  });
  const updated = await Task.update(task.id, {
    status: 'failed', error: errMsg, observability: failureObservability,
    lockedBy: null, heartbeatAt: null,
  });
  if (!updated) {
    // Race: row vanished between findById and update. Don't proceed to the
    // lifecycle transitions — they'd fail too. Release the worker lock.
    logger.warn('markTaskFailed: row disappeared during update, releasing lock', { taskId: task.id });
    await taskWorker.endRun(task.id).catch(() => {});
    return;
  }
  await taskLifecycle.transition(task.id, 'failed', {
    actor: task.type, reason: errMsg,
    payload: { code: error.code || null, recoverable: error.recoverable ?? null, subtype: error.subtype || null, numTurns: error.numTurns ?? null, stopReason: error.stopReason || null, exitCode: error.exitCode ?? null },
  });
  await FeatureBacklog.updateStatusByTaskId(task.id, 'TODO');
  await taskWorker.endRun(task.id);
}

// =============================================================================
// Handle task timeout
// =============================================================================

async function handleTaskTimeout(task) {
  const current = await Task.findById(task.id);
  if (!current || ['completed', 'failed', 'cancelled', 'timeout'].includes(current.executionStatus)) return;
  const reason = `execution timeout — exceeded ${AGENT_POLICY[task.type]?.timeout_seconds || '?'}s budget`;
  logger.warn('task execution timed out', { taskId: task.id, phase: task.type });
  await Task.update(task.id, { status: 'failed', error: reason, lockedBy: null, heartbeatAt: null });
  await taskLifecycle.transitionIfPresent(task.id, 'timeout', { actor: 'orchestrator', reason });
  await FeatureBacklog.updateStatusByTaskId(task.id, 'TODO').catch(() => {});
  await taskWorker.endRun(task.id);
}

module.exports = {
  buildMockOutput,
  runClaudeCodePath,
  runAgent,
  markTaskFailed,
  handleTaskTimeout,
};
