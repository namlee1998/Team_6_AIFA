// Per-session monotonic sequence counter.
//
// Pure in-process state. Allocates a `next` value against a Map keyed by
// sessionId. There is exactly ONE sequence space per session, used as the
// canonical SSE `id:` cursor and as AgentEvent.sequence.
//
// The counter is implicitly persisted via AgentEvent rows; on backend restart
// the counter resumes from the largest AgentEvent.sequence for that session
// so live events never collide with replayed ones.
//
// This service is transport-only: it has no business logic, no DB writes
// (the seed query is a read).

const prisma = require('../config/database');

const counters = new Map(); // sessionId -> next sequence to allocate

/**
 * Seed the counter from durable state on boot. Safe to call per-session.
 *
 * @param {string} sessionId
 * @param {string} projectId
 */
async function seedFromStore(sessionId, projectId) {
  if (counters.has(sessionId)) return counters.get(sessionId);
  const row = await prisma.agentEvent.findFirst({
    where: { sessionId, projectId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  }).catch(() => null);
  counters.set(sessionId, (row?.sequence ?? 0) + 1);
  return counters.get(sessionId);
}

/**
 * Allocate the next sequence for a session. Allocates from in-memory if
 * seeded, else seeds first (cheap on subsequent calls).
 *
 * @param {string} sessionId
 * @param {string} projectId
 */
async function next(sessionId, projectId) {
  if (!sessionId) throw new Error('sequence.next: sessionId is required');
  if (!projectId) throw new Error('sequence.next: projectId is required');
  if (!counters.has(sessionId)) await seedFromStore(sessionId, projectId);
  const v = counters.get(sessionId);
  counters.set(sessionId, v + 1);
  return v;
}

/** Test helper — drop everything. */
function _clearAll() {
  counters.clear();
}

module.exports = { next, seedFromStore, _clearAll };
