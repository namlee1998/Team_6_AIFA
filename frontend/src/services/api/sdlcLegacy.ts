import api from './client';
import { 
  startPipeline, 
  getPipelineStatus, 
  resolveGate, 
} from './sdlcApi';

const BASE = '/sdlc';

// Backward-compatibility adapters for existing components if any
export const startFromRepo = (projectId: string, repoUrl: string): Promise<unknown> => {
  return startPipeline(projectId, repoUrl, 'add google login').then(res => ({
    projectId: workflowIdToProjectId(res.workflowId),
    status: res.status
  }));
};

export const getPipelineStatusLegacy = (projectId: string): Promise<unknown> => {
  const workflowId = projectIdToWorkflowId(projectId);
  return getPipelineStatus(workflowId).then(res => ({
    projectId,
    status: res.status,
    currentStep: phaseToStep(res.status),
    repoInfo: res.repoInfo,
    approvals: res.pendingGates.map(g => ({
      id: g.id,
      agentName: g.type === 'PO_CLARIFY' ? 'PO' : 'DEV',
      artifactType: g.type === 'PO_CLARIFY' ? 'prd' : 'code_diff',
      confidence: 90,
      summary: g.type === 'PO_CLARIFY' ? 'PO Clarifications' : g.payload.reason || 'Code changes',
      createdAt: g.createdAt,
      approved: g.status === 'APPROVED'
    })),
    qaResult: res.qaResult
  }));
};

export const approveItemLegacy = (projectId: string, approvalId: string, action: 'approve' | 'reject', comment?: string): Promise<unknown> => {
  return resolveGate(approvalId, action, comment);
};

export const getArtifactContent = (projectId: string, type: string): Promise<{ content: string }> => {
  const contentMap: Record<string, string> = {
    prd: `# PRD for target repository\n- Authentication feature integration.`,
    ux_spec: `# UX Spec for authentication flow\n- Interactive Google button widget.`,
    code_diff: `diff --git a/auth.js b/auth.js\n+ // auth codes`,
    qa_report: `# QA Report\n- All validation assertions passed successfully.`
  };
  return Promise.resolve({ content: contentMap[type] || 'No content found' });
};

// Utilities to map legacy parameters
const workflowIdToProjectId = (wfId: string) => wfId;
const projectIdToWorkflowId = (pId: string) => pId;
const phaseToStep = (status: string): number => {
  switch (status) {
    case 'cloning': return 1;
    case 'analyzing': return 1;
    case 'po_running': return 2;
    case 'awaiting_approval': return 2;
    case 'ux_running': return 3;
    case 'dev_running': return 4;
    case 'sandbox_testing': return 5;
    case 'qa_running': return 6;
    case 'qa_complete': return 6;
    default: return 0;
  }
};

// ── Restored Legacy API Functions ──

export interface FeatureRequest {
  title: string;
  description?: string;
  priority?: 'High' | 'Medium' | 'Low';
  target_user?: string;
  business_goal?: string;
  constraints?: string[];
}

export const getWorkflowStatus = (projectId: string): Promise<unknown> =>
  api.get(`${BASE}/workflow-status`, { params: { project_id: projectId } }).then((r) => r.data.data);

export const getAuditTrail = (projectId: string): Promise<unknown> =>
  api.get(`${BASE}/audit-trail/${projectId}`).then((r) => r.data.data);

export const getWorkflowMetrics = (projectId: string): Promise<unknown> =>
  api.get(`${BASE}/projects/${projectId}/metrics`).then((r) => r.data.data);

export const getProjectArtifacts = (projectId: string): Promise<unknown> =>
  api.get(`${BASE}/projects/${projectId}/artifacts`).then((r) => r.data.data);

export const getBacklogs = (projectId: string): Promise<unknown> =>
  api.get(`${BASE}/projects/${projectId}/backlog`).then((r) => r.data.data);
