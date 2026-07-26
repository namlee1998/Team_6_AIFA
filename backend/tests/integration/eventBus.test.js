// eventBus — pure pub/sub fan-out.
//
// Verifies that a listener registered via subscribeProject receives every
// envelope published to that project, that unsubscribe removes it cleanly,
// and that listeners on different projects don't leak.

jest.mock('uuid', () => { let n = 0; return { v4: () => `uuid-${++n}` }; });

const eventBus = require('../../src/services/eventBus');

function envelope(projectId, sessionId = 's', type = 'runtime_log', payload = {}) {
  return {
    id: 'env',
    sequence: 1,
    type,
    timestamp: new Date().toISOString(),
    projectId,
    sessionId,
    taskId: null,
    role: null,
    payload,
  };
}

describe('eventBus', () => {
  beforeEach(() => {
    eventBus._clearAll();
  });

  test('subscribeProject returns an unsubscribe function', () => {
    const cb = jest.fn();
    const unsub = eventBus.subscribeProject('proj-1', cb);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  test('unsubscribe prevents future events from reaching the listener', () => {
    const cb = jest.fn();
    const unsub = eventBus.subscribeProject('proj-1', cb);
    unsub();
    eventBus.publish(envelope('proj-1', 's', 'runtime_log'));
    expect(cb).not.toHaveBeenCalled();
  });

  test('events for a different project do not leak into a subscriber', () => {
    const cbA = jest.fn();
    const cbB = jest.fn();
    eventBus.subscribeProject('proj-A', cbA);
    eventBus.subscribeProject('proj-B', cbB);
    eventBus.publish(envelope('proj-A', 's', 'runtime_log'));
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).not.toHaveBeenCalled();
  });

  test('publish forwards the envelope unchanged', () => {
    const cb = jest.fn();
    eventBus.subscribeProject('proj-1', cb);
    const env = envelope('proj-1', 's', 'gate_pending', { gate: { id: 'g1' } });
    eventBus.publish(env);
    expect(cb).toHaveBeenCalledWith(env);
  });

  test('a bad listener does not break other listeners', () => {
    const cbBad = jest.fn(() => { throw new Error('boom'); });
    const cbGood = jest.fn();
    eventBus.subscribeProject('proj-1', cbBad);
    eventBus.subscribeProject('proj-1', cbGood);
    eventBus.publish(envelope('proj-1'));
    expect(cbGood).toHaveBeenCalledTimes(1);
  });

  test('session-scope subscribers only get envelopes for their sessionId', () => {
    const cbA = jest.fn();
    const cbB = jest.fn();
    eventBus.subscribe('session-A', cbA);
    eventBus.subscribe('session-B', cbB);
    eventBus.publish(envelope('proj-X', 'session-A'));
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).not.toHaveBeenCalled();
  });
});