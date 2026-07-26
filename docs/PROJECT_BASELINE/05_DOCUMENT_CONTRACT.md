# 05 — Document Contract

> **Status:** FROZEN.
> **Effective from:** 2026-07-18.
> **Authority:** Permanent reference document.
> **Source of truth:** `docs/obs7/04_DOCUMENT_VERIFICATION.md`.

---

## Canonical Owner

**Backend:**

- `backend/src/controllers/DocumentController.js` (HTTP handlers)
- `backend/src/services/DocumentService.js` (business logic)
- `backend/src/models/Document.js` (Prisma row)
- `backend/src/routes/documents.js` (Multer cap reads `MAX_FILE_SIZE`)

**Frontend:**

- `frontend/src/services/api/documentsApi.ts` (8 functions)
- `frontend/src/services/api/projectsApi.ts` (12 functions)
- `frontend/src/services/api/foldersApi.ts` (5 functions)
- `frontend/src/services/api/treeApi.ts` (1 function)
- `frontend/src/services/api.ts` (barrel re-export)
- `frontend/src/hooks/useApiActions.ts` (4 functions consumed by AppShell)
- `frontend/src/store/useAppStore.ts` (`documents`,
  `docMgmtPreviewCache`, etc.)

## Source of Truth

- `backend/prisma/schema.prisma` — `Document` model with
  `@@index([projectId])`.
- `backend/src/controllers/DocumentController.js` — 9 HTTP routes.
- `backend/src/services/DocumentService.js` — `moveDocument` (single
  Prisma update), `detectFileKind` (helper), `getSignedUrl` (one DB read),
  `getContent` (415 for binary mimes), `uploadDocument` (DB row first,
  file second), `renameDocument` (409 on collision), `moveDocument`
  (EXDEV fallback).
- `frontend/src/services/api/types.ts` — `DocumentItem` shape with
  `status: 'uploaded' | 'failed'`.
- `frontend/src/store/useAppStore.ts` — clears `docMgmtPreviewCache` on
  `setCurrentProject`; dedupes `upsertDocument` by `(project_id, file_name)`.

## Producer

| Surface | Producer | File |
| ------- | -------- | ---- |
| HTTP routes | `DocumentController` | `backend/src/controllers/DocumentController.js` |
| Business logic | `DocumentService` | `backend/src/services/DocumentService.js` |
| Durable row | `DocumentModel` | `backend/src/models/Document.js` |
| FE HTTP wrappers | `documentsApi`, `projectsApi`, `foldersApi`, `treeApi` | `frontend/src/services/api/*.ts` |
| FE store | `useAppStore` | `frontend/src/store/useAppStore.ts` |

## Consumer

| Consumer | Reads | File |
| -------- | ----- | ---- |
| AppShell | `useAppStore.{projects, folders, documents}` | `frontend/src/components/layout/AppShell.tsx` |
| AppSidebar | `useAppStore.{projects, folders}` | `frontend/src/components/layout/AppSidebar.tsx` |
| Document viewer | `documentsApi.getDocument`, `getDocumentContent`, `getDocumentPreview` | `frontend/src/pages/DocumentViewer/**` |
| File tree | `treeApi.getDocumentTree` | `frontend/src/pages/FileTree/**` |
| FeatureRequestChatbox | `documentsApi.uploadDocument` | `frontend/src/pages/SdlcDashboard/components/FeatureRequestChatbox.tsx` |

## Invariants

The 9-route HTTP surface (`obs7/04_DOCUMENT_VERIFICATION.md` §3.1):

| Method | Path |
| ------ | ---- |
| POST | `/api/v1/documents/upload` |
| GET | `/api/v1/documents` |
| GET | `/api/v1/documents/:id` |
| GET | `/api/v1/documents/:id/preview` |
| GET | `/api/v1/documents/:id/download` |
| GET | `/api/v1/documents/:id/content` |
| PATCH | `/api/v1/documents/:id` |
| PATCH | `/api/v1/documents/:id/move` |
| DELETE | `/api/v1/documents/:id` |

The `DocumentItem` shape (FROZEN):

```ts
interface DocumentItem {
  document_id: string;
  project_id: string;
  folder_id?: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  status: 'uploaded' | 'failed';
  created_at: string;
}
```

The Prisma schema (FROZEN): no `version` column, no `published` column,
single-version per row, `@@index([projectId])`.

Additional invariants:

1. **One canonical API per domain** — Documents / projects / folders /
   tree each have a single `*Api.ts` file.
2. **`moveDocument` writes the row once** — single Prisma update.
3. **Upload write order is correct** — DB row first, file second;
   on failure, the row is cleaned up.
4. **Path traversal is blocked** — download refuses anything outside
   `uploadsDir` (403).
5. **Binary content refuses extraction** — `/content` returns 415
   for image / video / audio.
6. **`docMgmtPreviewCache` is cleared on `setCurrentProject`** (Patch D-F).
7. **`upsertDocument` dedupes by `(project_id, file_name)`** (Patch D-L).

## Forbidden Ownership

- A second API file for documents, projects, folders, or tree.
- A second `DocumentService.js` instance (singleton enforced).
- Reading `status` outside `'uploaded' | 'failed'`.
- Reading a `version` column on `Document` (no such column exists).
- Adding a `published` column (no such column exists).
- Preview URL auth (`/preview` is local-only; multi-tenant signed-URL
  is deferred — D-D17).

## Related OBS

- **OBS-7** — `docs/obs7/04_DOCUMENT_VERIFICATION.md` (freezes the
  contract; 24 of 25 drifts resolved; D-D17 deferred).

## Related Implementation Files

- `backend/prisma/schema.prisma`
- `backend/src/controllers/DocumentController.js`
- `backend/src/services/DocumentService.js`
- `backend/src/models/Document.js`
- `backend/src/routes/documents.js`
- `backend/src/services/FolderService.js`
- `backend/src/services/ProjectService.js`
- `backend/src/services/TreeService.js`
- `backend/src/controllers/{Folder,Project,Tree}Controller.js`
- `backend/src/routes/{folders,projects,tree}.js`
- `frontend/src/services/api.ts`
- `frontend/src/services/api/documentsApi.ts`
- `frontend/src/services/api/projectsApi.ts`
- `frontend/src/services/api/foldersApi.ts`
- `frontend/src/services/api/treeApi.ts`
- `frontend/src/services/api/types.ts`
- `frontend/src/store/useAppStore.ts`
- `frontend/src/hooks/useApiActions.ts`

End of Document Contract.
