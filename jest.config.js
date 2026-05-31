/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      diagnostics: false,
      tsconfig: {
        target: 'ES2020',
        module: 'commonjs',
        esModuleInterop: true,
        skipLibCheck: true,
        strict: false,
      },
    }],
  },
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'sdk/src/**/*.ts',
    '!sdk/src/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  moduleNameMapper: {
    '^stellar-sdk$': '<rootDir>/tests/__mocks__/stellar-sdk.ts',
    '^crypto-js$': '<rootDir>/tests/__mocks__/crypto-js.ts',
  },
  testTimeout: 30000,
};
