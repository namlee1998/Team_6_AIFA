/**
 * useUiStore — presentation-only state.
 *
 * This store owns everything that is purely UI presentation: which session is
 * active, which tab the inspector shows, whether the sidebar is collapsed,
 * modal visibility. None of this is workflow state.
 *
 * Workflow/session data lives in `useWorkflowStore`.
 */

import { create } from 'zustand';

export type InspectorTab = 'questions' | 'review' | 'decisions';

export interface UiState {
  // Active session within the workflow. Workflow data lives elsewhere;
  // this is just which session is "focused" right now.
  activeSessionId: string | null;

  // Inspector panel on Agent Tasks page.
  inspectorTab: InspectorTab;

  // Sidebar/rail UI flags.
  sidebarCollapsed: boolean;
  showArchivedSessions: boolean;
  sessionBrowserQuery: string;

  // Agent column + HITL focus inside Agent Tasks.
  selectedAgentKey: import('@/models/SessionState').AgentKey | null;
  selectedGateId: string | null;
  selectedArtifact: { agent: import('@/models/SessionState').AgentKey; taskId: string } | null;

  // Modal/panel visibility.
  isFeatureRequestFormOpen: boolean;
  isAgentDetailDrawerOpen: boolean;
  isReleaseDialogOpen: boolean;

  // Actions.
  setActiveSession(id: string | null): void;
  setInspectorTab(tab: InspectorTab): void;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebar(): void;
  setShowArchivedSessions(show: boolean): void;
  setSessionBrowserQuery(query: string): void;

  setSelectedAgentKey(key: import('@/models/SessionState').AgentKey | null): void;
  setSelectedGateId(id: string | null): void;
  setSelectedArtifact(artifact: UiState['selectedArtifact']): void;

  openFeatureRequestForm(): void;
  closeFeatureRequestForm(): void;
  openAgentDetailDrawer(): void;
  closeAgentDetailDrawer(): void;
  openReleaseDialog(): void;
  closeReleaseDialog(): void;

  resetUi(): void;
}

export const useUiStore = create<UiState>((set) => ({
  activeSessionId: null,
  inspectorTab: 'questions',
  sidebarCollapsed: false,
  showArchivedSessions: false,
  sessionBrowserQuery: '',
  selectedAgentKey: null,
  selectedGateId: null,
  selectedArtifact: null,
  isFeatureRequestFormOpen: false,
  isAgentDetailDrawerOpen: false,
  isReleaseDialogOpen: false,

  setActiveSession: (id) => set({ activeSessionId: id }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setShowArchivedSessions: (show) => set({ showArchivedSessions: show }),
  setSessionBrowserQuery: (query) => set({ sessionBrowserQuery: query }),

  setSelectedAgentKey: (key) => set({ selectedAgentKey: key }),
  setSelectedGateId: (id) => set({ selectedGateId: id }),
  setSelectedArtifact: (artifact) => set({ selectedArtifact: artifact }),

  openFeatureRequestForm: () => set({ isFeatureRequestFormOpen: true }),
  closeFeatureRequestForm: () => set({ isFeatureRequestFormOpen: false }),
  openAgentDetailDrawer: () => set({ isAgentDetailDrawerOpen: true }),
  closeAgentDetailDrawer: () => set({ isAgentDetailDrawerOpen: false }),
  openReleaseDialog: () => set({ isReleaseDialogOpen: true }),
  closeReleaseDialog: () => set({ isReleaseDialogOpen: false }),

  resetUi: () =>
    set({
      activeSessionId: null,
      inspectorTab: 'questions',
      selectedAgentKey: null,
      selectedGateId: null,
      selectedArtifact: null,
      isAgentDetailDrawerOpen: false,
      isReleaseDialogOpen: false,
    }),
}));
