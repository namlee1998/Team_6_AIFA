/**
 * SessionState — the single source of truth for one SDLC workflow session.
 *
 * Created by useWorkflowStore.startPipeline once the backend returns a sessionId.
 * Mutated only by the SSE dispatcher inside useWorkflowStore. Pages never write
 * to this object — they subscribe to slices.
 *
 * A session is identified by `sessionId` (AIFA v2.1: this is the same id used
 * for SSE subscription). One Session per `startPipeline` call. Up to 4 may run
 * concurrently per project.
 */

import type * as api from '@/services/api/sdlcApi';

export type AgentKey = 'ARCH' | 'PO' | 'UX' | 'DEV' | 'QA';

export const AGENT_KEYS: readonly AgentKey[] = ['ARCH', 'PO', 'UX', 'DEV', 'QA'] as const;

export type RuntimeEventType =
  | 'agent_start'
  | 'agent_tool_call'
  | 'agent_tool_result'
  | 'agent_complete'
  | 'file_change'
  | 'token_usage'
  | 'gate_triggered'
  | 'clarification_needed'
  | 'error';

export interface RuntimeEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type: RuntimeEventType;
  agent?: AgentKey;
  tool?: string;
  filePath?: string;
  action?: string;
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Per-agent runtime state. Distinct from `pipelinePhases` (which is the
 * coarse 5-bucket scheduling view). AgentState carries the fine-grained
 * "what is this agent doing right now" view used by the Inspector.
 */
export interface AgentState {
  agent: AgentKey;
  status: 'idle' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'skipped';
  currentStep: string | null;
  currentAction: string | null;
  currentFile: string | null;
  toolName: string | null;
  startedAt: number | null;
  completedAt: number | null;
  lastEventAt: number | null;
}

export interface GateHistoryEntry {
  gateId: string;
  type: api.GateType;
  agent: AgentKey | null;
  decision: 'approve' | 'reject' | 'answer';
  comment?: string;
  resolvedAt: string;
  payload?: unknown;
}

export type SessionStatus = 'pending' | 'running' | 'awaiting_approval' | 'awaiting_release' | 'completed' | 'failed';

export interface SessionState {
  // Identity
  sessionId: string;
  taskId: string;
  projectId: string;

  // Lifecycle
  status: SessionStatus;
  error: string | null;
  createdAt: number;
  lastUpdatedAt: number;

  // Coarse scheduling — the 5-bucket pipeline phase map.
  pipelinePhases: api.PhaseStatus[];

  // Fine-grained per-agent runtime state.
  agentStates: Record<AgentKey, AgentState>;

  // HITL
  pendingGates: api.GateItem[];
  selectedGateId: string | null;     // selected by user; never used as implicit fallback
  gateHistory: GateHistoryEntry[];

  // History
  auditLog: api.AuditEntry[];

  // Stream-backed runtime events for the current session (bounded).
  runtimeEvents: RuntimeEvent[];

  // Final outputs
  qaResult: api.QAResult | null;
  releaseStatus: 'pending' | 'approved' | 'rejected' | null;
  repoInfo: api.PipelineResponse['repoInfo'] | null;

  // User-provided input
  featureRequest: string;
  repoUrl: string;
}

export const RUNTIME_EVENTS_LIMIT = 500;

export function emptyAgentStates(): Record<AgentKey, AgentState> {
  const map = {} as Record<AgentKey, AgentState>;
  for (const key of AGENT_KEYS) {
    map[key] = {
      agent: key,
      status: 'idle',
      currentStep: null,
      currentAction: null,
      currentFile: null,
      toolName: null,
      startedAt: null,
      completedAt: null,
      lastEventAt: null,
    };
  }
  return map;
}

export function defaultPipelinePhases(): api.PhaseStatus[] {
  return AGENT_KEYS.map((agent) => ({ agent, status: 'pending' }));
}

export function defaultSessionState(params: {
  sessionId: string;
  taskId: string;
  projectId: string;
  featureRequest: string;
  repoUrl: string;
  now?: number;
}): SessionState {
  const now = params.now ?? Date.now();
  return {
    sessionId: params.sessionId,
    taskId: params.taskId,
    projectId: params.projectId,
    status: 'pending',
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
    featureRequest: params.featureRequest,
    repoUrl: params.repoUrl,
  };
}
