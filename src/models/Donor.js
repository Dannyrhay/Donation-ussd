const { getClient } = require('../db/prisma');
const { toPlain } = require('./mapper');

/**
 * Donor repository
 *
 * People who donate, keyed by phone number.
 */

const NETWORKS = ['mtn', 'telecel', 'airteltigo', 'unknown'];
const SORTABLE_FIELDS = ['totalDonated', 'donationCount', 'lastDonationAt', 'firstDonationAt', 'createdAt'];

function normalizeNetwork(network) {
  if (network === 'vodafone') return 'telecel';
  if (network === 'tigo') return 'airteltigo';
  return NETWORKS.includes(network) ? network : 'unknown';
}

async function findById(id) {
  return toPlain(await getClient().donor.findUnique({ where: { id } }));
}

async function findByPhone(phoneNumber) {
  return toPlain(await getClient().donor.findUnique({ where: { phoneNumber } }));
}

/**
 * Find or create donor by phone number. Atomic upsert — two concurrent first
 * donations from the same number can't create duplicate donors.
 */
async function findOrCreateByPhone(phoneNumber, network = 'unknown') {
  return toPlain(await getClient().donor.upsert({
    where: { phoneNumber },
    update: {},
    create: { phoneNumber, network: normalizeNetwork(network) }
  }));
}

/**
 * Update lifetime statistics after a successful donation (single atomic statement)
 *
 * @param {object} [tx] - optional transaction client
 */
async function recordDonation(donorId, amount, tx = getClient()) {
  const now = new Date(); // app clock, consistent with Prisma-written timestamps
  await tx.$executeRaw`
    UPDATE "donors"
    SET "totalDonated"    = "totalDonated" + ${amount}::numeric,
        "donationCount"   = "donationCount" + 1,
        "lastDonationAt"  = ${now},
        "firstDonationAt" = COALESCE("firstDonationAt", ${now}),
        "updatedAt"       = ${now}
    WHERE "id" = ${donorId}`;
}

/**
 * Save a real name (e.g. from Hubtel's callback) only if we don't have one yet.
 * Treats the legacy 'Donor' placeholder as "no name".
 */
async function setNameIfMissing(phoneNumber, name) {
  const result = await getClient().donor.updateMany({
    where: { phoneNumber, name: { in: ['', 'Donor'] } },
    data: { name }
  });
  return result.count > 0;
}

async function list({ skip = 0, limit = 100, sortBy = 'totalDonated' } = {}) {
  const field = SORTABLE_FIELDS.includes(sortBy) ? sortBy : 'totalDonated';
  return toPlain(await getClient().donor.findMany({
    orderBy: { [field]: 'desc' },
    skip,
    take: limit
  }));
}

async function count() {
  return getClient().donor.count();
}

module.exports = {
  findById,
  findByPhone,
  findOrCreateByPhone,
  recordDonation,
  setNameIfMissing,
  list,
  count,
  SORTABLE_FIELDS
};
