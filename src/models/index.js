/**
 * Data access (PostgreSQL via Prisma)
 *
 * Repositories return plain objects — there are no document methods like
 * `.save()`; call the repository functions instead.
 */

const Donor = require('./Donor');
const Donation = require('./Donation');
const Subscription = require('./Subscription');
const { isUniqueViolation } = require('../db/prisma');

module.exports = {
  Donor,
  Donation,
  Subscription,
  isUniqueViolation
};
