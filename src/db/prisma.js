const { PrismaClient, Prisma } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

/**
 * Prisma client (PostgreSQL via node-postgres driver adapter)
 *
 * Timeouts are deliberately short: USSD replies must reach Hubtel within a few
 * seconds, so a slow or unreachable database should fail fast (the USSD flow
 * catches DB errors and shows a message) instead of hanging into "Error:UUE".
 */

let client = null;

function createClient(connectionString = process.env.DATABASE_URL) {
  const adapter = new PrismaPg({
    connectionString,
    max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    connectionTimeoutMillis: 3000, // waiting for a free/new connection
    idleTimeoutMillis: 30000,
    statement_timeout: 5000, // server-side cap per query
    query_timeout: 5000 // client-side cap per query
  });

  return new PrismaClient({ adapter });
}

/**
 * Lazily-created singleton. Tests replace it with setClient().
 */
function getClient() {
  if (!client) {
    client = createClient();
  }
  return client;
}

function setClient(newClient) {
  client = newClient;
}

/**
 * True when an error is a unique-constraint violation (Postgres 23505 / Prisma P2002)
 */
function isUniqueViolation(error) {
  return Boolean(
    error &&
    ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
      error.code === 'P2002' ||
      error.code === '23505')
  );
}

module.exports = {
  getClient,
  setClient,
  createClient,
  isUniqueViolation,
  Prisma
};
