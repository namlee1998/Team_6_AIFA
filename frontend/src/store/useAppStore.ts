import { create } from 'zustand';
import * as api from '@/services/api';
import type {
  DocumentItem,
  FolderItem,
  ProjectItem,
} from '@/services/api';

export interface DocPreviewCacheItem {
  url: string | null;
  text: string | null;
  docxBuffer: ArrayBuffer | null;
  error: string | null;
}

// =============================================================================
// State
// =============================================================================

interface AppState {
  // --- Documents ---
  documents: DocumentItem[];
  projects: ProjectItem[];
  folders: FolderItem[];
  currentProjectId: string | null;
  currentDocumentId: string | null;
  documentsLoading: boolean;
  treeLoaded: boolean;
  docMgmtSelectedNodeId: string | null;
  docMgmtSelectedDocId: string | null;
  docMgmtPreviewCache: Record<string, DocPreviewCacheItem>;

  // --- UI State ---
  activeTab: string;
  isCreateProjectDialogOpen: boolean;

  // --- Actions: Documents ---
  fetchDocuments: (projectId?: string | null) => Promise<void>;
  fetchTree: () => Promise<void>;
  upsertProject: (project: ProjectItem) => void;
  removeProject: (projectId: string) => void;
  upsertFolder: (folder: FolderItem) => void;
  removeFolder: (folderId: string) => void;
  upsertDocument: (document: DocumentItem) => void;
  removeDocument: (documentId: string) => void;
  setDocMgmtSelection: (nodeId: string | null, docId: string | null) => void;
  setDocMgmtPreviewCache: (documentId: string, value: DocPreviewCacheItem) => void;
  clearDocMgmtPreviewCache: (documentId: string) => void;
  setCurrentProject: (id: string | null) => void;
  setCurrentDocument: (id: string | null) => void;



  // --- Actions: UI ---
  setActiveTab: (tab: string) => void;
  setCreateProjectDialogOpen: (isOpen: boolean) => void;
}

// =============================================================================
// SSE controller (singleton)
// =============================================================================

let sseAbort: AbortController | null = null;

// =============================================================================
// Store
// =============================================================================

export const useAppStore = create<AppState>((set, get) => ({
  // --- Initial state ---
  documents: [],
  projects: [],
  folders: [],
  currentProjectId: localStorage.getItem('currentProjectId'),
  currentDocumentId: null,
  documentsLoading: false,
  treeLoaded: false,
  docMgmtSelectedNodeId: null,
  docMgmtSelectedDocId: null,
  docMgmtPreviewCache: {},



  activeTab: 'documents',
  isCreateProjectDialogOpen: false,

  // --- Documents ---

  fetchDocuments: async (projectId) => {
    const targetProjectId = projectId ?? get().currentProjectId;
    set({ documentsLoading: true });
    try {
      const res = await api.listDocuments({ projectId: targetProjectId ?? undefined });
      set({ documents: res.data, documentsLoading: false });
    } catch {
      set({ documentsLoading: false });
    }
  },

  fetchTree: async () => {
    set({ documentsLoading: true });
    try {
      const res = await api.getDocumentTree();
      const projectId = get().currentProjectId || res.data.projects[0]?.project_id || null;
      if (projectId) {
        localStorage.setItem('currentProjectId', projectId);
      }
      set({
        projects: res.data.projects,
        folders: res.data.folders,
        currentProjectId: projectId,
        documents: res.data.documents,
        documentsLoading: false,
        treeLoaded: true,
      });
    } catch {
      set({ documentsLoading: false });
    }
  },

  upsertProject: (project) =>
    set((state) => {
      const idx = state.projects.findIndex((p) => p.project_id === project.project_id);
      if (idx >= 0) {
        const next = [...state.projects];
        next[idx] = project;
        return { projects: next };
      }
      return { projects: [...state.projects, project] };
    }),

  removeProject: (projectId) =>
    set((state) => {
      const folderIds = new Set(
        state.folders.filter((f) => f.project_id === projectId).map((f) => f.folder_id),
      );
      const removedDocIds = state.documents
        .filter((d) => d.project_id === projectId || (d.folder_id && folderIds.has(d.folder_id)))
        .map((d) => d.document_id);

      const nextPreviewCache = { ...state.docMgmtPreviewCache };
      removedDocIds.forEach((id) => {
        delete nextPreviewCache[id];
      });

      return {
        projects: state.projects.filter((p) => p.project_id !== projectId),
        folders: state.folders.filter((f) => f.project_id !== projectId),
        documents: state.documents.filter((d) => d.project_id !== projectId),
        docMgmtPreviewCache: nextPreviewCache,
        docMgmtSelectedNodeId:
          state.docMgmtSelectedNodeId === `project:${projectId}`
            ? null
            : state.docMgmtSelectedNodeId,
        docMgmtSelectedDocId:
          state.docMgmtSelectedDocId && removedDocIds.includes(state.docMgmtSelectedDocId)
            ? null
            : state.docMgmtSelectedDocId,
      };
    }),

  upsertFolder: (folder) =>
    set((state) => {
      const idx = state.folders.findIndex((f) => f.folder_id === folder.folder_id);
      if (idx >= 0) {
        const next = [...state.folders];
        next[idx] = folder;
        return { folders: next };
      }
      return { folders: [...state.folders, folder] };
    }),

  removeFolder: (folderId) =>
    set((state) => {
      const descendants = new Set<string>();
      const collect = (targetId: string) => {
        descendants.add(targetId);
        state.folders.filter((f) => f.parent_id === targetId).forEach((f) => collect(f.folder_id));
      };
      collect(folderId);

      const removedDocIds = state.documents
        .filter((d) => d.folder_id && descendants.has(d.folder_id))
        .map((d) => d.document_id);
      const nextPreviewCache = { ...state.docMgmtPreviewCache };
      removedDocIds.forEach((id) => {
        delete nextPreviewCache[id];
      });

      return {
        folders: state.folders.filter((f) => !descendants.has(f.folder_id)),
        documents: state.documents.filter((d) => !(d.folder_id && descendants.has(d.folder_id))),
        docMgmtPreviewCache: nextPreviewCache,
        docMgmtSelectedNodeId:
          state.docMgmtSelectedNodeId &&
          Array.from(descendants).some((id) => state.docMgmtSelectedNodeId === `folder:${id}`)
            ? null
            : state.docMgmtSelectedNodeId,
        docMgmtSelectedDocId:
          state.docMgmtSelectedDocId && removedDocIds.includes(state.docMgmtSelectedDocId)
            ? null
            : state.docMgmtSelectedDocId,
      };
    }),

  upsertDocument: (document) =>
    set((state) => {
      const idx = state.documents.findIndex((d) => d.document_id === document.document_id);
      if (idx >= 0) {
        const next = [...state.documents];
        next[idx] = document;
        return { documents: next };
      }
      return { documents: [...state.documents, document] };
    }),

  removeDocument: (documentId) =>
    set((state) => {
      const nextPreviewCache = { ...state.docMgmtPreviewCache };
      delete nextPreviewCache[documentId];
      return {
        documents: state.documents.filter((d) => d.document_id !== documentId),
        docMgmtPreviewCache: nextPreviewCache,
        docMgmtSelectedNodeId:
          state.docMgmtSelectedNodeId === `file:${documentId}` ? null : state.docMgmtSelectedNodeId,
        docMgmtSelectedDocId:
          state.docMgmtSelectedDocId === documentId ? null : state.docMgmtSelectedDocId,
      };
    }),

  setDocMgmtSelection: (nodeId, docId) =>
    set({ docMgmtSelectedNodeId: nodeId, docMgmtSelectedDocId: docId }),

  setDocMgmtPreviewCache: (documentId, value) =>
    set((state) => ({
      docMgmtPreviewCache: {
        ...state.docMgmtPreviewCache,
        [documentId]: value,
      },
    })),

  clearDocMgmtPreviewCache: (documentId) =>
    set((state) => {
      const next = { ...state.docMgmtPreviewCache };
      delete next[documentId];
      return { docMgmtPreviewCache: next };
    }),

  setCurrentProject: (id) => {
    const current = get().currentProjectId;
    // Do not reset if project is not changed
    if (current === id) return;

    // Stop SSE if running
    if (sseAbort) {
      sseAbort.abort();
      sseAbort = null;
    }

    // Clear backend session state (fire-and-forget). Previously called
    // api.deleteSessionState, which lived in flowsApi and was removed when
    // that file was deleted as part of the SSE transport refactor. Nothing
    // else depends on this state, so we drop the call.

    if (id) localStorage.setItem('currentProjectId', id);
    else localStorage.removeItem('currentProjectId');

    set({
      currentProjectId: id,
      docMgmtSelectedDocId: null,
      currentDocumentId: null,
    });
  },

  setCurrentDocument: (id) => set({ currentDocumentId: id }),


  // --- UI ---

  setActiveTab: (tab) => set({ activeTab: tab }),
  setCreateProjectDialogOpen: (isOpen) => set({ isCreateProjectDialogOpen: isOpen }),
}));
