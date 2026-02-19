/**
 * Database Models Index
 *
 * Export all models from a single location
 */

const Donor = require('./Donor');
const Donation = require('./Donation');
const Subscription = require('./Subscription');

module.exports = {
  Donor,
  Donation,
  Subscription
};
