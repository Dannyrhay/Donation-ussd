const mongoose = require('mongoose');

/**
 * Subscription Model
 *
 * Manages recurring donation subscriptions
 */
const subscriptionSchema = new mongoose.Schema({
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

  // Recurring amount in GHS
  amount: {
    type: Number,
    required: true,
    min: 1
  },

  // Payment channel
  channel: {
    type: String,
    enum: ['mtn-gh', 'vodafone-gh', 'tigo-gh'],
    required: true
  },

  // Frequency of payment
  frequency: {
    type: String,
    enum: ['weekly', 'monthly', 'quarterly', 'annually'],
    required: true
  },

  // Subscription status
  status: {
    type: String,
    enum: ['active', 'paused', 'cancelled', 'expired'],
    default: 'active',
    index: true
  },

  // Next payment date
  nextPaymentDate: {
    type: Date,
    required: true,
    index: true
  },

  // Last successful payment date
  lastPaymentDate: {
    type: Date
  },

  // Number of successful payments made
  paymentsCompleted: {
    type: Number,
    default: 0
  },

  // Number of failed payment attempts
  paymentsFailed: {
    type: Number,
    default: 0
  },

  // Total amount collected from this subscription
  totalCollected: {
    type: Number,
    default: 0
  },

  // Maximum number of payments (null = unlimited)
  maxPayments: {
    type: Number,
    default: null
  },

  // End date for subscription (null = no end date)
  endDate: {
    type: Date,
    default: null
  },

  // Why was it cancelled/paused?
  statusReason: {
    type: String
  },

  // Original USSD session that created this
  originalSessionId: {
    type: String
  },

  // Created via
  source: {
    type: String,
    enum: ['ussd', 'web', 'app'],
    default: 'ussd'
  }

}, {
  timestamps: true
});

/**
 * Calculate next payment date based on frequency
 */
subscriptionSchema.methods.calculateNextPaymentDate = function(fromDate = new Date()) {
  const date = new Date(fromDate);

  switch (this.frequency) {
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'annually':
      date.setFullYear(date.getFullYear() + 1);
      break;
  }

  return date;
};

/**
 * Record successful payment
 */
subscriptionSchema.methods.recordPayment = async function(amount) {
  this.paymentsCompleted += 1;
  this.totalCollected += amount;
  this.lastPaymentDate = new Date();
  this.nextPaymentDate = this.calculateNextPaymentDate();
  this.paymentsFailed = 0; // Reset failed counter on success

  // Check if we've reached max payments
  if (this.maxPayments && this.paymentsCompleted >= this.maxPayments) {
    this.status = 'expired';
    this.statusReason = 'Maximum payments reached';
  }

  // Check if we've passed end date
  if (this.endDate && new Date() >= this.endDate) {
    this.status = 'expired';
    this.statusReason = 'Subscription end date reached';
  }

  await this.save();
  return this;
};

/**
 * Record failed payment
 */
subscriptionSchema.methods.recordFailure = async function(reason) {
  this.paymentsFailed += 1;

  // Pause subscription after 3 consecutive failures
  if (this.paymentsFailed >= 3) {
    this.status = 'paused';
    this.statusReason = `Paused after ${this.paymentsFailed} failed payments: ${reason}`;
  }

  await this.save();
  return this;
};

/**
 * Cancel subscription
 */
subscriptionSchema.methods.cancel = async function(reason = 'User requested cancellation') {
  this.status = 'cancelled';
  this.statusReason = reason;
  await this.save();
  return this;
};

/**
 * Pause subscription
 */
subscriptionSchema.methods.pause = async function(reason = 'User requested pause') {
  this.status = 'paused';
  this.statusReason = reason;
  await this.save();
  return this;
};

/**
 * Resume subscription
 */
subscriptionSchema.methods.resume = async function() {
  this.status = 'active';
  this.statusReason = null;
  this.paymentsFailed = 0;
  // Set next payment to today or tomorrow if overdue
  if (this.nextPaymentDate < new Date()) {
    this.nextPaymentDate = new Date();
    this.nextPaymentDate.setDate(this.nextPaymentDate.getDate() + 1);
  }
  await this.save();
  return this;
};

/**
 * Find subscriptions due for payment
 */
subscriptionSchema.statics.findDueForPayment = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    nextPaymentDate: { $lte: now }
  }).populate('donor');
};

/**
 * Find active subscriptions for a phone number
 */
subscriptionSchema.statics.findActiveByPhone = function(phoneNumber) {
  return this.find({
    phoneNumber,
    status: 'active'
  });
};

/**
 * Get subscription statistics
 */
subscriptionSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    }
  ]);

  const result = {
    active: { count: 0, totalAmount: 0 },
    paused: { count: 0, totalAmount: 0 },
    cancelled: { count: 0, totalAmount: 0 },
    expired: { count: 0, totalAmount: 0 }
  };

  stats.forEach(stat => {
    result[stat._id] = {
      count: stat.count,
      totalAmount: stat.totalAmount
    };
  });

  return result;
};

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = Subscription;
