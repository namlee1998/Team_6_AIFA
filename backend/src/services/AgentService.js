const axios = require('axios');
const { getAgentUrl, getWebSocketUrl } = require('../config/agents');

/**
 * Service for communicating with the Python AI Agents server.
 * Pure bridge - no business logic, just proxying requests.
 */
class AgentService {
  /**
   * Send a request to the agent to run a specific node
   * @param {Object} params
   * @param {string} params.sessionId - Task/session ID
   * @param {string} params.nodeTarget - Target agent node (e.g., 'agent_1_extraction')
   * @param {Object} params.context - Context data for the agent
   * @param {string=} params.userId - User ID for trace correlation
   * @param {string=} params.projectId - Project ID for trace correlation
   * @param {string=} params.sourceRunId - Upstream task ID for trace correlation
   * @returns {Promise<Object>} Agent response
   */
  async runAgent({ sessionId, nodeTarget, context, userId = null, projectId = null, sourceRunId = null }) {
    try {
      // Log what we're sending for debugging
      console.log('[AgentService] Sending to agent server:', {
        sessionId,
        nodeTarget,
        contextKeys: Object.keys(context),
        rawTextLength: context.raw_text?.length || 0,
      });

      const response = await axios.post(
        getAgentUrl('/v1/agent/run'),
        {
          session_id: sessionId,
          user_id: userId,
          project_id: projectId,
          source_run_id: sourceRunId,
          node_target: nodeTarget,
          context,
          auto_approve: process.env.AUTO_APPROVE_TOOLS === 'true',
        },
        {
          headers: { 'Content-Type': 'application/json' },
          responseType: 'stream',
        }
      );
      return response;
    } catch (error) {
      if (error.response) {
        // Try to read the error response body for more details
        let errorDetail = `${error.response.status} ${error.response.statusText}`;
        try {
          const chunks = [];
          for await (const chunk of error.response.data) {
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks).toString('utf-8');
          errorDetail += ` - ${body}`;
        } catch (e) {
          // Ignore if we can't read the error body
        }
        throw new Error(`Agent server error: ${errorDetail}`);
      }
      throw new Error(`Failed to communicate with agent: ${error.message}`);
    }
  }

  /**
   * Get WebSocket URL for streaming agent traces
   * @param {string} sessionId
   * @returns {string} WebSocket URL
   */
  getStreamWebSocketUrl(sessionId) {
    return getWebSocketUrl(sessionId);
  }

  /**
   * Send resolve unknowns feedback to agent
   * @param {Object} params
   * @param {string} params.sessionId - Task/session ID
   * @param {Array} params.resolutions - Array of {unknown_text, user_feedback}
   * @returns {Promise<Object>} Agent response
   */
  async resolveUnknowns({ sessionId, resolutions }) {
    try {
      const response = await axios.post(
        getAgentUrl('/v1/agent/run'),
        {
          session_id: sessionId,
          node_target: 'agent_1_extraction',
          context: {
            resolutions,
            action: 'resolve_unknowns',
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Agent server error: ${error.response.status} ${error.response.statusText}`);
      }
      throw new Error(`Failed to resolve unknowns: ${error.message}`);
    }
  }

  /**
   * Determine target agent for rework based on feedback
   * @param {string} feedbackPrompt - The user feedback text
   * @returns {Promise<string>} Target agent name
   */
  async routeRework(feedbackPrompt) {
    try {
      const response = await axios.post(
        getAgentUrl('/v1/agent/route-rework'),
        { feedback_prompt: feedbackPrompt },
        { headers: { 'Content-Type': 'application/json' } }
      );
      return response.data.target_agent; // e.g. "ux_agent"
    } catch (error) {
      console.error('[AgentService] routeRework failed:', error.message);
      return 'qa_agent'; // default fallback
    }
  }
}

module.exports = new AgentService();
