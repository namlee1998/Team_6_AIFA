module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  clearMocks: true,
  // I1: guarantee DATABASE_URL before any test module (and thus prisma) loads.
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  moduleNameMapper: {
    '^@sentry/node$': '<rootDir>/__mocks__/@sentry/node.js',
  },
};
