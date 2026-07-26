// T6: a committed upstream task whose artifacts are INVALID must never hand off
// to the downstream agent. _requireApprovedTask is the single guard shared by
// runUXAgent / runDEVAgent / runQAAgent, so we assert it for each handoff pair.

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

jest.mock('../../src/models', () => ({
  Task: { findById: jest.fn() },
  AgentArtifact: { hasInvalid: jest.fn(), findByTaskIdAndType: jest.fn() },
  HitlDecision: {},
}));

jest.mock('../../src/models/FeatureBacklog', () => ({}));
jest.mock('../../src/services/AgentService', () => ({}));
jest.mock('../../src/services/MembershipService', () => ({ requireProjectRole: jest.fn() }), { virtual: true });
jest.mock('../../src/services/QuotaService', () => ({}), { virtual: true });
jest.mock('../../src/services/QualityGateService', () => ({}));

const SdlcWorkflowService = require('../../src/services/SdlcWorkflowService');
const { Task, AgentArtifact } = require('../../src/models');

const HANDOFF_PAIRS = [
  ['po-agent', 'UX'],
  ['ux-agent', 'DEV'],
  ['dev-agent', 'QA'],
];

describe('T6 — INVALID upstream blocks the handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(HANDOFF_PAIRS)('committed %s with INVALID artifacts is rejected', async (sourceType) => {
    Task.findById.mockResolvedValue({
      id: 'src-task',
      type: sourceType,
      status: 'completed',
      versionStatus: 'committed',
      projectId: 'proj-1',
    });
    AgentArtifact.hasInvalid.mockResolvedValue(true);

    await expect(
      SdlcWorkflowService._requireApprovedTask('src-task', sourceType, null),
    ).rejects.toThrow(/INVALID/);
    expect(AgentArtifact.hasInvalid).toHaveBeenCalledWith('src-task');
  });

  test('a VALID committed source passes the INVALID guard', async () => {
    Task.findById.mockResolvedValue({
      id: 'src-task',
      type: 'po-agent',
      status: 'completed',
      versionStatus: 'committed',
      projectId: 'proj-1',
      outputContentHash: 'hash-1',
    });
    AgentArtifact.hasInvalid.mockResolvedValue(false);
    // Provide a matching A2A handoff envelope so the next check also passes.
    AgentArtifact.findByTaskIdAndType.mockResolvedValue([
      { contentJson: { schema_version: 'a2a_handoff.v1', output_artifact: { hash: 'hash-1' } } },
    ]);

    await expect(
      SdlcWorkflowService._requireApprovedTask('src-task', 'po-agent', null),
    ).resolves.toMatchObject({ id: 'src-task' });
  });
});
