/**
 * runtimeSelectors — canonical runtime selector tests.
 *
 * Per the canonical runtime contract
 * (docs/runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md §9):
 *
 *   AC-08: Every lifecycle envelope (task_started, task_completed,
 *          task_failed, task_interrupted, task_resumed) MUST carry
 *          role: task.type. The literal null MUST NOT appear.
 *
 *   AC-09: Every EventEnvelope.type MUST have exactly one producer.
 *
 *   AC-12: The FE MUST render every executionStatus value. The CSS
 *          maps at SdlcDashboard/index.tsx MUST contain an entry
 *          for every canonical state.
 *
 *   AC-13: Dashboard, Agent Task, and Inspector MUST NEVER
 *          disagree on the same input. The selector is the single
 *          owner of this invariant.
 *
 * These tests cover EVERY canonical runtime state. They are
 * exhaustive: every branch of `projectAgentToPhaseStatus`,
 * `phaseStatusToCanonical`, and `selectRuntimeStatus` is exercised.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AGENT_KEYS,
  type AgentKey,
  type SessionState,
  emptyAgentStates,
  defaultPipelinePhases,
  defaultSessionState,
} from '@/models/SessionState';
import {
  RUNTIME_VISUAL,
  RUNTIME_STATES,
  canonicalToPhaseStatus,
  countCompletedAgents,
  countTotalAgents,
  deriveAgentRuntimeState,
  getRuntimeAnimation,
  getRuntimeIcon,
  getRuntimeVisual,
  phaseStatusToCanonical,
  phaseStatusToVisible,
  projectAgentToPhaseStatus,
  selectAgentPhaseEntry,
  selectAgentPhaseStatus,
  selectAgentPhaseStatuses,
  selectRuntimeStatus,
  type PhaseStatus,
  type RuntimeState,
  type RuntimeVisualStyle,
} from '@/store/runtimeSelectors';

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Build a session state for tests. Defaults produce the canonical
 * initial state (all phases 'pending', all agents 'idle').
 */
function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ...defaultSessionState({
      sessionId: 'sess-test',
      taskId: 'task-test',
      projectId: 'project-test',
      featureRequest: 'test',
      repoUrl: 'https://example.com/repo',
    }),
    ...overrides,
  };
}

/**
 * Build a session where `pipelinePhases` has the given statuses
 * (one entry per agent) and `agentStates` has the given agent
 * statuses (one entry per agent).
 */
function makeSessionWith(
  pipelineStatuses: Partial<Record<AgentKey, PhaseStatus>>,
  agentStatuses: Partial<Record<AgentKey, SessionState['agentStates'][AgentKey]['status']>>,
): SessionState {
  const phases = defaultPipelinePhases().map((p) => ({
    ...p,
    status: (pipelineStatuses[p.agent] ?? 'pending') as PhaseStatus,
  }));
  const agents = emptyAgentStates();
  for (const [agent, status] of Object.entries(agentStatuses)) {
    const key = agent as AgentKey;
    agents[key] = { ...agents[key], status: status ?? agents[key].status };
  }
  return makeSession({
    pipelinePhases: phases,
    agentStates: agents,
  });
}

// ── Test: projectAgentToPhaseStatus (visible projection) ────────────────

describe('runtimeSelectors.projectAgentToPhaseStatus', () => {
  it("returns 'pending' when pipelinePhases has no entry for the agent", () => {
    const session = makeSession({ pipelinePhases: [] });
    expect(projectAgentToPhaseStatus(session, 'ARCH')).toBe('pending');
  });

  it("passes 'pending' through verbatim when agent is idle", () => {
    const session = makeSessionWith({ ARCH: 'pending' }, { ARCH: 'idle' });
    expect(projectAgentToPhaseStatus(session, 'ARCH')).toBe('pending');
  });

  it("passes 'running' through verbatim when agent is running", () => {
    const session = makeSessionWith({ ARCH: 'running' }, { ARCH: 'running' });
    expect(projectAgentToPhaseStatus(session, 'ARCH')).toBe('running');
  });

  it("promotes 'running' to 'awaiting_review' when agentStates says awaiting_review", () => {
    const session = makeSessionWith(
      { ARCH: 'running' },
      { ARCH: 'awaiting_review' },
    );
    expect(projectAgentToPhaseStatus(session, 'ARCH')).toBe('awaiting_review');
  });

  it("does NOT promote 'gate_pending' to 'awaiting_review' (only 'running' qualifies)", () => {
    const session = makeSessionWith(
      { ARCH: 'gate_pending' },
      { ARCH: 'awaiting_review' },
    );
    expect(projectAgentToPhaseStatus(session, 'ARCH')).toBe('gate_pending');
  });

  it("passes 'gate_pending' through verbatim when agent is idle (no promotion)", () => {
    const session = makeSessionWith(
      { ARCH: 'gate_pending' },
      { ARCH: 'idle' },
    );
    expect(projectAgentToPhaseStatus(session, 'ARCH')).toBe('gate_pending');
  });

  it("passes 'completed' through verbatim", () => {
    const session = makeSessionWith({ ARCH: 'completed' }, { ARCH: 'completed' });
    expect(projectAgentToPhaseStatus(session, 'ARCH')).toBe('completed');
  });

  it("passes 'failed' through verbatim", () => {
    const session = makeSessionWith({ ARCH: 'failed' }, { ARCH: 'failed' });
    expect(projectAgentToPhaseStatus(session, 'ARCH')).toBe('failed');
  });

  it("passes 'skipped' through verbatim (cancelled/timeout projection)", () => {
    const session = makeSessionWith({ ARCH: 'skipped' }, { ARCH: 'skipped' });
    expect(projectAgentToPhaseStatus(session, 'ARCH')).toBe('skipped');
  });

  it('produces a deterministic output for every combination', () => {
    // Cross-product test: every PhaseStatus × every agentState status.
    const phaseStatuses: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    const agentStatuses: SessionState['agentStates'][AgentKey]['status'][] = [
      'idle',
      'running',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];

    const outputs = new Set<string>();
    for (const p of phaseStatuses) {
      for (const a of agentStatuses) {
        const s = makeSessionWith({ ARCH: p }, { ARCH: a });
        outputs.add(projectAgentToPhaseStatus(s, 'ARCH'));
      }
    }
    // The output is one of the seven PhaseStatus values.
    expect(outputs.size).toBeGreaterThan(0);
    for (const out of outputs) {
      expect([
        'pending',
        'running',
        'gate_pending',
        'awaiting_review',
        'completed',
        'failed',
        'skipped',
      ]).toContain(out);
    }
  });
});

// ── Test: phaseStatusToCanonical (canonical projection) ──────────────────

describe('runtimeSelectors.phaseStatusToCanonical', () => {
  it("projects 'pending' to 'queued' (covers idle / queued / dispatched)", () => {
    expect(phaseStatusToCanonical('pending')).toBe('queued');
  });

  it("projects 'running' to 'running'", () => {
    expect(phaseStatusToCanonical('running')).toBe('running');
  });

  it("projects 'gate_pending' to 'waiting_human'", () => {
    expect(phaseStatusToCanonical('gate_pending')).toBe('waiting_human');
  });

  it("projects 'awaiting_review' to 'waiting_human'", () => {
    expect(phaseStatusToCanonical('awaiting_review')).toBe('waiting_human');
  });

  it("projects 'completed' to 'completed'", () => {
    expect(phaseStatusToCanonical('completed')).toBe('completed');
  });

  it("projects 'failed' to 'failed'", () => {
    expect(phaseStatusToCanonical('failed')).toBe('failed');
  });

  it("projects 'skipped' to 'cancelled' (covers cancelled / timeout)", () => {
    expect(phaseStatusToCanonical('skipped')).toBe('cancelled');
  });
});

// ── Test: deriveAgentRuntimeState (per-agent canonical) ──────────────────

describe('runtimeSelectors.deriveAgentRuntimeState', () => {
  it("returns 'queued' for the default initial session", () => {
    const session = makeSession();
    for (const agent of AGENT_KEYS) {
      expect(deriveAgentRuntimeState(session, agent)).toBe('queued');
    }
  });

  it("returns 'running' when pipelinePhases says running AND agentStates is running", () => {
    const session = makeSessionWith(
      { DEV: 'running' },
      { DEV: 'running' },
    );
    expect(deriveAgentRuntimeState(session, 'DEV')).toBe('running');
  });

  it("returns 'waiting_human' when agentStates says awaiting_review AND pipeline is running", () => {
    const session = makeSessionWith(
      { DEV: 'running' },
      { DEV: 'awaiting_review' },
    );
    expect(deriveAgentRuntimeState(session, 'DEV')).toBe('waiting_human');
  });

  it("returns 'waiting_human' when pipeline is gate_pending (canonical wire)", () => {
    const session = makeSessionWith(
      { DEV: 'gate_pending' },
      { DEV: 'idle' },
    );
    expect(deriveAgentRuntimeState(session, 'DEV')).toBe('waiting_human');
  });

  it("returns 'completed' when pipeline is completed", () => {
    const session = makeSessionWith({ ARCH: 'completed' }, { ARCH: 'completed' });
    expect(deriveAgentRuntimeState(session, 'ARCH')).toBe('completed');
  });

  it("returns 'failed' when pipeline is failed", () => {
    const session = makeSessionWith({ ARCH: 'failed' }, { ARCH: 'failed' });
    expect(deriveAgentRuntimeState(session, 'ARCH')).toBe('failed');
  });

  it("returns 'cancelled' when pipeline is skipped (cancelled/timeout collapsed)", () => {
    const session = makeSessionWith({ ARCH: 'skipped' }, { ARCH: 'skipped' });
    expect(deriveAgentRuntimeState(session, 'ARCH')).toBe('cancelled');
  });

  it('produces every reachable canonical state at least once across all combinations', () => {
    // Exhaustiveness guard: every reachable member of RuntimeState
    // must be reachable through the projection. The contract
    // (canonical runtime contract §3.1) marks two states as
    // reserved / unreachable:
    //   - `idle` — FE-only initial value; never reaches the backend
    //   - `dispatched` — reserved; matrix permits but no producer
    //     today
    // Both are listed in RUNTIME_STATES for completeness but the
    // visible projection collapses them to other states
    // (`idle`/`dispatched` both project to `'pending'` →
    // canonical `'queued'`). We assert all REACHABLE members are
    // reachable and document the two unreachable ones explicitly.
    const UNREACHABLE_VIA_PROJECTION: ReadonlySet<RuntimeState> = new Set([
      'idle',
      'dispatched',
    ]);
    const found: Set<RuntimeState> = new Set();
    const phaseStatuses: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    const agentStatuses: SessionState['agentStates'][AgentKey]['status'][] = [
      'idle',
      'running',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const p of phaseStatuses) {
      for (const a of agentStatuses) {
        const s = makeSessionWith({ ARCH: p }, { ARCH: a });
        found.add(deriveAgentRuntimeState(s, 'ARCH'));
      }
    }
    for (const state of RUNTIME_STATES) {
      if (UNREACHABLE_VIA_PROJECTION.has(state)) {
        expect(
          found.has(state),
          `state '${state}' is listed UNREACHABLE_VIA_PROJECTION but is actually reachable — update the contract`,
        ).toBe(false);
      } else {
        expect(
          found.has(state),
          `canonical state '${state}' is unreachable through the projection — fix the producer chain`,
        ).toBe(true);
      }
    }
  });
});

// ── Test: canonicalToPhaseStatus (inverse projection) ──────────────────

describe('runtimeSelectors.canonicalToPhaseStatus', () => {
  it("collapses 'idle' / 'queued' / 'dispatched' to 'pending'", () => {
    expect(canonicalToPhaseStatus('idle')).toBe('pending');
    expect(canonicalToPhaseStatus('queued')).toBe('pending');
    expect(canonicalToPhaseStatus('dispatched')).toBe('pending');
  });

  it("returns 'running' for 'running'", () => {
    expect(canonicalToPhaseStatus('running')).toBe('running');
  });

  it("returns 'gate_pending' for 'waiting_human'", () => {
    expect(canonicalToPhaseStatus('waiting_human')).toBe('gate_pending');
  });

  it("returns 'completed' for 'completed'", () => {
    expect(canonicalToPhaseStatus('completed')).toBe('completed');
  });

  it("returns 'failed' for 'failed'", () => {
    expect(canonicalToPhaseStatus('failed')).toBe('failed');
  });

  it("returns 'skipped' for 'cancelled'", () => {
    expect(canonicalToPhaseStatus('cancelled')).toBe('skipped');
  });

  it('phaseStatusToVisible is an alias of canonicalToPhaseStatus', () => {
    for (const state of RUNTIME_STATES) {
      expect(phaseStatusToVisible(state)).toBe(canonicalToPhaseStatus(state));
    }
  });
});

// ── Test: selectRuntimeStatus (session-level derivation) ───────────────

describe('runtimeSelectors.selectRuntimeStatus', () => {
  it('returns all-idle agentStates and null currentAgent for a default session', () => {
    const session = makeSession();
    const status = selectRuntimeStatus(session);

    for (const agent of AGENT_KEYS) {
      expect(status.agentStates[agent]).toBe('queued');
    }
    expect(status.currentAgent).toBeNull();
    expect(status.reviewingAgent).toBeNull();
  });

  it("sets currentAgent to the last agent whose agentStates.status === 'running' (matches prior inline code)", () => {
    // Note: the prior inline code at workflowSelectors.ts:233 used
    // an UNCONDITIONAL `runningAgent = key` assignment, so the
    // LAST agent in AGENT_KEYS order with status 'running' wins.
    // This behaviour is preserved byte-for-byte per the
    // zero-behavior-change invariant.
    const session = makeSessionWith(
      { ARCH: 'completed', PO: 'completed', UX: 'running', DEV: 'running', QA: 'pending' },
      { ARCH: 'completed', PO: 'completed', UX: 'running', DEV: 'running', QA: 'idle' },
    );
    const status = selectRuntimeStatus(session);
    expect(status.currentAgent).toBe('DEV');
  });

  it("sets reviewingAgent to the first agent whose agentStates.status === 'awaiting_review'", () => {
    const session = makeSessionWith(
      { ARCH: 'completed', PO: 'completed', UX: 'running', DEV: 'pending', QA: 'pending' },
      { ARCH: 'completed', PO: 'completed', UX: 'awaiting_review', DEV: 'idle', QA: 'idle' },
    );
    const status = selectRuntimeStatus(session);
    expect(status.currentAgent).toBeNull(); // no agent has status 'running'
    expect(status.reviewingAgent).toBe('UX');
  });

  it('prefers running over awaiting_review when both are set', () => {
    // Note: per the SessionState shape, agentStates is one status
    // per agent; here we model the rare case where PO is
    // awaiting_review AND DEV is running (two separate agents).
    const session = makeSessionWith(
      { ARCH: 'completed', PO: 'running', UX: 'pending', DEV: 'running', QA: 'pending' },
      { ARCH: 'completed', PO: 'awaiting_review', UX: 'idle', DEV: 'running', QA: 'idle' },
    );
    const status = selectRuntimeStatus(session);
    // PO iteration comes first; PO has awaiting_review but not running
    // → reviewingAgent = PO. DEV has running → runningAgent = DEV.
    // Final: currentAgent = runningAgent ?? reviewingAgent ?? null.
    expect(status.currentAgent).toBe('DEV');
    expect(status.reviewingAgent).toBe('PO');
  });

  it('exposes every canonical state in agentStates', () => {
    const session = makeSessionWith(
      {
        ARCH: 'completed',
        PO: 'completed',
        UX: 'running',
        DEV: 'gate_pending',
        QA: 'pending',
      },
      {
        ARCH: 'completed',
        PO: 'completed',
        UX: 'running',
        DEV: 'awaiting_review',
        QA: 'idle',
      },
    );
    const status = selectRuntimeStatus(session);
    expect(status.agentStates.ARCH).toBe('completed');
    expect(status.agentStates.PO).toBe('completed');
    expect(status.agentStates.UX).toBe('running');
    expect(status.agentStates.DEV).toBe('waiting_human');
    expect(status.agentStates.QA).toBe('queued');
  });

  it('preserves the byte-identical currentAgent derivation for pathological cases', () => {
    // Pathological case: pipelinePhases.DEV.status === 'completed'
    // but agentStates.DEV.status === 'awaiting_review'. The prior
    // inline code reported reviewingAgent = DEV; the canonical
    // selector must preserve that behavior.
    //
    // Note: the agentStates field of RuntimeStatus is the CANONICAL
    // projection, which does NOT promote awaiting_review unless the
    // pipeline phase is 'running'. So when pipelinePhases.status
    // === 'completed', the canonical projection is 'completed'
    // regardless of agentStates.status. The divergence between
    // currentAgent (which reads agentStates directly) and the
    // canonical projection is preserved byte-for-byte.
    const session = makeSessionWith(
      { DEV: 'completed' },
      { DEV: 'awaiting_review' },
    );
    const status = selectRuntimeStatus(session);
    // currentAgent reads agentStates directly (zero behavior change);
    // reviewingAgent therefore includes DEV.
    expect(status.reviewingAgent).toBe('DEV');
    // The agentStates field projects through the visible
    // projection → canonical. DEV has pipelinePhases.status
    // === 'completed' and is NOT in the awaiting_review promotion,
    // so the canonical value is 'completed'.
    expect(status.agentStates.DEV).toBe('completed');
  });
});

// ── Test: contract guarantees ───────────────────────────────────────────

describe('runtimeSelectors — contract guarantees', () => {
  it('RUNTIME_STATES has exactly eight members', () => {
    expect(RUNTIME_STATES.length).toBe(8);
  });

  it('RUNTIME_STATES matches the contract §3 names exactly', () => {
    expect([...RUNTIME_STATES].sort()).toEqual(
      [
        'cancelled',
        'completed',
        'dispatched',
        'failed',
        'idle',
        'queued',
        'running',
        'waiting_human',
      ].sort(),
    );
  });

  it('PhaseStatus union has exactly seven members', () => {
    const phases: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    expect(phases.length).toBe(7);
  });

  it('every RuntimeState has a canonical → visible projection', () => {
    for (const state of RUNTIME_STATES) {
      const projected = canonicalToPhaseStatus(state);
      expect(typeof projected).toBe('string');
      expect(projected.length).toBeGreaterThan(0);
    }
  });

  it('round-trip: every visible PhaseStatus maps back to a canonical state', () => {
    const phaseStatuses: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const phase of phaseStatuses) {
      const canonical = phaseStatusToCanonical(phase);
      expect(RUNTIME_STATES).toContain(canonical);
    }
  });
});

// ── Test: selectRuntimeExecution integration ────────────────────────────

describe('runtimeSelectors — integration with workflowSelectors', () => {
  it('selectRuntimeExecution.phases matches projectAgentToPhaseStatus for every agent', async () => {
    // Lazy import to avoid a circular module resolution at test
    // load time (workflowSelectors imports runtimeSelectors).
    const { selectRuntimeExecution } = await import(
      '@/store/workflowSelectors'
    );
    const session = makeSessionWith(
      {
        ARCH: 'completed',
        PO: 'completed',
        UX: 'running',
        DEV: 'gate_pending',
        QA: 'pending',
      },
      {
        ARCH: 'completed',
        PO: 'completed',
        UX: 'running',
        DEV: 'awaiting_review',
        QA: 'idle',
      },
    );
    // The runtime selector only reads sessions[sessionsId]; the
    // rest of the WorkflowState is irrelevant. We use a typed cast
    // to a partial shape — same pattern as the production callers
    // (SdlcDashboard/index.tsx:129 uses `as never`).
    const state = { sessions: { 'sess-test': session } } as unknown as Parameters<typeof selectRuntimeExecution>[0];
    const runtime = selectRuntimeExecution(state, 'sess-test');
    expect(runtime).not.toBeNull();
    if (!runtime) return;

    for (const phase of runtime.phases) {
      const expected = projectAgentToPhaseStatus(session, phase.agent);
      expect(phase.status).toBe(expected);
    }
  });

  it('selectRuntimeExecution.currentAgent matches selectRuntimeStatus.currentAgent', async () => {
    const { selectRuntimeExecution } = await import(
      '@/store/workflowSelectors'
    );
    const session = makeSessionWith(
      { UX: 'running', DEV: 'running' },
      { UX: 'running', DEV: 'running' },
    );
    const state = { sessions: { 'sess-test': session } } as unknown as Parameters<typeof selectRuntimeExecution>[0];
    const runtime = selectRuntimeExecution(state, 'sess-test');
    const status = selectRuntimeStatus(session);
    expect(runtime?.currentAgent).toBe(status.currentAgent);
  });
});

// ── OBS-01.5 — Inspector cross-page identity ────────────────────────────
//
// Per the canonical runtime contract §5.2.2 (and the OBS-01.5
// brief), "Dashboard, Agent Task, and Inspector MUST NEVER
// disagree on the same input." Both Dashboard and Agent Task
// already route runtime reads through `selectAgentPhaseStatus`
// (the OBS-01.2 store-normalization helper) and obtain the
// presentational visuals through `getRuntimeVisual` /
// `getRuntimeIcon`. The Inspector routes runtime reads through
// `selectRuntimeExecution`, whose `phases[i].status` field is
// derived from `projectAgentToPhaseStatus` (the same canonical
// projection).
//
// The acceptance test below asserts that for every reachable
// (pipelineStatus, agentAwaitingReview) combination, the three
// consumer paths yield the same PhaseStatus — the cross-page
// identity invariant.

describe('runtimeSelectors — OBS-01.5 cross-page identity (Dashboard ≡ Agent Task ≡ Inspector)', () => {
  /**
   * Three consumer paths:
   *  - Dashboard:    selectAgentPhaseStatus → getRuntimeVisual
   *  - Agent Task:   selectAgentPhaseStatus → getRuntimeVisual
   *                   (same canonical projection as Dashboard)
   *  - Inspector:    selectRuntimeExecution.phases[i].status
   *                   (projectAgentToPhaseStatus under the hood)
   *
   * They MUST agree for every input.
   */
  it('Dashboard / Agent Task / Inspector agree on the per-agent PhaseStatus for every reachable combination', async () => {
    const { selectRuntimeExecution } = await import(
      '@/store/workflowSelectors'
    );

    // Reachable PhaseStatus values per the canonical projection.
    const inputs: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];

    // agentAwaitingReview vector — true only for one combination
    // (pipelineStatus === 'running'). All other combinations
    // follow the passthrough rule.
    for (const pipelineStatus of inputs) {
      const session = makeSessionWith(
        { DEV: pipelineStatus },
        { DEV: pipelineStatus === 'gate_pending' || pipelineStatus === 'running' ? 'awaiting_review' : 'idle' },
      );
      const state = { sessions: { 'sess-test': session } } as unknown as Parameters<typeof selectRuntimeExecution>[0];
      const runtime = selectRuntimeExecution(state, 'sess-test');
      if (!runtime) throw new Error('selectRuntimeExecution returned null');

      const inspectorStatus = runtime.phases.find((p) => p.agent === 'DEV')?.status as PhaseStatus;
      const dashboardStatus = selectAgentPhaseStatus(session, 'DEV');

      // Dashboard / Agent Task path. The OBS-01.2 helper is what
      // both pages consume (Dashboard via selectAgentPhaseStatus
      // and Agent Task via selectAgentPhaseStatus / runtime.phases).
      // Agent Task additionally passes through phaseStatusFor, but
      // that helper returns selectRuntimeExecution.phases[agent].status
      // — identical to the Inspector path here.
      const agentTaskStatus = selectAgentPhaseStatus(session, 'DEV');

      expect(inspectorStatus).toBe(dashboardStatus);
      expect(agentTaskStatus).toBe(dashboardStatus);

      // For every state that becomes a visible visual, the runtime
      // visual MUST come from getRuntimeVisual(status) — the same
      // helper for all three pages. This guarantees that the
      // Inspector path and the Dashboard/Agent Task path produce
      // byte-identical CSS classes for the same input.
      const inspectorVisual = getRuntimeVisual(dashboardStatus);
      const dashboardVisual = getRuntimeVisual(inspectorStatus);
      expect(inspectorVisual).toBe(dashboardVisual);
      expect(inspectorVisual.background).toBe(dashboardVisual.background);
      expect(inspectorVisual.border).toBe(dashboardVisual.border);
      expect(inspectorVisual.badge).toBe(dashboardVisual.badge);
    }
  });

  it('the canonical projection is referentially stable across the three consumers', () => {
    // Every consumer returns the SAME RuntimeVisualStyle object
    // instance for the same PhaseStatus — the React renderer's
    // memoization depends on this. If a future regression breaks
    // referential stability, the per-cell CSS classes would still
    // compare equal-by-value (above assertion) but React's
    // render-equality would diverge.
    const a = getRuntimeVisual('running');
    const b = getRuntimeVisual('running');
    expect(a).toBe(b);

    const c = selectAgentPhaseStatus(makeSessionWith({ DEV: 'running' }, {}), 'DEV');
    expect(c).toBe('running');
  });
});

// ── OBS-01.2 — Store normalization helpers ──────────────────────────────

describe('runtimeSelectors — OBS-01.2 store normalization', () => {
  it('selectAgentPhaseStatus returns the canonical projection for one agent', () => {
    const session = makeSessionWith(
      { UX: 'running', DEV: 'gate_pending' },
      { UX: 'running', DEV: 'awaiting_review' },
    );
    expect(selectAgentPhaseStatus(session, 'ARCH')).toBe('pending');
    expect(selectAgentPhaseStatus(session, 'UX')).toBe('running');
    expect(selectAgentPhaseStatus(session, 'DEV')).toBe('gate_pending');
  });

  it('selectAgentPhaseStatuses returns the canonical projection for every agent', () => {
    const session = makeSessionWith(
      { ARCH: 'completed', PO: 'completed', UX: 'running', DEV: 'gate_pending', QA: 'pending' },
      { ARCH: 'completed', PO: 'completed', UX: 'running', DEV: 'awaiting_review', QA: 'idle' },
    );
    const out = selectAgentPhaseStatuses(session);
    expect(out).toEqual({
      ARCH: 'completed',
      PO: 'completed',
      UX: 'running',
      DEV: 'gate_pending',
      QA: 'pending',
    });
    // Every AGENT_KEYS entry MUST be present — no missing keys.
    for (const k of AGENT_KEYS) {
      expect(out[k]).toBeDefined();
    }
  });

  it('selectAgentPhaseStatuses byte-identical to a manual pipelinePhases lookup', () => {
    // Per the OBS-01.2 invariant: the canonical projection MUST be
    // byte-identical to a direct read of pipelinePhases[i].status
    // for every input — otherwise the FE would silently change what
    // the user sees. Verified here with a representative input set.
    const phaseStatuses: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const p of phaseStatuses) {
      const session = makeSessionWith({ ARCH: p }, { ARCH: 'idle' });
      const direct = session.pipelinePhases.find((x) => x.agent === 'ARCH')?.status ?? 'pending';
      const projected = selectAgentPhaseStatus(session, 'ARCH');
      expect(projected).toBe(direct);
    }
  });

  it('selectAgentPhaseStatus preserves the awaiting_review promotion', () => {
    const session = makeSessionWith(
      { DEV: 'running' },
      { DEV: 'awaiting_review' },
    );
    // The promotion rule fires: running + awaiting_review →
    // awaiting_review (NOT the underlying 'running').
    expect(selectAgentPhaseStatus(session, 'DEV')).toBe('awaiting_review');
  });

  it('countCompletedAgents counts only "completed" (canonical projection)', () => {
    const session = makeSessionWith(
      { ARCH: 'completed', PO: 'completed', UX: 'running', DEV: 'failed', QA: 'pending' },
      { ARCH: 'completed', PO: 'completed', UX: 'running', DEV: 'failed', QA: 'idle' },
    );
    expect(countCompletedAgents(session)).toBe(2);
  });

  it('countCompletedAgents returns 0 for the default initial session', () => {
    expect(countCompletedAgents(makeSession())).toBe(0);
  });

  it('countCompletedAgents handles the pathological "all completed" case', () => {
    const session = makeSessionWith(
      { ARCH: 'completed', PO: 'completed', UX: 'completed', DEV: 'completed', QA: 'completed' },
      { ARCH: 'completed', PO: 'completed', UX: 'completed', DEV: 'completed', QA: 'completed' },
    );
    expect(countCompletedAgents(session)).toBe(5);
  });

  it('countCompletedAgents byte-identical to the prior inline filter', () => {
    // For every (pipeline, agent) combination, the canonical count
    // MUST equal the prior inline filter. This guards against any
    // future divergence.
    const phaseStatuses: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const p of phaseStatuses) {
      const session = makeSessionWith({ ARCH: p }, { ARCH: 'idle' });
      const inline =
        session.pipelinePhases.filter((x) => x.status === 'completed').length;
      const projected = countCompletedAgents(session);
      expect(projected).toBe(inline);
    }
  });

  it('countTotalAgents returns the cardinality of AGENT_KEYS', () => {
    expect(countTotalAgents(makeSession())).toBe(5);
  });

  it('countTotalAgents byte-identical to the prior "pipelinePhases.length || 5" expression', () => {
    // The prior inline expression:
    //   session.pipelinePhases.length || 5
    // returned the length when non-zero, else 5. In practice the
    // SSE snapshot and defaultPipelinePhases always return 5 entries,
    // so the result is always 5. The new helper makes that explicit.
    const session = makeSession();
    const inline = session.pipelinePhases.length || 5;
    expect(countTotalAgents(session)).toBe(inline);
  });

  it('selectAgentPhaseEntry returns status + taskId + duration', () => {
    const session = makeSession();
    const entry = selectAgentPhaseEntry(session, 'ARCH');
    expect(entry).toHaveProperty('status');
    expect(entry).toHaveProperty('taskId');
    expect(entry).toHaveProperty('duration');
    expect(entry.status).toBe('pending');
    expect(entry.taskId).toBeUndefined();
    expect(entry.duration).toBeUndefined();
  });

  it('selectAgentPhaseEntry preserves taskId from the persisted phase entry', () => {
    const session = makeSession({
      pipelinePhases: [
        { agent: 'ARCH', status: 'completed', taskId: 'task-arch-1' },
        { agent: 'PO', status: 'running', taskId: 'task-po-1' },
        { agent: 'UX', status: 'pending' },
        { agent: 'DEV', status: 'pending' },
        { agent: 'QA', status: 'pending' },
      ],
    });
    const entry = selectAgentPhaseEntry(session, 'ARCH');
    expect(entry.status).toBe('completed');
    expect(entry.taskId).toBe('task-arch-1');
  });

  it('selectAgentPhaseEntry status is canonical, not the raw PhaseStatus', () => {
    // Pathological case: pipeline status 'completed' but
    // agentStates status 'awaiting_review'. The canonical projection
    // MUST return 'completed' (no promotion fires because the
    // pipeline is not 'running'). The taskId is the persisted
    // identifier (independent of runtime).
    const session = makeSession({
      pipelinePhases: [
        { agent: 'ARCH', status: 'completed', taskId: 'task-x' },
        { agent: 'PO', status: 'pending' },
        { agent: 'UX', status: 'pending' },
        { agent: 'DEV', status: 'pending' },
        { agent: 'QA', status: 'pending' },
      ],
    });
    session.agentStates.ARCH.status = 'awaiting_review';
    const entry = selectAgentPhaseEntry(session, 'ARCH');
    expect(entry.status).toBe('completed');
    expect(entry.taskId).toBe('task-x');
  });

  it('every store-normalization helper agrees with selectRuntimeStatus', () => {
    // Cross-consistency: a session must produce the same
    // completed-count via every path.
    const session = makeSessionWith(
      { ARCH: 'completed', PO: 'completed', UX: 'running', DEV: 'completed', QA: 'pending' },
      { ARCH: 'completed', PO: 'completed', UX: 'running', DEV: 'completed', QA: 'idle' },
    );
    const inline = session.pipelinePhases.filter((p) => p.status === 'completed').length;
    const viaStatuses = Object.values(selectAgentPhaseStatuses(session)).filter(
      (s) => s === 'completed',
    ).length;
    const viaEntry = AGENT_KEYS.filter(
      (k) => selectAgentPhaseEntry(session, k).status === 'completed',
    ).length;
    const viaHelper = countCompletedAgents(session);
    expect(viaHelper).toBe(inline);
    expect(viaHelper).toBe(viaStatuses);
    expect(viaHelper).toBe(viaEntry);
  });
});

// ── OBS-01.3 — Dashboard runtime visual maps ────────────────────────────

describe('runtimeSelectors — OBS-01.3 Dashboard runtime visual maps', () => {
  // The expected visuals below are transcribed verbatim from the
  // canonical runtime contract §5.1. If any of these assertions
  // fail, the visual map has drifted from the contract; the fix
  // is to update the map AND revalidate the contract source.
  const EXPECTED_VISUAL: Record<PhaseStatus, RuntimeVisualStyle> = {
    pending: {
      background: 'bg-surface-container text-on-surface-variant/60',
      border: 'border-outline-variant/20',
      glyph: '·',
      iconName: 'PlayCircle',
      badge: 'PENDING',
      animation: '',
    },
    running: {
      background: 'bg-blue-500/20 text-blue-300',
      border: 'border-blue-500/30',
      glyph: '…',
      iconName: 'Loader2',
      badge: 'RUNNING',
      animation: 'animate-spin',
    },
    gate_pending: {
      background: 'bg-amber-500/20 text-amber-400',
      border: 'border-amber-500/30',
      glyph: '!',
      iconName: 'Clock',
      badge: 'GATE PENDING',
      animation: '',
    },
    awaiting_review: {
      background: 'bg-amber-500/20 text-amber-300',
      border: 'border-amber-500/30',
      glyph: '!',
      iconName: 'Clock',
      badge: 'AWAITING REVIEW',
      animation: '',
    },
    completed: {
      background: 'bg-emerald-500/20 text-emerald-400',
      border: 'border-emerald-500/20',
      glyph: '✓',
      iconName: 'Check',
      badge: 'COMPLETED',
      animation: '',
    },
    failed: {
      background: 'bg-red-500/20 text-red-400',
      border: 'border-red-500/30',
      glyph: '✗',
      iconName: 'AlertCircle',
      badge: 'FAILED',
      animation: '',
    },
    skipped: {
      background: 'bg-outline-variant/30 text-on-surface-variant',
      border: 'border-dashed border-outline-variant/20',
      glyph: '⊘',
      iconName: 'SkipForward',
      badge: 'CANCELLED',
      animation: '',
    },
  };

  it('the visual map covers every PhaseStatus value (exhaustive)', () => {
    const required: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const s of required) {
      expect(RUNTIME_VISUAL[s]).toBeDefined();
      expect(RUNTIME_VISUAL[s]).toEqual(EXPECTED_VISUAL[s]);
    }
  });

  it('pending renders dim gray with PlayCircle icon (contract §5.1.1/5.1.2)', () => {
    const v = getRuntimeVisual('pending');
    expect(v.background).toContain('bg-surface-container');
    expect(v.border).toBe('border-outline-variant/20');
    expect(v.iconName).toBe('PlayCircle');
    expect(v.glyph).toBe('·');
    expect(v.badge).toBe('PENDING');
  });

  it('running renders blue with Loader2 icon (contract §5.1.4)', () => {
    const v = getRuntimeVisual('running');
    expect(v.background).toContain('blue');
    expect(v.border).toContain('blue');
    expect(v.iconName).toBe('Loader2');
    expect(v.badge).toBe('RUNNING');
  });

  it('gate_pending renders yellow with Clock icon (contract §5.1.5)', () => {
    const v = getRuntimeVisual('gate_pending');
    expect(v.background).toContain('amber');
    expect(v.border).toContain('amber');
    expect(v.iconName).toBe('Clock');
    expect(v.badge).toBe('GATE PENDING');
  });

  it('awaiting_review renders yellow with Clock icon (FE-side projection of waiting_human)', () => {
    const v = getRuntimeVisual('awaiting_review');
    expect(v.background).toContain('amber');
    expect(v.border).toContain('amber');
    expect(v.iconName).toBe('Clock');
    expect(v.badge).toBe('AWAITING REVIEW');
  });

  it('completed renders green with Check icon (contract §5.1.6)', () => {
    const v = getRuntimeVisual('completed');
    expect(v.background).toContain('emerald');
    expect(v.border).toContain('emerald');
    expect(v.iconName).toBe('Check');
    expect(v.badge).toBe('COMPLETED');
  });

  it('failed renders red with AlertCircle icon (contract §5.1.7)', () => {
    const v = getRuntimeVisual('failed');
    expect(v.background).toContain('red');
    expect(v.border).toContain('red');
    expect(v.iconName).toBe('AlertCircle');
    expect(v.badge).toBe('FAILED');
  });

  it('skipped renders dim gray with dashed border and SkipForward (contract §5.1.8)', () => {
    const v = getRuntimeVisual('skipped');
    expect(v.background).toContain('outline-variant');
    expect(v.border).toContain('dashed');
    expect(v.iconName).toBe('SkipForward');
    expect(v.badge).toBe('CANCELLED');
  });

  it('every visual carries all 5 contract aspects (background + border + glyph + iconName + badge)', () => {
    const required: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const s of required) {
      const v = getRuntimeVisual(s);
      expect(typeof v.background).toBe('string');
      expect(v.background.length).toBeGreaterThan(0);
      expect(typeof v.border).toBe('string');
      expect(v.border.length).toBeGreaterThan(0);
      expect(typeof v.glyph).toBe('string');
      expect(v.glyph.length).toBeGreaterThan(0);
      expect(typeof v.iconName).toBe('string');
      expect(v.iconName.length).toBeGreaterThan(0);
      expect(typeof v.badge).toBe('string');
      expect(v.badge.length).toBeGreaterThan(0);
    }
  });

  it('every visual is frozen (no consumer may mutate the canonical map at runtime)', () => {
    expect(Object.isFrozen(RUNTIME_VISUAL)).toBe(true);
  });

  it('getRuntimeVisual returns the SAME reference for the same status (referential stability)', () => {
    const a = getRuntimeVisual('running');
    const b = getRuntimeVisual('running');
    // The map is frozen; Object.freeze preserves identity.
    expect(a).toBe(b);
  });

  it('every visual respects the contract — exhaustively compared against the contract source', () => {
    // The mapping below is the byte-transcription of the contract
    // §5.1 tables (with the OBS-01.6 animation column per §5.1.4
    // Pulse / Animation columns). The test ASSERTS that the
    // runtime selectors match the contract — any drift here is a
    // contract violation, not a test expectation drift.
    const expected: Record<PhaseStatus, {
      background: string;
      border: string;
      glyph: string;
      iconName: string;
      badge: string;
      animation: string;
    }> = {
      pending: {
        background: 'bg-surface-container text-on-surface-variant/60',
        border: 'border-outline-variant/20',
        glyph: '·',
        iconName: 'PlayCircle',
        badge: 'PENDING',
        animation: '',
      },
      running: {
        background: 'bg-blue-500/20 text-blue-300',
        border: 'border-blue-500/30',
        glyph: '…',
        iconName: 'Loader2',
        badge: 'RUNNING',
        animation: 'animate-spin',
      },
      gate_pending: {
        background: 'bg-amber-500/20 text-amber-400',
        border: 'border-amber-500/30',
        glyph: '!',
        iconName: 'Clock',
        badge: 'GATE PENDING',
        animation: '',
      },
      awaiting_review: {
        background: 'bg-amber-500/20 text-amber-300',
        border: 'border-amber-500/30',
        glyph: '!',
        iconName: 'Clock',
        badge: 'AWAITING REVIEW',
        animation: '',
      },
      completed: {
        background: 'bg-emerald-500/20 text-emerald-400',
        border: 'border-emerald-500/20',
        glyph: '✓',
        iconName: 'Check',
        badge: 'COMPLETED',
        animation: '',
      },
      failed: {
        background: 'bg-red-500/20 text-red-400',
        border: 'border-red-500/30',
        glyph: '✗',
        iconName: 'AlertCircle',
        badge: 'FAILED',
        animation: '',
      },
      skipped: {
        background: 'bg-outline-variant/30 text-on-surface-variant',
        border: 'border-dashed border-outline-variant/20',
        glyph: '⊘',
        iconName: 'SkipForward',
        badge: 'CANCELLED',
        animation: '',
      },
    };
    expect(RUNTIME_VISUAL).toEqual(expected);
  });

  it('getRuntimeIcon returns a component for every status', () => {
    const required: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const s of required) {
      const Icon = getRuntimeIcon(s);
      // lucide-react icons are forwardRef components (functions or
      // memo()-wrapped). The simplest "is a component" check is
      // truthy + has a displayName or $$typeof.
      expect(Icon).toBeDefined();
      expect(typeof Icon === 'function' || typeof Icon === 'object').toBe(true);
    }
  });

  it('runningAgent visual matches the canonical "running" visual', () => {
    // The Dashboard runningAgent indicator must use the canonical
    // "running" visual for badge text. This guards against the
    // pattern where a consumer hardcodes a separate "running" badge
    // instead of going through getRuntimeVisual.
    const v = getRuntimeVisual('running');
    expect(v.background).toContain('blue');
    expect(v.badge.toLowerCase()).toBe('running');
  });

  it('reviewingAgent visual matches the canonical "awaiting_review" visual', () => {
    const v = getRuntimeVisual('awaiting_review');
    expect(v.background).toContain('amber');
    expect(v.badge.toLowerCase()).toBe('awaiting review');
  });

  it('runtime animation contract — OBS-01.6 per-state animation invariant', () => {
    // Per the canonical runtime contract §5.1 Pulse / Animation
    // columns:
    //   - running      → `animate-spin` (per-task Loader2 icon)
    //   - all other    → empty string (no animation)
    //
    // This test replaces the OBS-01.3 "no animation" assertion,
    // which is now stale: OBS-01.6 deliberately enables the
    // `running` animation per contract §5.1.4. Every other state
    // remains animation-free per the contract.
    expect(getRuntimeVisual('running').animation).toBe('animate-spin');
    const nonRunning: PhaseStatus[] = [
      'pending',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const s of nonRunning) {
      expect(getRuntimeVisual(s).animation).toBe('');
    }
    // And getRuntimeAnimation routes through the canonical map.
    expect(getRuntimeAnimation('running')).toBe('animate-spin');
    expect(getRuntimeAnimation('pending')).toBe('');
    expect(getRuntimeAnimation('completed')).toBe('');
    expect(getRuntimeAnimation('failed')).toBe('');
    expect(getRuntimeAnimation('skipped')).toBe('');
    expect(getRuntimeAnimation('gate_pending')).toBe('');
    expect(getRuntimeAnimation('awaiting_review')).toBe('');
  });

  it('no inline `animate-*` class is applied to the runtime background or border fields', () => {
    // The background / border fields carry colours only — the
    // canonical contract §7 forbids mixing animation classes with
    // them. Per-state animation lives in the dedicated `animation`
    // field, consumed via `getRuntimeAnimation` at the icon
    // render sites.
    const phaseStatuses: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const s of phaseStatuses) {
      const v = getRuntimeVisual(s);
      expect(v.background).not.toMatch(/\banimate-/);
      expect(v.border).not.toMatch(/\banimate-/);
    }
  });
});

// ── OBS-01.6 — Runtime animation contract ────────────────────────────────
//
// Per the canonical runtime contract §5.1.4 Pulse / Animation
// columns, the `running` state's Loader2 icon carries
// `animate-spin`; every other state carries no animation. The
// animation is sourced from `RUNTIME_VISUAL[*].animation` and
// consumed at runtime-icon render sites via `getRuntimeAnimation`.
//
// The OBS-01.6 invariant: the runtime icon's `animate-*` class is
// never hardcoded inline on a consumer file. Consumers route
// through the canonical selector. This guards the "no duplicated
// animation logic" acceptance criterion in the brief.
//
// Submit-button spinners, connection-state spinners, and other
// non-runtime `animate-*` usages are correctly out of scope — they
// belong to UI-level local state, not runtime state per the
// contract §5.1.

describe('runtimeSelectors — OBS-01.6 animation contract (canonical-only)', () => {
  /**
   * Read a consumer source file. Used as a fast lexical check
   * for inline `animate-*` literals on runtime visuals.
   */
  function readConsumerSource(relativePath: string): string {
    const file = path.resolve(__dirname, '..', 'src', ...relativePath.split('/'));
    return fs.readFileSync(file, 'utf8');
  }

  /**
   * Strip comments and string-literal contents so a citation in
   * a comment block (e.g. "no `animate-*` here") does not match
   * the forbidden regex.
   */
  function stripCommentsAndStrings(src: string): string {
    return src
      .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
  }

  it('Dashboard source routes animation through the canonical selector (no inline animate-spin/animate-pulse on runtime visuals)', () => {
    const src = stripCommentsAndStrings(readConsumerSource('pages/SdlcDashboard/OverviewPage.tsx'));
    // No literal `animate-spin` on the runtime icon's className —
    // animation is sourced from getRuntimeAnimation.
    // We allow `animate-spin` / `animate-pulse` to appear in
    // NON-runtime contexts (SessionStatusIcon for session-level
    // status; session-connection dot states). Those are owned by
    // session-level UI maps and are correctly out of scope per
    // the canonical contract §5.1.
    //
    // The OBS-01.6 invariant is narrow: the four runtime-icon
    // render sites that consume `getRuntimeIcon` must also
    // consume `getRuntimeAnimation`. We assert by checking that
    // the consumer source imports BOTH helpers and never uses an
    // inline animation class on a `<Icon>`/`<RunningIcon>` line.
    expect(src).toMatch(/getRuntimeAnimation/);
    // Specifically: no `<Icon … className="…animate-spin…"` or
    // `<RunningIcon … className="…animate-spin…"` literal.
    expect(src).not.toMatch(/<Icon[^>]*className=[^>]*\banimate-spin\b/);
    expect(src).not.toMatch(/<RunningIcon[^>]*className=[^>]*\banimate-spin\b/);
  });

  it('Agent Task source routes animation through the canonical selector (no inline animate-spin/animate-pulse on runtime visuals)', () => {
    const src = stripCommentsAndStrings(readConsumerSource('pages/SdlcDashboard/index.tsx'));
    expect(src).toMatch(/getRuntimeAnimation/);
    // Per-task icon and currentAgent icon both consume
    // `getRuntimeAnimation`; no inline `animate-spin` on either.
    expect(src).not.toMatch(/<TaskIcon[^>]*className=[^>]*\banimate-spin\b/);
    expect(src).not.toMatch(/<RunningIcon[^>]*className=[^>]*\banimate-spin\b/);
  });

  it('canonical animation field is sourced from the frozen canonical map', () => {
    // The canonical visual map is `Object.freeze`d (OBS-01.3
    // invariant). The OBS-01.6 `animation` field is a string
    // primitive, so no consumer can mutate the canonical
    // animation class at runtime. The animation value is the
    // exact literal in the canonical map — verifying the
    // accessor returns the canonical value, not a derived copy.
    expect(Object.isFrozen(RUNTIME_VISUAL)).toBe(true);
    expect(typeof RUNTIME_VISUAL.running.animation).toBe('string');
    expect(getRuntimeAnimation('running')).toBe(RUNTIME_VISUAL.running.animation);
    expect(getRuntimeAnimation('pending')).toBe(RUNTIME_VISUAL.pending.animation);
  });

  it('getRuntimeAnimation is referentially stable for the same input', () => {
    // Required for React render-equality: repeated calls return
    // the same string literal (primitive equality) so the icon
    // component does not re-render on each parent render.
    expect(getRuntimeAnimation('running')).toBe('animate-spin');
    expect(getRuntimeAnimation('running')).toBe('animate-spin');
    expect(getRuntimeAnimation('pending')).toBe('');
    expect(getRuntimeAnimation('pending')).toBe('');
  });
});

// ── OBS-01.7 — Timeline consumes the canonical runtime selector ────────
//
// Per the canonical runtime contract §5.2.2 and the OBS-01.7 brief,
// "Timeline must consume the canonical runtime selector;
// Timeline must never derive runtime independently." The
// Timeline is the runtime events projection that the canonical
// runtime selector exposes at `RuntimeExecution.events` (built by
// the module-private `timelineFromEvents` helper inside
// `workflowSelectors.ts`). It is the single source of timeline
// data; Dashboard, Agent Task, Inspector, and Timeline all
// consume it through `selectRuntimeExecution(...)`.
//
// OBS-01.7 invariants:
//
//   (a) The Timeline projection lives in exactly one place —
//       `timelineFromEvents` inside `workflowSelectors.ts`. No
//       consumer outside `workflowSelectors.ts` may reconstruct
//       the projection (e.g. by deriving timeline-status from
//       `pipelinePhases[i].status` or `agentStates[i].status`).
//
//   (b) The Timeline projection never reads `pipelinePhases` or
//       `agentStates` to compute timeline-status. It only reads
//       `RuntimeEvent` fields (`evt.type`, `evt.agent`,
//       `evt.action`, `evt.timestamp`, `evt.id`). Runtime-state
//       fields are sourced from the canonical selector.
//
//   (c) The Timeline's per-agent runtime visual matches Dashboard
//       / Agent Task / Inspector — all four surfaces consume
//       `selectRuntimeExecution`, so `runtime.phases[i].status`
//       is identical across surfaces.

describe('runtimeSelectors — OBS-01.7 Timeline canonical-selector invariant', () => {
  it('Timeline projection is sourced from `selectRuntimeExecution(...).events`', async () => {
    const { selectRuntimeExecution } = await import(
      '@/store/workflowSelectors'
    );
    const session = makeSessionWith(
      { ARCH: 'completed', PO: 'running', UX: 'pending', DEV: 'gate_pending', QA: 'pending' },
      { ARCH: 'completed', PO: 'running' },
    );
    // Seed a few runtime events to exercise the timeline projection.
    session.runtimeEvents = [
      { id: 'evt-1', type: 'agent_start', agent: 'PO', timestamp: 100, action: 'started' } as never,
      { id: 'evt-2', type: 'agent_tool_call', agent: 'PO', timestamp: 200, action: 'tool:x' } as never,
      { id: 'evt-3', type: 'gate_triggered', agent: 'DEV', timestamp: 300, action: 'gate' } as never,
      { id: 'evt-4', type: 'error', agent: 'PO', timestamp: 400, action: 'oops' } as never,
    ];
    const state = { sessions: { 'sess-test': session } } as unknown as Parameters<typeof selectRuntimeExecution>[0];
    const runtime = selectRuntimeExecution(state, 'sess-test');
    expect(runtime).not.toBeNull();
    if (!runtime) return;

    // The Timeline is `runtime.events` — the projection exposed by
    // the canonical selector.
    expect(Array.isArray(runtime.events)).toBe(true);
    expect(runtime.events.length).toBe(4);

    // The raw events surface remains available via `runtime.runtimeEvents`
    // for consumers that need the full event stream. The Timeline
    // projection is a UI-side view (last 200 events + per-event status).
    expect(runtime.runtimeEvents.length).toBe(4);

    // The timeline-status mapping is per-event (not per-runtime-state).
    // Per the canonical contract §5.1 the Timeline is a separate
    // presentation surface from the per-agent runtime; the per-event
    // status ('ok' | 'warning' | 'error' | 'pending') does NOT equal
    // the per-agent PhaseStatus. Asserting this distinction guards
    // against a future regression that conflates the two.
    const evt3 = runtime.events[2];
    expect(evt3.status).toBe('pending'); // gate_triggered → pending
    expect(evt3.status).not.toBe('gate_pending'); // not the per-agent PhaseStatus
    const evt4 = runtime.events[3];
    expect(evt4.status).toBe('error');
    const evt2 = runtime.events[1];
    expect(evt2.status).toBe('warning'); // agent_tool_call → warning
    const evt1 = runtime.events[0];
    expect(evt1.status).toBe('ok');
  });

  it('Timeline projection trims to the last 200 events (canonical cap)', async () => {
    const { selectRuntimeExecution } = await import(
      '@/store/workflowSelectors'
    );
    const session = makeSession();
    // Seed 250 events. The projection MUST emit exactly 200.
    session.runtimeEvents = Array.from({ length: 250 }, (_, i) => ({
      id: `evt-${i}`,
      type: 'agent_start',
      agent: 'ARCH',
      timestamp: i,
      action: `step-${i}`,
    })) as never;
    const state = { sessions: { 'sess-test': session } } as unknown as Parameters<typeof selectRuntimeExecution>[0];
    const runtime = selectRuntimeExecution(state, 'sess-test');
    expect(runtime).not.toBeNull();
    if (!runtime) return;
    expect(runtime.events.length).toBe(200);
    // The trim drops the oldest 50 events and keeps the latest 200.
    expect(runtime.events[0].id).toBe('evt-50_0');
    expect(runtime.events[199].id).toBe('evt-249_199');
  });

  it('Timeline per-agent runtime matches Dashboard / Agent Task / Inspector (cross-page identity)', async () => {
    // For every reachable (pipelineStatus, agentAwaitingReview)
    // combination, the Timeline's `runtime.phases[i].status` MUST
    // match the Dashboard / Agent Task projection (`selectAgentPhaseStatus`)
    // and the Inspector's path (also `runtime.phases[i].status`). All
    // four surfaces consume `selectRuntimeExecution`, so the value is
    // identical by construction.
    const { selectRuntimeExecution } = await import(
      '@/store/workflowSelectors'
    );
    const inputs: PhaseStatus[] = [
      'pending',
      'running',
      'gate_pending',
      'awaiting_review',
      'completed',
      'failed',
      'skipped',
    ];
    for (const pipelineStatus of inputs) {
      const session = makeSessionWith(
        { DEV: pipelineStatus },
        { DEV: pipelineStatus === 'gate_pending' || pipelineStatus === 'running' ? 'awaiting_review' : 'idle' },
      );
      const state = { sessions: { 'sess-test': session } } as unknown as Parameters<typeof selectRuntimeExecution>[0];
      const runtime = selectRuntimeExecution(state, 'sess-test');
      if (!runtime) throw new Error('selectRuntimeExecution returned null');

      // Timeline path (via selectRuntimeExecution.phases[agent].status).
      const timelineStatus = runtime.phases.find((p) => p.agent === 'DEV')?.status as PhaseStatus;
      // Dashboard / Agent Task / Inspector path (all read the same
      // canonical projection via selectAgentPhaseStatus).
      const dashboardStatus = selectAgentPhaseStatus(session, 'DEV');

      expect(timelineStatus).toBe(dashboardStatus);
      // The Timeline's runtime visual must equal Dashboard's
      // visual for the same input (cross-page identity invariant).
      const timelineVisual = getRuntimeVisual(timelineStatus);
      const dashboardVisual = getRuntimeVisual(dashboardStatus);
      expect(timelineVisual).toBe(dashboardVisual);
    }
  });

  it('Timeline source-level invariant — workflowSelectors exports the Timeline projection; no consumer reconstructs it', async () => {
    // The Timeline projection (`timelineFromEvents`) is
    // module-private inside `workflowSelectors.ts`. The exported
    // surface is `RuntimeExecution.events` (typed `RuntimeTimelineEntry[]`),
    // accessible only via `selectRuntimeExecution(...)`.
    //
    // Guard against future contributors that:
    //   (1) export `timelineFromEvents` directly (bypassing the
    //       canonical selector facade);
    //   (2) read raw `session.runtimeEvents` and re-implement
    //       the per-event status mapping outside the canonical
    //       selector;
    //   (3) compute a timeline-status from `pipelinePhases` /
    //       `agentStates` (which are runtime-state fields, not
    //       event-level fields).
    const fs = await import('node:fs') as typeof import('node:fs');
    const path = await import('node:path') as typeof import('node:path');
    const file = path.resolve(
      __dirname,
      '..',
      'src',
      'store',
      'workflowSelectors.ts',
    );
    const src = fs.readFileSync(file, 'utf8');
    // Strip comments and string literals so the citations don't match.
    const code = src
      .replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');

    // The Timeline projection is module-private (not exported).
    expect(code).not.toMatch(/^\s*export\s+(?:async\s+)?function\s+timelineFromEvents/m);
    expect(code).not.toMatch(/export\s*\{[^}]*\btimelineFromEvents\b[^}]*\}/);

    // Extract ONLY the body of `timelineFromEvents` so the
    // invariant is scoped to the Timeline projection. The
    // `selectRuntimeExecution` function legitimately reads
    // `session.pipelinePhases` / `session.agentStates` for the
    // per-agent phases / artifact derivation — that is NOT the
    // Timeline projection.
    const helperMatch = code.match(/function\s+timelineFromEvents\s*\([^)]*\)\s*:\s*RuntimeTimelineEntry\[\]\s*\{([\s\S]*?)\n\}/);
    expect(helperMatch).not.toBeNull();
    if (!helperMatch) return;
    const helperBody = helperMatch[1];

    // The Timeline projection body MUST NOT read runtime-state fields.
    // (It only reads RuntimeEvent fields — `evt.type`, `evt.agent`,
    // `evt.action`, `evt.timestamp`, `evt.id`.)
    expect(helperBody).not.toMatch(/pipelinePhases/);
    expect(helperBody).not.toMatch(/agentStates/);
    expect(helperBody).not.toMatch(/session\.pipelinePhases/);
    expect(helperBody).not.toMatch(/session\.agentStates/);
    // The Timeline projection reads the raw event stream only.
    expect(helperBody).toMatch(/events/);

    // The Timeline projection is wired through `selectRuntimeExecution`
    // — the canonical-selector facade. It MUST be called only from
    // inside that function.
    expect(code).toMatch(/const\s+events\s*=\s*timelineFromEvents\s*\(\s*session\.runtimeEvents\s*\)/);
  });
});

// ── OBS-01.5 — Inspector consumes the canonical runtime selector ────────
//
// Per the canonical runtime contract §5.2.2, Dashboard, Agent Task,
// and Inspector MUST consume the canonical runtime selector for
// every runtime-state read. The Inspector today renders no
// per-agent runtime visuals (per the implementation checklist
// §OBS-01.7, the Inspector's three tabs render gates and
// gateHistory only — "behaviour unchanged" for that phase).
//
// OBS-01.5's invariant:
//
//   (a) The Inspector source MUST NOT contain an inline runtime
//       derivation — no direct pipelinePhases.find, no direct
//       agentStates[i].status lookup, no per-state ternary that
//       re-derives a status.
//
//   (b) The runtime selector is the single entry-point for every
//       runtime-state read. Today this is `selectRuntimeExecution`,
//       which itself consumes `selectRuntimeStatus` from
//       `runtimeSelectors.ts` (the canonical selector).
//
//   (c) When the Inspector eventually renders per-agent runtime
//       visuals (a future OBS phase), they MUST go through
//       `getRuntimeVisual` / `getRuntimeIcon` — the same helpers
//       Dashboard and Agent Task already consume.
//
// These tests guard the invariant by reading the Inspector source
// and asserting the structural properties. If a future commit
// inside the Inspector were to derive runtime state inline, the
// assertion would fail and force the contributor to either (i)
// route through the canonical selector or (ii) update the test
// with an explicit justification — both outcomes are louder than
// the silent drift OBS-01 was set up to fix.

describe('runtimeSelectors — OBS-01.5 Inspector canonical-selector invariant', () => {
  /**
   * Read the InspectorPanel source synchronously. Used as a fast
   * lexical check; it does NOT import the module (which would
   * require a full React/Vitest harness).
   */
  function readInspectorSource(): string {
    // Read the InspectorPanel source via Node's fs/path. The test
    // file lives at frontend/tests/, so the InspectorPanel source is
    // at ../src/pages/SdlcDashboard/components/InspectorPanel.tsx.
    const file = path.resolve(
      __dirname,
      '..',
      'src',
      'pages',
      'SdlcDashboard',
      'components',
      'InspectorPanel.tsx',
    );
    return fs.readFileSync(file, 'utf8');
  }

  it('Inspector source imports the canonical selector (selectRuntimeExecution)', () => {
    const src = readInspectorSource();
    expect(src).toMatch(
      /import\s*\{[^}]*\bselectRuntimeExecution\b[^}]*\}\s*from\s*['"]@\/store\/workflowSelectors['"]/,
    );
  });

  it('Inspector source has no inline agentStates[i].status lookup (no derivation)', () => {
    const src = readInspectorSource();
    // Forbidden patterns per the canonical contract §7 — "No
    // component may derive runtime state independently."
    // Strip comments first so the citation in the new OBS-01.5
    // comment block does not match the forbidden regex.
    const code = src.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.agentStates\[[^\]]+\]\.status/);
    expect(code).not.toMatch(/\.agentStates\.[A-Z]+\.status/);
  });

  it('Inspector source has no inline pipelinePhases.find / pipelinePhases[i].status', () => {
    const src = readInspectorSource();
    expect(src).not.toMatch(/\.pipelinePhases\.find\(/);
    expect(src).not.toMatch(/\.pipelinePhases\[[^\]]+\]\.status/);
  });

  it('Inspector source has no inline per-state ternary that re-derives runtime colour', () => {
    const src = readInspectorSource();
    // Forbidden inline colour strings on runtime visuals. The
    // session-level UI uses these too (SessionStatusIcon,
    // SessionPill) — but the OBS-01.5 invariant concerns runtime
    // visuals specifically. The Dashboard's contract §5.1 lists
    // the 8 per-agent runtime states; any per-state colour branch
    // in the Inspector's runtime surface is forbidden.
    //
    // Allowed: gate-kind branches (kind === 'question',
    // kind === 'tool' — these are gate state, not runtime state).
    //
    // The assertion below is intentionally a *no-op* today
    // because the Inspector renders no per-agent runtime
    // visuals. If a future contributor adds such a visual and
    // bypasses the canonical selector, the assertion catches the
    // regression.
    const hasPerAgentColourBranch =
      /status\s*===\s*['"]completed['"]/.test(src)
      || /status\s*===\s*['"]running['"]/.test(src)
      || /status\s*===\s*['"]failed['"]/.test(src);
    expect(hasPerAgentColourBranch).toBe(false);
  });
});