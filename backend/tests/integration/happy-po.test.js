jest.mock('uuid', () => ({ v4: jest.fn(() => 'happy-po-uuid') }));

const path = require('path');
const os = require('os');
const fs = require('fs/promises');

jest.mock('../../src/models', () => ({
  Task: {
    create: jest.fn(), update: jest.fn(), findLatestBySession: jest.fn(), findById: jest.fn(),
  },
  AgentArtifact: {
    findByTaskId: jest.fn(), findByTaskIdAndType: jest.fn(),
  },
  PipelineSession: {
    findById: jest.fn(), countActive: jest.fn(), create: jest.fn(), update: jest.fn(),
  },
}));
jest.mock('../../src/models/FeatureBacklog', () => ({ linkTask: jest.fn(), updateStatusByTaskId: jest.fn() }));
jest.mock('../../src/services/gateBridge', () => ({ listPending: jest.fn(() => []) }));
jest.mock('../../src/services/repoIndexService', () => ({}));

const SdlcController = require('../../src/controllers/SdlcController');
const SdlcWorkflowService = require('../../src/services/SdlcWorkflowService');
const workflowOrchestrator = require('../../src/services/workflowOrchestrator');
const { Task, AgentArtifact, PipelineSession } = require('../../src/models');

const ARCH_TASK = {
  id: 'arch-task', projectId: 'project-1', sessionId: 'session-1',
  type: 'architecture-agent', status: 'completed', versionStatus: 'committed',
};
const ARCHITECTURE = {
  project_type: { value: 'web_app', source: 'inferred', status: 'confirmed' },
  language: { value: 'JavaScript', source: 'inferred', status: 'confirmed' },
};

describe('PO happy-path demo', () => {
  beforeEach(() => jest.clearAllMocks());

  test('controller forwards the guarded happy-path controls to WorkflowService', async () => {
    const spy = jest.spyOn(SdlcWorkflowService, 'runPOAgent').mockResolvedValue({
      id: 'po-task', sessionId: 'session-1', status: 'pending', type: 'po-agent',
    });
    const req = {
      body: {
        project_id: 'project-1', source_task_id: 'arch-task',
        feature_request: { title: 'Add login button.' },
      },
      user: { id: 'user-1' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await SdlcController.runPOAgent(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      sourceTaskId: 'arch-task',
      featureRequest: { title: 'Add login button.' },
      architectureInputPath: '.aifa/architecture_contract.json',
      autoApproveOutputReview: true,
      stopAfterAgent: 'po-agent',
    }));
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ task_id: 'po-task', session_id: 'session-1' }));
  });

  test('orchestrator reads only the explicit repository architecture input', async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'happy-po-'));
    await fs.mkdir(path.join(repoPath, '.aifa'), { recursive: true });
    await fs.writeFile(path.join(repoPath, '.aifa', 'architecture_contract.json'), JSON.stringify(ARCHITECTURE));

    PipelineSession.findById.mockResolvedValue({ id: 'session-1', projectId: 'project-1', repoPath });
    AgentArtifact.findByTaskIdAndType.mockResolvedValue([{
      artifactType: 'architecture_contract', contentJson: ARCHITECTURE,
    }]);
    AgentArtifact.findByTaskId.mockResolvedValue([{
      artifactType: 'architecture_contract', contentHash: 'legacy-hash',
      contentJson: { language: { value: 'WRONG', source: 'agent', status: 'confirmed' } },
    }]);
    Task.create.mockImplementation(async (data) => ({ ...data, observability: {} }));
    Task.findLatestBySession.mockResolvedValue(null);

    let receivedContext;
    const deps = {
      requireApprovedTask: jest.fn(async () => ARCH_TASK),
      MembershipService: { requireProjectRole: jest.fn() },
      contentHash: jest.fn(() => 'input-hash'),
      buildContextFromArtifacts: jest.fn(async (_rows, extras) => extras),
      runAgent: jest.fn(async (_task, context) => { receivedContext = context; }),
    };

    const task = await workflowOrchestrator.runPOAgent({
      projectId: 'project-1', sourceTaskId: 'arch-task', sessionId: 'session-1',
      featureRequest: { title: 'Add login button.' },
      architectureInputPath: '.aifa/architecture_contract.json',
      autoApproveOutputReview: true, stopAfterAgent: 'po-agent', user: null,
    }, deps);

    await new Promise(setImmediate);
    expect(task.type).toBe('po-agent');
    expect(receivedContext.architecture_contract).toEqual(ARCHITECTURE);
    expect(deps.contentHash).toHaveBeenCalledWith(expect.objectContaining({
      architectureContract: ARCHITECTURE,
      artifacts: [],
    }));
  });

  test('explicit architecture input never falls back when the file is missing', async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'happy-po-missing-'));
    PipelineSession.findById.mockResolvedValue({ id: 'session-1', projectId: 'project-1', repoPath });
    AgentArtifact.findByTaskIdAndType.mockResolvedValue([{
      artifactType: 'architecture_contract', contentJson: ARCHITECTURE,
    }]);
    AgentArtifact.findByTaskId.mockResolvedValue([{ artifactType: 'architecture_contract', contentJson: ARCHITECTURE }]);

    const deps = {
      requireApprovedTask: jest.fn(async () => ARCH_TASK),
      MembershipService: { requireProjectRole: jest.fn() },
      contentHash: jest.fn(), buildContextFromArtifacts: jest.fn(), runAgent: jest.fn(),
    };

    await expect(workflowOrchestrator.runPOAgent({
      projectId: 'project-1', sourceTaskId: 'arch-task', sessionId: 'session-1',
      featureRequest: { title: 'Add login button.' },
      architectureInputPath: '.aifa/architecture_contract.json', user: null,
    }, deps)).rejects.toMatchObject({ code: 'ARCHITECTURE_INPUT_MISSING' });
    expect(Task.create).not.toHaveBeenCalled();
    expect(deps.runAgent).not.toHaveBeenCalled();
  });
});
