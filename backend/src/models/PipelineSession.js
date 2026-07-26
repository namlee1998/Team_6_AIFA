const prisma = require('../config/database');

class PipelineSessionModel {
  static async create(data) {
    const record = await prisma.pipelineSession.create({
      data: {
        id: data.id,
        projectId: data.projectId,
        title: data.title || null,
        status: data.status || 'running',
        repoPath: data.repoPath || null,
        workingBranch: data.workingBranch || null,
        baseBranch: data.baseBranch || null,
        outputDir: data.outputDir || null,
      },
    });
    return this._map(record);
  }

  static async findById(id) {
    const data = await prisma.pipelineSession.findUnique({ where: { id } });
    return this._map(data);
  }

  static async findByProjectId(projectId) {
    const data = await prisma.pipelineSession.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return (data || []).map(this._map);
  }

  static async update(id, data) {
    const mapped = {
      title: data.title,
      status: data.status,
      repoPath: data.repoPath,
      workingBranch: data.workingBranch,
      baseBranch: data.baseBranch,
      outputDir: data.outputDir,
    };
    Object.keys(mapped).forEach((k) => mapped[k] === undefined && delete mapped[k]);

    const record = await prisma.pipelineSession.update({ where: { id }, data: mapped });
    return this._map(record);
  }

  /** Count sessions that still have an in-flight task (pending/processing). */
  static async countActive() {
    const distinct = await prisma.task.findMany({
      where: {
        status: { in: ['pending', 'processing'] },
        sessionId: { not: null },
      },
      distinct: ['sessionId'],
      select: { sessionId: true },
    });
    return distinct.length;
  }

  static _map(row) {
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title || null,
      status: row.status || 'running',
      repoPath: row.repoPath || null,
      workingBranch: row.workingBranch || null,
      baseBranch: row.baseBranch || null,
      outputDir: row.outputDir || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

module.exports = PipelineSessionModel;
