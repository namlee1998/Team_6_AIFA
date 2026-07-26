// Authentication service for the Login feature.
//
// Security-sensitive (risk_classification.security = high). Design choices:
//  - Passwords are never stored in plaintext: scrypt with a per-user random salt.
//  - Credential verification uses crypto.timingSafeEqual to avoid timing oracles
//    and returns a SINGLE generic failure for both "unknown email" and "wrong
//    password" so the caller cannot tell which field was wrong (AC-3).
//  - Sessions are HMAC-signed, expiring tokens — tamper-evident without server
//    state, suitable for an HttpOnly, SameSite=Lax, Secure (prod) cookie (AC-5).
//
// The in-memory user store is a stand-in for a DB-backed lookup; swap
// `authenticate` to query the real users table when the backend is available.

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24h

const users = new Map();

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), useSalt, 64).toString('hex');
  return `${useSalt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, derived] = stored.split(':');
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function seedUser(email, password) {
  const normalized = String(email).toLowerCase();
  const id = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  users.set(normalized, { id, email: normalized, passwordHash: hashPassword(password) });
  return id;
}

// Default demo credentials so the flow is runnable/testable before the real
// auth backend exists. Override via env in any shared environment.
seedUser(process.env.DEMO_EMAIL || 'demo@example.com', process.env.DEMO_PASSWORD || 'password123');

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

// Returns { id, email } on success, or null on ANY failure (no field disclosure).
function authenticate(email, password) {
  const user = users.get(String(email || '').toLowerCase());
  if (!user) {
    // Spend roughly the same work on the miss path to flatten timing.
    hashPassword(password || '', '0123456789abcdef0123456789abcdef');
    return null;
  }
  if (!verifyPassword(password || '', user.passwordHash)) return null;
  return { id: user.id, email: user.email };
}

function createSession(user) {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${user.id}.${expires}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return { token: `${payload}.${sig}`, expires };
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, expires, sig] = parts;
  const payload = `${id}.${expires}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() > Number(expires)) return null;
  return { id };
}

module.exports = {
  hashPassword,
  verifyPassword,
  seedUser,
  authenticate,
  createSession,
  verifySession,
  isValidEmail,
  SESSION_TTL_MS,
};
