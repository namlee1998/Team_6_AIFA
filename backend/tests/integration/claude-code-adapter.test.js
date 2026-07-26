jest.mock('uuid', () => ({ v4: () => 'approval-id' }));

const path = require('path');
const claudePermissionDispatcher = require('../../src/agents/claudePermissionDispatcher');
const claudeCodeRunner = require('../../src/agents/claudeCodeRunner');
const gateBridge = require('../../src/services/gateBridge');

describe('Claude Code SDK adapter contracts', () => {
  test('parser finds a valid JSON block after an invalid fenced block', () => {
    const parsed = claudeCodeRunner.parseJsonObject([
      'Draft:',
      '```json',
      '{"prd": "missing closing brace"',
      '```',
      'Final:',
      '```json',
      '{"outputVersion":"agent-io.v3","artifact":{"prd":"# PRD","user_stories":["Story"]}}',
      '```',
    ].join('\n'));

    expect(parsed).toMatchObject({
      outputVersion: 'agent-io.v3',
      artifact: { prd: '# PRD' },
    });
  });

  test('parser prefers the full artifact envelope over a small prose object', () => {
    const parsed = claudeCodeRunner.parseJsonObject([
      'Example metadata: {"status":"draft"}',
      'Final output:',
      '{"outputVersion":"agent-io.v3","stage":"po","artifact":{"prd":"# PRD","scope":"In","out_of_scope":"Out"}}',
    ].join('\n'));

    expect(parsed).toMatchObject({
      outputVersion: 'agent-io.v3',
      stage: 'po',
      artifact: { prd: '# PRD' },
    });
  });

  test('balanced JSON extraction ignores braces inside string values', () => {
    const parsed = claudeCodeRunner.parseJsonObject(
      'Result: {"artifact":{"prd":"Use {tenantId} in the route","scope":"API"}} trailing text',
    );

    expect(parsed.artifact.prd).toContain('{tenantId}');
  });

  test('output repair runs once without any allowed tools', async () => {
    const query = jest.fn(({ options }) => (async function* resultStream() {
      expect(options.allowedTools).toEqual([]);
      expect(options.maxTurns).toBe(3);
      await expect(options.canUseTool('Write', { file_path: 'x' })).resolves.toMatchObject({
        behavior: 'deny',
      });
      yield {
        type: 'result',
        result: '```json\n{"outputVersion":"agent-io.v3","artifact":{"prd":"# Repaired"}}\n```',
      };
    }()));

    const result = await claudeCodeRunner._internal.repairRawOutput({
      query,
      role: 'po-agent',
      rawResult: 'PRD was drafted but JSON formatting failed.',
      cwd: process.cwd(),
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(claudeCodeRunner.parseJsonObject(result)).toMatchObject({
      artifact: { prd: '# Repaired' },
    });
  });

  test('runner forwards canUseTool context and adapts absolute paths for the UI gate', async () => {
    const onGate = jest.fn(async (_toolName, input) => ({ behavior: 'allow', updatedInput: input }));
    const repoPath = path.resolve('repo');
    const canUseTool = claudeCodeRunner._internal.makeCanUseTool(onGate, repoPath);
    const options = { toolUseID: 'tool-1', title: 'Claude wants to edit src/app.js' };

    await canUseTool('Edit', {
      file_path: path.join(repoPath, 'src', 'app.js'),
      old_string: 'old',
      new_string: 'new',
    }, options);

    expect(onGate).toHaveBeenCalledWith('Edit', expect.objectContaining({
      file_path: path.join('src', 'app.js'),
      diff: expect.stringContaining('+ new'),
    }), options);
  });

  test('tool payload keeps rich SDK data and existing board display fields', () => {
    const payload = claudePermissionDispatcher._internal.toolPayload({
      taskId: 'task-dev',
      role: 'dev-agent',
      toolName: 'Edit',
      input: { file_path: 'src/app.js', diff: '@@ src/app.js\n- old\n+ new' },
      options: { toolUseID: 'tool-1', title: 'Claude wants to edit src/app.js' },
      decision: { category: 'modify_existing', reason: 'Modifying an existing file requires human approval' },
    });

    expect(payload).toMatchObject({
      type: 'tool_permission',
      toolUseID: 'tool-1',
      toolName: 'Edit',
      tool: 'Edit',
      file_path: 'src/app.js',
      diff: expect.stringContaining('+ new'),
      display: { prompt: 'Claude wants to edit src/app.js', filePath: 'src/app.js' },
    });
  });

  test('tool payload remains valid when decision metadata is unavailable', () => {
    const payload = claudePermissionDispatcher._internal.toolPayload({
      taskId: 'task-dev',
      role: 'dev-agent',
      toolName: 'Write',
      input: { file_path: 'src/auth/google.js' },
    });

    expect(payload).toMatchObject({
      category: 'unknown',
      reason: 'Tool action requires approval',
      riskLevel: 'medium',
    });
  });

  test('interactive auth write reaches the approval gate with risk metadata', async () => {
    process.env.CLAUDE_CODE_INTERACTIVE_GATES = 'true';
    const requestGate = jest.spyOn(gateBridge, 'requestGate').mockReturnValue({
      approvalId: 'approval-id',
      ready: Promise.resolve(),
      promise: Promise.resolve({ action: 'approve' }),
    });

    try {
      const result = await claudePermissionDispatcher.dispatch({
        toolName: 'Write',
        input: { file_path: 'src/auth/google.js', content: 'module.exports = {};' },
        taskId: 'task-dev',
        role: 'dev-agent',
        scope: { featurePaths: ['src/', 'tests/', 'docs/'] },
        audit: jest.fn(),
      });

      expect(result.behavior).toBe('allow');
      expect(requestGate).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'tool',
        payload: expect.objectContaining({
          category: 'security',
          reason: expect.stringContaining('auth/security/payment'),
          riskLevel: 'high',
        }),
      }));
    } finally {
      requestGate.mockRestore();
      delete process.env.CLAUDE_CODE_INTERACTIVE_GATES;
    }
  });

  test('question answers use the object shape AskUserQuestion expects', () => {
    const answers = claudePermissionDispatcher._internal.normalizeQuestionAnswers({
      questions: [
        { question: 'Edit file A?' },
        { question: 'Delete file B?' },
      ],
    }, ['yes', 'no']);

    expect(answers).toEqual({ 'Edit file A?': 'yes', 'Delete file B?': 'no' });
  });

  test('non-interactive mode auto-answers questions and auto-allows repo tools', async () => {
    delete process.env.CLAUDE_CODE_INTERACTIVE_GATES;
    const audit = jest.fn();

    const question = await claudePermissionDispatcher.dispatch({
      toolName: 'AskUserQuestion',
      input: { questions: [{ question: 'Which option?', options: [{ label: 'Recommended option' }] }] },
      taskId: 'task-dev',
      role: 'dev-agent',
      audit,
    });
    expect(question).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'Which option?': 'Recommended option' } },
    });

    const edit = await claudePermissionDispatcher.dispatch({
      toolName: 'Edit',
      input: { file_path: 'src/app.js', old_string: 'a', new_string: 'b' },
      taskId: 'task-dev',
      role: 'dev-agent',
      scope: { featurePaths: ['src/'] },
      audit,
    });
    expect(edit.behavior).toBe('allow');
  });

  test('non-interactive mode still blocks dangerous operations', async () => {
    delete process.env.CLAUDE_CODE_INTERACTIVE_GATES;
    const result = await claudePermissionDispatcher.dispatch({
      toolName: 'Bash',
      input: { command: 'git push origin main' },
      taskId: 'task-dev',
      role: 'dev-agent',
    });
    expect(result).toMatchObject({ behavior: 'deny' });
  });

  test('tool-use execution errors are retryable', () => {
    expect(claudeCodeRunner._internal.isRetryableToolUseError({
      subtype: 'error_during_execution',
      stopReason: 'tool_use',
    })).toBe(true);
  });

  test('runner explicitly uses a generous maxTurns default', () => {
    expect(claudeCodeRunner._internal.DEFAULT_MAX_TURNS).toBeGreaterThanOrEqual(100);
  });

  test('role limits keep DEV and QA runs bounded unless explicitly overridden', () => {
    expect(claudeCodeRunner._internal.maxTurnsForRole('dev-agent')).toBe(200);
    expect(claudeCodeRunner._internal.maxTurnsForRole('qa-agent')).toBe(150);
  });

  test('DEV context excludes unrelated upstream artifacts', () => {
    const compact = claudeCodeRunner._internal.compactContext('dev-agent', {
      prd: [{ content: '# PRD' }],
      ux_spec: [{ content: '# UX' }],
      qa_report: [{ content: 'irrelevant and potentially huge' }],
      a2a_handoff: [{ content: { noisy: true } }],
    });

    expect(compact).toEqual({
      prd: [{ content: '# PRD' }],
      ux_spec: [{ content: '# UX' }],
    });
  });

  // Phase 3.6: DEV no longer promotes nested security evidence. Security evidence
  // (security_notes / security_gate) moved to QA as canonical owner.
  test('normalizer ignores nested DEV security evidence (Phase 3.6 moved to QA)', () => {
    const output = claudeCodeRunner.normalizeOutput('dev-agent', {
      artifact: {
        implementation_plan: '# Plan',
        patch_diff: 'diff --git a/a b/a',
        changed_files: ['a'],
      },
    });

    expect(output.security_notes).toBeUndefined();
    expect(output.security_gate).toBeUndefined();
    expect(output.patch_format).toBe('unified_diff');
  });

  test('normalizer rejects required fields that are present but empty', () => {
    expect(() => claudeCodeRunner.normalizeOutput('ux-agent', {
      outputVersion: 'agent-io.v3',
      artifact: {
        ux_spec: '# Login design',
        user_flow: [],
        wireframe_spec: '',
        screens: [],
        component_inventory: [],
      },
    })).toThrow(/empty: user_flow, wireframe_spec, screens, component_inventory/);
  });

  // Role ownership: QA owns its structured output. The platform must NOT
  // silently reshape ac_coverage_matrix, risk_classification, or
  // test_run_report into the contract shape — that masks real ambiguities
  // the operator should resolve via AskUserQuestion. If future refactors
  // add coercion here, this test will fail and force a deliberate decision.
  //
  // The contract check in normalizeOutput runs after coerceArrayFields.
  // We can't reach a "no coerce" assertion without first satisfying all
  // REQUIRED_OUTPUT_KEYS, but if any of those three fields is later
  // reshaped, the assertion below will catch the change.
  test('platform does NOT silently coerce QA shape fields (role ownership)', () => {
    const output = claudeCodeRunner.normalizeOutput('qa-agent', {
      artifact: {
        // Wrong shape for the contract — these should pass through unchanged.
        risk_classification: { level: 'low', required_gates: ['functional'] },
        ac_coverage_matrix: [{ ac_id: 'AC-1', covered: true, evidence: 'unit test' }],
        test_run_report: { executed: true, total: 1, passed: 1, failed: 0, logs: 'ok' },
        // Required fields to satisfy assertOutputConforms
        test_cases: [{ id: 'TC-1' }],
        qa_report: '# QA report',
        release_reason: 'ok',
        blocker_count: 0,
        build_result: 'ok',
        self_test_report: 'ok',
        linked_ac_ids: ['AC-1'],
        risk_assessment: 'low',
        security_notes: 'ok',
        security_gate: { recommendation: 'PASS' },
        gate_evaluation: { recommendation: 'PASS' },
      },
    });

    // These three are QA-owned shapes — no silent reshape.
    expect(output.risk_classification).toEqual({ level: 'low', required_gates: ['functional'] });
    expect(output.ac_coverage_matrix).toEqual([{ ac_id: 'AC-1', covered: true, evidence: 'unit test' }]);
    expect(output.test_run_report).toEqual({ executed: true, total: 1, passed: 1, failed: 0, logs: 'ok' });
    expect(output.test_run_report.executed).toBe(true);
  });
});
