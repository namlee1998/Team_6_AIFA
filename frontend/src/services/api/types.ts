// =============================================================================
// TypeScript interfaces - matching API contract & Backend responses
// =============================================================================

// --- Documents ---

export interface UploadDocumentResponse {
  status: 'success';
  data: {
    document_id: string;
    file_name: string;
    file_type: string;
  };
}

export interface DocumentItem {
  document_id: string;
  project_id: string;
  folder_id?: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  status: 'uploaded' | 'processing' | 'processed' | 'failed';
  created_at: string;
}

export interface ProjectItem {
  project_id: string;
  name: string;
  role?: ProjectRole;
  created_at: string;
  updated_at: string;
}

export type ProjectRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface ProjectMemberItem {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  invited_by: string | null;
  joined_at: string;
  created_at: string;
  email: string | null;
  full_name: string | null;
}

export interface ProjectInvitationItem {
  invitation_id: string;
  project_id: string;
  project_name: string | null;
  email: string;
  role: Exclude<ProjectRole, 'owner'>;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invited_by: string;
  expires_at: string;
  created_at: string;
}

export interface FolderItem {
  folder_id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ListDocumentsResponse {
  status: 'success';
  data: DocumentItem[];
  total: number;
}

export interface ListProjectsResponse {
  status: 'success';
  data: ProjectItem[];
}

export interface ListFoldersResponse {
  status: 'success';
  data: FolderItem[];
}

export interface TreeResponse {
  status: 'success';
  data: {
    projects: ProjectItem[];
    folders: FolderItem[];
    documents: DocumentItem[];
  };
}

export interface DocumentPreviewResponse {
  status: 'success';
  data: {
    url: string;
    file_type: string;
    file_name: string;
  };
}

export interface DocumentContentResponse {
  status: 'success';
  data: {
    content: string;
    file_type: string;
    file_name: string;
  };
}

// --- Tasks / Workflows ---

export type TaskType = 'extract-flows' | 'generate-testcases' | 'generate-automation';

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ObservabilityInfo {
  provider?: string | null;
  session_id?: string | null;
  trace_url?: string | null;
  model?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  failed_at?: string | null;
  latency_ms?: number | null;
  error?: string | null;
}

export interface TaskItem {
  task_id: string;
  type: TaskType;
  status: TaskStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  document?: {
    id: string;
    fileName: string;
    fileType: string;
  };
  artifacts?: AgentArtifactItem[];
  testcases?: TestcaseItem[];
  version_status?: 'draft' | 'committed';
  input_content_hash?: string | null;
  output_content_hash?: string | null;
  source_run_id?: string | null;
  observability?: ObservabilityInfo | null;
}

export interface AgentArtifactItem {
  id: string;
  taskId: string;
  projectId: string;
  agentType: 'agent1' | 'agent2' | 'agent3';
  artifactType: 'flow' | 'raw_markdown' | 'scenario' | 'yaml';
  artifactKey: string;
  title: string | null;
  contentJson: Record<string, unknown> | null;
  contentText: string | null;
  ordinal: number;
  sourceArtifactId: string | null;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowTaskSummary {
  task_id: string;
  type: TaskType;
  status: TaskStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  observability?: ObservabilityInfo | null;
}

export interface TestcaseItem {
  id: string;
  taskId: string;
  featureName: string;
  flowName: string;
  scenarioData: Record<string, unknown> | null;
  automationYaml: string | null;
  yamlFilename: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Agent 1: Extract Flows ---

export interface ExtractFlowsRequest {
  project_id: string;
  document_ids: string[];
  prompt_profile?: string;
  feedback_prompt?: string;
}

export interface ExtractFlowsResponse {
  task_id: string;
  status: TaskStatus;
}

// --- Agent 1: Resolve Unknowns ---

export interface UnknownResolution {
  unknown_text: string;
  user_feedback: string;
}

export interface ResolveUnknownsRequest {
  task_id: string;
  resolutions: UnknownResolution[];
}

export interface ResolveUnknownsResponse {
  status: 'success';
  data: {
    task_id: string;
    status: TaskStatus;
    result: Record<string, unknown>;
  };
}

// --- Agent 2: Generate Testcases ---

export interface GenerateTestcasesRequest {
  task_id: string;
  feedback_prompt?: string;
  selected_flow_names?: string[];
  previous_task_id?: string;
}

export interface GenerateTestcasesResponse {
  task_id: string;
  status: TaskStatus;
}

// --- Agent 3: Generate Automation ---

export interface GenerateAutomationRequest {
  task_id: string;
  framework?: string;
  feedback_prompt?: string;
  selected_scenario_ids?: string[];
  previous_task_id?: string;
}

export interface GenerateAutomationResponse {
  task_id: string;
  status: TaskStatus;
}

export interface YamlFile {
  filename: string;
  content: string;
}

// --- SSE Events (parsed from event-stream) ---

export interface SSEProgressEvent {
  event: 'progress';
  data: {
    step: string;
    status?: string;
    log?: string;
  };
}

export interface SSECompletedEvent {
  event: 'completed';
  data: Record<string, unknown>;
}

export interface SSEPartialEvent {
  event: 'partial';
  data: {
    artifacts?: AgentArtifactItem[];
    testcases: TestcaseItem[];
  };
}

export interface SSEErrorEvent {
  event: 'error';
  data: {
    message: string;
  };
}

export type SSEEvent = SSEProgressEvent | SSEPartialEvent | SSECompletedEvent | SSEErrorEvent;

// --- Session State ---

export interface SessionState {
  id: string;
  page: string;
  selectedDocIds: string[];
  taskId: string | null;
  metadata: {
    lastRunAt?: string;
    flowCount?: number;
    featureCount?: number;
    docCount?: number;
    projectId?: string;
    sourceTaskId?: string;
    selectedSourceTaskId?: string;
    inputTaskHistory?: string[];
    inputSignature?: string;
    inputFlowKeys?: string[];
    inputCapturedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}
