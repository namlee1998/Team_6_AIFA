// Canonical runtime event DTO.
//
// This module is PURE — it MUST NOT import eventBus, eventPublisher, or any
// service that performs IO. Producers import `publishEvent` from
// `services/eventPublisher`; nobody imports `createEnvelope` directly.

const { v4: uuidv4 } = require('uuid');

/**
 * @typedef {'session_started'
 *   | 'session_resumed'
 *   | 'pipeline_completed'
 *   | 'pipeline_failed'
 *   | 'task_started'
 *   | 'task_completed'
 *   | 'task_failed'
 *   | 'task_interrupted'
 *   | 'task_resumed'
 *   | 'gate_pending'
 *   | 'gate_resolved'
 *   | 'agent_event'
 *   | 'runtime_log'} EventType
 */

/**
 * @typedef {Object} EventEnvelope
 * @property {string} id         UUIDv4, unique across whole workflow
 * @property {number} sequence    monotonic per-session, used as SSE `id:`
 * @property {EventType} type     discriminator
 * @property {string} timestamp   ISO8601
 * @property {string} projectId
 * @property {string} sessionId   required — every published envelope is bound
 *   to a session. There is one sequence space per session.
 * @property {string|null} taskId
 * @property {string|null} role
 * @property {object} payload
 */

/**
 * Build a canonical EventEnvelope. Used internally by eventPublisher.
 *
 * @param {EventType} type
 * @param {{ projectId: string, sessionId: string, taskId?: string|null, role?: string|null }} base
 * @param {object} payload
 * @param {number} sequence     allocated by sequenceService
 */
function createEnvelope(type, base, payload, sequence) {
  if (!type) throw new Error('createEnvelope: type is required');
  if (!base || typeof base !== 'object') throw new Error('createEnvelope: base is required');
  if (!base.projectId) throw new Error('createEnvelope: base.projectId is required');
  if (!base.sessionId) throw new Error('createEnvelope: sessionId is required');
  if (!Number.isFinite(sequence)) throw new Error('createEnvelope: sequence is required');

  return {
    id: uuidv4(),
    sequence,
    type,
    timestamp: new Date().toISOString(),
    projectId: base.projectId,
    sessionId: base.sessionId,
    taskId: base.taskId ?? null,
    role: base.role ?? null,
    payload: payload ?? {},
  };
}

module.exports = {
  createEnvelope,
};