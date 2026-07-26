/**
 * OverviewPage — monitoring view of all running workflows.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { OverviewPage } from '@/pages/SdlcDashboard/OverviewPage';
import { AGENT_KEYS } from '@/models/SessionState';

const sessions: ReturnType<typeof makeSession>[] = [];
let connectionStatus: 'idle' | 'connecting' | 'connected' | 'error' = 'connected';

function makeSession(overrides: Record<string, unknown> = {}) {
  const emptyAgents = Object.fromEntries(
    AGENT_KEYS.map((k) => [k, {
      agent: k, status: 'idle', currentStep: null, currentAction: null,
      currentFile: null, toolName: null, startedAt: null, completedAt: null, lastEventAt: null,
    }]),
  );
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
    agentStates: emptyAgents,
    pendingGates: [
      {
        id: 'gate-1',
        type: 'PO_CLARIFY',
        role: 'po-agent',
        createdAt: new Date().toISOString(),
        payload: { questions: [{ question: 'Login method?' }] },
      },
    ],
    selectedGateId: null,
    gateHistory: [],
    auditLog: [],
    runtimeEvents: [],
    qaResult: null,
    releaseStatus: 'pending',
    repoInfo: null,
    featureRequest: 'add google login',
    repoUrl: 'https://github.com/test/repo.git',
    ...overrides,
  };
}

const uiStoreShape: Record<string, unknown> = {
  openFeatureRequestForm: () => {},
  setActiveSession: () => {},
  setInspectorTab: () => {},
  setSelectedGateId: () => {},
};

vi.mock('@/store/useUiStore', () => ({
  useUiStore: Object.assign(
    vi.fn((selector?: (s: typeof uiStoreShape) => unknown) =>
      typeof selector === 'function' ? selector(uiStoreShape) : uiStoreShape,
    ),
    { getState: () => uiStoreShape },
  ),
}));

vi.mock('@/store/useWorkflowStore', () => ({
  useWorkflowStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const fakeState = {
      sessions: sessions.reduce<Record<string, unknown>>((acc, s) => ({ ...acc, [s.sessionId]: s }), {}),
      sseConnections: { 'sess-1': connectionStatus },
      sseAbortControllers: {},
    };
    if (typeof selector === 'function') return selector(fakeState);
    return fakeState;
  }),
  selectAllSessions: () => sessions,
  selectConnectionStatus: () => connectionStatus,
  selectActiveSessionId: () => null,
  selectAllPendingGates: () => [],
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.length = 0;
    connectionStatus = 'connected';
  });

  it('shows empty state when there are no sessions', () => {
    render(<MemoryRouter><OverviewPage /></MemoryRouter>);
    expect(screen.getByText('Workflow Overview')).toBeInTheDocument();
    expect(screen.getByText('No workflows yet')).toBeInTheDocument();
  });

  it('lists sessions with pending-gate badges and connection pill', () => {
    const session = makeSession();
    sessions.push(session);

    render(<MemoryRouter><OverviewPage /></MemoryRouter>);

    expect(screen.getByText('Workflow Overview')).toBeInTheDocument();
    expect(screen.getByText('add google login')).toBeInTheDocument();
    expect(screen.getByText(/1 gate/i)).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('does not render a runtime log on the overview', () => {
    const session = makeSession();
    sessions.push(session);

    render(<MemoryRouter><OverviewPage /></MemoryRouter>);

    // "Runtime log" is the inspector tab title on Agent Tasks — should not
    // appear here.
    expect(screen.queryByText(/Runtime log/i)).not.toBeInTheDocument();
  });
});
