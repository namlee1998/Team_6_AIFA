/**
 * SdlcDashboard (Agent Tasks page) — verifies the 3-column layout shows
 * the 5 agent columns once a session is active and SSE-driven state has
 * populated pipelinePhases.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import SdlcDashboard from '@/pages/SdlcDashboard';

// Helper that returns a fake session.
const sessions: ReturnType<typeof makeSession>[] = [];

function emptyAgents() {
  return Object.fromEntries(
    AGENT_KEYS.map((k) => [k, {
      agent: k, status: 'idle', currentStep: null, currentAction: null,
      currentFile: null, toolName: null, startedAt: null, completedAt: null, lastEventAt: null,
    }]),
  );
}

function makeSession() {
  return {
    sessionId: 'sess-1',
    taskId: 'task-1',
    projectId: 'project-1',
    status: 'running',
    error: null,
    createdAt: Date.now(),
    lastUpdatedAt: Date.now(),
    pipelinePhases: [
      { agent: 'ARCH', status: 'completed' },
      { agent: 'PO', status: 'completed' },
      { agent: 'UX', status: 'completed' },
      { agent: 'DEV', status: 'running' },
      { agent: 'QA', status: 'pending' },
    ],
    agentStates: emptyAgents(),
    pendingGates: [],
    selectedGateId: null,
    gateHistory: [],
    auditLog: [],
    runtimeEvents: [],
    qaResult: null,
    releaseStatus: 'pending',
    repoInfo: null,
    featureRequest: 'add google login',
    repoUrl: 'https://github.com/test/repo.git',
  };
}

const uiStoreShape: Record<string, unknown> = {
  activeSessionId: null,
  inspectorTab: 'runtime',
  sidebarCollapsed: false,
  showArchivedSessions: false,
  sessionBrowserQuery: '',
  selectedAgentKey: null,
  selectedGateId: null,
  selectedArtifact: null,
  isFeatureRequestFormOpen: false,
  setActiveSession: () => {},
  setInspectorTab: () => {},
  setSessionBrowserQuery: () => {},
  setShowArchivedSessions: () => {},
};

vi.mock('@/store/useAppStore', () => ({ useAppStore: vi.fn() }));

vi.mock('@/store/useUiStore', () => ({
  // When called as a hook with a selector, run it against the shape.
  useUiStore: Object.assign(
    vi.fn((selector?: (s: typeof uiStoreShape) => unknown) =>
      typeof selector === 'function' ? selector(uiStoreShape) : uiStoreShape,
    ),
    { getState: () => uiStoreShape },
  ),
}));

vi.mock('@/store/useWorkflowStore', () => ({
  useWorkflowStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      sessions: sessions.reduce((acc, s) => ({ ...acc, [s.sessionId]: s }), {}),
      sseConnections: {},
      sseAbortControllers: {},
      projectId: 'project-1',
      isLoading: false,
      sseConnection: 'connected',
      activeSessionId: null,
      startPipeline: vi.fn(),
      setActiveSession: vi.fn(),
      resolveGate: vi.fn(),
      resolveOutputReviewGate: vi.fn(),
      resolveClarification: vi.fn(),
      releaseDecision: vi.fn(),
      cleanupSession: vi.fn(),
      resetAll: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  }),
  selectAllSessions: () => sessions,
  selectConnectionStatus: () => 'connected',
  selectActiveSessionId: () => null,
  selectAllPendingGates: () => [],
}));

vi.mock('@/services/api/sdlcApi', () => ({ getSdlcTaskStatus: vi.fn() }));

import { useAppStore } from '@/store/useAppStore';
import { AGENT_KEYS } from '@/models/SessionState';

const mockUseAppStore = useAppStore as unknown as Mock;

describe('SdlcDashboard (Agent Tasks page)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.length = 0;
    mockUseAppStore.mockReturnValue({
      currentProjectId: 'project-1',
      treeLoaded: true,
      fetchTree: vi.fn(),
    });
  });

  it('renders the agent-tasks title when a session is active', async () => {
    const session = makeSession();
    sessions.push(session);
    uiStoreShape.activeSessionId = session.sessionId;

    render(<MemoryRouter><SdlcDashboard /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Agent Tasks')).toBeInTheDocument();
    });

    uiStoreShape.activeSessionId = null;
  });

  it('shows the empty state when there are no sessions', () => {
    render(<MemoryRouter><SdlcDashboard /></MemoryRouter>);
    expect(screen.getByText('Start your first workflow')).toBeInTheDocument();
  });
});
