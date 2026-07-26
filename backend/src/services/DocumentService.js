const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Document, Project, Folder } = require('../models');
const SessionState = require('../models/SessionState');
const MembershipService = {
  requireProjectRole: async () => ({ role: 'owner' }),
  listAccessibleProjectIds: async () => {
    const projects = await Project.list();
    return projects.map((p) => p.id);
  },
};
const { MAX_FILE_SIZE } = require('../config/environment');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const { ApiError } = require('../middleware/errorHandler');

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

class DocumentService {
  /**
   * Upload file to local storage and create document record
   * @param {Object} file - Multer file object
   * @param {string} projectId
   * @param {string|null} folderId - Optional folder ID
   * @returns {Promise<Object>} Document record
   */
  async uploadFile(file, projectId, folderId = null, user) {
    if (!projectId) {
      throw new ApiError(400, 'project_id is required');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }
    await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor']);

    const project = await Project.findById(projectId);
    if (!project) {
      throw new ApiError(404, 'Project not found');
    }

    if (folderId) {
      const folder = await Folder.findById(folderId);
      if (!folder) {
        throw new ApiError(404, 'Folder not found');
      }
      if (folder.projectId !== projectId) {
        throw new ApiError(400, 'folder_id does not belong to project_id');
      }
    }

    const documentId = uuidv4();
    const extension = file.originalname.split('.').pop();
    const storagePath = `${projectId}/${folderId || 'root'}/${documentId}.${extension}`;
    const fullPath = path.join(UPLOADS_DIR, storagePath);

    // Save to local disk
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.buffer);

    // Create document record
    const document = await Document.create({
      id: documentId,
      projectId,
      fileName: file.originalname,
      fileType: file.mimetype,
      filePath: storagePath,
      fileSize: file.size,
      folderId,
      status: 'uploaded',
    });

    return document;
  }

  /**
   * Get document by ID
   * @param {string} documentId
   * @returns {Promise<Object|null>} Document record
   */
  async getDocumentById(documentId, user) {
    const document = await Document.findById(documentId);
    if (document && user) {
      await MembershipService.requireProjectRole(user.id, document.projectId, ['owner', 'admin', 'editor', 'viewer']);
    }
    return document;
  }

  /**
   * Get preview/download URL for a document
   * @param {string} documentId
   * @param {number} expiresIn - URL expiry in seconds (ignored for local files)
   * @returns {Promise<{url: string}>} Local download URL
   */
  async getSignedUrl(documentId, expiresIn = 3600, user) {
    const document = await Document.findById(documentId);
    if (!document) {
      throw new Error('Document not found');
    }
    if (user) {
      await MembershipService.requireProjectRole(user.id, document.projectId, ['owner', 'admin', 'editor', 'viewer']);
    }

    // Local-first preview url served from the backend download route
    return { url: `/api/v1/documents/${document.id}/download` };
  }

  /**
   * Download file content from local storage as text
   * @param {string} documentId
   * @returns {Promise<string>} File content as string
   */
  async getContent(documentId, user) {
    const document = await Document.findById(documentId);
    if (!document) {
      throw new Error('Document not found');
    }
    if (user) {
      await MembershipService.requireProjectRole(user.id, document.projectId, ['owner', 'admin', 'editor', 'viewer']);
    }

    const fullPath = path.join(UPLOADS_DIR, document.filePath);
    let buffer;
    try {
      buffer = await fs.readFile(fullPath);
    } catch (err) {
      throw new Error(`Failed to read file: ${err.message}`);
    }

    const fileType = document.fileType?.toLowerCase() || '';
    const fileName = document.fileName?.toLowerCase() || '';

    console.log(`[DocumentService.getContent] fileType="${fileType}" fileName="${fileName}"`);

    // DOCX: extract text via mammoth
    if (fileType.includes('docx') || fileType.includes('wordprocessingml') || fileName.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer });
      console.log(`[DocumentService.getContent] mammoth extracted ${result.value.length} chars`);
      return result.value;
    }

    // PDF: extract text via pdf-parse
    if (fileType.includes('pdf') || fileName.endsWith('.pdf')) {
      const result = await pdfParse(buffer);
      console.log(`[DocumentService.getContent] pdf-parse extracted ${result.text.length} chars`);
      return result.text;
    }

    // Plain text / markdown
    const text = buffer.toString('utf8');
    console.log(`[DocumentService.getContent] plain text ${text.length} chars`);
    return text;
  }

  /**
   * Update document status
   * @param {string} documentId
   * @param {string} status
   * @returns {Promise<Object>} Updated document
   */
  async updateStatus(documentId, status) {
    const document = await Document.findById(documentId);
    if (!document) {
      throw new Error('Document not found');
    }
    return Document.update(documentId, { status });
  }

  /**
   * Get all documents
   * @param {Object} options - Query options
   * @returns {Promise<Object>} List of documents with count
   */
  async getAllDocuments(options = {}) {
    const { limit = 50, offset = 0, projectId, user } = options;
    if (projectId) {
      await MembershipService.requireProjectRole(user.id, projectId, ['owner', 'admin', 'editor', 'viewer']);
    } else {
      const accessibleProjectIds = await MembershipService.listAccessibleProjectIds(user.id);
      if (accessibleProjectIds.length === 0) return { rows: [], count: 0 };
      const results = await Promise.all(
        accessibleProjectIds.map((id) => Document.list({ limit: 1000, offset: 0, projectId: id })),
      );
      const rows = results.flatMap((result) => result.rows)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(offset, offset + limit);
      return { rows, count: results.reduce((sum, result) => sum + (result.count || 0), 0) };
    }
    return Document.list({ limit, offset, projectId });
  }

  async renameDocument(documentId, fileName, user) {
    const document = await Document.findById(documentId);
    if (!document) {
      throw new ApiError(404, 'Document not found');
    }
    await MembershipService.requireProjectRole(user.id, document.projectId, ['owner', 'admin', 'editor']);
    if (!fileName || !fileName.trim()) {
      throw new ApiError(400, 'file_name is required');
    }
    return Document.rename(documentId, fileName.trim());
  }

  async moveDocument(documentId, { projectId, folderId, user }) {
    const document = await Document.findById(documentId);
    if (!document) {
      throw new ApiError(404, 'Document not found');
    }
    await MembershipService.requireProjectRole(user.id, document.projectId, ['owner', 'admin', 'editor']);

    const targetProjectId = projectId || document.projectId;
    if (!targetProjectId) {
      throw new ApiError(400, 'project_id is required');
    }
    if (targetProjectId !== document.projectId) {
      await MembershipService.requireProjectRole(user.id, targetProjectId, ['owner', 'admin', 'editor']);
    }

    const project = await Project.findById(targetProjectId);
    if (!project) {
      throw new ApiError(404, 'Project not found');
    }

    if (folderId) {
      const folder = await Folder.findById(folderId);
      if (!folder) {
        throw new ApiError(404, 'Folder not found');
      }
      if (folder.projectId !== targetProjectId) {
        throw new ApiError(400, 'folder_id does not belong to project_id');
      }
    }

    const extension = document.filePath.includes('.') ? document.filePath.split('.').pop() : '';
    const newStoragePath = `${targetProjectId}/${folderId || 'root'}/${document.id}${extension ? `.${extension}` : ''}`;

    // Move file locally
    if (document.filePath !== newStoragePath) {
      const oldFullPath = path.join(UPLOADS_DIR, document.filePath);
      const newFullPath = path.join(UPLOADS_DIR, newStoragePath);
      await fs.mkdir(path.dirname(newFullPath), { recursive: true });
      await fs.rename(oldFullPath, newFullPath);
    }

    await Document.move(documentId, {
      projectId: targetProjectId,
      folderId: folderId || null,
    });

    return Document.update(documentId, { filePath: newStoragePath });
  }

  /**
   * Delete a document and its file from storage
   * @param {string} documentId
   * @returns {Promise<boolean>} Success status
   */
  async deleteDocument(documentId, user, options = {}) {
    const document = await Document.findById(documentId);
    if (!document) {
      throw new Error('Document not found');
    }
    if (!options.skipAccessCheck) {
      await MembershipService.requireProjectRole(user.id, document.projectId, ['owner', 'admin', 'editor']);
    }

    // Delete file from local disk
    try {
      const fullPath = path.join(UPLOADS_DIR, document.filePath);
      await fs.unlink(fullPath);
    } catch (error) {
      console.warn('[DocumentService] File not found in local storage:', document.filePath);
    }

    await Document.delete(documentId);
    
    // Auto-clear project-scoped session state if this document was part of saved selection.
    await SessionState.removeDocIds([documentId], { projectId: document.projectId });
    
    return true;
  }
}

module.exports = new DocumentService();
