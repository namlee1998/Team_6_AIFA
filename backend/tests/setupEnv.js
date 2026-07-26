// I1: the prisma datasource now reads DATABASE_URL (env-driven). The runtime
// prisma client does not load .env, so guarantee a value for the test process.
// Defaults to the existing local dev.db (so test behaviour is unchanged) unless
// the runner/CI already pointed DATABASE_URL at an isolated sqlite file.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./dev.db';

// The sandbox used for these tests rejects binding to 0.0.0.0. Supertest
// creates ephemeral HTTP servers internally, so force localhost in the Jest
// process only.
const net = require('net');
const originalListen = net.Server.prototype.listen;

net.Server.prototype.listen = function patchedListen(...args) {
  const nextArgs = [...args];
  if (nextArgs.length === 0) {
    nextArgs.push(0, '127.0.0.1');
  } else if (typeof nextArgs[0] === 'number') {
    if (nextArgs.length === 1) nextArgs.push('127.0.0.1');
    else if (typeof nextArgs[1] !== 'string' && typeof nextArgs[1] !== 'object') nextArgs.splice(1, 0, '127.0.0.1');
    else if (typeof nextArgs[1] === 'object' && nextArgs[1] !== null && !nextArgs[1].host) {
      nextArgs[1] = { ...nextArgs[1], host: '127.0.0.1' };
    }
  } else if (typeof nextArgs[0] === 'object' && nextArgs[0] !== null && !nextArgs[0].host) {
    nextArgs[0] = { ...nextArgs[0], host: '127.0.0.1' };
  }
  return originalListen.apply(this, nextArgs);
};
