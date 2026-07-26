const SdlcWorkflowService = require('./SdlcWorkflowService');

class DemoBoardService {
  async seedDemoBoard(reset, sourceRepoPath, mode) {
    return {
      status: 'success',
      mode,
      flows: []
    };
  }

  async getDemoBoard(user) {
    // Basic stub that returns a healthy board.
    // In a real implementation, this would aggregate flows from SdlcWorkflowService.
    return {
      status: 'ready',
      flows: []
    };
  }

  async getDemoUxDoc(projectId, user) {
    return {
      taskId: 'mock-task-id',
      fileName: 'UX_SPEC.md',
      markdown: '# UX Specification\n\nMock document.'
    };
  }

  async retryDemoFlow(projectId, user) {
    return {
      retried: true,
      stage: 'PO',
      reason: 'Manual retry via Demo Board'
    };
  }
}

module.exports = new DemoBoardService();
