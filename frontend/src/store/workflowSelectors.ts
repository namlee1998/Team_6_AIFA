/**
 * workflowSelectors — single source of truth for derived views.
 *
 * Components MUST NOT call `deriveRuntimeExecution` from the model directly.
 * They use `selectRuntimeExecution(state, sessionId)` instead, so the
 * projection logic lives in exactly one place and is shared by Overview,
 * Agent Tasks, the Inspector, and the Output Panel.
 */

import type * as api from '@/services/api/sdlcApi';
import type {
  SessionState,
  AgentKey,
  RuntimeEvent,
} from '@/models/SessionState';
import { AGENT_KEYS } from '@/models/SessionState';
import type { WorkflowState } from './useWorkflowStore';
import {
  projectAgentToPhaseStatus,
  selectRuntimeStatus,
} from './runtimeSelectors';

// ── Presentation types (kept here so consumers don't depend on the model) ──

export interface RuntimeTool {
  name: string | null;
  filePath: string | null;
  action: string | null;
  details: string | null;
}

export interface RuntimeArtifact {
  title: string;
  type: string;
  content: string | null;
  taskId: string | null;
  agent: AgentKey;
}

export interface RuntimeMetrics {
  elapsedTime: string;
  tokenUsage: string;
  filesChanged: number | null;
  branches: string[];
}

export interface RuntimeTimelineEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  status: 'ok' | 'warning' | 'error' | 'pending';
}

export interface RuntimeIntervention {
  type: 'clarification' | 'output_review' | 'tool_approval' | 'release' | 'security';
  id: string;
  label: string;
  currentPhase: AgentKey | null;
  createdAt: string;
  payload: api.GateItem['payload'];
}

export interface RuntimeAgentPhase {
  agent: AgentKey;
  status: SessionState['pipelinePhases'][number]['status'] | 'awaiting_review' | 'running';
  taskId?: string;
}

export interface RuntimeExecution {
  sessionId: string;
  sessionTitle: string;
  sessionStatus: SessionState['status'];
  createdAt: number;

  currentAgent: AgentKey | null;
  currentPhaseStatus: string;
  currentStep: string | null;
  currentAction: string | null;
  currentFile: string | null;

  tool: RuntimeTool;
  artifact: RuntimeArtifact | null;

  metrics: RuntimeMetrics;
  events: RuntimeTimelineEntry[];
  phases: RuntimeAgentPhase[];
  interventions: RuntimeIntervention[];
  runtimeEvents: RuntimeEvent[];

  session: SessionState;
}

const METRICS_TIME_FORMATTER = (startedAt: number) => {
  const diff = Math.max(0, Date.now() - startedAt);
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const TOOL_ACTION_DEFAULTS: Record<AgentKey, string> = {
  ARCH: 'Repository discovery',
  PO: 'Generate PRD',
  UX: 'Generate mockup',
  DEV: 'Modify source',
  QA: 'Run tests',
};

const ARTIFACT_TITLE_DEFAULTS: Record<AgentKey, string> = {
  ARCH: 'Architecture_Brief.md',
  PO: 'PRD.md',
  UX: 'UI_Mockup.html',
  DEV: 'Code_Patch.md',
  QA: 'QA_Report.md',
};

function classifyIntervention(gate: api.GateItem): RuntimeIntervention {
  if (gate.type === 'PO_CLARIFY') {
    return {
      type: 'clarification',
      id: gate.id,
      label: 'PO Clarification Required',
      currentPhase: 'PO',
      createdAt: gate.createdAt,
      payload: gate.payload,
    };
  }
  if (gate.type === 'DEV_FILE_GATE') {
    return {
      type: 'security',
      id: gate.id,
      label: 'Tool approval required',
      currentPhase: 'DEV',
      createdAt: gate.createdAt,
      payload: gate.payload,
    };
  }
  if (gate.type === 'FINAL_RELEASE') {
    return {
      type: 'release',
      id: gate.id,
      label: 'Final release decision',
      currentPhase: 'QA',
      createdAt: gate.createdAt,
      payload: gate.payload,
    };
  }
  if (gate.type.endsWith('_OUTPUT_REVIEW')) {
    const agent = gate.type.replace('_OUTPUT_REVIEW', '') as AgentKey;
    return {
      type: 'output_review',
      id: gate.id,
      label: `${agent} Output Review`,
      currentPhase: agent,
      createdAt: gate.createdAt,
      payload: gate.payload,
    };
  }
  return {
    type: 'clarification',
    id: gate.id,
    label: 'Review required',
    currentPhase: null,
    createdAt: gate.createdAt,
    payload: gate.payload,
  };
}

function detectCurrentTool(streamEvents: RuntimeEvent[], pendingGates: api.GateItem[], currentAgent: AgentKey | null) {
  // 1) Most recent tool_call event
  for (let i = streamEvents.length - 1; i >= 0; i -= 1) {
    const evt = streamEvents[i];
    if (evt.type === 'agent_tool_call') {
      return {
        name: evt.tool ?? null,
        filePath: evt.filePath ?? null,
        action: evt.action ?? null,
        details: evt.details ? JSON.stringify(evt.details) : null,
      } satisfies RuntimeTool;
    }
  }
  // 2) Pending security/file gate as a "tool pending approval"
  const fileGate = pendingGates.find((g) => g.type === 'DEV_FILE_GATE');
  if (fileGate) {
    return {
      name: fileGate.payload.action === 'DELETE' ? 'execute_command' : 'apply_diff',
      filePath: fileGate.payload.path ?? null,
      action: fileGate.payload.reason ?? null,
      details: fileGate.payload.diff ?? null,
    } satisfies RuntimeTool;
  }
  // 3) Inferred from agent
  if (currentAgent) {
    return {
      name: null,
      filePath: null,
      action: TOOL_ACTION_DEFAULTS[currentAgent],
      details: null,
    } satisfies RuntimeTool;
  }
  return { name: null, filePath: null, action: null, details: null } satisfies RuntimeTool;
}

function timelineFromEvents(events: RuntimeEvent[]): RuntimeTimelineEntry[] {
  return events.slice(-200).map((evt, idx) => {
    let status: RuntimeTimelineEntry['status'] = 'ok';
    if (evt.type === 'error') status = 'error';
    else if (evt.type === 'gate_triggered' || evt.type === 'clarification_needed') status = 'pending';
    else if (evt.type === 'agent_tool_call') status = 'warning';
    return {
      id: `${evt.id}_${idx}`,
      timestamp: evt.timestamp,
      actor: evt.agent ?? 'system',
      action: evt.action ?? evt.type,
      status,
    };
  });
}

export function selectRuntimeExecution(state: WorkflowState, sessionId: string | null): RuntimeExecution | null {
  if (!sessionId) return null;
  const session = state.sessions[sessionId];
  if (!session) return null;

  // Runtime state derivation is owned by the canonical selector.
  // See frontend/src/store/runtimeSelectors.ts and the contract at
  // docs/runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md.
  // This module is the single consumer; no other reducer / component
  // may compute runtime state independently.
  const runtimeStatus = selectRuntimeStatus(session);
  const currentAgent = runtimeStatus.currentAgent;
  // runtimeStatus.reviewingAgent is exposed by the canonical
  // selector but not consumed by this function (the prior inline
  // derivation also assigned it without using it). Kept for
  // parity — see RuntimeStatus contract in runtimeSelectors.ts.

  const currentAgentState = currentAgent ? session.agentStates[currentAgent] : null;

  // Tool: prefer agentStates (lastEventAt freshness) over stream scanning.
  const tool: RuntimeTool = currentAgentState?.toolName
    ? {
        name: currentAgentState.toolName,
        filePath: currentAgentState.currentFile,
        action: currentAgentState.currentAction,
        details: null,
      }
    : detectCurrentTool(session.runtimeEvents, session.pendingGates, currentAgent);

  // Phases — drawn from the canonical selector. The selector's
  // `projectAgentToPhaseStatus` returns the FE-visible PhaseStatus
  // value directly (matching the prior inline derivation at
  // workflowSelectors.ts:247-264 byte-for-byte).
  const phases: RuntimeAgentPhase[] = AGENT_KEYS.map((agent) => {
    const phase = session.pipelinePhases.find((p) => p.agent === agent);
    return {
      agent,
      status: projectAgentToPhaseStatus(session, agent),
      taskId: phase?.taskId,
    };
  });

  // Artifact — derived from latest completed agent's phase.
  let artifact: RuntimeArtifact | null = null;
  for (let i = session.pipelinePhases.length - 1; i >= 0; i -= 1) {
    const phase = session.pipelinePhases[i];
    if (phase.status === 'completed') {
      artifact = {
        title: ARTIFACT_TITLE_DEFAULTS[phase.agent] ?? `${phase.agent}_output.md`,
        type: phase.agent === 'DEV' ? 'code_diff' : 'document',
        content: null,
        taskId: phase.taskId ?? null,
        agent: phase.agent,
      };
      break;
    }
  }

  // Interventions — classify each pending gate.
  const interventions = session.pendingGates.map(classifyIntervention);

  // Events: runtime events are the single source of truth per spec §8.2.
  // The audit log is preserved on the model for backward compat with stored
  // sessions but is no longer rendered into the timeline.
  const events = timelineFromEvents(session.runtimeEvents);

  // Tool calls (for the Tools tab) — last 50 tool calls.
  const runtimeEvents = session.runtimeEvents.slice(-50);

  return {
    sessionId,
    sessionTitle: session.featureRequest || 'Untitled Session',
    sessionStatus: session.status,
    createdAt: session.createdAt,
    currentAgent,
    currentPhaseStatus: currentAgentState?.status ?? session.status,
    currentStep: currentAgentState?.currentStep ?? null,
    currentAction: currentAgentState?.currentAction ?? null,
    currentFile: currentAgentState?.currentFile ?? null,
    tool,
    artifact,
    metrics: {
      elapsedTime: METRICS_TIME_FORMATTER(session.createdAt),
      tokenUsage: 'N/A',
      filesChanged: session.repoInfo?.fileCount ?? null,
      branches: session.repoInfo?.components ?? [],
    },
    events,
    phases,
    interventions,
    runtimeEvents,
    session,
  };
}
