// Tests for the OBS-01.10 R-25 fix.
//
// Before R-25, `SdlcWorkflowService.toPhaseStatus` was an inline closure
// that read `phaseData.status` (the legacy `Task.status` field). The
// canonical runtime contract (07_CANONICAL_RUNTIME_CONTRACT.md §7) forbids
// "Deriving runtime from `Task.status` (legacy)". R-25 extracts the
// helper to `sdlcConstants.js` and re-projects from `phaseData.executionStatus`
// (the canonical machine) onto the FE-visible `PhaseStatus`.
//
// These tests assert that every one of the 8 canonical `executionStatus`
// values projects onto the correct `PhaseStatus`, plus the existing
// legacy-fallback and `awaitingReview` override semantics.

const {
  toPhaseStatus,
  EXECUTION_STATUS_TO_PHASE_STATUS,
} = require('../../src/services/sdlcConstants');

describe('toPhaseStatus (OBS-01.10 R-25)', () => {
  describe('EXECUTION_STATUS_TO_PHASE_STATUS mapping table', () => {
    test('covers every one of the 8 canonical executionStatus values', () => {
      expect(Object.keys(EXECUTION_STATUS_TO_PHASE_STATUS).sort()).toEqual([
        'awaiting_gate',
        'cancelled',
        'completed',
        'dispatched',
        'failed',
        'queued',
        'running',
        'timeout',
      ]);
    });

    test('queued → pending (canonical initial)', () => {
      expect(EXECUTION_STATUS_TO_PHASE_STATUS.queued).toBe('pending');
    });

    test('dispatched → pending (reserved; no producer today)', () => {
      expect(EXECUTION_STATUS_TO_PHASE_STATUS.dispatched).toBe('pending');
    });

    test('running → running', () => {
      expect(EXECUTION_STATUS_TO_PHASE_STATUS.running).toBe('running');
    });

    test('awaiting_gate → gate_pending', () => {
      expect(EXECUTION_STATUS_TO_PHASE_STATUS.awaiting_gate).toBe('gate_pending');
    });

    test('completed → completed', () => {
      expect(EXECUTION_STATUS_TO_PHASE_STATUS.completed).toBe('completed');
    });

    test('failed → failed', () => {
      expect(EXECUTION_STATUS_TO_PHASE_STATUS.failed).toBe('failed');
    });

    test('cancelled → skipped (FE projection collapses with timeout)', () => {
      expect(EXECUTION_STATUS_TO_PHASE_STATUS.cancelled).toBe('skipped');
    });

    test('timeout → skipped (FE projection collapses with cancelled)', () => {
      expect(EXECUTION_STATUS_TO_PHASE_STATUS.timeout).toBe('skipped');
    });
  });

  describe('toPhaseStatus — null / absent phaseData', () => {
    test('returns pending when phaseData is null', () => {
      expect(toPhaseStatus('PO', null, false)).toEqual({
        agent: 'PO',
        status: 'pending',
      });
    });

    test('returns pending when phaseData is undefined', () => {
      expect(toPhaseStatus('PO', undefined, false)).toEqual({
        agent: 'PO',
        status: 'pending',
      });
    });

    test('returns skipped when isSkipped=true and phaseData is null', () => {
      expect(toPhaseStatus('PO', null, true)).toEqual({
        agent: 'PO',
        status: 'skipped',
      });
    });

    test('isSkipped is ignored when phaseData is provided', () => {
      // When phaseData exists, isSkipped alone does not force skipped.
      // The executionStatus drives the visible status.
      expect(
        toPhaseStatus('DEV', { taskId: 't-1', executionStatus: 'running', awaitingReview: false, invalid: false }, true),
      ).toMatchObject({ agent: 'DEV', status: 'running' });
    });
  });

  describe('toPhaseStatus — canonical executionStatus (the R-25 fix)', () => {
    test('reads executionStatus (NOT legacy status) — running case', () => {
      // The legacy status is 'processing' (the legacy writer
      // `agentDispatcher.runAgent:312` writes 'processing').
      // Before R-25, the visible value would be 'processing' (no FE map).
      // After R-25, the visible value is 'running' (canonical).
      const result = toPhaseStatus('PO', {
        taskId: 't-1',
        status: 'processing',  // legacy
        executionStatus: 'running', // canonical
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('running');
    });

    test('reads executionStatus — awaiting_gate case', () => {
      const result = toPhaseStatus('PO', {
        taskId: 't-1',
        executionStatus: 'awaiting_gate',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('gate_pending');
    });

    test('reads executionStatus — completed case', () => {
      const result = toPhaseStatus('QA', {
        taskId: 't-qa',
        executionStatus: 'completed',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('completed');
    });

    test('reads executionStatus — failed case', () => {
      const result = toPhaseStatus('DEV', {
        taskId: 't-dev',
        executionStatus: 'failed',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('failed');
    });

    test('reads executionStatus — cancelled → skipped', () => {
      const result = toPhaseStatus('UX', {
        taskId: 't-ux',
        executionStatus: 'cancelled',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('skipped');
    });

    test('reads executionStatus — timeout → skipped', () => {
      const result = toPhaseStatus('UX', {
        taskId: 't-ux',
        executionStatus: 'timeout',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('skipped');
    });

    test('reads executionStatus — queued → pending', () => {
      const result = toPhaseStatus('Architecture', {
        taskId: 't-arch',
        executionStatus: 'queued',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('pending');
    });

    test('reads executionStatus — dispatched → pending (reserved)', () => {
      const result = toPhaseStatus('DEV', {
        taskId: 't-dev',
        executionStatus: 'dispatched',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('pending');
    });
  });

  describe('toPhaseStatus — awaitingReview override (preserved from pre-R-25)', () => {
    test('awaitingReview=true forces gate_pending regardless of executionStatus', () => {
      // Per contract §4 evidence gaps "gated vs ungated output_review":
      // a completed task with awaitingReview=true is in the output_review
      // gate path; the visible state should be gate_pending.
      const result = toPhaseStatus('PO', {
        taskId: 't-po',
        executionStatus: 'completed',
        versionStatus: 'committed',
        awaitingReview: true,
        invalid: false,
      });
      expect(result.status).toBe('gate_pending');
      expect(result.awaitingReview).toBe(true);
    });

    test('awaitingReview=true overrides queued → gate_pending', () => {
      const result = toPhaseStatus('PO', {
        taskId: 't-po',
        executionStatus: 'queued',
        awaitingReview: true,
        invalid: false,
      });
      expect(result.status).toBe('gate_pending');
    });

    test('awaitingReview=false preserves canonical mapping', () => {
      const result = toPhaseStatus('PO', {
        taskId: 't-po',
        executionStatus: 'completed',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('completed');
    });
  });

  describe('toPhaseStatus — defensive legacy fallback', () => {
    test('falls back to legacy status when executionStatus is null', () => {
      // Defensive path: callers that pre-date the canonical column and
      // only carry the legacy `status` field continue to work.
      const result = toPhaseStatus('PO', {
        taskId: 't-po',
        executionStatus: null,
        status: 'completed',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('completed');
    });

    test('falls back to legacy status when executionStatus is undefined', () => {
      const result = toPhaseStatus('PO', {
        taskId: 't-po',
        status: 'completed',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('completed');
    });

    test('returns pending when neither executionStatus nor status is set', () => {
      const result = toPhaseStatus('PO', {
        taskId: 't-po',
        awaitingReview: false,
        invalid: false,
      });
      expect(result.status).toBe('pending');
    });
  });

  describe('toPhaseStatus — output shape', () => {
    test('preserves taskId on the returned object', () => {
      expect(
        toPhaseStatus('PO', {
          taskId: 't-42',
          executionStatus: 'running',
          awaitingReview: false,
          invalid: false,
        }),
      ).toMatchObject({ taskId: 't-42' });
    });

    test('preserves awaitingReview on the returned object', () => {
      expect(
        toPhaseStatus('PO', {
          taskId: 't-42',
          executionStatus: 'completed',
          awaitingReview: true,
          invalid: false,
        }),
      ).toMatchObject({ awaitingReview: true });
    });

    test('preserves invalid on the returned object', () => {
      expect(
        toPhaseStatus('PO', {
          taskId: 't-42',
          executionStatus: 'failed',
          awaitingReview: false,
          invalid: true,
        }),
      ).toMatchObject({ invalid: true });
    });

    test('preserves agent name on the returned object', () => {
      expect(
        toPhaseStatus('Architecture', {
          taskId: 't-arch',
          executionStatus: 'running',
          awaitingReview: false,
          invalid: false,
        }),
      ).toMatchObject({ agent: 'Architecture' });
    });
  });
});