// Business mapping for runtime event envelopes.
//
// Each mapper consumes an EventEnvelope and returns the next-state patch for
// the session. The Workflow Store dispatches via applyEnvelope() and never
// sees the per-type mapping — it only knows the EventEnvelope contract.

import {
  type EventEnvelope,
  type GatePendingPayload,
  type GateResolvedPayload,
  type RuntimeLogPayload,
  type SessionStartedPayload,
  type AgentEventPayload,
  type PipelineFailedPayload,
  type PipelineCompletedPayload,
  type TaskLifecyclePayload,
} from '@/dto/event';
import {
  type SessionState,
  type RuntimeEvent,
  type AgentKey,
  type AgentState,
  AGENT_KEYS,
  RUNTIME_EVENTS_LIMIT,
} from '@/models/SessionState';

const AGENT_TO_ROLE: Record<string, AgentKey> = {
  'architecture-agent': 'ARCH',
  'po-agent': 'PO',
  'ux-agent': 'UX',
  'dev-agent': 'DEV',
  'qa-agent': 'QA',
};

function inferAgentKey(role?: string | null): AgentKey | null {
  if (!role) return null;
  return AGENT_TO_ROLE[role] ?? null;
}

function nextRuntimeEventId(): string {
  return `rt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function applyAgentRuntime(
  agentStates: Record<AgentKey, SessionState['agentStates'][AgentKey]>,
  payload: AgentEventPayload,
  now: number,
): Record<AgentKey, SessionState['agentStates'][AgentKey]> {
  const agentKey = payload.agent;
  if (!agentKey) return agentStates;
  const next = { ...agentStates };
  const existing = next[agentKey];
  const advanced = { ...existing };
  switch (payload.type) {
    case 'agent_start':
      advanced.status = 'running';
      advanced.startedAt = advanced.startedAt ?? now;
      advanced.lastEventAt = now;
      advanced.currentStep = 'starting';
      advanced.currentAction = payload.action ?? `${agentKey} initiated`;
      advanced.currentFile = null;
      advanced.toolName = null;
      break;
    case 'agent_tool_call':
      advanced.status = 'running';
      advanced.toolName = payload.tool ?? advanced.toolName;
      advanced.currentFile = (payload.filePath as string | null) ?? advanced.currentFile;
      advanced.currentAction = payload.action ?? `using ${payload.tool ?? 'tool'}`;
      advanced.currentStep = 'tool_execution';
      advanced.lastEventAt = now;
      break;
    case 'agent_tool_result':
      advanced.lastEventAt = now;
      break;
    case 'file_change':
      advanced.lastEventAt = now;
      break;
    case 'agent_complete':
      advanced.status = 'completed';
      advanced.completedAt = now;
      advanced.currentStep = 'completed';
      advanced.currentAction = 'finished';
      advanced.toolName = null;
      advanced.lastEventAt = now;
      break;
    case 'error':
      advanced.status = 'failed';
      advanced.lastEventAt = now;
      advanced.currentStep = 'failed';
      advanced.currentAction = payload.error ?? 'failed';
      break;
    case 'token_usage':
    default:
      advanced.lastEventAt = now;
      break;
  }
  next[agentKey] = advanced;
  return next;
}

export function mapGatePending(state: SessionState, env: EventEnvelope<GatePendingPayload>): Partial<SessionState> {
  const gate = env.payload.gate;
  if (!gate) return { lastUpdatedAt: Date.now() };
  if (state.pendingGates.some((g) => g.id === gate.id)) {
    return { lastUpdatedAt: Date.now() };
  }
  const agentForGate = inferAgentKey(gate.role);
  const nextAgentStates = agentForGate
    ? {
        ...state.agentStates,
        [agentForGate]: {
          ...state.agentStates[agentForGate],
          status: 'awaiting_review' as const,
          lastEventAt: Date.now(),
          currentStep: 'awaiting_hitl',
        },
      }
    : state.agentStates;
  // FINAL_RELEASE gates belong to the release stage, not an agent output
  // review — they should land the session in `awaiting_release`, not
  // `awaiting_approval`, so the summary bar / pill reads correctly.
  const newStatus = gate.kind === 'release' || gate.type === 'FINAL_RELEASE'
    ? 'awaiting_release'
    : 'awaiting_approval';
  return {
    pendingGates: [...state.pendingGates, gate as unknown as SessionState['pendingGates'][number]],
    status: newStatus,
    agentStates: nextAgentStates,
    lastUpdatedAt: Date.now(),
  };
}

export function mapGateResolved(state: SessionState, env: EventEnvelope<GateResolvedPayload>): Partial<SessionState> {
  const { gateId, decision, comment } = env.payload;
  if (!gateId) return { lastUpdatedAt: Date.now() };
  const gate = state.pendingGates.find((g) => g.id === gateId);
  const nextPending = state.pendingGates.filter((g) => g.id !== gateId);
  // Wire carries 'timeout' as a fourth decision outcome (no human answer
  // arrived before expiry); the FE history model only knows approve/reject/
  // answer. Project timeout → reject for display.
  const historyDecision: 'approve' | 'reject' | 'answer' =
    decision === 'timeout' ? 'reject' : (decision as 'approve' | 'reject' | 'answer');
  const historyEntry = gate
    ? {
        gateId: gate.id,
        type: gate.type,
        agent: inferAgentKey(gate.role),
        decision: historyDecision,
        comment,
        resolvedAt: env.timestamp,
        payload: gate.payload,
      }
    : null;
  const nextHistory = historyEntry ? [historyEntry, ...state.gateHistory] : state.gateHistory;
  const nextStatus: SessionState['status'] =
    nextPending.length > 0
      ? 'awaiting_approval'
      : state.status === 'awaiting_approval'
        ? 'running'
        : state.status;
  return {
    pendingGates: nextPending,
    gateHistory: nextHistory,
    status: nextStatus,
    lastUpdatedAt: Date.now(),
  };
}

export function mapAgentEvent(state: SessionState, env: EventEnvelope<AgentEventPayload>): Partial<SessionState> {
  const payload = env.payload;
  const evt: RuntimeEvent = {
    id: nextRuntimeEventId(),
    sessionId: env.sessionId,
    timestamp: env.timestamp,
    type: payload.type,
    agent: payload.agent,
    tool: payload.tool,
    filePath: payload.filePath ?? undefined,
    action: payload.action,
    details: payload.details as Record<string, unknown> | undefined,
    error: payload.error,
  };
  const bounded = state.runtimeEvents.length >= RUNTIME_EVENTS_LIMIT
    ? state.runtimeEvents.slice(state.runtimeEvents.length - RUNTIME_EVENTS_LIMIT + 1)
    : state.runtimeEvents;
  return {
    runtimeEvents: [...bounded, evt],
    agentStates: applyAgentRuntime(state.agentStates, payload, Date.now()),
    lastUpdatedAt: Date.now(),
  };
}

export function mapRuntimeLog(_state: SessionState, _env: EventEnvelope<RuntimeLogPayload>): Partial<SessionState> {
  // runtime_log is a backend audit event (auto_commit, gate_audit, etc.).
  // The previous FE reducer did not surface these to the timeline; we keep
  // that behavior and only bump lastUpdatedAt as a liveness signal.
  return { lastUpdatedAt: Date.now() };
}

export function mapSessionStarted(state: SessionState, env: EventEnvelope<SessionStartedPayload>): Partial<SessionState> {
  const { status, pipelinePhases, repoInfo, pendingGates } = env.payload;
  return {
    status: (status as SessionState['status']) ?? state.status,
    pipelinePhases: (pipelinePhases as SessionState['pipelinePhases']) ?? state.pipelinePhases,
    repoInfo: (repoInfo as SessionState['repoInfo']) ?? state.repoInfo,
    pendingGates: pendingGates ? (pendingGates as unknown as SessionState['pendingGates']) : state.pendingGates,
    lastUpdatedAt: Date.now(),
  };
}

export function mapSessionResumed(_state: SessionState, _env: EventEnvelope<SessionStartedPayload>): Partial<SessionState> {
  // No state mutation on resume; the server replays prior events verbatim.
  return {};
}

// OBS-01.10 R-23: helper that returns the canonical patch for both
// `agentStates[agentKey]` AND `pipelinePhases[i]` given the per-event
// agentState status and the FE-visible PhaseStatus. This is the SINGLE
// place where per-event lifecycle mappers should compose their patch;
// direct readers of `pipelinePhases[i].status` outside the canonical
// selector would otherwise see stale data (per contract §8 invariant 14,
// AC-15, and the §7 forbidden pattern "frozen snapshot for runtime
// transitions").
function patchAgentStateAndPhase(
  state: SessionState,
  agentKey: AgentKey,
  agentStatus: AgentState['status'],
  phaseStatus: 'pending' | 'running' | 'gate_pending' | 'awaiting_review' | 'completed' | 'failed' | 'skipped',
  extraAgentFields: Partial<AgentState> = {},
): Partial<SessionState> {
  const now = Date.now();
  return {
    agentStates: {
      ...state.agentStates,
      [agentKey]: {
        ...state.agentStates[agentKey],
        status: agentStatus,
        lastEventAt: now,
        ...extraAgentFields,
      },
    },
    pipelinePhases: state.pipelinePhases.map((p) =>
      p.agent === agentKey ? { ...p, status: phaseStatus } : p,
    ),
    lastUpdatedAt: now,
  };
}

export function mapTaskStarted(state: SessionState, env: EventEnvelope<TaskLifecyclePayload>): Partial<SessionState> {
  if (!env.taskId) return { lastUpdatedAt: Date.now() };
  // Map a task start back to a role→agent update via the envelope's role.
  const agentKey = inferAgentKey(env.role);
  if (!agentKey) return { lastUpdatedAt: Date.now() };
  return patchAgentStateAndPhase(state, agentKey, 'running', 'running');
}

export function mapTaskCompleted(state: SessionState, env: EventEnvelope<TaskLifecyclePayload>): Partial<SessionState> {
  const agentKey = inferAgentKey(env.role);
  if (!agentKey) return { lastUpdatedAt: Date.now() };
  return patchAgentStateAndPhase(state, agentKey, 'completed', 'completed', {
    completedAt: Date.now(),
  });
}

export function mapTaskFailed(state: SessionState, env: EventEnvelope<TaskLifecyclePayload>): Partial<SessionState> {
  const agentKey = inferAgentKey(env.role);
  if (!agentKey) return { lastUpdatedAt: Date.now() };
  return patchAgentStateAndPhase(state, agentKey, 'failed', 'failed');
}

export function mapTaskInterrupted(state: SessionState, env: EventEnvelope<TaskLifecyclePayload>): Partial<SessionState> {
  const agentKey = inferAgentKey(env.role);
  if (!agentKey) return { lastUpdatedAt: Date.now() };
  // Per the canonical projection (runtimeSelectors.ts:203-206), BOTH
  // 'cancelled' and 'timeout' project to PhaseStatus 'skipped'. This
  // collapses the canonical wire values onto a single FE-visible value.
  return patchAgentStateAndPhase(state, agentKey, 'skipped', 'skipped');
}

export function mapTaskResumed(state: SessionState, env: EventEnvelope<TaskLifecyclePayload>): Partial<SessionState> {
  const agentKey = inferAgentKey(env.role);
  if (!agentKey) return { lastUpdatedAt: Date.now() };
  return {
    agentStates: {
      ...state.agentStates,
      [agentKey]: {
        ...state.agentStates[agentKey],
        status: 'running',
        lastEventAt: Date.now(),
      },
    },
    lastUpdatedAt: Date.now(),
  };
}

export function mapPipelineCompleted(state: SessionState, env: EventEnvelope<PipelineCompletedPayload>): Partial<SessionState> {
  const now = Date.now();
  return {
    status: 'completed',
    qaResult: (env.payload.qaResult as SessionState['qaResult']) ?? state.qaResult,
    agentStates: AGENT_KEYS.reduce((acc, key) => {
      const existing = state.agentStates[key];
      acc[key] = existing.status === 'running'
        ? { ...existing, status: 'completed', completedAt: existing.completedAt ?? now, currentStep: 'completed', lastEventAt: now }
        : existing;
      return acc;
    }, { ...state.agentStates }),
    lastUpdatedAt: now,
  };
}

export function mapPipelineFailed(state: SessionState, env: EventEnvelope<PipelineFailedPayload>): Partial<SessionState> {
  const message = env.payload?.message ?? 'Pipeline failed';
  return {
    status: 'failed',
    error: message,
    lastUpdatedAt: Date.now(),
  };
}

/** Mapper registry: keyed on `envelope.type`. */
export type SessionPatcher = (state: SessionState, env: EventEnvelope) => Partial<SessionState>;

export const mappers: Record<string, SessionPatcher> = {
  gate_pending: mapGatePending as SessionPatcher,
  gate_resolved: mapGateResolved as SessionPatcher,
  agent_event: mapAgentEvent as SessionPatcher,
  runtime_log: mapRuntimeLog as SessionPatcher,
  session_started: mapSessionStarted as SessionPatcher,
  session_resumed: mapSessionResumed as SessionPatcher,
  task_started: mapTaskStarted as SessionPatcher,
  task_completed: mapTaskCompleted as SessionPatcher,
  task_failed: mapTaskFailed as SessionPatcher,
  task_interrupted: mapTaskInterrupted as SessionPatcher,
  task_resumed: mapTaskResumed as SessionPatcher,
  pipeline_completed: mapPipelineCompleted as SessionPatcher,
  pipeline_failed: mapPipelineFailed as SessionPatcher,
};

export function applyEnvelope(state: SessionState, envelope: EventEnvelope): SessionState {
  const mapper = mappers[envelope.type];
  if (!mapper) return state;
  return { ...state, ...mapper(state, envelope) };
}