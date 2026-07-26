// T4: structured error codes the orchestrator/UI can branch on.
const ERROR_CODES = {
  ARTIFACT_MISSING: 'ARTIFACT_MISSING',
  HASH_MISMATCH: 'HASH_MISMATCH',
  MOCK_PARSE_ERROR: 'MOCK_PARSE_ERROR',
  CLAUDE_CODE_AUTH_ERROR: 'CLAUDE_CODE_AUTH_ERROR',
  CLAUDE_CODE_CERTIFICATE_ERROR: 'CLAUDE_CODE_CERTIFICATE_ERROR',
  CLAUDE_CODE_EXIT: 'CLAUDE_CODE_EXIT',
  CLAUDE_CODE_RATE_LIMIT: 'CLAUDE_CODE_RATE_LIMIT',
  CLAUDE_CODE_TIMEOUT: 'CLAUDE_CODE_TIMEOUT',
  CLAUDE_OUTPUT_CONTRACT_INVALID: 'CLAUDE_OUTPUT_CONTRACT_INVALID',
  CLAUDE_OUTPUT_PARSE_ERROR: 'CLAUDE_OUTPUT_PARSE_ERROR',
};

const Sentry = require('@sentry/node');

// Fallback code derived from the HTTP status when an error has none.
const codeFromStatus = (statusCode) => {
  if (statusCode === 400) return 'BAD_REQUEST';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 422) return 'UNPROCESSABLE_ENTITY';
  return 'INTERNAL_ERROR';
};

/**
 * Global error handler middleware. Returns a stable `{status, code, message, phase}`
 * envelope so the frontend can render a precise error state instead of a blank screen.
 */
const errorHandler = (err, req, res, _next) => {
  console.error('[ErrorHandler]', err);

  // Default error response
  const isMulterError = err?.name === 'MulterError';
  const statusCode = isMulterError ? 413 : (err.statusCode || err.status || 500);
  const message = isMulterError
    ? (err.code === 'LIMIT_FILE_SIZE'
      ? 'Folder contains a file larger than the 25 MB upload limit'
      : err.code === 'LIMIT_FILE_COUNT'
        ? 'Folder contains more than the 8,000 file upload limit'
        : `Folder upload rejected: ${err.message}`)
    : (err.message || 'Internal Server Error');

  if (statusCode >= 500) {
    Sentry.captureException(err, {
      tags: { phase: err.phase || 'unknown' },
      contexts: {
        request: {
          id: req.id,
          method: req.method,
          url: req.originalUrl,
          headers: req.headers
        }
      }
    });
  }

  // Don't leak error details in production
  const response = {
    status: 'error',
    code: err.code || codeFromStatus(statusCode),
    message,
    phase: err.phase || null,
    // I2: correlate this error with the request log line.
    requestId: req.id || null,
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

/**
 * Custom error class for API errors. `code`/`phase` are optional and backward
 * compatible with the existing `new ApiError(status, message)` call sites.
 */
class ApiError extends Error {
  constructor(statusCode, message, code = null, phase = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.code = code;
    this.phase = phase;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
};

module.exports = { errorHandler, notFoundHandler, ApiError, ERROR_CODES };
