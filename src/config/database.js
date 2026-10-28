const { getClient } = require('../db/prisma');

/**
 * Database Connection Module
 *
 * Connects to PostgreSQL (Railway) through Prisma. Schema changes are applied
 * by `prisma migrate deploy` (Railway pre-deploy command), not at runtime.
 */

async function connectDatabase() {
  if (!process.env.DATABASE_URL) {
    console.log('='.repeat(50));
    console.log('DATABASE_URL not set - running without database');
    console.log('='.repeat(50));
    return null;
  }

  try {
    const prisma = getClient();
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`; // verify the connection actually works

    console.log('='.repeat(50));
    console.log('PostgreSQL Connected Successfully');
    console.log('='.repeat(50));

    return prisma;

  } catch (error) {
    console.error('='.repeat(50));
    console.error('PostgreSQL Connection Failed');
    console.error('Error:', error.message);
    console.error('='.repeat(50));
    console.error('Check DATABASE_URL (on Railway: reference ${{Postgres.DATABASE_URL}})');

    // Don't crash the app - continue without database
    // (useful for testing USSD flow without DB)
    return null;
  }
}

async function disconnectDatabase() {
  await getClient().$disconnect();
  console.log('PostgreSQL disconnected');
}

module.exports = {
  connectDatabase,
  disconnectDatabase
};
