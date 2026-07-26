// Auth is intentionally bypassed for local-first execution: the program is
// meant to run directly without authentication. authMiddleware always attaches
// a local user and calls next() — it never validates a token. These tests pin
// that contract so a future change can't silently re-introduce an auth wall.

const authMiddleware = require('../../src/middleware/authMiddleware');

const createRes = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

describe('authMiddleware (local-first, no auth)', () => {
  test('attaches a local user and calls next, regardless of headers', async () => {
    const req = { headers: {}, query: {} };
    const res = createRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(req.user).toEqual({
      id: 'local-user-id',
      email: 'local-user@example.com',
      role: 'authenticated',
    });
    expect(req.accessToken).toBe('local-dummy-token');
    expect(next).toHaveBeenCalled();
    // never blocks the request
    expect(res.statusCode).toBeNull();
  });

  test('never rejects, even with no/invalid Authorization header', async () => {
    const req = { headers: { authorization: 'Bearer whatever' }, query: {} };
    const res = createRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
    expect(req.user.id).toBe('local-user-id');
  });
});
