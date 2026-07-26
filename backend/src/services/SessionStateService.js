const SessionState = require('../models/SessionState');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Session State Service - Manage UI state persistence
 */
class SessionStateService {
  /**
   * Save or update session state
   */
  async saveState({ page, selectedDocIds, taskId, metadata, user }) {
    const projectId = metadata?.projectId;
    if (!projectId) throw new ApiError(400, 'metadata.projectId is required');
    return SessionState.upsert({
      page,
      userId: user.id,
      projectId,
      selectedDocIds,
      taskId,
      metadata,
    });
  }

  /**
   * Get session state for a page
   */
  async getState(page, user, projectId) {
    if (!projectId) throw new ApiError(400, 'project_id is required');
    return SessionState.findByPage(page, user.id, projectId);
  }

  /**
   * Clear session state for a page
   */
  async clearState(page, user, projectId = null) {
    return SessionState.deleteByPage(page, user.id, projectId);
  }

  /**
   * Remove document IDs from session state (when docs are deleted)
   */
  async removeDocuments(docIds) {
    return SessionState.removeDocIds(docIds);
  }
}

module.exports = new SessionStateService();

