const { PrismaClient } = require('@prisma/client');

// SQLite concurrency hardening. The default rollback-journal mode allows only a
// single writer and lets readers block writers, so the background intervals
// (worker heartbeat, stale sweeper, demo-board drainer, SSE polls) contending
// with a slow real-runner stage can trip "the database failed to respond within
// the configured timeout". We:
//   1. force a single pooled connection so queries serialize instead of racing
//      the SQLite lock (eliminates SQLITE_BUSY),
//   2. enable WAL + a generous busy_timeout so readers/writers don't starve,
//   3. raise the interactive-transaction timeout for slow moments.
function withConnLimit(url) {
  if (!url || !url.startsWith('file:')) return url;
  if (url.includes('connection_limit=')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
}

const url = withConnLimit(process.env.DATABASE_URL);

const prisma = new PrismaClient({
  ...(url ? { datasources: { db: { url } } } : {}),
  transactionOptions: { timeout: 20000, maxWait: 20000 },
});

// journal_mode=WAL is persisted in the db file; busy_timeout is per-connection
// (safe here because connection_limit=1 means a single connection). PRAGMAs
// return a row, so use $queryRawUnsafe (not $executeRawUnsafe).
(async () => {
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout=20000;');
    await prisma.$queryRawUnsafe('PRAGMA synchronous=NORMAL;');
  } catch (e) {
    console.warn('[Prisma] SQLite PRAGMA setup skipped:', e.message);
  }
})();

module.exports = prisma;
