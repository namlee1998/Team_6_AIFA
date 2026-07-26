const { v4: uuidv4 } = require('uuid');
const { Project, Folder, Document } = require('../models');
const DocumentService = require('./DocumentService');
const prisma = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');

class ProjectService {
  async listProjects(user) {
    const projects = await Project.list();
    return projects.map((project) => ({
      ...project,
      role: 'owner',
    }));
  }

  async createProject(name, user) {
    if (!name || !name.trim()) {
      throw new ApiError(400, 'Project name is required');
    }
    if (!user?.id) throw new ApiError(401, 'Authenticated user is required');

    const project = await Project.create({
      id: uuidv4(),
      name: name.trim(),
      createdBy: user.id,
    });
    return { ...project, role: 'owner' };
  }

  async renameProject(projectId, name, user) {
    const project = await Project.findById(projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    if (!name || !name.trim()) throw new ApiError(400, 'Project name is required');
    const updated = await Project.update(projectId, { name: name.trim() });
    return { ...updated, role: 'owner' };
  }

  async deleteProject(projectId, user) {
    const project = await Project.findById(projectId);
    if (!project) throw new ApiError(404, 'Project not found');

    const projectDocs = await Document.list({ projectId, limit: 1000, offset: 0 });
    const docIds = projectDocs.rows.map((d) => d.id);
    for (const docId of docIds) {
      await DocumentService.deleteDocument(docId, user, { skipAccessCheck: true });
    }

    const tasks = await prisma.task.findMany({
      where: { projectId },
      select: { id: true },
    });
    const taskIds = tasks.map((task) => task.id);

    await prisma.$transaction([
      prisma.agentArtifact.deleteMany({
        where: taskIds.length > 0
          ? { OR: [{ projectId }, { taskId: { in: taskIds } }] }
          : { projectId },
      }),
      prisma.testcase.deleteMany({ where: { projectId } }),
      prisma.hitlDecision.deleteMany({ where: { projectId } }),
      prisma.featureBacklog.deleteMany({ where: { projectId } }),
      prisma.sessionState.deleteMany({ where: { projectId } }),
      prisma.task.deleteMany({ where: { projectId } }),
      prisma.pipelineSession.deleteMany({ where: { projectId } }),
      prisma.folder.deleteMany({ where: { projectId } }),
      prisma.project.delete({ where: { id: projectId } }),
    ]);
    return true;
  }

  async getProjectTree(projectId, user) {
    const project = await Project.findById(projectId);
    if (!project) throw new ApiError(404, 'Project not found');

    const [folders, docsResult] = await Promise.all([
      Folder.listByProjectId(projectId),
      Document.list({ projectId, limit: 1000, offset: 0 }),
    ]);

    return {
      project,
      folders,
      documents: docsResult.rows,
    };
  }
}

module.exports = new ProjectService();

