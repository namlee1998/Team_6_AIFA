// Pure pub/sub transport for runtime events.
//
// Responsibilities (and ONLY these):
//   - publish(envelope)
//   - subscribe(scopeKey, listener)
//   - subscribeProject(projectId, listener)
//   - unsubscribe(handle)
//
// What this module NEVER does:
//   - write database
//   - mutate domain state
//   - derive business values (gate types, role->agent mapping, etc.)
//   - convert payloads
//   - know PendingGate or AgentEvent
//   - perform lifecycle transitions
//
// It is a transport. Producers own business logic; this module owns delivery.

const logger = require('../config/logger');

/** scopeKey (sessionId) -> Set<(envelope) => void> */
const sessionSubscribers = new Map();
/** projectId -> Set<(envelope) => void> */
const projectSubscribers = new Map();

/**
 * Subscribe to every event published under the given scopeKey (a sessionId
 * or any logical scope you choose). Returns an unsubscribe function.
 *
 * @param {string} scopeKey
 * @param {(envelope: object) => void} listener
 * @returns {() => void} unsubscribe
 */
function subscribe(scopeKey, listener) {
  if (!scopeKey) return () => {};
  if (typeof listener !== 'function') return () => {};
  const set = sessionSubscribers.get(scopeKey) || new Set();
  set.add(listener);
  sessionSubscribers.set(scopeKey, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) sessionSubscribers.delete(scopeKey);
  };
}

/**
 * Subscribe to every event whose envelope.projectId matches. Useful for
 * session-wide consumers (the SSE writer) that want to see every task's
 * events without knowing each sessionId up front.
 */
function subscribeProject(projectId, listener) {
  if (!projectId) return () => {};
  if (typeof listener !== 'function') return () => {};
  const set = projectSubscribers.get(projectId) || new Set();
  set.add(listener);
  projectSubscribers.set(projectId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) projectSubscribers.delete(projectId);
  };
}

/**
 * Fan an envelope out to every subscriber matching its scopeKey or projectId.
 * Synchronous, in-process. Listener errors are logged and swallowed — one bad
 * subscriber cannot break the rest.
 */
function publish(envelope) {
  if (!envelope || typeof envelope !== 'object') return;
  const { sessionId, projectId } = envelope;

  if (sessionId) {
    const set = sessionSubscribers.get(sessionId);
    if (set) {
      for (const listener of set) {
        try {
          listener(envelope);
        } catch (err) {
          logger.warn?.('eventBus session listener failed', { sessionId, type: envelope.type, error: err.message });
        }
      }
    }
  }
  if (projectId) {
    const set = projectSubscribers.get(projectId);
    if (set) {
      for (const listener of set) {
        try {
          listener(envelope);
        } catch (err) {
          logger.warn?.('eventBus project listener failed', { projectId, sessionId, type: envelope.type, error: err.message });
        }
      }
    }
  }
}

/** Test helper — drop everything. */
function _clearAll() {
  sessionSubscribers.clear();
  projectSubscribers.clear();
}

module.exports = {
  publish,
  subscribe,
  subscribeProject,
  _clearAll,
};