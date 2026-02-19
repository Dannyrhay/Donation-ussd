const mongoose = require('mongoose');

/**
 * Donor Model
 *
 * Stores information about people who donate
 */
const donorSchema = new mongoose.Schema({
  // Phone number (primary identifier)
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Name (optional - can be collected later)
  name: {
    type: String,
    default: ''
  },

  // Email (optional)
  email: {
    type: String,
    default: ''
  },

  // Mobile network (MTN, Telecel, AirtelTigo)
  network: {
    type: String,
    enum: ['mtn', 'telecel', 'airteltigo', 'unknown'],
    default: 'unknown'
  },

  // Total amount donated (lifetime)
  totalDonated: {
    type: Number,
    default: 0
  },

  // Number of donations
  donationCount: {
    type: Number,
    default: 0
  },

  // First donation date
  firstDonationAt: {
    type: Date
  },

  // Last donation date
  lastDonationAt: {
    type: Date
  },

  // Is this donor active?
  isActive: {
    type: Boolean,
    default: true
  },

  // Notes (for admin use)
  notes: {
    type: String,
    default: ''
  }

}, {
  timestamps: true  // Adds createdAt and updatedAt
});

/**
 * Update donor statistics after a successful donation
 */
donorSchema.methods.recordDonation = async function(amount) {
  this.totalDonated += amount;
  this.donationCount += 1;
  this.lastDonationAt = new Date();

  if (!this.firstDonationAt) {
    this.firstDonationAt = new Date();
  }

  await this.save();
};

/**
 * Find or create donor by phone number
 */
donorSchema.statics.findOrCreateByPhone = async function(phoneNumber, network = 'unknown') {
  let donor = await this.findOne({ phoneNumber });

  if (!donor) {
    donor = await this.create({
      phoneNumber,
      network
    });
  }

  return donor;
};

const Donor = mongoose.model('Donor', donorSchema);

module.exports = Donor;
