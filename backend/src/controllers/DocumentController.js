const path = require('path');
const DocumentService = require("../services/DocumentService");

class DocumentController {
  /**
   * Handle file upload
   * POST /api/v1/documents/upload
   */
  async upload(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          status: "error",
          message: "No file uploaded",
        });
      }

      const projectId = req.body.project_id;
      const folderId = req.body.folder_id || null;
      const document = await DocumentService.uploadFile(
        req.file,
        projectId,
        folderId,
        req.user,
      );

      return res.status(201).json({
        status: "success",
        data: {
          document_id: document.id,
          project_id: document.projectId,
          folder_id: document.folderId,
          file_name: document.fileName,
          file_type: document.fileType,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get document by ID
   * GET /api/v1/documents/:id
   */
  async getById(req, res, next) {
    try {
      const { id } = req.params;
      const document = await DocumentService.getDocumentById(id, req.user);

      if (!document) {
        return res.status(404).json({
          status: "error",
          message: "Document not found",
        });
      }

      return res.json({
        status: "success",
        data: {
          document_id: document.id,
          project_id: document.projectId,
          folder_id: document.folderId,
          file_name: document.fileName,
          file_type: document.fileType,
          file_size: document.fileSize,
          status: document.status,
          created_at: document.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List all documents
   * GET /api/v1/documents
   */
  async list(req, res, next) {
    try {
      const { limit, offset } = req.query;
      const { project_id: projectId } = req.query;
      const result = await DocumentService.getAllDocuments({
        limit: parseInt(limit, 10) || 50,
        offset: parseInt(offset, 10) || 0,
        projectId: projectId || undefined,
        user: req.user,
      });

      return res.json({
        status: "success",
        data: result.rows.map((doc) => ({
          document_id: doc.id,
          project_id: doc.projectId,
          folder_id: doc.folderId,
          file_name: doc.fileName,
          file_type: doc.fileType,
          file_size: doc.fileSize,
          status: doc.status,
          created_at: doc.createdAt,
        })),
        total: result.count,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get signed URL for document preview
   * GET /api/v1/documents/:id/preview
   */
  async getPreviewUrl(req, res, next) {
    try {
      const { id } = req.params;
      const { url } = await DocumentService.getSignedUrl(id, 3600, req.user);
      const document = await DocumentService.getDocumentById(id, req.user);

      return res.json({
        status: "success",
        data: {
          url,
          file_type: document?.fileType,
          file_name: document?.fileName,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get extracted textual content for preview
   * GET /api/v1/documents/:id/content
   */
  async getContent(req, res, next) {
    try {
      const { id } = req.params;
      const document = await DocumentService.getDocumentById(id, req.user);
      if (!document) {
        return res.status(404).json({
          status: "error",
          message: "Document not found",
        });
      }

      const content = await DocumentService.getContent(id, req.user);
      return res.json({
        status: "success",
        data: {
          content,
          file_type: document.fileType,
          file_name: document.fileName,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a document
   * DELETE /api/v1/documents/:id
   */
  async delete(req, res, next) {
    try {
      const { id } = req.params;
      await DocumentService.deleteDocument(id, req.user);

      return res.json({
        status: "success",
        message: "Document deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Rename a document
   * PATCH /api/v1/documents/:id
   */
  async rename(req, res, next) {
    try {
      const { id } = req.params;
      const { file_name: fileName } = req.body;
      const doc = await DocumentService.renameDocument(id, fileName, req.user);
      return res.json({
        status: "success",
        data: {
          document_id: doc.id,
          project_id: doc.projectId,
          folder_id: doc.folderId,
          file_name: doc.fileName,
          file_type: doc.fileType,
          file_size: doc.fileSize,
          status: doc.status,
          created_at: doc.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Move a document to another folder/project
   * PATCH /api/v1/documents/:id/move
   */
  async move(req, res, next) {
    try {
      const { id } = req.params;
      const { project_id: projectId, folder_id: folderId } = req.body;
      const doc = await DocumentService.moveDocument(id, {
        projectId,
        folderId: folderId || null,
        user: req.user,
      });
      return res.json({
        status: "success",
        data: {
          document_id: doc.id,
          project_id: doc.projectId,
          folder_id: doc.folderId,
          file_name: doc.fileName,
          file_type: doc.fileType,
          file_size: doc.fileSize,
          status: doc.status,
          created_at: doc.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Download the local document file
   * GET /api/v1/documents/:id/download
   */
  async download(req, res, next) {
    try {
      const { id } = req.params;
      const document = await DocumentService.getDocumentById(id, req.user);
      if (!document) {
        return res.status(404).json({
          status: "error",
          message: "Document not found",
        });
      }

      const uploadsDir = path.join(__dirname, '../../uploads');
      const filePath = path.resolve(uploadsDir, document.filePath);
      return res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DocumentController();
