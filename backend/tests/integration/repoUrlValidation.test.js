// AIFA v2.1 §4 Phase 1: runArchitectureAgent must reject an invalid
// repo_url with HTTP 400 BEFORE workspace creation or clone work begins.
//
// We cover two layers:
//   1) validateRepoUrl at the function level (pure, no Express) — every
//      accepted shape is returned, every rejected shape throws ApiError(400)
//      with code INVALID_REPO_URL and phase ARCH_RUNNING.
//   2) The error middleware renders that ApiError as a clean HTTP 400
//      envelope (status='error', code='INVALID_REPO_URL', message, phase)
//      so the API contract from the controller is identical to what the
//      middleware would produce. We do not boot Express+supertest here to
//      avoid a long-running server during unit testing.

jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid') }));

const repoService = require('../../src/services/repoService');
const {
  ApiError,
  errorHandler,
} = require('../../src/middleware/errorHandler');

const VALID_BODY = {
  project_id: 'proj-1',
  feature_request: { title: 'Add login', description: 'Email + password' },
};

describe('validateRepoUrl — pure function (AIFA v2.1 §4)', () => {
  const accept = [
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo',
    'http://gitlab.example.com/team/repo.git',
    'git://github.com/owner/repo.git',
    'ssh://git@github.com/owner/repo.git',
    'ssh://git@host.example:2222/owner/repo.git',
    'git@github.com:owner/repo.git',
  ];

  const reject = [
    ['', /repo_url is required/],
    ['   ', /repo_url is required/],
    ['not-a-url', /must be a valid Git URL/],
    ['/some/local/path', /must be a valid Git URL/],
    ['./relative/path', /must be a valid Git URL/],
    ['file:///etc/passwd', /protocol not supported/],
    ['ftp://example.com/repo.git', /protocol not supported/],
    ['ftps://example.com/repo.git', /protocol not supported/],
    ['rsync://example.com/repo', /protocol not supported/],
    ['git+ssh://git@github.com/owner/repo.git', /protocol not supported/],
    ['https://', /not a valid http\(s\) URL/],
    ['https://github.com', /must include a repository path/],
    ['git://', /must be a valid git:\/\/ URL/],
    ['ssh://', /must be a valid ssh:\/\/ URL/],
  ];

  test.each(accept)('accepts valid URL: %s', (url) => {
    expect(repoService.validateRepoUrl(url)).toBe(url.trim());
  });

  test.each(reject)('rejects invalid URL: %j', (url, expectedMessage) => {
    let thrown;
    try {
      repoService.validateRepoUrl(url);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown.statusCode).toBe(400);
    expect(thrown.code).toBe('INVALID_REPO_URL');
    expect(thrown.phase).toBe('ARCH_RUNNING');
    expect(thrown.message).toMatch(expectedMessage);
  });
});

describe('errorHandler — renders ApiError as HTTP envelope', () => {
  // Drive the middleware with a fake req/res. We want to confirm the same
  // ApiError shape that validateRepoUrl throws is rendered as a 400 with
  // { status, code, message, phase } — which is what the frontend will see
  // when the controller calls next(err) on a validation failure.
  function callMiddleware(err) {
    const req = { id: 'req-1', method: 'POST', originalUrl: '/run-architecture-agent', headers: {} };
    const headers = {};
    let statusCode = 0;
    let body = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };
    errorHandler(err, req, res, () => {});
    return { statusCode, body, headers };
  }

  test('ApiError(400, ..., INVALID_REPO_URL, ARCH_RUNNING) → HTTP 400 envelope', () => {
    const err = new ApiError(
      400,
      'repo_url is required (AIFA v2.1 §4).',
      'INVALID_REPO_URL',
      'ARCH_RUNNING',
    );
    const { statusCode, body } = callMiddleware(err);
    expect(statusCode).toBe(400);
    expect(body.status).toBe('error');
    expect(body.code).toBe('INVALID_REPO_URL');
    expect(body.phase).toBe('ARCH_RUNNING');
    expect(body.message).toMatch(/repo_url is required/);
  });

  test('ApiError with no code → falls back to BAD_REQUEST', () => {
    const err = new ApiError(400, 'oops');
    const { statusCode, body } = callMiddleware(err);
    expect(statusCode).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
  });
});
