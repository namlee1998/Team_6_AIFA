// Typed frontend boundary for /api/v1/sdlc.
//
// Beginner reading guide: this file contains transport helpers only. Components
// call these functions; backend workflow behavior lives in SdlcWorkflowService.
// The primary /aifa UI polls getDemoBoard(). The SSE transport is owned by
// @/services/sseClient and consumed via useWorkflowStore — there is exactly
// one frontend transport implementation.

import api from './client';

// ── Types ─────────────────────────────────────────────────────────────────

export type GateType =
  | 'DEV_FILE_GATE'
  | 'PO_CLARIFY'
  | 'UX_CLARIFY'
  | 'DEV_CLARIFY'
  | 'QA_CLARIFY'
  | 'AGENT_CLARIFY'
  | 'HITL_REVIEW'
  | 'FINAL_RELEASE'
  | 'PO_OUTPUT_REVIEW'
  | 'UX_OUTPUT_REVIEW'
  | 'DEV_OUTPUT_REVIEW'
  | 'QA_OUTPUT_REVIEW'
  | 'AGENT_OUTPUT_REVIEW';
export type GateAction = 'approve' | 'reject';

export interface GateItem {
  id: string;
  taskId?: string;
  type: GateType;
  kind?: 'tool' | 'question' | 'output_review' | 'release';  // canonical dispatch key (frozen spec §6)
  role?: string;             // owning agent role, e.g. 'po-agent'
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  payload: {
    action?: string;         // 'MODIFY' | 'DELETE' | 'CREATE'
    path?: string;           // file path
    file_path?: string;      // alt tool-gate key (PendingGate shape)
    tool?: string;           // tool name (HITL_REVIEW)
    toolName?: string;       // alt tool name key
    reason?: string;         // risk reason
    category?: string;       // risk category (HITL_REVIEW)
    diff?: string;           // unified diff
    display?: { command?: string | null; filePath?: string | null; diffPreview?: string | null; prompt?: string | null };
    questions?: ClarificationQuestion[];    // agent clarification questions (object form, T2)
    summary?: string | null;   // agent's completed-output summary (output_review gates; backend key per T3)
    validationIssues?: Array<{ rule: string; message?: string | null }>;
  };
  createdAt: string;
}

export interface ClarificationOption {
  label: string;
  description?: string;
}

export interface ClarificationQuestion {
  question: string;
  header?: string;
  options?: ClarificationOption[];
}

export interface AuditEntry {
  timestamp: string;
  actor: 'ARCH' | 'PO' | 'UX' | 'DEV' | 'QA' | 'A2A' | 'SYSTEM' | 'USER';
  action: string;
  status: 'ok' | 'warning' | 'error' | 'pending';
}

export interface PhaseStatus {
  agent: 'ARCH' | 'PO' | 'UX' | 'DEV' | 'QA';
  status: 'pending' | 'running' | 'gate_pending' | 'awaiting_review' | 'completed' | 'failed' | 'skipped';
  taskId?: string;
  duration?: string;
  awaitingReview?: boolean;
  invalid?: boolean;
}

export interface QAResult {
  status: 'passed' | 'failed';
  coverage: number;
  blockers: number;
  warnings: number;
  reportUrl: string;
  commitSha: string;
}

export interface PipelineResponse {
  workflowId: string;
  status: string;
  pipelinePhases: PhaseStatus[];
  pendingGates: GateItem[];
  auditLog: AuditEntry[];
  qaResult?: QAResult | null;
  releaseStatus?: 'pending' | 'approved' | 'rejected' | null;
  repoInfo?: {
    // T7 (B7) — spec §8.1 Session Summary needs Repository / Branch /
    // Commit SHA. techStack / components are vestigial (the old stub)
    // — kept optional for back-compat with stored sessions.
    repoUrl?: string | null;
    branch?: string | null;
    commitSha?: string | null;
    fileCount?: number;
    techStack?: string[];
    components?: string[];
  } | null;
}

// ── Real API Implementation ───────────────────────────────────────────────

const BASE = '/sdlc';

// AIFA v2.1 §4: the workflow entry is the Architecture Agent. Workflows
// are never started from a PO-first path or from an uploaded folder — only
// from a Git Repository URL. The backend creates the PipelineSession
// upfront in runArchitectureAgent and returns both task_id and session_id
// in the same response. The frontend uses session_id as the workflow
// identifier — there is no bridge, no task_id → session_id polling.
const startPipelineReal = (
  projectId: string,
  repoUrl: string,
  _request: string,
): Promise<{ sessionId: string; taskId: string; workflowId: string; status: string; type: string }> =>
  api.post(`${BASE}/run-architecture-agent`, {
    project_id: projectId,
    feature_request: {
      title: _request,
      description: _request,
    },
    repo_url: repoUrl,
  }).then((r) => {
    const data = r.data || {};
    const sessionId = data.session_id as string | undefined;
    const taskId = data.task_id as string | undefined;
    if (!sessionId) {
      throw new Error('Backend did not return session_id');
    }
    if (!taskId) {
      throw new Error('Backend did not return task_id');
    }
    // workflowId is the sessionId — they are 1:1 in AIFA v2.1.
    return {
      sessionId,
      taskId,
      workflowId: sessionId,
      status: data.status,
      type: data.type,
    };
  });

export interface SdlcError {
  message: string;
  code?: string | null;
  phase?: string | null;
  requestId?: string | null;
}

export const parseApiError = (error: unknown, fallback: string): SdlcError => {
  if (typeof error !== 'object' || error === null) return { message: fallback };
  const candidate = error as {
    response?: { data?: { message?: string; code?: string; phase?: string; requestId?: string }; headers?: Record<string, string> };
    message?: string;
  };
  const data = candidate.response?.data;
  return {
    message: data?.message || candidate.message || fallback,
    code: data?.code ?? null,
    phase: data?.phase ?? null,
    requestId: data?.requestId ?? candidate.response?.headers?.['x-request-id'] ?? null,
  };
};

const getPipelineStatusReal = (workflowId: string): Promise<PipelineResponse> =>
  api.get(`${BASE}/pipeline/${workflowId}`).then((r) => r.data.data);

const resolveGateReal = (gateId: string, action: 'approve' | 'reject', comment?: string): Promise<{ success: boolean }> =>
  api.post(`${BASE}/approvals/${gateId}`, { action, comment }).then((r) => r.data);

const releaseDecisionReal = (
  sessionId: string,
  decisionId: string,
  decision: 'APPROVE' | 'REJECT',
  comment?: string,
): Promise<{ success: boolean; branch?: string; finalMd?: string }> =>
  api
    .post(`${BASE}/sessions/${sessionId}/release-decision`, { decision_id: decisionId, decision, comment })
    .then((r) => r.data);

export const executeGitAction = async (
  sessionId: string,
  action: 'sync' | 'commit' | 'push' | 'pr',
  agent: string,
  githubToken?: string,
  commitMessage?: string
): Promise<{ success: boolean; output?: string; message?: string }> => {
  return api.post(`${BASE}/session/${sessionId}/git-action`, {
    action,
    agent,
    githubToken,
    commitMessage
  }).then(r => r.data);
};

// ── Real API wrappers (no mock) ───────────────────────────────────────────

export const startPipeline = (
  projectId: string,
  repoUrl: string,
  request: string,
): Promise<{ sessionId: string; taskId: string; workflowId: string; status: string; type: string }> =>
  startPipelineReal(projectId, repoUrl, request);

export const getPipelineStatus = (workflowId: string): Promise<PipelineResponse> =>
  getPipelineStatusReal(workflowId);

export const resolveGate = (gateId: string, action: 'approve' | 'reject', comment?: string): Promise<{ success: boolean }> =>
  resolveGateReal(gateId, action, comment);

export const releaseDecision = (
  sessionId: string,
  decisionId: string,
  decision: 'APPROVE' | 'REJECT',
  comment?: string,
): Promise<{ success: boolean; branch?: string; finalMd?: string }> =>
  releaseDecisionReal(sessionId, decisionId, decision, comment);

// Re-export legacy functions from sdlcLegacy
export {
  startFromRepo,
  getPipelineStatusLegacy,
  approveItemLegacy,
  getArtifactContent,
  getWorkflowStatus,
  getAuditTrail,
  getWorkflowMetrics,
  getProjectArtifacts,
  getBacklogs
} from './sdlcLegacy';

export type { FeatureRequest } from './sdlcLegacy';


// AIFA demo board API

export interface GateDecisionPayload {
  decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  comment?: string;
}

export const submitGateDecision = (taskId: string, payload: GateDecisionPayload) =>
  api.post(`${BASE}/tasks/${taskId}/gate-decision`, payload).then((r) => r.data);

// Structured stage-review decision: idempotent and optimistic-locked.
export const submitHitlDecision = async (
  taskId: string,
  payload: {
    decision_id: string;
    base_output_version: number;
    action: string;
    payload?: string;
    comment?: string;
  }
) => {
  const { data } = await api.post(`${BASE}/dev/tasks/${taskId}/hitl`, payload);
  return data;
};

/**
 * Approve or reject a DEV Agent tool execution
 */
export const approveToolCall = async (
  taskId: string,
  approved: boolean,
  feedback: string
) => {
  const { data } = await api.post(`${BASE}/dev/tasks/${taskId}/approve-tool`, {
    approved,
    feedback,
  });
  return data;
};

export const getPendingToolApprovals = async (projectId: string) => {
  const { data } = await api.get(`${BASE}/dev/projects/${projectId}/pending-approvals`);
  return data;
};

export interface StructuredDecisionBody {
  decision_id: string;
  base_output_version: number;
  action: 'approve' | 'reject' | 'edit_approve';
  comment?: string;
  payload?: {
    retry_reason?: string;
    patch?: unknown[];
    edited_output?: Record<string, unknown>;
    target_fields?: string[];
    blocking_issues?: Array<{ severity: string; issue: string; expected_fix: string }>;
    acceptance_checks?: string[];
  };
}

export const submitStructuredDecision = (taskId: string, body: StructuredDecisionBody) =>
  api.post(`${BASE}/tasks/${taskId}/decision`, body).then((r) => r.data);

// ── Status ────────────────────────────────────────────────────────────────

export const getSdlcTaskStatus = (taskId: string) =>
  api.get(`${BASE}/tasks/${taskId}`).then((r) => r.data.data);

export const getFinalReviewPacket = (projectId: string) =>
  api.get(`${BASE}/final-review-packet/${projectId}`).then((r) => r.data.data);

export const submitReleaseDecision = (
  projectId: string,
  body: { decision_id: string; decision: 'APPROVE' | 'REJECT'; comment?: string },
) => api.post(`${BASE}/projects/${projectId}/release-decision`, body).then((r) => r.data);

// ── Live onGate approvals ──────────────────────────────────────────────────

export interface PendingGate {
  approvalId: string;
  taskId: string;
  projectId?: string | null;
  role: string;
  type?: GateType;            // canonical GateType (frozen spec §6) — derived from (role,kind) by backend's toGateType
  kind: 'tool' | 'question' | 'output_review' | 'release';
  status?: 'pending' | 'interrupted';
  payload: {
    tool?: string;
    toolName?: string;
    file_path?: string | null;
    diff?: string | null;
    reason?: string;
    category?: string;
    display?: { command?: string | null; filePath?: string | null; diffPreview?: string | null; prompt?: string | null };
    questions?: Array<{ question: string; header?: string; options?: Array<{ label: string; description?: string }> }>;
  };
  createdAt?: string;
}

export const resolveApproval = (
  approvalId: string,
  body: { action?: 'approve' | 'reject'; comment?: string; answers?: string[] | Record<string, string> },
) => api.post(`${BASE}/approvals/${approvalId}`, body).then((r) => r.data.data);

/**
 * Resolve the always-on output-review gate created after every agent
 * (PO/UX/DEV/QA) finishes. Reject requires a non-empty `comment` — it is fed
 * back into a re-run of that same agent.
 */
export const resolveOutputReviewGate = (
  approvalId: string,
  action: GateAction,
  comment?: string,
) => api.post(`${BASE}/output-review/${approvalId}`, { action, comment }).then((r) => r.data.data);

export const downloadReleaseFile = (projectId: string, fileName: 'final.md' | 'qa-report.md') =>
  api.get(`${BASE}/projects/${projectId}/release-files/${fileName}`, { responseType: 'blob' })
    .then((r) => r.data as Blob);

// ── Primary /aifa board: real_single or staged three_flow mode ─────────────

export interface CardAction {
  label: string;
  kind?: 'review' | 'diff' | 'test-report' | 'approve' | 'reject';
  placeholder?: string;
}
export interface BoardCard {
  label: string;
  agent: string;
  title: string;
  description: string;
  whatsIncluded: string[];
  taskId: string;
  stage?: string;
  invalid: boolean;
  validationIssues?: Array<{ rule: string; detail: string }>;
  patchDiff?: string | null;
  changedFiles?: string[] | null;
  testCases?: Array<Record<string, unknown>> | null;
  qaReport?: string | null;
  actions?: { review: CardAction; approve: CardAction; reject: CardAction };
}

export interface BoardPhase {
  stage: string;
  status: string;
  committed: boolean;
  awaitingReview: boolean;
  invalid: boolean;
  error?: string | null;
}

export interface BoardReleaseGate {
  eligible: boolean;
  status: string;
  canDecide: boolean;
  approvalBlocked: boolean;
}

export interface BoardFlow {
  flowNo: number;
  target: string;
  projectId?: string;
  active?: boolean;
  status: 'seeding' | 'ready' | 'error' | 'unavailable';
  repo?: string;
  branch?: string;
  progress?: { done: number; total: number };
  currentPhase?: string;
  waitingFor?: string | null;
  reviewStage?: string | null;
  phases?: BoardPhase[];
  card?: BoardCard | null;
  failure?: {
    stage: string;
    error: string;
    code?: string | null;
    recoverable?: boolean | null;
  } | null;
  pendingGates?: PendingGate[];
  releaseGate?: BoardReleaseGate | null;
  released?: string | null;
}

export interface DemoBoard {
  id?: string;
  mode?: 'three_flow' | 'real_single';
  status: string;
  error?: string | null;
  flows: BoardFlow[];
}

export interface WorkflowTimelineEvent {
  timestamp: string;
  actor: string;
  action: string;
  type: string;
  taskId?: string | null;
  agent?: string | null;
  status?: string | null;
  decision?: string | null;
  comment?: string | null;
  reason?: string | null;
  gate?: string | null;
  stateFrom?: string | null;
  stateTo?: string | null;
  fromAgent?: string | null;
  toAgent?: string | null;
  versionTag?: string | null;
  severity?: string | null;
}

export interface WorkflowTimeline {
  projectId: string;
  events: WorkflowTimelineEvent[];
  phaseTransitions?: Array<Record<string, unknown>>;
}

// Real Claude Code runs make these board calls slower than ordinary CRUD (the
// backend reads live workflow status), so override the 30s default to avoid a
// misleading "timeout exceeded" banner while a real run is provisioning.
const BOARD_TIMEOUT_MS = 120_000;

export const seedDemoBoard = (
  reset = false,
  sourceRepoPath?: string,
  mode: 'three_flow' | 'real_single' = 'three_flow',
): Promise<DemoBoard> =>
  api.post(`${BASE}/demo/seed-board`, { reset, sourceRepoPath, mode }, { timeout: BOARD_TIMEOUT_MS }).then((r) => r.data.data);

export const getDemoBoard = (): Promise<DemoBoard> =>
  api.get(`${BASE}/demo/board`, { timeout: BOARD_TIMEOUT_MS }).then((r) => r.data.data);

export interface UxDoc { taskId: string; fileName: string; markdown: string; }

export const getDemoUxDoc = (projectId: string): Promise<UxDoc | null> =>
  api.get(`${BASE}/demo/flow/${projectId}/ux-doc`).then((r) => r.data.data);

export const retryDemoFlow = (projectId: string): Promise<{ retried: boolean; stage?: string; reason?: string }> =>
  api.post(`${BASE}/demo/flow/${projectId}/retry`, {}, { timeout: BOARD_TIMEOUT_MS }).then((r) => r.data.data);

export const getWorkflowTimeline = (projectId: string): Promise<WorkflowTimeline> =>
  api.get(`${BASE}/workflow/${projectId}/timeline`).then((r) => r.data.data);

// ── Global HITL Interventions ──

export interface GlobalInterventionItem extends GateItem {
  projectId: string;
  projectName: string;
  sessionId: string | null;  // which of the project's (up to 4) concurrent sessions this gate belongs to
  repoUrl: string;
  pipelineStatus: string;   // e.g. 'awaiting_approval', 'qa_complete'
  currentPhase: string;     // e.g. 'PO', 'DEV', 'QA'
  updatedAt: string;        // ISO timestamp for sorting
}

const getAllInterventionsReal = (projectId?: string): Promise<GlobalInterventionItem[]> =>
  api.get(`${BASE}/interventions`, { params: projectId ? { project_id: projectId } : undefined }).then((r) => r.data.data);

// Scoped to the current project by default so one user's other projects never
// show up as bottlenecks on this dashboard. Pass no arg to fall back to global.
export const getAllInterventions = (projectId?: string): Promise<GlobalInterventionItem[]> =>
  getAllInterventionsReal(projectId);

export interface SystemHealthData {
  db: {
    status: 'ok' | 'error';
    error: string | null;
    projectCount: number;
  };
  env: {
    OPENAI_API_KEY: boolean;
    ANTHROPIC_API_KEY: boolean;
    DEEPSEEK_API_KEY: boolean;
    GOOGLE_API_KEY: boolean;
    DATABASE_URL: boolean;
    AUTO_APPROVE_TOOLS?: boolean;
  };
  timestamp: string;
}

export const getProjectHealth = (projectId?: string): Promise<SystemHealthData> => {
  void projectId;
  return api.get(`${BASE}/dev/health`).then((r) => r.data.data);
};

export const updateSystemSettings = (keys: Record<string, string>): Promise<{ status: string }> =>
  api.post(`${BASE}/dev/settings/env`, { keys }).then((r) => r.data);

export const updateEnvSettings = updateSystemSettings;

// ── Sessions list ─────────────────────────────────────────────────────────
// Previously used by the store to bridge from a freshly-created architecture
// task_id to the sessionId created later when PO auto-advances. AIFA v2.1
// now returns session_id directly from POST /run-architecture-agent, so this
// bridge helper is no longer needed. The list endpoint is still available
// on the backend if any UI surface needs an explicit session listing.
export interface ProjectSession {
  sessionId: string;
  projectId: string;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const listProjectSessions = (projectId: string): Promise<ProjectSession[]> =>
  api.get(`${BASE}/projects/${projectId}/sessions`).then((r) => r.data.data);

