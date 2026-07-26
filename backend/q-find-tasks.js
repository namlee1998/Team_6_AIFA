// List all tasks under session 479aefb4-...
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const session = await p.PipelineSession.findUnique({
    where: { id: '479aefb4-fac9-4cb1-bfed-49e22c19301f' },
  });
  console.log('SESSION:', JSON.stringify(session, null, 2));
  const tasks = await p.Task.findMany({
    where: { sessionId: '479aefb4-fac9-4cb1-bfed-49e22c19301f' },
    orderBy: { createdAt: 'asc' },
  });
  for (const t of tasks) {
    console.log(`TASK id=${t.id} type=${t.type} status=${t.executionStatus}/${t.versionStatus} created=${t.createdAt?.toISOString?.()}`);
  }
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
