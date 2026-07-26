// AIFA v2.1 §3 / §15 — every non-entry agent must require its immediate
// predecessor to have produced a non-empty canonical artifact. This file
// exercises the guard at the function level (no Express, no DB).

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

const AgentArtifact = require('../../src/models/AgentArtifact');
const { ApiError } = require('../../src/middleware/errorHandler');
const { requireUpstreamArtifact, PREDECESSOR_ROLE } = require('../../src/services/workflowOrchestrator');
const { REQUIRED_OUTPUT_KEYS } = require('../../src/services/agentContract');

describe('requireUpstreamArtifact — canonical chain guard (AIFA v2.1)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('ARCH entry is not gated (no predecessor)', async () => {
    // ARCH is the workflow entry — it has no predecessor to require.
    await expect(requireUpstreamArtifact(null, 'architecture-agent')).resolves.toBeUndefined();
  });

  test('throws when sourceTask is null', async () => {
    let thrown;
    try {
      await requireUpstreamArtifact(null, 'po-agent');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown.statusCode).toBe(400);
    expect(thrown.code).toBe('UPSTREAM_ARTIFACT_MISSING');
    expect(thrown.phase).toBe('PO_RUNNING');
  });

  test('throws when source task type is not the expected predecessor', async () => {
    const source = { id: 'src-1', type: 'po-agent' };
    let thrown;
    try {
      // PO is starting but source is a PO task, not ARCH.
      await requireUpstreamArtifact(source, 'po-agent');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown.statusCode).toBe(400);
    expect(thrown.code).toBe('UPSTREAM_ARTIFACT_MISSING');
    expect(thrown.message).toMatch(/requires predecessor architecture-agent/);
  });

  test('rejects when every required predecessor artifact is empty/missing', async () => {
    const source = { id: 'arch-1', type: 'architecture-agent' };
    const requiredKeys = REQUIRED_OUTPUT_KEYS['architecture-agent'];
    // Pretend the DB returns no rows for any required key.
    jest.spyOn(AgentArtifact, 'findByTaskIdAndType').mockResolvedValue([]);

    let thrown;
    try {
      await requireUpstreamArtifact(source, 'po-agent');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown.statusCode).toBe(400);
    expect(thrown.code).toBe('UPSTREAM_ARTIFACT_MISSING');
    expect(thrown.phase).toBe('PO_RUNNING');
    // The first required key is the one reported in the message.
    expect(thrown.message).toContain(`'${requiredKeys[0]}'`);
  });

  test('rejects when required artifact exists but has empty contentText', async () => {
    const source = { id: 'po-1', type: 'po-agent' };
    const requiredKeys = REQUIRED_OUTPUT_KEYS['po-agent'];
    jest.spyOn(AgentArtifact, 'findByTaskIdAndType').mockImplementation(async (taskId, key) => {
      if (key === requiredKeys[0]) return [{ id: 'a1', taskId, artifactType: key, contentText: '   ', contentJson: null }];
      return [];
    });

    let thrown;
    try {
      await requireUpstreamArtifact(source, 'ux-agent');
    } catch (err) {
      thrown = err;
    }
    expect(thrown.statusCode).toBe(400);
    expect(thrown.code).toBe('UPSTREAM_ARTIFACT_MISSING');
    expect(thrown.message).toContain(`'${requiredKeys[0]}'`);
  });

  test('passes when every required predecessor artifact is present and non-empty', async () => {
    const source = { id: 'arch-2', type: 'architecture-agent' };
    const requiredKeys = REQUIRED_OUTPUT_KEYS['architecture-agent'];
    jest.spyOn(AgentArtifact, 'findByTaskIdAndType').mockImplementation(async (taskId, key) => {
      if (requiredKeys.includes(key)) {
        return [{ id: `a-${key}`, taskId, artifactType: key, contentText: `${key} content`, contentJson: null }];
      }
      return [];
    });

    await expect(requireUpstreamArtifact(source, 'po-agent')).resolves.toBeUndefined();
  });

  test('rejects when only some required keys are present — all are required', async () => {
    const source = { id: 'ux-1', type: 'ux-agent' };
    const requiredKeys = REQUIRED_OUTPUT_KEYS['ux-agent'];
    jest.spyOn(AgentArtifact, 'findByTaskIdAndType').mockImplementation(async (taskId, key) => {
      if (key === requiredKeys[0]) {
        return [{ id: 'a1', taskId, artifactType: key, contentText: '', contentJson: null }];
      }
      if (key === requiredKeys[1]) {
        return [{ id: 'a2', taskId, artifactType: key, contentText: null, contentJson: { steps: ['a', 'b'] } }];
      }
      return [];
    });

    // First required key is empty → guard rejects, even though a later key
    // is non-empty. The contract treats every required key as must-be-present.
    let thrown;
    try {
      await requireUpstreamArtifact(source, 'dev-agent');
    } catch (err) {
      thrown = err;
    }
    expect(thrown.statusCode).toBe(400);
    expect(thrown.code).toBe('UPSTREAM_ARTIFACT_MISSING');
    expect(thrown.message).toContain(`'${requiredKeys[0]}'`);
  });

  test('strict predecessor chain: DEV never accepts PO as source', async () => {
    // PREDECESSOR_ROLE must lock DEV to UX. The guard is what enforces this;
    // a leftover PO→DEV call must fail with the "wrong predecessor" error.
    const source = { id: 'po-2', type: 'po-agent' };
    let thrown;
    try {
      await requireUpstreamArtifact(source, 'dev-agent');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown.statusCode).toBe(400);
    expect(thrown.code).toBe('UPSTREAM_ARTIFACT_MISSING');
    expect(thrown.message).toMatch(/requires predecessor ux-agent, got po-agent/);
  });

  test('PREDECESSOR_ROLE — canonical chain mapping', () => {
    expect(PREDECESSOR_ROLE['po-agent']).toBe('architecture-agent');
    expect(PREDECESSOR_ROLE['ux-agent']).toBe('po-agent');
    expect(PREDECESSOR_ROLE['dev-agent']).toBe('ux-agent');
    expect(PREDECESSOR_ROLE['qa-agent']).toBe('dev-agent');
    // ARCH is the entry point — has no predecessor.
    expect(PREDECESSOR_ROLE['architecture-agent']).toBeUndefined();
  });
});
