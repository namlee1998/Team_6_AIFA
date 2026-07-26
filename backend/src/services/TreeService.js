const { Project, Folder, Document } = require('../models');

class TreeService {
  async getTree(user) {
    const projects = await Project.list();
    const projectIds = projects.map((project) => project.id);
    if (projectIds.length === 0) {
      return { projects: [], folders: [], documents: [] };
    }

    const folders = (await Promise.all(projectIds.map((projectId) => Folder.listByProjectId(projectId)))).flat();
    const docResults = await Promise.all(
      projectIds.map((projectId) => Document.list({ projectId, limit: 5000, offset: 0 })),
    );

    return {
      projects: projects.map((project) => ({
        ...project,
        role: 'owner',
      })),
      folders,
      documents: docResults.flatMap((result) => result.rows),
    };
  }
}

module.exports = new TreeService();

