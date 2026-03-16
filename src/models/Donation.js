const mongoose = require('mongoose');

/**
 * Donation Model
 *
 * Records each individual donation/payment transaction
 */
const donationSchema = new mongoose.Schema({
  // Reference to donor
  donor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Donor',
    required: true,
    index: true
  },

  // Phone number (for quick lookup)
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },

  // Amount in GHS
  amount: {
    type: Number,
    required: true,
    min: 1
  },

  // Payment channel (standard or recurring)
  channel: {
    type: String,
    enum: ['mtn-gh', 'vodafone-gh', 'tigo-gh', 'mtn_gh_rec', 'vodafone_gh_rec'],
    required: true
  },

  // Frequency type
  frequency: {
    type: String,
    enum: ['once', 'weekly', 'monthly', 'annually'],
    default: 'once'
  },

  // Reference to subscription (if recurring)
  subscription: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    default: null
  },

  // Unique reference for this transaction
  reference: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // USSD session ID
  sessionId: {
    type: String
  },

  // Payment status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'fulfilled', 'Success', 'failed', 'cancelled', 'refunded'],
    default: 'pending',
    index: true
  },

  // Description
  description: {
    type: String,
    default: 'Donation to Jesus Mission Fund'
  },

  // Hubtel transaction ID
  hubtelTransactionId: {
    type: String
  },

  // Hubtel response data
  hubtelResponse: {
    type: mongoose.Schema.Types.Mixed
  },

  // Callback data received
  callbackData: {
    type: mongoose.Schema.Types.Mixed
  },

  // Error message (if failed)
  errorMessage: {
    type: String
  },

  // When payment was initiated
  initiatedAt: {
    type: Date,
    default: Date.now
  },

  // When payment was completed
  completedAt: {
    type: Date
  },

  // When service was fulfilled (set by fulfilment callback)
  fulfilledAt: {
    type: Date
  },

  // Source of donation
  source: {
    type: String,
    enum: ['ussd', 'web', 'app', 'subscription', 'hubtel_recurring'],
    default: 'ussd'
  }

}, {
  timestamps: true
});

/**
 * Mark donation as completed
 */
donationSchema.methods.markCompleted = async function(callbackData) {
  this.status = 'completed';
  this.completedAt = new Date();
  this.callbackData = callbackData;

  if (callbackData?.Data?.TransactionId) {
    this.hubtelTransactionId = callbackData.Data.TransactionId;
  }

  await this.save();

  // Update donor statistics
  const Donor = mongoose.model('Donor');
  const donor = await Donor.findById(this.donor);
  if (donor) {
    await donor.recordDonation(this.amount);
  }

  return this;
};

/**
 * Mark donation as failed
 */
donationSchema.methods.markFailed = async function(callbackData, errorMessage) {
  this.status = 'failed';
  this.callbackData = callbackData;
  this.errorMessage = errorMessage || 'Payment failed';
  await this.save();
  return this;
};

/**
 * Get donations by status
 */
donationSchema.statics.findByStatus = function(status) {
  return this.find({ status }).sort({ createdAt: -1 });
};

/**
 * Get donations for a specific phone number
 */
donationSchema.statics.findByPhone = function(phoneNumber) {
  return this.find({ phoneNumber }).sort({ createdAt: -1 });
};

/**
 * Get total donations for a period
 */
donationSchema.statics.getTotalForPeriod = async function(startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        status: { $in: ['completed', 'fulfilled'] },
        $or: [
          { completedAt: { $gte: startDate, $lte: endDate } },
          { fulfilledAt: { $gte: startDate, $lte: endDate } }
        ]
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);

  return result[0] || { total: 0, count: 0 };
};

const Donation = mongoose.model('Donation', donationSchema);

module.exports = Donation;
