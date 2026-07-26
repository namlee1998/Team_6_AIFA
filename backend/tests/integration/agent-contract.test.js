// I4: shared agent-contract conformance suite. The mock implementation
// (`_buildMockOutput`) must satisfy the role contract for every agent. When a
// real agent is wired it runs through this exact suite, so any divergence from
// the mock's shape is caught here instead of mid-pipeline.

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

const SdlcWorkflowService = require('../../src/services/SdlcWorkflowService');
const {
  assertOutputConforms, REQUIRED_OUTPUT_KEYS, STRICT_OUTPUT_KEYS, AGENT_CONTRACT_VERSION, hasContent,
} = require('../../src/services/agentContract');

// Happy-path so the high-risk DEV security gate passes on the first run.
beforeAll(() => { process.env.MOCK_SCENARIO = 'happy_path'; });
afterAll(() => { delete process.env.MOCK_SCENARIO; });

const CONTEXT = {
  'intent-agent': { featureRequest: { title: 'Add Google login', description: 'OAuth 2.0 sign-in' } },
  'architecture-agent': { scopeHints: null },
  'po-agent': { featureRequest: { title: 'Add Google login', description: 'OAuth 2.0 sign-in' } },
  'ux-agent': {},
  'dev-agent': {},
  'qa-agent': {},
};

describe('I4 — agent output contract', () => {
  test('contract version is pinned', () => {
    expect(AGENT_CONTRACT_VERSION).toBe('agent-io.v5');
  });

  test.each(Object.keys(REQUIRED_OUTPUT_KEYS))(
    'mock %s output conforms to the contract',
    async (role) => {
      const task = { id: 'test-task', type: role, projectId: 'proj-1', sourceRunId: 'src-1' };
      const output = await SdlcWorkflowService._buildMockOutput(task, CONTEXT[role]);
      const result = assertOutputConforms(role, output);
      expect(result.missing).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );

  test('assertOutputConforms reports missing keys for an empty output', () => {
    const result = assertOutputConforms('po-agent', {});
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(['prd', 'acceptance_criteria']));
  });

  test.each(Object.keys(REQUIRED_OUTPUT_KEYS))('%s rejects present-but-empty required fields', (role) => {
    const emptyOutput = Object.fromEntries(REQUIRED_OUTPUT_KEYS[role].map((key) => [key, '']));
    const result = assertOutputConforms(role, emptyOutput);
    expect(result.ok).toBe(false);
    // Roles with a STRICT_OUTPUT_KEYS override (currently only
    // architecture-agent) tolerate empty values for non-strict fields —
    // those entries exist as human-readable documentation, not as the
    // A2A Contract. The test asserts against the strict subset for those
    // roles, and against the full REQUIRED list for all other roles.
    const expected = STRICT_OUTPUT_KEYS[role] || REQUIRED_OUTPUT_KEYS[role];
    expect(result.empty).toEqual(expect.arrayContaining(expected));
  });

  test('nested placeholder values are not meaningful content', () => {
    expect(hasContent([''])).toBe(false);
    expect(hasContent([{}])).toBe(false);
    expect(hasContent({ title: '', details: [] })).toBe(false);
    expect(hasContent({ executed: false, failed: 0 })).toBe(true);
  });
});
