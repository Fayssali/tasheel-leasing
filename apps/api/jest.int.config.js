/** Integration tests: need a migrated and seeded PostgreSQL (see CI workflow). */
module.exports = {
  rootDir: '.',
  testRegex: 'test-int/.*\\.int-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  testTimeout: 30000,
};
