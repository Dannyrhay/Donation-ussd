// Prisma CLI configuration (Prisma 7+: the datasource URL lives here, not in schema.prisma)
require('dotenv').config({ quiet: true });
const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    // Not using env() — it throws when unset, which would break `prisma generate`
    // (run on every `npm ci` via postinstall) in CI and builds that have no DB.
    // Commands that connect (migrate) fail with a clear error if this is empty.
    url: process.env.DATABASE_URL || ''
  }
});
