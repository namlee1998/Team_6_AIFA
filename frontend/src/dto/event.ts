// Canonical EventEnvelope TypeScript mirror.
//
// Mirrors backend/src/dto/eventEnvelope.js. Producers never construct
// envelopes — the SSE server is the only source.

export type EventType =
  | 'session_started'
  | 'session_resumed'
  | 'pipeline_completed'
  | 'pipeline_failed'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_interrupted'
  | 'task_resumed'
  | 'gate_pending'
  | 'gate_resolved'
  | 'agent_event'
  | 'runtime_log';

export type GateType =
  | 'PO_CLARIFY'
  | 'UX_CLARIFY'
  | 'DEV_CLARIFY'
  | 'QA_CLARIFY'
  | 'AGENT_CLARIFY'
  | 'DEV_FILE_GATE'
  | 'PO_OUTPUT_REVIEW'
  | 'UX_OUTPUT_REVIEW'
  | 'DEV_OUTPUT_REVIEW'
  | 'QA_OUTPUT_REVIEW'
  | 'AGENT_OUTPUT_REVIEW'
  | 'FINAL_RELEASE'
  | 'HITL_REVIEW';

export interface GatePendingPayload {
  gate: {
    id: string;
    type: GateType;
    kind: 'question' | 'tool' | 'output_review' | 'release';
    taskId: string;
    projectId: string;
    role: string;
    status: 'pending' | 'interrupted';
    payload: Record<string, unknown>;
    createdAt: string;
  };
}

export interface GateResolvedPayload {
  gateId: string;
  taskId: string;
  decision: 'approve' | 'reject' | 'answer' | 'timeout';
  comment?: string;
  resolvedAt: string;
}

export interface RuntimeLogPayload {
  taskId?: string;
  level: 'info' | 'warning' | 'error';
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface AgentEventRuntime {
  agent: 'ARCH' | 'PO' | 'UX' | 'DEV' | 'QA';
  role: string;
  runtime:
    | 'agent_start'
    | 'agent_tool_call'
    | 'agent_tool_result'
    | 'agent_complete'
    | 'file_change'
    | 'token_usage'
    | 'error';
  tool?: string;
  filePath?: string | null;
  action?: string;
  details?: Record<string, unknown>;
  error?: string;
}

export interface AgentEventPayload {
  type: AgentEventRuntime['runtime'];
  agent: AgentEventRuntime['agent'];
  tool?: string;
  filePath?: string | null;
  action?: string;
  details?: Record<string, unknown>;
  error?: string;
}

export interface SessionStartedPayload {
  status: string;
  pipelinePhases: unknown[];
  repoInfo?: unknown;
  pendingGates: unknown[];
  resumedFrom: number;
  log: string;
}

export interface TaskLifecyclePayload {
  from?: string;
  to?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface PipelineCompletedPayload {
  qaResult: unknown;
}

export interface PipelineFailedPayload {
  message: string;
  code?: string | null;
  statusCode?: number;
}

export interface EventEnvelope<P = unknown> {
  id: string;
  sequence: number;
  type: EventType;
  timestamp: string;
  projectId: string;
  sessionId: string;
  taskId: string | null;
  role: string | null;
  payload: P;
}

/** True iff `obj` looks like a canonical EventEnvelope. */
export function isEnvelope(obj: unknown): obj is EventEnvelope {
  if (!obj || typeof obj !== 'object') return false;
  const e = obj as Record<string, unknown>;
  return (
    typeof e.id === 'string'
    && Number.isFinite(e.sequence)
    && typeof e.type === 'string'
    && typeof e.timestamp === 'string'
    && typeof e.projectId === 'string'
    && typeof e.sessionId === 'string'
    && 'taskId' in e
    && 'role' in e
    && 'payload' in e
  );
}