// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/__mocks__/uuid.js'
  }
};
