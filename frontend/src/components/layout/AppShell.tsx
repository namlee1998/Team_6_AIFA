import React, { useEffect, useState, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppSidebar } from './AppSidebar';
import { useApiActions } from '@/hooks/useApiActions';
import { useAppStore } from '@/store';
import { NotFoundPage } from '@/pages/NotFound';
const SdlcDashboard = lazy(() => import('@/pages/SdlcDashboard'));
const OverviewPage = lazy(() => import('@/pages/SdlcDashboard/OverviewPage'));
import { AppTopBar } from './AppTopBar';
import { useUiStore } from '@/store/useUiStore';
import { FeatureRequestProjectDialog } from './dialogs/FeatureRequestProjectDialog';
import { ImportProjectDialog } from './dialogs/ImportProjectDialog';


export const AppShell: React.FC = () => {
  const { t } = useTranslation();
  const api = useApiActions();
  const {
    projects,
    currentProjectId,
    treeLoaded,
    fetchTree,
    setCurrentProject,
    upsertProject,
    removeProject,
    isCreateProjectDialogOpen,
    setCreateProjectDialogOpen,
  } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();
  const isFeatureRequestFormOpen = useUiStore((s) => s.isFeatureRequestFormOpen);
  const closeFeatureRequestForm = useUiStore((s) => s.closeFeatureRequestForm);

  // Handle feature request form navigation when project is already selected.
  // Always (re)navigate with focusRequest=true — even when already on the
  // Build Dashboard — since the chatbox visibility is driven purely by that
  // URL param, not by this flag. Previously this skipped the navigate call
  // when already on /sdlc/build, so the flag flipped true→false without ever
  // setting focusRequest, leaving the "new feature request" button inert.
  useEffect(() => {
    if (!isFeatureRequestFormOpen || !currentProjectId) return;
    navigate('/sdlc/build?focusRequest=true');
    closeFeatureRequestForm();
  }, [isFeatureRequestFormOpen, currentProjectId, navigate, closeFeatureRequestForm]);
  const isDefaultRoute = location.pathname === '/sdlc' || location.pathname === '/sdlc/'; // → OverviewPage
  const isBuildRoute = location.pathname === '/sdlc/build' || location.pathname === '/sdlc/build/';
  // T4 (B3) — per spec §8.2, Audit Trail is gone. Runtime Log is the single
  // timeline. Old /sdlc/audit URLs redirect to the build dashboard instead of
  // 404'ing old bookmarks.
  const isLegacyAuditRoute = location.pathname === '/sdlc/audit' || location.pathname === '/sdlc/audit/';
  const isRemovedTabRoute = location.pathname.startsWith('/sdlc/debug') || location.pathname.startsWith('/sdlc/agents');
  const isUnknownAppRoute = location.pathname.startsWith('/sdlc/')
    && location.pathname !== '/sdlc/' && location.pathname !== '/sdlc'
    && !isBuildRoute && !isLegacyAuditRoute && !isRemovedTabRoute;

  useEffect(() => {
    if (isRemovedTabRoute || isLegacyAuditRoute) navigate('/sdlc/build', { replace: true });
  }, [isRemovedTabRoute, isLegacyAuditRoute, navigate]);

  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    return localStorage.getItem('project-panel-collapsed') === 'true';
  });
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [projectActionMessage, setProjectActionMessage] = useState<string | null>(null);


  useEffect(() => {
    if (!treeLoaded) void fetchTree();
  }, [fetchTree, treeLoaded]);

  function handleToggleCollapse() {
    const next = !panelCollapsed;
    setPanelCollapsed(next);
    localStorage.setItem('project-panel-collapsed', String(next));
  }

  async function handleCreateProject(name: string, url: string) {
    const res = await api.createProject(name);
    upsertProject(res.data);

    // AIFA v2.1 §4: the workflow entry is a Git Repository URL. Folder
    // uploads are no longer part of the execution-flow entry — the dialog
    // collects only the URL, which the workflow uses to start via
    // POST /run-architecture-agent.
    localStorage.setItem(`repoUrl_${res.data.project_id}`, url);
    setCurrentProject(res.data.project_id);
    setCreateProjectDialogOpen(false);
    // errors propagate up to ImportProjectDialog which displays them inline
  }

  useEffect(() => {
    if (!projectActionMessage) return;
    const timeout = window.setTimeout(() => setProjectActionMessage(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [projectActionMessage]);

  async function handleDeleteProject(projectId: string) {
    const project = projects.find((item) => item.project_id === projectId);

    setDeletingProjectId(projectId);
    try {
      await api.deleteProject(projectId);
      removeProject(projectId);
      if (currentProjectId === projectId) {
        const fallbackId = projects.find((item) => item.project_id !== projectId)?.project_id || null;
        setCurrentProject(fallbackId);
      }
      setPendingDeleteProjectId(null);
      setProjectActionMessage(t('layout.projectActionDeleted', { name: project?.name || 'project' }));
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } }; message?: string })
        .response?.data?.message || (error as Error).message || t('layout.projectActionDeleteFailed');
      setProjectActionMessage(message);
    } finally {
      setDeletingProjectId(null);
    }
  }

  const panelProjects = projects.map((p) => ({ id: p.project_id, name: p.name, role: p.role }));

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background dark">
      <AppTopBar />

      <div className="flex flex-1 min-h-0">
        <AppSidebar
          projects={panelProjects}
          activeProjectId={currentProjectId}
          onSelectProject={setCurrentProject}
          onCreateProject={() => setCreateProjectDialogOpen(true)}
          onDeleteProject={setPendingDeleteProjectId}
          deletingProjectId={deletingProjectId}
          collapsed={panelCollapsed}
          onToggleCollapse={handleToggleCollapse}
        />

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 overflow-y-auto">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-slate-500 text-sm animate-pulse">Loading module...</div>}>
              {isUnknownAppRoute ? (
                <NotFoundPage mode="panel" />
              ) : isDefaultRoute ? (
                <div className="flex flex-col h-full bg-background">
                  <OverviewPage />
                </div>
              ) : isBuildRoute || isRemovedTabRoute ? (
                <div className="flex flex-col h-full bg-background">
                  <SdlcDashboard />
                </div>
              ) : (
                <div className="flex flex-col h-full bg-background">
                  <SdlcDashboard />
                </div>
              )}
            </Suspense>
          </div>
        </main>
      </div>

      {isCreateProjectDialogOpen && (
        <ImportProjectDialog
          onCancel={() => setCreateProjectDialogOpen(false)}
          onSubmit={handleCreateProject}
        />
      )}

      {isFeatureRequestFormOpen && !currentProjectId && (
        <FeatureRequestProjectDialog
          projects={panelProjects}
          onCancel={() => closeFeatureRequestForm()}
          onSelect={(projectId) => {
            setCurrentProject(projectId);
            closeFeatureRequestForm();
            navigate('/sdlc/build?focusRequest=true');
          }}
        />
      )}

      {projectActionMessage && (
        <div className="fixed bottom-5 right-5 z-[1000] rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-3 text-xs font-semibold text-on-surface shadow-xl">
          {projectActionMessage}
        </div>
      )}

      {pendingDeleteProjectId && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-outline-variant bg-surface-container-lowest p-5 shadow-2xl">
            <h2 className="text-base font-bold text-on-surface">{t('layout.deleteProjectConfirm')}</h2>
            <p className="mt-2 text-sm text-on-surface-variant">
              {t('layout.deleteProjectDesc', { name: projects.find((item) => item.project_id === pendingDeleteProjectId)?.name || 'this project' })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-outline-variant px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-variant"
                onClick={() => setPendingDeleteProjectId(null)}
                disabled={deletingProjectId !== null}
              >
                {t('layout.cancel')}
              </button>
              <button
                type="button"
                className="rounded-lg bg-error px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                onClick={() => void handleDeleteProject(pendingDeleteProjectId)}
                disabled={deletingProjectId !== null}
              >
                {deletingProjectId ? t('layout.deleting') : t('layout.confirmDeleteBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
