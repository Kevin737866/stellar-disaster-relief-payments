/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      diagnostics: false,
      tsconfig: {
        strict: false,
        esModuleInterop: true,
        skipLibCheck: true,
      },
    }],
  },
};
