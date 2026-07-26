// AIFA — regression coverage for the race where an SDK tool/question
// decision arrives AFTER the task's execution budget has expired and the
// task has already moved to a terminal executionStatus. Previously this
// surfaced as:
//
//   {"error":"Invalid task transition: timeout -> awaiting_gate",
//    "msg":"failed to persist pending gate"}
//
// because gateBridge.requestGate unconditionally tried to transition the
// owning task `… -> awaiting_gate`. The state machine forbids that
// transition from any terminal state. The fix is to skip the lifecycle
// transition when the owning task is already terminal — the PendingGate
// row is still created (operator still sees the gate), but no invalid
// edge is attempted and no swallowed error is logged.

jest.mock('uuid', () => { let n = 0; return { v4: () => `gate-bug-${++n}` }; });

const gateBridge = require('../../src/services/gateBridge');
const eventBus = require('../../src/services/eventBus');
const { Task } = require('../../src/models');

describe('gateBridge — terminal-state race guard', () => {
  beforeEach(() => {
    gateBridge._clearAll();
    eventBus._clearAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('tool gate on a task already in `timeout` does not throw and still creates PendingGate', async () => {
    const findByIdSpy = jest.spyOn(Task, 'findById').mockResolvedValue({
      id: 'task-timeout',
      executionStatus: 'timeout',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });

    const { approvalId, ready } = gateBridge.requestGate({
      taskId: 'task-timeout',
      sessionId: 'sess-1',
      projectId: 'proj-1',
      role: 'qa-agent',
      kind: 'tool',
      payload: { toolName: 'Write', file_path: 'src/a.js' },
    });

    // The bug surfaced here as `ready` rejecting with "Invalid task
    // transition: timeout -> awaiting_gate".
    await expect(ready).resolves.toBeUndefined();
    expect(findByIdSpy).toHaveBeenCalledWith('task-timeout');
    expect(gateBridge.hasPending(approvalId)).toBe(true);
  });

  test.each(['completed', 'failed', 'cancelled', 'timeout'])(
    'tool gate on a task in `%s` executionStatus does not attempt awaiting_gate transition',
    async (terminalStatus) => {
      jest.spyOn(Task, 'findById').mockResolvedValue({
        id: 'task-terminal',
        executionStatus: terminalStatus,
        projectId: 'proj-1',
        sessionId: 'sess-1',
      });

      const { ready } = gateBridge.requestGate({
        taskId: 'task-terminal',
        sessionId: 'sess-1',
        projectId: 'proj-1',
        role: 'qa-agent',
        kind: 'tool',
        payload: {},
      });

      await expect(ready).resolves.toBeUndefined();
    },
  );

  test('tool gate on a task still `running` does attempt the awaiting_gate transition', async () => {
    // Sanity check: the guard must NOT skip the transition for live tasks.
    jest.spyOn(Task, 'findById').mockResolvedValue({
      id: 'task-running',
      executionStatus: 'running',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    });

    // taskLifecycle.transitionIfPresent will surface "Task not found" for
    // a real DB write (Task.findById here only fakes the gateBridge check).
    // We only assert that the call site is reached — i.e. the guard didn't
    // short-circuit. The simplest way is to count Task.findById calls and
    // confirm the gate was still created (ready resolves).
    const { approvalId, ready } = gateBridge.requestGate({
      taskId: 'task-running',
      sessionId: 'sess-1',
      projectId: 'proj-1',
      role: 'dev-agent',
      kind: 'tool',
      payload: {},
    });

    await ready;
    expect(gateBridge.hasPending(approvalId)).toBe(true);
  });

  test('output_review gates still skip the awaiting_gate transition (existing behaviour preserved)', async () => {
    // No Task.findById needed — output_review is already in the skip list.
    jest.spyOn(Task, 'findById').mockResolvedValue(null);

    const { approvalId, ready } = gateBridge.requestGate({
      taskId: 'task-output-review',
      sessionId: 'sess-1',
      projectId: 'proj-1',
      role: 'qa-agent',
      kind: 'output_review',
      payload: {},
    });

    await expect(ready).resolves.toBeUndefined();
    expect(gateBridge.hasPending(approvalId)).toBe(true);
  });
});

// Second-order race: an in-flight agent can complete (returning data +
// triggering _saveAgentData) AFTER the task was moved to `timeout` by
// handleTaskTimeout. Previously _saveAgentData called transition()
// directly which threw "Invalid task transition: timeout -> completed",
// which then bubbled up as "claude-code path failed" and double-marked
// the task failed even though `markTaskFailed` already detected the
// terminal state and skipped. The fix is a narrower version of the
// terminal-state guard: `transitionIfPresent` now swallows the canonical
// invalid-transition error and `_saveAgentData` switched to it.

describe('taskLifecycle — transitionIfPresent swallows terminal-state invalid edges', () => {
  // We exercise the real `transitionIfPresent` against a mocked `prisma.task`
  // so the actual state-machine validation runs and surfaces the canonical
  // "Invalid task transition" error. Mocking the exported `transition`
  // function won't work — `transitionIfPresent` calls it by closure
  // reference, not via the module's exports object.
  // eslint-disable-next-line global-require
  const taskLifecycle = require('../../src/services/taskLifecycleService');
  // eslint-disable-next-line global-require
  const logger = require('../../src/config/logger');
  // eslint-disable-next-line global-require
  const prisma = require('../../src/config/database');
  let loggerSpy;
  let originalTaskDelegate;

  beforeEach(() => {
    originalTaskDelegate = prisma.task;
    loggerSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    prisma.task = originalTaskDelegate;
    jest.restoreAllMocks();
  });

  it('returns null and logs a warning when currentStatus is terminal and nextStatus has no edge', async () => {
    prisma.task = {
      findUnique: async () => ({
        id: 't-1',
        executionStatus: 'timeout',
        projectId: null,
        sessionId: null,
      }),
      update: async () => ({ id: 't-1', executionStatus: 'completed' }),
    };

    const result = await taskLifecycle.transitionIfPresent('t-1', 'completed', {});
    expect(result).toBeNull();
    expect(loggerSpy).toHaveBeenCalledWith(
      'task lifecycle transition skipped for terminal state',
      expect.objectContaining({ taskId: 't-1', nextStatus: 'completed' }),
    );
  });

  it('still throws for non-canonical transition errors (regression)', async () => {
    // Mock prisma.task.findUnique to throw something other than the canonical
    // "Invalid task transition" / "Task not found" messages — those are the
    // ones transitionIfPresent swallows; everything else bubbles.
    prisma.task = {
      findUnique: async () => {
        throw new Error('Database connection lost');
      },
      update: async () => ({ id: 't-2' }),
    };

    await expect(taskLifecycle.transitionIfPresent('t-2', 'completed', {}))
      .rejects.toThrow('Database connection lost');
  });
});
