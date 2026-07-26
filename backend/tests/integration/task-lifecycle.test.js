// Per-session monotonic transport contract.
//
// Spec v3 §10: every EventEnvelope.sequence is monotonic PER session, allocated
// by sequenceService.next(sessionId, projectId). There is no per-task sequence
// space. Lifecycle events for one task share the session's sequence with any
// other task in the same session — so the absolute sequence values in this
// test are deterministic ONLY because we run it on a fresh session.
// Re-running across sessions would shift the absolute numbers; the contract
// is monotonic strictly increasing within the session.

const { randomUUID } = require('crypto');
jest.mock('uuid', () => ({ v4: () => require('crypto').randomUUID() }));

const prisma = require('../../src/config/database');
const { Task, AgentEvent } = require('../../src/models');
const taskLifecycle = require('../../src/services/taskLifecycleService');
const sequenceService = require('../../src/services/sequence');
const eventBus = require('../../src/services/eventBus');
const eventPublisher = require('../../src/services/eventPublisher');

afterEach(() => {
  eventBus._clearAll();
  sequenceService._clearAll();
});

function expectMonotonicIncreasing(values, label) {
  for (let i = 1; i < values.length; i++) {
    expect(values[i]).toBeGreaterThan(values[i - 1]);
  }
  // Sanity: the very first sequence must start at 1 (fresh session, no
  // pre-existing rows).
  expect(values[0]).toBe(1);
}

describe('persisted task lifecycle and AgentEvent (per-session transport)', () => {
  let projectId;
  let taskId;
  let sessionId;

  beforeEach(async () => {
    projectId = randomUUID();
    sessionId = randomUUID();
    taskId = randomUUID();
    await prisma.project.create({ data: { id: projectId, name: 'Lifecycle test' } });
    // Task.sessionId has a FK to PipelineSession — we don't drive the session
    // model here, but the FK must resolve so Task.create can persist.
    await prisma.pipelineSession.create({
      data: { id: sessionId, projectId, status: 'running' },
    });
    await Task.create({ id: taskId, projectId, sessionId, type: 'po-agent', status: 'pending' });
  });

  afterEach(async () => {
    await Task.deleteById(taskId).catch(() => {});
    await prisma.pipelineSession.delete({ where: { id: sessionId } }).catch(() => {});
    await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
  });

  test('persists valid transitions; sequences are monotonic per-session', async () => {
    await taskLifecycle.transition(taskId, 'running', { actor: 'po-agent' });
    await taskLifecycle.transition(taskId, 'awaiting_gate', { actor: 'po-agent', payload: { approvalId: 'gate-1' } });
    await taskLifecycle.transition(taskId, 'running', {
      actor: 'human',
      payload: { approvalId: 'gate-1' },
      eventType: 'gate_resolved',
    });
    await taskLifecycle.transition(taskId, 'completed', { actor: 'po-agent' });

    const task = await Task.findById(taskId);
    const events = await AgentEvent.list({ taskId });

    expect(task.executionStatus).toBe('completed');
    expect(task.startedAt).toBeTruthy();
    expect(task.finishedAt).toBeTruthy();
    expect(events.map((event) => event.type)).toEqual([
      'task_queued',
      'task_started',
      'gate_pending',
      'gate_resolved',
      'task_completed',
    ]);

    // Spec §10: EventEnvelope.sequence is monotonic per-session. The very
    // first event in a fresh session starts at 1; subsequent events must be
    // strictly greater than the preceding one (NOT necessarily consecutive
    // integers — other tasks in the same session may interleave).
    const sequences = events.map((event) => event.sequence);
    expectMonotonicIncreasing(sequences, 'sequences');

    // Every envelope is canonical and required-shape.
    for (const row of events) {
      expect(row.envelope).toBeTruthy();
      const env = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
      expect(env.sessionId).toBe(sessionId);
      expect(env.projectId).toBe(projectId);
      expect(env.sequence).toBe(row.sequence);
      expect(env.id).toBeTruthy();
      expect(typeof env.timestamp).toBe('string');
    }
  });

  test('every envelope carries the canonical shape required by the transport spec', async () => {
    const observed = [];
    eventBus.subscribeProject(projectId, (envelope) => observed.push(envelope));

    // Drive a legal lifecycle path: queued → running → completed. All three
    // envelopes must reach the bus and carry the canonical shape.
    await taskLifecycle.transition(taskId, 'running', { actor: 'po-agent' });
    await taskLifecycle.transition(taskId, 'completed', { actor: 'po-agent' });

    expect(observed.length).toBeGreaterThan(0);
    for (const env of observed) {
      // Mandatory canonical fields.
      expect(env.id).toBeTruthy();
      expect(Number.isFinite(env.sequence)).toBe(true);
      expect(typeof env.type).toBe('string');
      expect(typeof env.timestamp).toBe('string');
      expect(env.projectId).toBe(projectId);
      expect(env.sessionId).toBe(sessionId); // required (string, never null)
      expect('taskId' in env).toBe(true);
      expect('role' in env).toBe(true);
      expect('payload' in env).toBe(true);
    }
  });

  test('rejects an invalid transition without writing an event', async () => {
    await expect(taskLifecycle.transition(taskId, 'completed')).rejects.toThrow(/Invalid task transition/);
    const events = await AgentEvent.list({ taskId });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('task_queued');
  });

  // OBS-01.10 R-24: every lifecycle envelope MUST carry `role: task.type`
  // (per canonical runtime contract §4.1.3–4.1.6, §7 forbidden pattern
  // "`role: null` on lifecycle envelopes", AC-08, §8 invariant 5).
  test('every lifecycle envelope carries role=task.type (OBS-01.10 R-24)', async () => {
    const observed = [];
    eventBus.subscribeProject(projectId, (envelope) => observed.push(envelope));

    // Drive a legal lifecycle path: queued → running → completed.
    // (awaiting_gate → completed is NOT a legal edge per the canonical
    //  matrix; we cannot transition directly.)
    await taskLifecycle.transition(taskId, 'running', { actor: 'po-agent' });
    await taskLifecycle.transition(taskId, 'completed', { actor: 'po-agent' });

    // Filter to lifecycle wire envelopes only (exclude the gate_pending
    // event emitted by gateBridge, which has its own role semantics).
    const lifecycleTypes = new Set([
      'task_started',
      'task_completed',
      'task_failed',
      'task_interrupted',
    ]);
    const lifecycleEnvelopes = observed.filter((env) => lifecycleTypes.has(env.type));

    expect(lifecycleEnvelopes.length).toBeGreaterThan(0);
    for (const env of lifecycleEnvelopes) {
      // AC-08: every lifecycle envelope MUST carry role=task.type.
      expect(env.role).toBe('po-agent');
      // The literal `null` MUST NOT appear on any canonical lifecycle envelope.
      expect(env.role).not.toBeNull();
      expect(env.role).not.toBeUndefined();
      expect(env.taskId).toBe(taskId);
    }
  });

  // OBS-01.10 R-24: failed transitions also carry role=task.type.
  test('failed lifecycle envelope carries role=task.type (OBS-01.10 R-24)', async () => {
    const observed = [];
    eventBus.subscribeProject(projectId, (envelope) => observed.push(envelope));

    await taskLifecycle.transition(taskId, 'running', { actor: 'po-agent' });
    await taskLifecycle.transition(taskId, 'failed', { actor: 'po-agent' });

    const failedEnvelopes = observed.filter((env) => env.type === 'task_failed');
    expect(failedEnvelopes).toHaveLength(1);
    expect(failedEnvelopes[0].role).toBe('po-agent');
  });

  // OBS-01.10 R-24: cancelled transitions also carry role=task.type.
  test('cancelled lifecycle envelope carries role=task.type (OBS-01.10 R-24)', async () => {
    const observed = [];
    eventBus.subscribeProject(projectId, (envelope) => observed.push(envelope));

    await taskLifecycle.transition(taskId, 'running', { actor: 'po-agent' });
    await taskLifecycle.transition(taskId, 'cancelled', { actor: 'po-agent' });

    const interruptedEnvelopes = observed.filter((env) => env.type === 'task_interrupted');
    expect(interruptedEnvelopes).toHaveLength(1);
    expect(interruptedEnvelopes[0].role).toBe('po-agent');
  });

  // OBS-01.10 R-24: the AgentEvent row carries the envelope verbatim,
  // so the persisted replay also reflects the non-null role.
  test('persisted AgentEvent envelope carries role=task.type (OBS-01.10 R-24)', async () => {
    await taskLifecycle.transition(taskId, 'running', { actor: 'po-agent' });
    await taskLifecycle.transition(taskId, 'completed', { actor: 'po-agent' });

    const events = await AgentEvent.list({ taskId });
    // Note: the first persisted row is the `task_queued` envelope emitted by
    // `Task.create` (Task.js:25-30) — that path is a separate code path from
    // `taskLifecycle.publishLifecycle` (R-24's scope). Skip it for this test.
    // The remaining rows come from `taskLifecycle.transition` → publishLifecycle.
    for (const row of events) {
      expect(row.envelope).toBeTruthy();
      const env = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
      const lifecycleTypes = new Set([
        'task_started',
        'task_completed',
        'task_failed',
        'task_interrupted',
      ]);
      // Skip the task_queued envelope (its lifecycleType marker identifies it).
      const isTaskQueued = env.payload && env.payload.lifecycleType === 'task_queued';
      if (lifecycleTypes.has(env.type) && !isTaskQueued) {
        expect(env.role).toBe('po-agent');
      }
    }
  });
});

describe('sequenceService — per-session allocation', () => {
  beforeEach(() => {
    sequenceService._clearAll();
  });

  test('allocates strictly increasing per-session sequences', async () => {
    const s = randomUUID();
    const p = randomUUID();
    const a = await sequenceService.next(s, p);
    const b = await sequenceService.next(s, p);
    const c = await sequenceService.next(s, p);
    expect(a).toBe(1);
    expect(b).toBe(a + 1);
    expect(c).toBe(b + 1);
  });

  test('separate sessions have independent sequence spaces', async () => {
    const a1 = await sequenceService.next('sA', 'pA');
    const b1 = await sequenceService.next('sB', 'pB');
    const a2 = await sequenceService.next('sA', 'pA');
    const b2 = await sequenceService.next('sB', 'pB');
    expect(a1).toBe(1);
    expect(b1).toBe(1);
    expect(a2).toBe(a1 + 1);
    expect(b2).toBe(b1 + 1);
  });

  test('rejects allocation without a sessionId', async () => {
    await expect(sequenceService.next('', 'p')).rejects.toThrow(/sessionId is required/);
  });

  test('rejects allocation without a projectId', async () => {
    await expect(sequenceService.next('s', '')).rejects.toThrow(/projectId is required/);
  });
});

describe('eventPublisher — single construction path', () => {
  beforeEach(() => {
    eventBus._clearAll();
    sequenceService._clearAll();
  });

  test('publishEvent allocates per-session sequence and publishes exactly one envelope', async () => {
    const seen = [];
    eventBus.subscribeProject('p-test', (env) => seen.push(env));

    const env = await eventPublisher.publishEvent(
      'runtime_log',
      { projectId: 'p-test', sessionId: 's-test', taskId: 't-1', role: null },
      { message: 'hello' },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(env);
    expect(env.sequence).toBe(1);
    expect(env.sessionId).toBe('s-test');
    expect(env.projectId).toBe('p-test');
    expect(env.type).toBe('runtime_log');
    expect(typeof env.id).toBe('string');
    expect(typeof env.timestamp).toBe('string');
  });

  test('publishEvent throws when sessionId is missing', async () => {
    await expect(eventPublisher.publishEvent(
      'runtime_log',
      { projectId: 'p-test' },
      {},
    )).rejects.toThrow(/sessionId is required/);
  });
});
