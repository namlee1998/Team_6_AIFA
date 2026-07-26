// AIFA — coverage for the mandatory AskUserQuestion enforcement loop.
// Originally scoped to the Architecture Agent; now applies to every role
// whose structured output is validated by OUTPUT_CONTRACTS (po, ux, dev,
// qa). Verifies the retry policy, the BLOCKER-driven feedback prompt, the
// assumed_forbidden rule, and the per-role throw codes on exhaustion.

jest.mock('uuid', () => { let n = 0; return { v4: () => `arch-uuid-${++n}` }; });

const { enforceAskUserQuestion } = require('../../src/services/archAskEnforcer');
const { PROJECT_DEFINITION_MANDATORY_KEYS } = require('../../src/services/agentContract');

beforeAll(() => { process.env.MOCK_SCENARIO = 'happy_path'; });
afterAll(() => { delete process.env.MOCK_SCENARIO; });

function _validPd() {
  const pd = {};
  for (const key of PROJECT_DEFINITION_MANDATORY_KEYS) {
    let value;
    if (key === 'repository') value = { target_module: 'src/' };
    else if (key === 'constraints' || key === 'out_of_scope') value = ['placeholder'];
    else value = 'placeholder';
    pd[key] = { value, source: 'user', status: 'confirmed' };
  }
  return pd;
}

describe('T1 — Claude calls AskUserQuestion on attempt 1 → accepted as-is', () => {
  test('returns output without retrying', async () => {
    let calls = 0;
    const result = await enforceAskUserQuestion({
      task: { type: 'architecture-agent' },
      context: {},
      runOnce: async () => {
        calls += 1;
        return {
          output: { project_definition: _validPd() },
          toolCalls: [{ name: 'AskUserQuestion', input: { questions: [{ question: 'q', options: [] }] } }],
        };
      },
    });
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.toolCalls.some((t) => t.name === 'AskUserQuestion')).toBe(true);
  });
});

describe('T2 — Claude skips AskUserQuestion, retry succeeds with feedback', () => {
  test('appends missing-field feedback to context.feedbackPrompt', async () => {
    const calls = [];
    const result = await enforceAskUserQuestion({
      task: { type: 'architecture-agent' },
      context: { featureRequest: 'something' },
      runOnce: async ({ context }) => {
        calls.push({ feedbackPrompt: context.feedbackPrompt });
        if (calls.length === 1) {
          // missing framework on the first attempt
          const bad = _validPd();
          bad.framework = { value: null, source: 'agent', status: 'missing' };
          return { output: { project_definition: bad }, toolCalls: [] };
        }
        return { output: { project_definition: _validPd() }, toolCalls: [] };
      },
    });

    expect(calls.length).toBe(2);
    expect(result.attempts).toBe(2);

    // First call had no feedback; second call (after retry) sees the feedback block
    expect(calls[0].feedbackPrompt || '').toBe('');
    const secondFeedback = calls[1].feedbackPrompt || '';
    expect(secondFeedback).toMatch(/framework/);
    expect(secondFeedback).toMatch(/Previous attempt failed/i);
  });
});

describe('T3 — Three failed attempts → ARCH_MAX_RETRIES_EXCEEDED', () => {
  test('throws with code and recoverable=false', async () => {
    let calls = 0;
    await expect(
      enforceAskUserQuestion({
        task: { type: 'architecture-agent' },
        context: {},
        runOnce: async () => {
          calls += 1;
          const bad = _validPd();
          bad.framework = { value: null, source: 'agent', status: 'missing' };
          return { output: { project_definition: bad }, toolCalls: [] };
        },
      }),
    ).rejects.toMatchObject({
      code: 'ARCH_MAX_RETRIES_EXCEEDED',
      recoverable: false,
      attempts: 3,
    });
    expect(calls).toBe(3);
  });

  test('error message names the retry limit', async () => {
    await expect(
      enforceAskUserQuestion({
        task: { type: 'architecture-agent' },
        context: {},
        runOnce: async () => {
          const bad = _validPd();
          bad.framework = { value: null, source: 'agent', status: 'missing' };
          return { output: { project_definition: bad }, toolCalls: [] };
        },
      }),
    ).rejects.toThrow(/failed to obtain mandatory project information after 3 attempts/);
  });
});

describe('T4 — Non-ARCH roles ALSO run through the loop', () => {
  // Clean output → single attempt, no retry, regardless of role.
  test.each(['po-agent', 'ux-agent', 'dev-agent', 'qa-agent'])(
    '%s with valid output runs exactly once',
    async (role) => {
      let calls = 0;
      const result = await enforceAskUserQuestion({
        task: { type: role },
        context: {},
        runOnce: async () => {
          calls += 1;
          if (role === 'po-agent') return { output: { prd: '# PRD', user_stories: ['story'], acceptance_criteria: ['AC-1 with enough detail'], scope: 'in', out_of_scope: 'out' }, toolCalls: [] };
          if (role === 'ux-agent') return { output: { ux_spec: '# UX', user_flow: 'flow', wireframe_spec: 'wire', screens: ['s'], component_inventory: ['c'] }, toolCalls: [] };
          if (role === 'dev-agent') return { output: { implementation_plan: '# plan', patch_diff: 'diff', changed_files: ['a'] }, toolCalls: [] };
          if (role === 'qa-agent') return {
            output: {
              test_cases: [{ id: 'TC-1' }],
              qa_report: '# QA',
              ac_coverage_matrix: [{ ac_id: 'AC-1', covered: true, evidence: 'unit test' }],
              test_run_report: { executed: true, total: 1, passed: 1, failed: 0, logs: 'ok' },
              release_reason: 'ok',
              blocker_count: 0,
              build_result: 'ok',
              self_test_report: 'ok',
              linked_ac_ids: ['AC-1'],
              risk_classification: { level: 'low', required_gates: ['functional'] },
              risk_assessment: 'low',
              gate_evaluation: { recommendation: 'PASS' },
            },
            toolCalls: [],
          };
          return { output: {}, toolCalls: [] };
        },
      });
      expect(calls).toBe(1);
      expect(result.attempts).toBe(1);
    },
  );
});

describe('T5 — AskUserQuestion called but output still missing → no retry', () => {
  test('accepted as-is per spec: "Không thay đổi gì"', async () => {
    let calls = 0;
    const result = await enforceAskUserQuestion({
      task: { type: 'architecture-agent' },
      context: {},
      runOnce: async () => {
        calls += 1;
        const bad = _validPd();
        bad.framework = { value: null, source: 'agent', status: 'missing' };
        return {
          output: { project_definition: bad },
          toolCalls: [{ name: 'AskUserQuestion', input: {} }],
        };
      },
    });
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
  });
});

describe('T6 — All mandatory fields confirmed, no AskUserQuestion → accepted', () => {
  test('one run, no retry', async () => {
    let calls = 0;
    const result = await enforceAskUserQuestion({
      task: { type: 'architecture-agent' },
      context: {},
      runOnce: async () => {
        calls += 1;
        return { output: { project_definition: _validPd() }, toolCalls: [] };
      },
    });
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.missingFields).toEqual([]);
  });
});

describe('T7 — Mandatory field with status="assumed" is BLOCKER', () => {
  test('assumed on mandatory fires BLOCKER and triggers retry', async () => {
    let calls = 0;
    let lastFeedback = null;
    const result = await enforceAskUserQuestion({
      task: { type: 'architecture-agent' },
      context: {},
      runOnce: async ({ context }) => {
        calls += 1;
        lastFeedback = context.feedbackPrompt;
        if (calls === 1) {
          // framework has status=assumed (forbidden on mandatory)
          const bad = _validPd();
          bad.framework = { value: 'FastAPI', source: 'agent', status: 'assumed' };
          return { output: { project_definition: bad }, toolCalls: [] };
        }
        return { output: { project_definition: _validPd() }, toolCalls: [] };
      },
    });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.attempts).toBeGreaterThanOrEqual(2);
    expect(lastFeedback || '').toMatch(/framework/);
  });

  test('assumed-without-AskUserQuestion exhausts retries', async () => {
    let calls = 0;
    await expect(
      enforceAskUserQuestion({
        task: { type: 'architecture-agent' },
        context: {},
        runOnce: async () => {
          calls += 1;
          const bad = _validPd();
          bad.framework = { value: 'FastAPI', source: 'agent', status: 'assumed' };
          return { output: { project_definition: bad }, toolCalls: [] };
        },
      }),
    ).rejects.toMatchObject({ code: 'ARCH_MAX_RETRIES_EXCEEDED' });
    expect(calls).toBe(3);
  });

  test('assumed on optional field (assumptions) is allowed', async () => {
    let calls = 0;
    const result = await enforceAskUserQuestion({
      task: { type: 'architecture-agent' },
      context: {},
      runOnce: async () => {
        calls += 1;
        const pd = _validPd();
        pd.assumptions = { value: ['mock assumption'], source: 'agent', status: 'assumed' };
        return { output: { project_definition: pd }, toolCalls: [] };
      },
    });
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T8-T12 — Non-ARCH roles go through the same loop
// ---------------------------------------------------------------------------

describe('T8 — PO BLOCKER + no AskUserQuestion → retry with feedback', () => {
  test('appends BLOCKER feedback to context.feedbackPrompt on retry', async () => {
    const calls = [];
    const result = await enforceAskUserQuestion({
      task: { type: 'po-agent' },
      context: {},
      runOnce: async ({ context }) => {
        calls.push(context.feedbackPrompt || '');
        if (calls.length === 1) {
          return { output: { prd: 'p', user_stories: [], acceptance_criteria: [], scope: '', out_of_scope: '' }, toolCalls: [] };
        }
        return { output: { prd: '# PRD', user_stories: ['story'], acceptance_criteria: ['AC-1 long enough to test'], scope: 'in', out_of_scope: 'out' }, toolCalls: [] };
      },
    });
    expect(calls.length).toBe(2);
    expect(calls[0]).toBe('');
    expect(calls[1]).toMatch(/Previous attempt failed/i);
    expect(calls[1]).toMatch(/po-agent/);
    expect(result.attempts).toBe(2);
  });
});

describe('T9 — PO BLOCKER + AskUserQuestion called → accepted on first try', () => {
  test('no retry when Ask is present even if BLOCKERs remain', async () => {
    let calls = 0;
    const result = await enforceAskUserQuestion({
      task: { type: 'po-agent' },
      context: {},
      runOnce: async () => {
        calls += 1;
        return {
          output: { prd: '', user_stories: [], acceptance_criteria: [], scope: '', out_of_scope: '' },
          toolCalls: [{ name: 'AskUserQuestion', input: { questions: [{ question: 'q' }] } }],
        };
      },
    });
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
  });
});

describe('T10 — DEV BLOCKER → retry with feedback', () => {
  test('missing changed_files triggers a retry', async () => {
    const calls = [];
    const result = await enforceAskUserQuestion({
      task: { type: 'dev-agent' },
      context: {},
      runOnce: async ({ context }) => {
        calls.push(context.feedbackPrompt || '');
        if (calls.length === 1) {
          return { output: { implementation_plan: '', patch_diff: '', changed_files: [] }, toolCalls: [] };
        }
        return { output: { implementation_plan: '# plan', patch_diff: 'diff', changed_files: ['a'] }, toolCalls: [] };
      },
    });
    expect(calls.length).toBe(2);
    expect(calls[1]).toMatch(/changed_files_present|changed files/i);
    expect(result.attempts).toBe(2);
  });
});

describe('T11 — QA BLOCKER → retry with feedback', () => {
  test('missing gate_evaluation triggers a retry', async () => {
    const calls = [];
    const result = await enforceAskUserQuestion({
      task: { type: 'qa-agent' },
      context: {},
      runOnce: async ({ context }) => {
        calls.push(context.feedbackPrompt || '');
        if (calls.length === 1) {
          return {
            output: {
              test_cases: [], qa_report: '', ac_coverage_matrix: [],
              test_run_report: {}, release_reason: '', blocker_count: 0,
            },
            toolCalls: [],
          };
        }
        return {
          output: {
            test_cases: [{ id: 'TC-1' }],
            qa_report: '# QA',
            ac_coverage_matrix: [{ ac_id: 'AC-1', covered: true, evidence: 'unit' }],
            test_run_report: { executed: true, total: 1, passed: 1, failed: 0, logs: 'ok' },
            release_reason: 'ok',
            blocker_count: 0,
            build_result: 'ok',
            self_test_report: 'ok',
            linked_ac_ids: ['AC-1'],
            risk_classification: { level: 'low', required_gates: ['functional'] },
            risk_assessment: 'low',
            gate_evaluation: { recommendation: 'PASS' },
          },
          toolCalls: [],
        };
      },
    });
    expect(calls.length).toBe(2);
    expect(calls[1]).toMatch(/qa-agent/);
    expect(result.attempts).toBe(2);
  });
});

describe('T12 — 2 retries exhausted for QA → throws QA_MAX_RETRIES_EXCEEDED', () => {
  test('throws with role-specific code and recoverable=false', async () => {
    let calls = 0;
    await expect(
      enforceAskUserQuestion({
        task: { type: 'qa-agent' },
        context: {},
        runOnce: async () => {
          calls += 1;
          // Always BLOCKER — no test_cases, no qa_report, etc.
          return {
            output: {
              test_cases: [], qa_report: '', ac_coverage_matrix: [],
              test_run_report: {}, release_reason: '', blocker_count: 0,
            },
            toolCalls: [],
          };
        },
      }),
    ).rejects.toMatchObject({
      code: 'QA_MAX_RETRIES_EXCEEDED',
      recoverable: false,
      role: 'qa-agent',
      attempts: 2,
    });
    expect(calls).toBe(2);
  });
});
