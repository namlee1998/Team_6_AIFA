// Tests for the OBS-01.10 R-23 fix.
//
// Before R-23, the per-event lifecycle mappers in `eventMappers.ts` updated
// `agentStates[agentKey]` but did NOT patch `pipelinePhases[i].status`.
// Per the canonical runtime contract (07_CANONICAL_RUNTIME_CONTRACT.md §8
// invariant 14, AC-15, and the §7 forbidden pattern "frozen snapshot for
// runtime transitions"), the canonical writers of `pipelinePhases` are
// `mapSessionStarted` (seed) AND per-event lifecycle mappers (per-event
// patches).
//
// These tests assert that every per-event lifecycle mapper patches BOTH
// `agentStates[agentKey]` AND `pipelinePhases[i].status` for the matching
// agent.

import { describe, expect, it } from 'vitest';
import {
  mapTaskStarted,
  mapTaskCompleted,
  mapTaskFailed,
  mapTaskInterrupted,
} from '@/store/eventMappers';
import type { EventEnvelope, TaskLifecyclePayload } from '@/dto/event';
import {
  AGENT_KEYS,
  defaultPipelinePhases,
  emptyAgentStates,
  type AgentKey,
  type SessionState,
} from '@/models/SessionState';

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  const now = 1_700_000_000_000;
  return {
    sessionId: 's-1',
    taskId: 't-1',
    projectId: 'p-1',
    status: 'running',
    error: null,
    createdAt: now,
    lastUpdatedAt: now,
    pipelinePhases: defaultPipelinePhases(),
    agentStates: emptyAgentStates(),
    pendingGates: [],
    selectedGateId: null,
    gateHistory: [],
    auditLog: [],
    runtimeEvents: [],
    qaResult: null,
    releaseStatus: 'pending',
    repoInfo: null,
    featureRequest: 'test feature',
    repoUrl: 'https://example.com/repo',
    ...overrides,
  };
}

function makeEnvelope(role: string | null, taskId: string | null = 't-1'): EventEnvelope<TaskLifecyclePayload> {
  return {
    id: 'env-1',
    sequence: 1,
    type: 'task_started',
    timestamp: new Date().toISOString(),
    projectId: 'p-1',
    sessionId: 's-1',
    taskId,
    role,
    payload: { from: 'queued', to: 'running' },
  };
}

describe('per-event lifecycle mappers — OBS-01.10 R-23 pipelinePhases patch', () => {
  describe('mapTaskStarted', () => {
    it("patches both agentStates[PO].status and pipelinePhases[PO].status to 'running'", () => {
      const state = makeSession();
      const result = mapTaskStarted(state, makeEnvelope('po-agent'));
      expect(result.agentStates?.PO?.status).toBe('running');
      expect(result.pipelinePhases?.find((p) => p.agent === 'PO')?.status).toBe('running');
    });

    it('patches only the matching agent, leaves others as pending', () => {
      const state = makeSession();
      const result = mapTaskStarted(state, makeEnvelope('dev-agent'));
      expect(result.agentStates?.DEV?.status).toBe('running');
      expect(result.pipelinePhases?.find((p) => p.agent === 'DEV')?.status).toBe('running');
      // Other agents should remain at their initial values — the patch
      // preserves every other agent's status (only the matching agent is
      // touched via `state.pipelinePhases.map(...)` filter).
      for (const agent of AGENT_KEYS) {
        if (agent === 'DEV') continue;
        expect(result.agentStates?.[agent]?.status).toBe('idle');
        expect(result.pipelinePhases?.find((p) => p.agent === agent)?.status).toBe('pending');
      }
    });

    it('does NOT patch either field when inferAgentKey returns null (early-return)', () => {
      const state = makeSession();
      const env = makeEnvelope(null);
      const result = mapTaskStarted(state, env);
      // agentStates must be undefined in the early-return branch — applying
      // the patch would overwrite nothing, but the canonical projection
      // expects no patch when the role is unresolvable.
      expect(result.agentStates).toBeUndefined();
      // pipelinePhases must be undefined too — no patch.
      expect(result.pipelinePhases).toBeUndefined();
    });

    it('does NOT patch either field when env.taskId is null', () => {
      const state = makeSession();
      const env = makeEnvelope('po-agent', null);
      const result = mapTaskStarted(state, env);
      expect(result.agentStates).toBeUndefined();
      expect(result.pipelinePhases).toBeUndefined();
    });
  });

  describe('mapTaskCompleted', () => {
    it("patches both agentStates[PO].status and pipelinePhases[PO].status to 'completed'", () => {
      const state = makeSession();
      const result = mapTaskCompleted(state, makeEnvelope('po-agent'));
      expect(result.agentStates?.PO?.status).toBe('completed');
      expect(result.agentStates?.PO?.completedAt).toBeTypeOf('number');
      expect(result.pipelinePhases?.find((p) => p.agent === 'PO')?.status).toBe('completed');
    });

    it('does NOT patch either field when inferAgentKey returns null', () => {
      const state = makeSession();
      const result = mapTaskCompleted(state, makeEnvelope(null));
      expect(result.agentStates).toBeUndefined();
      expect(result.pipelinePhases).toBeUndefined();
    });
  });

  describe('mapTaskFailed', () => {
    it("patches both agentStates[DEV].status and pipelinePhases[DEV].status to 'failed'", () => {
      const state = makeSession();
      const result = mapTaskFailed(state, makeEnvelope('dev-agent'));
      expect(result.agentStates?.DEV?.status).toBe('failed');
      expect(result.pipelinePhases?.find((p) => p.agent === 'DEV')?.status).toBe('failed');
    });

    it('does NOT patch either field when inferAgentKey returns null', () => {
      const state = makeSession();
      const result = mapTaskFailed(state, makeEnvelope(null));
      expect(result.agentStates).toBeUndefined();
      expect(result.pipelinePhases).toBeUndefined();
    });
  });

  describe('mapTaskInterrupted (cancelled / timeout)', () => {
    it("patches both agentStates[UX].status and pipelinePhases[UX].status to 'skipped' for cancelled", () => {
      const state = makeSession();
      const result = mapTaskInterrupted(state, makeEnvelope('ux-agent'));
      expect(result.agentStates?.UX?.status).toBe('skipped');
      expect(result.pipelinePhases?.find((p) => p.agent === 'UX')?.status).toBe('skipped');
    });

    it("patches both fields to 'skipped' for timeout (same projection per canonical mapping)", () => {
      // Per runtimeSelectors.ts:203-206, BOTH 'cancelled' and 'timeout'
      // project to PhaseStatus 'skipped'. The mapper does not distinguish.
      const state = makeSession();
      const result = mapTaskInterrupted(state, makeEnvelope('qa-agent'));
      expect(result.agentStates?.QA?.status).toBe('skipped');
      expect(result.pipelinePhases?.find((p) => p.agent === 'QA')?.status).toBe('skipped');
    });

    it('does NOT patch either field when inferAgentKey returns null', () => {
      const state = makeSession();
      const result = mapTaskInterrupted(state, makeEnvelope(null));
      expect(result.agentStates).toBeUndefined();
      expect(result.pipelinePhases).toBeUndefined();
    });
  });

  describe('cross-agent pipelinePhases atomicity', () => {
    it('all 5 agents project to running after 5 sequential task_started envelopes', () => {
      let state = makeSession();
      const roles: Record<AgentKey, string> = {
        ARCH: 'architecture-agent',
        PO: 'po-agent',
        UX: 'ux-agent',
        DEV: 'dev-agent',
        QA: 'qa-agent',
      };
      for (const [agentKey, role] of Object.entries(roles) as Array<[AgentKey, string]>) {
        const env = makeEnvelope(role);
        state = { ...state, ...mapTaskStarted(state, env) };
        expect(state.agentStates[agentKey].status).toBe('running');
        expect(state.pipelinePhases.find((p) => p.agent === agentKey)?.status).toBe('running');
      }
      // All 5 phases should be running
      for (const p of state.pipelinePhases) {
        expect(p.status).toBe('running');
      }
    });

    it('pipelinePhases patch preserves the agent field', () => {
      const state = makeSession();
      const result = mapTaskStarted(state, makeEnvelope('po-agent'));
      const poPhase = result.pipelinePhases?.find((p) => p.agent === 'PO');
      expect(poPhase?.agent).toBe('PO');
    });
  });
});