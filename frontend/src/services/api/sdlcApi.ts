// Typed frontend boundary for /api/v1/sdlc.
//
// Beginner reading guide: this file contains transport helpers only. Components
// call these functions; backend workflow behavior lives in SdlcWorkflowService.
// The primary /aifa UI polls getDemoBoard(), while subscribeTaskSSE remains
// available for task-level clients and the legacy dashboard.

import api, { getBaseURL } from './client';

// ── Types ─────────────────────────────────────────────────────────────────

export type GateType =
  | 'DEV_FILE_GATE'
  | 'PO_CLARIFY'
  | 'HITL_REVIEW'
  | 'FINAL_RELEASE'
  | 'PO_OUTPUT_REVIEW'
  | 'UX_OUTPUT_REVIEW'
  | 'DEV_OUTPUT_REVIEW'
  | 'QA_OUTPUT_REVIEW'
  | 'AGENT_OUTPUT_REVIEW';
export type RouteType = 'UI' | 'BACKEND' | 'ANALYSIS' | 'FULLSTACK';
export type GateAction = 'approve' | 'reject';

export interface GateItem {
  id: string;
  taskId?: string;
  type: GateType;
  role?: string;             // owning agent role, e.g. 'po-agent'
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  payload: {
    action?: string;         // 'MODIFY' | 'DELETE' | 'CREATE'
    path?: string;           // file path
    reason?: string;         // risk reason
    diff?: string;           // unified diff
    questions?: string[];    // PO clarification questions (max 3)
    outputSummary?: string | null;   // agent's completed-output summary (output_review gates)
    validationIssues?: Array<{ rule: string; message?: string | null }>;
  };
  createdAt: string;
}

export interface AuditEntry {
  timestamp: string;
  actor: 'PO' | 'UX' | 'DEV' | 'QA' | 'A2A' | 'SYSTEM' | 'USER';
  action: string;
  status: 'ok' | 'warning' | 'error' | 'pending';
}

export interface PhaseStatus {
  agent: 'PO' | 'UX' | 'DEV' | 'QA';
  status: 'pending' | 'running' | 'gate_pending' | 'completed' | 'failed' | 'skipped';
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
  routeType: RouteType;
  pipelinePhases: PhaseStatus[];
  pendingGates: GateItem[];
  auditLog: AuditEntry[];
  qaResult?: QAResult | null;
  releaseStatus?: 'pending' | 'approved' | 'rejected' | null;
  repoInfo?: {
    techStack: string[];
    fileCount: number;
    components: string[];
  } | null;
}

// ── Real API Implementation ───────────────────────────────────────────────

const BASE = '/sdlc';

const startPipelineReal = (projectId: string, repoUrl: string, request: string): Promise<{ workflowId: string; status: string }> =>
  api.post(`${BASE}/run-po-agent`, {
    project_id: projectId,
    feature_request: {
      title: request,
      description: request
    },
    repo_path: repoUrl,
    request
  }).then((r) => r.data);

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

const releaseDecisionReal = (projectId: string, action: 'approve' | 'reject'): Promise<{ success: boolean; branch?: string; finalMd?: string }> =>
  api.post(`${BASE}/projects/${projectId}/release-decision`, { action }).then((r) => r.data);

// ── Real SSE Subscription ──────────────────────────────────────────────────

const subscribeWorkflowSSEReal = (
  workflowId: string,
  handlers: {
    onMessage?: (event: string, data: Record<string, unknown>) => void;
    onError?: (error: unknown) => void;
  }
): AbortController => {
  const abort = new AbortController();
  let retryCount = 0;

  const connect = async () => {
    try {
      const headers: Record<string, string> = {};

      const baseUrl = getBaseURL().replace(/\/$/, '');
      const response = await fetch(`${baseUrl}${BASE}/stream/${workflowId}`, {
        signal: abort.signal,
        headers
      });

      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent: string | null = null;
      retryCount = 0; // Reset retry count on successful connection

      while (!abort.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              handlers.onMessage?.(currentEvent, data);
            } catch { /* Ignore malformed frames */ }
            currentEvent = null;
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        handlers.onError?.(err);
      }
    }

    if (!abort.signal.aborted) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
      retryCount++;
      setTimeout(connect, delay);
    }
  };

  connect();
  return abort;
};

// ── Real API wrappers (no mock) ───────────────────────────────────────────

export const startPipeline = (projectId: string, repoUrl: string, request: string): Promise<{ workflowId: string; status: string }> =>
  startPipelineReal(projectId, repoUrl, request);

export const getPipelineStatus = (workflowId: string): Promise<PipelineResponse> =>
  getPipelineStatusReal(workflowId);

export const resolveGate = (gateId: string, action: 'approve' | 'reject', comment?: string): Promise<{ success: boolean }> =>
  resolveGateReal(gateId, action, comment);

export const releaseDecision = (projectId: string, action: 'approve' | 'reject'): Promise<{ success: boolean; branch?: string; finalMd?: string }> =>
  releaseDecisionReal(projectId, action);

export const subscribeWorkflowSSE = (
  workflowId: string,
  handlers: {
    onMessage?: (event: string, data: Record<string, unknown>) => void;
    onError?: (error: unknown) => void;
  }
): AbortController =>
  subscribeWorkflowSSEReal(workflowId, handlers);

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

// ── Repo-aware workflow start and live onGate approvals ────────────────────

/**
 * Start a repo-aware, PO-first workflow (applies the 429 cap).
 * Pass `repoUrl` to clone a remote repo, or `repoPath` to use an already-cloned
 * local folder ("Open folder" flow). Both are optional — omit for a repo-less run.
 */
export const runWorkflow = (
  projectId: string,
  request: string,
  repoUrl?: string,
  branch = 'main',
  repoPath?: string,
) => api.post(`${BASE}/run-po-agent`, {
  project_id: projectId,
  feature_request: { title: request, description: request, priority: 'High' },
  request,
  repo_url: repoUrl || undefined,
  repo_path: repoPath || undefined,
  branch,
}).then((r) => r.data);

/**
 * Upload a whole local folder (chosen anywhere on the user's machine) as the
 * workflow repo. Browsers can't expose an absolute path, so we stream the files
 * with their relative paths; the backend writes them into the project workspace
 * and git-inits a repo, returning the server-side `repo_path`.
 */
export const uploadRepoFolder = (
  projectId: string,
  files: Array<File & { relativePath?: string }>,
  request = '',
  onProgress?: (pct: number) => void,
) => {
  const form = new FormData();
  form.append('project_id', projectId);
  if (request) form.append('request', request);
  for (const f of files) {
    form.append('files', f);
    form.append('paths', f.relativePath || (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
  }
  return api.post(`${BASE}/upload-repo`, form, {
    timeout: 10 * 60 * 1000,
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  }).then((r) => r.data.data as { repo_path: string; base_branch: string; file_count: number });
};

export interface PendingGate {
  approvalId: string;
  taskId: string;
  projectId?: string | null;
  role: string;
  kind: 'tool' | 'question';
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

export const openFile = (projectId: string, path: string): Promise<void> =>
  api.post(`${BASE}/dev/projects/${projectId}/open-file`, { path }).then((r) => r.data);
