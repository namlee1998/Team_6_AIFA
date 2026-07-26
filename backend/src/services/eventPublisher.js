// Transport-side envelope publishing facade.
//
// Producers (workflow code) MUST NOT call createEnvelope directly. They
// import publishEvent from this module and let it:
//   1. allocate the next per-session sequence (the ONE sequence source)
//   2. build a canonical EventEnvelope (DTO is pure)
//   3. publish through eventBus
//
// Returns the envelope so callers can persist it (e.g. via AgentEvent)
// after publishing. The bus is delivery-only; durability is the caller's
// job.

const { createEnvelope } = require('../dto/eventEnvelope');
const eventBus = require('./eventBus');
const sequenceService = require('./sequence');

async function publishEvent(type, base, payload) {
  if (!base || !base.projectId) {
    throw new Error('publishEvent: base.projectId is required');
  }
  if (!base.sessionId) {
    throw new Error('publishEvent: base.sessionId is required');
  }
  const sequence = await sequenceService.next(base.sessionId, base.projectId);
  const envelope = createEnvelope(type, base, payload, sequence);
  eventBus.publish(envelope);
  return envelope;
}

module.exports = { publishEvent };
