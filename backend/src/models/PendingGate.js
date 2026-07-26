const prisma = require('../config/database');

class PendingGateModel {
  static async create(data) {
    return prisma.pendingGate.upsert({
      where: { approvalId: data.approvalId },
      create: {
        approvalId: data.approvalId,
        taskId: data.taskId,
        projectId: data.projectId || null,
        role: data.role,
        kind: data.kind,
        payload: JSON.stringify(data.payload || {}),
        status: 'pending',
      },
      update: {
        payload: JSON.stringify(data.payload || {}),
        status: 'pending',
        resolution: null,
        resolvedAt: null,
      },
    });
  }

  static async resolve(approvalId, status, resolution = null) {
    return prisma.pendingGate.updateMany({
      where: { approvalId, status: 'pending' },
      data: {
        status,
        resolution: resolution === null ? null : JSON.stringify(resolution),
        resolvedAt: new Date(),
      },
    });
  }

  static async markPendingInterrupted() {
    return prisma.pendingGate.updateMany({
      where: { status: 'pending' },
      data: { status: 'interrupted', resolvedAt: new Date() },
    });
  }

  static async listInterrupted({ taskId = null, projectId = null } = {}) {
    const rows = await prisma.pendingGate.findMany({
      where: {
        status: 'interrupted',
        ...(taskId ? { taskId } : {}),
        ...(projectId ? { projectId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      approvalId: row.approvalId,
      taskId: row.taskId,
      projectId: row.projectId,
      role: row.role,
      kind: row.kind,
      payload: JSON.parse(row.payload || '{}'),
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  static async findById(approvalId) {
    const row = await prisma.pendingGate.findUnique({ where: { approvalId } });
    if (!row) return null;
    return {
      approvalId: row.approvalId,
      taskId: row.taskId,
      projectId: row.projectId,
      role: row.role,
      kind: row.kind,
      payload: JSON.parse(row.payload || '{}'),
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}

module.exports = PendingGateModel;
