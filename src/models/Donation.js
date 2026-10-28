const { getClient, Prisma } = require('../db/prisma');
const { toPlain } = require('./mapper');
const Donor = require('./Donor');

/**
 * Donation repository
 *
 * Each individual donation/payment transaction.
 */

const COMPLETED_STATUSES = ['completed', 'fulfilled'];

function jsonOrNull(value) {
  return value === undefined || value === null ? Prisma.DbNull : value;
}

function buildWhere({ status, phoneNumber, phoneContains, subscriptionId } = {}) {
  const where = {};
  if (typeof status === 'string' && status) where.status = status;
  if (typeof phoneNumber === 'string' && phoneNumber) where.phoneNumber = phoneNumber;
  if (typeof phoneContains === 'string' && phoneContains) where.phoneNumber = { contains: phoneContains };
  if (typeof subscriptionId === 'string' && subscriptionId) where.subscriptionId = subscriptionId;
  return where;
}

/**
 * @param {object} data - Prisma create data (uses donorId / subscriptionId)
 * @param {object} [tx] - optional transaction client
 * @throws unique violation (see isUniqueViolation) when `reference` already exists
 */
async function create(data, tx = getClient()) {
  return toPlain(await tx.donation.create({ data }));
}

async function findById(id) {
  return toPlain(await getClient().donation.findUnique({ where: { id } }));
}

async function findByReference(reference, { includeDonor = false } = {}) {
  return toPlain(await getClient().donation.findUnique({
    where: { reference },
    include: includeDonor ? { donor: true } : undefined
  }));
}

async function findByHubtelSessionId(hubtelSessionId) {
  return toPlain(await getClient().donation.findFirst({ where: { hubtelSessionId } }));
}

async function findByHubtelOrderId(hubtelOrderId) {
  return toPlain(await getClient().donation.findFirst({ where: { hubtelOrderId } }));
}

/**
 * Most recent pending one-time donation for a phone number
 * (fallback match for Hubtel payment callbacks)
 */
async function findLatestPendingOnceByPhone(phoneNumber) {
  return toPlain(await getClient().donation.findFirst({
    where: { phoneNumber, frequency: 'once', status: 'pending' },
    orderBy: { createdAt: 'desc' }
  }));
}

/**
 * Store Hubtel's payment SessionId / OrderId (only the values provided)
 */
async function setHubtelIds(id, { hubtelSessionId, hubtelOrderId }) {
  const data = {};
  if (hubtelSessionId) data.hubtelSessionId = hubtelSessionId;
  if (hubtelOrderId) data.hubtelOrderId = hubtelOrderId;
  if (Object.keys(data).length === 0) return;
  await getClient().donation.update({ where: { id }, data });
}

/**
 * Mark donation completed and update donor statistics — in one transaction.
 *
 * Idempotent: a repeated payment callback for an already-completed donation
 * does not count the donor's total twice.
 */
async function markCompleted(id, callbackData) {
  const transactionId = callbackData?.Data?.TransactionId;

  return getClient().$transaction(async (tx) => {
    const updated = await tx.donation.updateMany({
      where: { id, status: { not: 'completed' } },
      data: {
        status: 'completed',
        completedAt: new Date(),
        callbackData: jsonOrNull(callbackData),
        ...(transactionId ? { hubtelTransactionId: String(transactionId) } : {})
      }
    });

    const donation = await tx.donation.findUnique({ where: { id } });

    if (updated.count === 1 && donation) {
      await Donor.recordDonation(donation.donorId, donation.amount, tx);
    }

    return toPlain(donation);
  });
}

async function markFailed(id, callbackData, errorMessage) {
  return toPlain(await getClient().donation.update({
    where: { id },
    data: {
      status: 'failed',
      callbackData: jsonOrNull(callbackData),
      errorMessage: typeof errorMessage === 'string' ? errorMessage : (errorMessage ? JSON.stringify(errorMessage) : 'Payment failed')
    }
  }));
}

/**
 * Mark fulfilled (Hubtel fulfilment callback). Single atomic statement:
 * sets completedAt only if not already set (fulfilment can arrive before the
 * payment callback), and only touches donations not yet fulfilled.
 *
 * @returns {Promise<string|null>} id of the fulfilled donation, or null
 */
async function markFulfilledByHubtelSessionId(hubtelSessionId) {
  const now = new Date(); // app clock — DB NOW() can be skewed from the app's
  const rows = await getClient().$queryRaw`
    UPDATE "donations"
    SET "status" = 'fulfilled', "fulfilledAt" = ${now},
        "completedAt" = COALESCE("completedAt", ${now}), "updatedAt" = ${now}
    WHERE "hubtelSessionId" = ${hubtelSessionId} AND "fulfilledAt" IS NULL
    RETURNING "id"`;
  return rows[0] ? rows[0].id : null;
}

async function markFulfilledByHubtelOrderId(hubtelOrderId) {
  const now = new Date(); // app clock — DB NOW() can be skewed from the app's
  const rows = await getClient().$queryRaw`
    UPDATE "donations"
    SET "status" = 'fulfilled', "fulfilledAt" = ${now},
        "completedAt" = COALESCE("completedAt", ${now}), "updatedAt" = ${now}
    WHERE "hubtelOrderId" = ${hubtelOrderId} AND "fulfilledAt" IS NULL
    RETURNING "id"`;
  return rows[0] ? rows[0].id : null;
}

async function list(filters = {}, { skip = 0, limit = 100, includeDonor = false, includeSubscription = false } = {}) {
  const include = {};
  if (includeDonor) include.donor = true;
  if (includeSubscription) include.subscription = true;

  return toPlain(await getClient().donation.findMany({
    where: buildWhere(filters),
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
    include: Object.keys(include).length ? include : undefined
  }));
}

async function count(filters = {}) {
  return getClient().donation.count({ where: buildWhere(filters) });
}

async function countCompleted() {
  return getClient().donation.count({ where: { status: { in: COMPLETED_STATUSES } } });
}

/**
 * Total completed/fulfilled donations within a period
 */
async function getTotalForPeriod(startDate, endDate) {
  const result = await getClient().donation.aggregate({
    where: {
      status: { in: COMPLETED_STATUSES },
      OR: [
        { completedAt: { gte: startDate, lte: endDate } },
        { fulfilledAt: { gte: startDate, lte: endDate } }
      ]
    },
    _sum: { amount: true },
    _count: { _all: true }
  });

  return {
    total: result._sum.amount ? result._sum.amount.toNumber() : 0,
    count: result._count._all
  };
}

module.exports = {
  create,
  findById,
  findByReference,
  findByHubtelSessionId,
  findByHubtelOrderId,
  findLatestPendingOnceByPhone,
  setHubtelIds,
  markCompleted,
  markFailed,
  markFulfilledByHubtelSessionId,
  markFulfilledByHubtelOrderId,
  list,
  count,
  countCompleted,
  getTotalForPeriod
};
