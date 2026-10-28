const { getClient } = require('../db/prisma');
const { toPlain } = require('./mapper');

/**
 * Subscription repository
 *
 * Recurring donations managed by the Hubtel Recurring Invoice API
 * (Hubtel schedules and debits; we track state from its callbacks).
 */

const STATUSES = ['pending', 'active', 'paused', 'cancelled', 'expired', 'failed'];
const MAX_CONSECUTIVE_FAILURES = 3;

function buildWhere({ status, phoneContains } = {}) {
  const where = {};
  if (typeof status === 'string' && status) where.status = status;
  if (typeof phoneContains === 'string' && phoneContains) where.phoneNumber = { contains: phoneContains };
  return where;
}

/**
 * Next payment date based on frequency (display only — Hubtel does the scheduling)
 */
function calculateNextPaymentDate(frequency, fromDate = new Date()) {
  const date = new Date(fromDate);

  switch (frequency) {
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'annually':
      date.setFullYear(date.getFullYear() + 1);
      break;
  }

  return date;
}

async function create(data) {
  return toPlain(await getClient().subscription.create({ data }));
}

async function findById(id, { includeDonor = false } = {}) {
  return toPlain(await getClient().subscription.findUnique({
    where: { id },
    include: includeDonor ? { donor: true } : undefined
  }));
}

async function findByRecurringInvoiceId(recurringInvoiceId) {
  return toPlain(await getClient().subscription.findFirst({ where: { recurringInvoiceId } }));
}

async function findByClientReference(clientReference) {
  return toPlain(await getClient().subscription.findFirst({ where: { clientReference } }));
}

async function findActiveByPhone(phoneNumber) {
  return toPlain(await getClient().subscription.findMany({
    where: { phoneNumber, status: 'active' },
    orderBy: { createdAt: 'desc' }
  }));
}

/**
 * Subscriptions due for payment (only non-Hubtel managed ones)
 */
async function findDueForPayment() {
  return toPlain(await getClient().subscription.findMany({
    where: { status: 'active', managedByHubtel: false, nextPaymentDate: { lte: new Date() } },
    include: { donor: true }
  }));
}

/**
 * Record a successful payment on the subscription
 *
 * @param {object} subscription - needs id and frequency
 * @param {object} [tx] - optional transaction client
 */
async function recordPayment(subscription, amount, tx = getClient()) {
  return toPlain(await tx.subscription.update({
    where: { id: subscription.id },
    data: {
      paymentsCompleted: { increment: 1 },
      totalCollected: { increment: amount },
      lastPaymentDate: new Date(),
      nextPaymentDate: calculateNextPaymentDate(subscription.frequency),
      paymentsFailed: 0 // reset consecutive failures on success
    }
  }));
}

/**
 * Record a Hubtel recurring payment: creates the Donation and updates the
 * subscription in ONE transaction.
 *
 * Idempotent: the Donation's unique `reference` (REC-<transactionId>) makes a
 * retried callback fail the insert, which rolls back the whole transaction —
 * so totals are never counted twice, and a partial failure leaves nothing
 * behind for Hubtel's retry to trip over.
 *
 * @returns {Promise<{ donation: object, subscription: object }>}
 * @throws unique violation when this transaction was already recorded
 */
async function recordRecurringPayment(subscription, { amount, reference, transactionId }) {
  return getClient().$transaction(async (tx) => {
    const donation = await tx.donation.create({
      data: {
        donorId: subscription.donorId,
        phoneNumber: subscription.phoneNumber,
        amount,
        channel: subscription.channel,
        frequency: subscription.frequency,
        subscriptionId: subscription.id,
        reference,
        status: 'Success',
        description: `Recurring ${subscription.frequency} donation`,
        source: 'hubtel_recurring',
        hubtelTransactionId: transactionId || null
      }
    });

    const updated = await recordPayment(subscription, amount, tx);

    return { donation: toPlain(donation), subscription: updated };
  });
}

/**
 * Record a failed payment; pauses after MAX_CONSECUTIVE_FAILURES.
 * Single atomic statement, so concurrent failures can't lose a count.
 */
async function recordFailure(id, reason = 'Payment failed') {
  const now = new Date();
  const rows = await getClient().$queryRaw`
    UPDATE "subscriptions"
    SET "paymentsFailed" = "paymentsFailed" + 1,
        "status" = CASE WHEN "paymentsFailed" + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN 'paused' ELSE "status" END,
        "statusReason" = CASE WHEN "paymentsFailed" + 1 >= ${MAX_CONSECUTIVE_FAILURES}
          THEN 'Paused after ' || ("paymentsFailed" + 1) || ' failed payments: ' || ${String(reason)}
          ELSE "statusReason" END,
        "updatedAt" = ${now}
    WHERE "id" = ${id}
    RETURNING *`;
  return toPlain(rows[0] || null);
}

async function setStatus(id, status, statusReason = null) {
  if (!STATUSES.includes(status)) {
    throw new Error(`Invalid subscription status: ${status}`);
  }
  return toPlain(await getClient().subscription.update({
    where: { id },
    data: { status, statusReason }
  }));
}

function cancel(id, reason = 'User requested cancellation') {
  return setStatus(id, 'cancelled', reason);
}

function pause(id, reason = 'User requested pause') {
  return setStatus(id, 'paused', reason);
}

/**
 * Resume a paused subscription; if the next payment date is overdue, move it to tomorrow
 */
async function resume(subscription) {
  const data = { status: 'active', statusReason: null, paymentsFailed: 0 };

  if (!subscription.nextPaymentDate || new Date(subscription.nextPaymentDate) < new Date()) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    data.nextPaymentDate = tomorrow;
  }

  return toPlain(await getClient().subscription.update({ where: { id: subscription.id }, data }));
}

async function list(filters = {}, { skip = 0, limit = 100, includeDonor = false } = {}) {
  return toPlain(await getClient().subscription.findMany({
    where: buildWhere(filters),
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit,
    include: includeDonor ? { donor: true } : undefined
  }));
}

async function count(filters = {}) {
  return getClient().subscription.count({ where: buildWhere(filters) });
}

async function countDue() {
  return getClient().subscription.count({
    where: { status: 'active', nextPaymentDate: { lte: new Date() } }
  });
}

/**
 * Count and total amount per status
 */
async function getStats() {
  const groups = await getClient().subscription.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { amount: true }
  });

  const result = {};
  STATUSES.forEach((status) => {
    result[status] = { count: 0, totalAmount: 0 };
  });

  groups.forEach((group) => {
    result[group.status] = {
      count: group._count._all,
      totalAmount: group._sum.amount ? group._sum.amount.toNumber() : 0
    };
  });

  return result;
}

module.exports = {
  calculateNextPaymentDate,
  create,
  findById,
  findByRecurringInvoiceId,
  findByClientReference,
  findActiveByPhone,
  findDueForPayment,
  recordPayment,
  recordRecurringPayment,
  recordFailure,
  setStatus,
  cancel,
  pause,
  resume,
  list,
  count,
  countDue,
  getStats,
  STATUSES,
  MAX_CONSECUTIVE_FAILURES
};
