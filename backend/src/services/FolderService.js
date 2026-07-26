const { v4: uuidv4 } = require('uuid');
const { Folder, Project } = require('../models');

const { ApiError } = require('../middleware/errorHandler');

function normalizeName(name) {
  return (name || '').trim();
}

class FolderService {
  async listFolders(projectId, user) {
    if (!projectId) throw new ApiError(400, 'project_id is required');
    const project = await Project.findById(projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    return Folder.listByProjectId(projectId);
  }

  async createFolder({ projectId, parentId, name, user }) {
    const trimmedName = normalizeName(name);
    if (!projectId) throw new ApiError(400, 'project_id is required');
    if (!trimmedName) throw new ApiError(400, 'Folder name is required');

    const project = await Project.findById(projectId);
    if (!project) throw new ApiError(404, 'Project not found');

    if (parentId) {
      const parent = await Folder.findById(parentId);
      if (!parent) throw new ApiError(404, 'Parent folder not found');
      if (parent.projectId !== projectId) {
        throw new ApiError(400, 'Parent folder belongs to another project');
      }
    }

    return Folder.create({
      id: uuidv4(),
      projectId,
      parentId: parentId || null,
      name: trimmedName,
    });
  }

  async renameFolder(folderId, name, user) {
    const trimmedName = normalizeName(name);
    if (!trimmedName) throw new ApiError(400, 'Folder name is required');

    const folder = await Folder.findById(folderId);
    if (!folder) throw new ApiError(404, 'Folder not found');

    return Folder.update(folderId, { name: trimmedName });
  }

  async moveFolder(folderId, { parentId, projectId, sortOrder, user }) {
    const folder = await Folder.findById(folderId);
    if (!folder) throw new ApiError(404, 'Folder not found');

    const targetProjectId = projectId || folder.projectId;
    const targetProject = await Project.findById(targetProjectId);
    if (!targetProject) throw new ApiError(404, 'Target project not found');

    if (parentId) {
      const parent = await Folder.findById(parentId);
      if (!parent) throw new ApiError(404, 'Parent folder not found');
      if (parent.projectId !== targetProjectId) {
        throw new ApiError(400, 'Parent folder belongs to another project');
      }
      if (await this._isDescendant(parentId, folderId)) {
        throw new ApiError(400, 'Cannot move folder inside its own descendant');
      }
    }

    return Folder.update(folderId, {
      parent_id: parentId || null,
      project_id: targetProjectId,
      sort_order: sortOrder ?? folder.sortOrder ?? 0,
    });
  }

  async deleteFolder(folderId, user) {
    const folder = await Folder.findById(folderId);
    if (!folder) throw new ApiError(404, 'Folder not found');
    await Folder.delete(folderId);
    return true;
  }

  async _isDescendant(candidateParentId, folderId) {
    let current = await Folder.findById(candidateParentId);
    while (current) {
      if (current.id === folderId) return true;
      if (!current.parentId) return false;
      current = await Folder.findById(current.parentId);
    }
    return false;
  }
}

module.exports = new FolderService();
