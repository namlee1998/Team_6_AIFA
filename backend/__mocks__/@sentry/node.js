// Mock for @sentry/node — prevents "Cannot find module" in Jest.
// Sentry is only used in the error handler middleware (Sentry.captureException).
// No tests exercise Sentry, so a no-op mock is sufficient.
module.exports = {
  captureException: () => {},
  captureMessage: () => {},
  withScope: () => {},
  init: () => {},
};
