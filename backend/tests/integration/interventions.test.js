// Mock dependencies before requiring SdlcWorkflowService and routes
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

jest.mock('../../src/models', () => ({
  Task: { findById: jest.fn() },
  AgentArtifact: {},
  HitlDecision: {},
  AgentEvent: {},
}));

jest.mock('../../src/config/database', () => ({
  project: {
    findUnique: jest.fn(),
  },
}));

jest.mock('../../src/middleware/authMiddleware', () => (req, res, next) => {
  req.user = { id: 'local-user-id', email: 'local-user@example.com' };
  next();
});

const SdlcWorkflowService = require('../../src/services/SdlcWorkflowService');
const SdlcController = require('../../src/controllers/SdlcController');
const { Task } = require('../../src/models');
const prisma = require('../../src/config/database');

// Spy on listPendingGates on SdlcWorkflowService
jest.spyOn(SdlcWorkflowService, 'listPendingGates');

describe('Interventions API & Service Audit', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('SdlcWorkflowService.getAllInterventions', () => {
    test('successfully maps and enriches a PO question gate', async () => {
      const mockGates = [
        {
          approvalId: 'gate-1',
          taskId: 'task-1',
          projectId: 'proj-1',
          role: 'PO',
          kind: 'question',
          payload: { questions: ['Question 1', { question: 'Question 2' }] },
          status: 'pending',
          createdAt: new Date('2026-06-13T10:00:00.000Z'),
          updatedAt: new Date('2026-06-13T10:00:00.000Z'),
        },
      ];

      SdlcWorkflowService.listPendingGates.mockResolvedValue(mockGates);
      prisma.project.findUnique.mockResolvedValue({ id: 'proj-1', name: 'Project One' });
      Task.findById.mockResolvedValue({ id: 'task-1', status: 'awaiting_approval', type: 'po-agent' });

      const result = await SdlcWorkflowService.getAllInterventions();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'gate-1',
        type: 'PO_CLARIFY',
        status: 'PENDING',
        payload: {
          path: '',
          reason: '',
          diff: '',
          questions: ['Question 1', 'Question 2'],
        },
        createdAt: '2026-06-13T10:00:00.000Z',
        updatedAt: '2026-06-13T10:00:00.000Z',
        projectId: 'proj-1',
        projectName: 'Project One',
        sessionId: null,
        repoUrl: '',
        pipelineStatus: 'awaiting_approval',
        currentPhase: 'PO',
      });
    });

    test('successfully maps and enriches a DEV tool gate', async () => {
      const mockGates = [
        {
          approvalId: 'gate-2',
          taskId: 'task-2',
          projectId: 'proj-2',
          role: 'DEV',
          kind: 'tool',
          payload: {
            file_path: 'src/main.js',
            reason: 'High risk edit',
            diff: 'diff details',
          },
          status: 'pending',
          createdAt: new Date('2026-06-13T11:00:00.000Z'),
          updatedAt: new Date('2026-06-13T11:00:00.000Z'),
        },
      ];

      SdlcWorkflowService.listPendingGates.mockResolvedValue(mockGates);
      prisma.project.findUnique.mockResolvedValue({ id: 'proj-2', name: 'Project Two' });
      Task.findById.mockResolvedValue({ id: 'task-2', status: 'running', type: 'dev-agent' });

      const result = await SdlcWorkflowService.getAllInterventions();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'gate-2',
        type: 'DEV_FILE_GATE',
        status: 'PENDING',
        payload: {
          path: 'src/main.js',
          reason: 'High risk edit',
          diff: 'diff details',
          questions: [],
        },
        createdAt: '2026-06-13T11:00:00.000Z',
        updatedAt: '2026-06-13T11:00:00.000Z',
        projectId: 'proj-2',
        projectName: 'Project Two',
        sessionId: null,
        repoUrl: '',
        pipelineStatus: 'running',
        currentPhase: 'DEV',
      });
    });
  });

  describe('GET /sdlc/interventions API Endpoint', () => {
    test('returns 200 with all enriched interventions', async () => {
      const mockInterventions = [
        {
          id: 'gate-1',
          type: 'PO_CLARIFY',
          status: 'PENDING',
          payload: { questions: ['Q1'] },
          createdAt: '2026-06-13T10:00:00.000Z',
          updatedAt: '2026-06-13T10:00:00.000Z',
          projectId: 'proj-1',
          projectName: 'Project One',
          repoUrl: '',
          pipelineStatus: 'awaiting_approval',
          currentPhase: 'PO',
        },
      ];

      jest.spyOn(SdlcWorkflowService, 'getAllInterventions').mockResolvedValue(mockInterventions);

      const req = { user: { id: 'local-user-id' } };
      const res = { json: jest.fn() };
      await SdlcController.listAllInterventions(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        data: mockInterventions,
      });
    });
  });
});
