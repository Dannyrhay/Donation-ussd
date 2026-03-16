const mongoose = require('mongoose');

/**
 * Subscription Model
 *
 * Manages recurring donation subscriptions using Hubtel Recurring Invoice API.
 * Hubtel handles the scheduling and automatic debit processing.
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

  // Payment channel (standard or recurring)
  channel: {
    type: String,
    enum: ['mtn-gh', 'vodafone-gh', 'tigo-gh', 'mtn_gh_rec', 'vodafone_gh_rec'],
    required: true
  },

  // Frequency of payment
  frequency: {
    type: String,
    enum: ['weekly', 'monthly', 'annually'],
    required: true
  },

  // Subscription status
  status: {
    type: String,
    enum: ['pending', 'active', 'paused', 'cancelled', 'expired', 'failed'],
    default: 'pending',
    index: true
  },

  // Hubtel Recurring Invoice ID (from Hubtel API)
  recurringInvoiceId: {
    type: String,
    index: true,
    sparse: true
  },

  // Hubtel Request ID (for verification if needed)
  hubtelRequestId: {
    type: String
  },

  // Hubtel verification type (USSD or OTP)
  hubtelVerificationType: {
    type: String
  },

  // Last Hubtel response code
  hubtelResponseCode: {
    type: String
  },

  // Next payment date (tracked for display, Hubtel manages actual scheduling)
  nextPaymentDate: {
    type: Date,
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

  // Invoice end date (sent to Hubtel)
  invoiceEndDate: {
    type: Date
  },

  // Why was it cancelled/paused?
  statusReason: {
    type: String
  },

  // Original USSD session that created this
  originalSessionId: {
    type: String
  },

  // Client reference for tracking
  clientReference: {
    type: String,
    index: true
  },

  // Created via
  source: {
    type: String,
    enum: ['ussd', 'web', 'app'],
    default: 'ussd'
  },

  // Whether this is managed by Hubtel Recurring API
  managedByHubtel: {
    type: Boolean,
    default: true
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
 * Activate subscription after Hubtel confirms
 */
subscriptionSchema.methods.activate = async function(hubtelData = {}) {
  this.status = 'active';
  this.statusReason = null;
  if (hubtelData.recurringInvoiceId) {
    this.recurringInvoiceId = hubtelData.recurringInvoiceId;
  }
  if (hubtelData.responseCode) {
    this.hubtelResponseCode = hubtelData.responseCode;
  }
  this.nextPaymentDate = this.calculateNextPaymentDate();
  await this.save();
  return this;
};

/**
 * Mark subscription as failed
 */
subscriptionSchema.methods.markFailed = async function(reason) {
  this.status = 'failed';
  this.statusReason = reason;
  await this.save();
  return this;
};

/**
 * Find subscription by Hubtel recurring invoice ID
 */
subscriptionSchema.statics.findByRecurringInvoiceId = function(recurringInvoiceId) {
  return this.findOne({ recurringInvoiceId });
};

/**
 * Find subscription by client reference
 */
subscriptionSchema.statics.findByClientReference = function(clientReference) {
  return this.findOne({ clientReference });
};

/**
 * Find subscriptions due for payment (for non-Hubtel managed subscriptions)
 */
subscriptionSchema.statics.findDueForPayment = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    managedByHubtel: false,
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
  }).sort({ createdAt: -1 });
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
    pending: { count: 0, totalAmount: 0 },
    active: { count: 0, totalAmount: 0 },
    paused: { count: 0, totalAmount: 0 },
    cancelled: { count: 0, totalAmount: 0 },
    expired: { count: 0, totalAmount: 0 },
    failed: { count: 0, totalAmount: 0 }
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
