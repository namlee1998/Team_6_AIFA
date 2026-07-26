import { useMemo } from 'react';
import * as api from '@/services/api';

export function useApiActions() {
  return useMemo(
    () => ({
      createProject: api.createProject,
      createFolder: api.createFolder,
      deleteDocument: api.deleteDocument,
      deleteFolder: api.deleteFolder,
      deleteProject: api.deleteProject,
      generateAutomation: api.generateAutomation,
      generateTestcases: api.generateTestcases,
      getDocument: api.getDocument,
      getDocumentContent: api.getDocumentContent,
      getDocumentPreview: api.getDocumentPreview,
      moveDocument: api.moveDocument,
      moveFolder: api.moveFolder,
      renameDocument: api.renameDocument,
      renameFolder: api.renameFolder,
      renameProject: api.renameProject,
      uploadDocument: api.uploadDocument,
    }),
    [],
  );
}
