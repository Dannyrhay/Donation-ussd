const { Subscription, Donation, Donor } = require('../models');
const paymentService = require('./paymentService');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');

/**
 * Subscription Processor Service
 *
 * Handles automated processing of recurring subscription payments
 * with retry logic, failure handling, and comprehensive logging.
 *
 * NOTE: With Hubtel Recurring Invoice API integration, most subscriptions
 * are now managed by Hubtel (managedByHubtel: true). This processor only
 * handles legacy subscriptions that are not managed by Hubtel.
 *
 * For Hubtel-managed subscriptions:
 * - Hubtel handles scheduling and automatic debits
 * - We receive callbacks at /api/callback/recurring
 * - The Subscription model tracks the recurringInvoiceId
 *
 * Security measures:
 * - Rate limiting on processing
 * - Transaction locking to prevent duplicate charges
 * - Comprehensive audit logging
 * - Graceful error handling
 */

// Processing lock to prevent concurrent processing of same subscription
const processingLocks = new Map();

// Constants
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_HOURS = [1, 6, 24]; // Exponential backoff: 1hr, 6hr, 24hr
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Acquire a processing lock for a subscription
 * Prevents duplicate processing of the same subscription
 */
function acquireLock(subscriptionId) {
  const lockKey = subscriptionId.toString();

  if (processingLocks.has(lockKey)) {
    const lockTime = processingLocks.get(lockKey);
    const lockAge = Date.now() - lockTime;

    // Lock expires after 5 minutes
    if (lockAge < 5 * 60 * 1000) {
      return false;
    }
  }

  processingLocks.set(lockKey, Date.now());
  return true;
}

/**
 * Release a processing lock
 */
function releaseLock(subscriptionId) {
  processingLocks.delete(subscriptionId.toString());
}

/**
 * Sanitize data for logging (remove sensitive info)
 */
function sanitizeForLog(data) {
  if (!data) return data;

  const sanitized = { ...data };
  const sensitiveFields = ['apiKey', 'apiSecret', 'password', 'token', 'secret'];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Log subscription event with structured format
 */
function logEvent(level, event, subscriptionId, details = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    subscriptionId: subscriptionId?.toString(),
    ...sanitizeForLog(details)
  };

  const logMethod = level === 'error' ? console.error : console.log;
  logMethod(`[SUBSCRIPTION] ${JSON.stringify(logEntry)}`);
}

/**
 * Process a single subscription payment
 */
async function processSubscriptionPayment(subscription) {
  const subscriptionId = subscription._id;

  // Try to acquire lock
  if (!acquireLock(subscriptionId)) {
    logEvent('warn', 'LOCK_FAILED', subscriptionId, {
      message: 'Subscription already being processed'
    });
    return { success: false, reason: 'already_processing' };
  }

  try {
    logEvent('info', 'PROCESSING_START', subscriptionId, {
      amount: subscription.amount,
      frequency: subscription.frequency,
      phoneNumber: subscription.phoneNumber.slice(-4).padStart(subscription.phoneNumber.length, '*')
    });

    // Validate subscription is still active
    const currentSubscription = await Subscription.findById(subscriptionId);
    if (!currentSubscription || currentSubscription.status !== 'active') {
      logEvent('warn', 'SUBSCRIPTION_NOT_ACTIVE', subscriptionId, {
        status: currentSubscription?.status
      });
      return { success: false, reason: 'not_active' };
    }

    // Check if max payments reached
    if (currentSubscription.maxPayments &&
        currentSubscription.paymentsCompleted >= currentSubscription.maxPayments) {
      logEvent('info', 'MAX_PAYMENTS_REACHED', subscriptionId);
      await currentSubscription.cancel('Maximum payments reached');
      return { success: false, reason: 'max_payments_reached' };
    }

    // Check if end date passed
    if (currentSubscription.endDate && new Date() > currentSubscription.endDate) {
      logEvent('info', 'SUBSCRIPTION_EXPIRED', subscriptionId);
      await currentSubscription.cancel('Subscription end date reached');
      return { success: false, reason: 'expired' };
    }

    // Generate unique reference for this payment
    const reference = `SUB-${Date.now()}-${uuidv4().substring(0, 8)}`;

    // Get donor info
    const donor = await Donor.findById(currentSubscription.donor);

    // Create donation record
    const donation = await Donation.create({
      donor: currentSubscription.donor,
      phoneNumber: currentSubscription.phoneNumber,
      amount: currentSubscription.amount,
      channel: currentSubscription.channel,
      frequency: currentSubscription.frequency,
      subscription: subscriptionId,
      reference,
      status: 'pending',
      description: `Recurring ${currentSubscription.frequency} donation to ${config.orgName}`,
      source: 'subscription'
    });

    logEvent('info', 'DONATION_CREATED', subscriptionId, {
      donationId: donation._id.toString(),
      reference
    });

    // Initiate payment via Hubtel
    const paymentResult = await paymentService.initiatePayment({
      phoneNumber: currentSubscription.phoneNumber,
      amount: currentSubscription.amount,
      channel: currentSubscription.channel,
      description: `Recurring ${currentSubscription.frequency} donation to ${config.orgName}`,
      sessionId: `sub-${subscriptionId}`,
      frequency: currentSubscription.frequency
    });

    if (paymentResult.success) {
      logEvent('info', 'PAYMENT_INITIATED', subscriptionId, {
        reference,
        simulated: paymentResult.simulated
      });

      // Update subscription - payment initiated, waiting for callback
      // The actual success/failure will be handled by the payment callback
      return {
        success: true,
        reference,
        donation: donation._id,
        message: 'Payment initiated, awaiting confirmation'
      };
    } else {
      // Payment initiation failed
      logEvent('error', 'PAYMENT_INITIATION_FAILED', subscriptionId, {
        error: paymentResult.error
      });

      // Mark donation as failed
      await donation.markFailed(null, paymentResult.error || 'Payment initiation failed');

      // Record failure on subscription
      await currentSubscription.recordFailure(paymentResult.error || 'Payment initiation failed');

      return {
        success: false,
        reason: 'payment_failed',
        error: paymentResult.error
      };
    }

  } catch (error) {
    logEvent('error', 'PROCESSING_ERROR', subscriptionId, {
      error: error.message,
      stack: error.stack?.substring(0, 200)
    });

    return {
      success: false,
      reason: 'error',
      error: error.message
    };

  } finally {
    releaseLock(subscriptionId);
  }
}

/**
 * Process all due subscriptions
 * Called by the scheduler
 */
async function processDueSubscriptions() {
  const startTime = Date.now();

  logEvent('info', 'BATCH_PROCESSING_START', null, {
    timestamp: new Date().toISOString()
  });

  const results = {
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  try {
    // Find all subscriptions due for payment
    const dueSubscriptions = await Subscription.findDueForPayment();

    logEvent('info', 'SUBSCRIPTIONS_FOUND', null, {
      count: dueSubscriptions.length
    });

    if (dueSubscriptions.length === 0) {
      logEvent('info', 'NO_SUBSCRIPTIONS_DUE', null);
      return results;
    }

    // Process each subscription sequentially to avoid overwhelming the payment API
    for (const subscription of dueSubscriptions) {
      results.processed++;

      try {
        const result = await processSubscriptionPayment(subscription);

        if (result.success) {
          results.successful++;
        } else if (result.reason === 'already_processing') {
          results.skipped++;
        } else {
          results.failed++;
          results.errors.push({
            subscriptionId: subscription._id.toString(),
            reason: result.reason,
            error: result.error
          });
        }

        // Small delay between payments to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        results.failed++;
        results.errors.push({
          subscriptionId: subscription._id.toString(),
          error: error.message
        });
      }
    }

  } catch (error) {
    logEvent('error', 'BATCH_PROCESSING_ERROR', null, {
      error: error.message
    });
    results.errors.push({ error: error.message });
  }

  const duration = Date.now() - startTime;

  logEvent('info', 'BATCH_PROCESSING_COMPLETE', null, {
    duration: `${duration}ms`,
    ...results
  });

  return results;
}

/**
 * Get subscription processing statistics
 */
async function getProcessingStats() {
  try {
    const stats = await Subscription.getStats();
    const dueCount = await Subscription.countDocuments({
      status: 'active',
      nextPaymentDate: { $lte: new Date() }
    });

    return {
      ...stats,
      dueForPayment: dueCount,
      activeLocks: processingLocks.size
    };
  } catch (error) {
    logEvent('error', 'STATS_ERROR', null, { error: error.message });
    return null;
  }
}

/**
 * Manually trigger processing for a specific subscription
 * Used for testing or retry
 */
async function triggerSubscriptionPayment(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId);

  if (!subscription) {
    return { success: false, error: 'Subscription not found' };
  }

  if (subscription.status !== 'active') {
    return { success: false, error: `Subscription is ${subscription.status}` };
  }

  return processSubscriptionPayment(subscription);
}

/**
 * Pause a subscription with reason
 */
async function pauseSubscription(subscriptionId, reason) {
  try {
    const subscription = await Subscription.findById(subscriptionId);

    if (!subscription) {
      return { success: false, error: 'Subscription not found' };
    }

    await subscription.pause(reason);

    logEvent('info', 'SUBSCRIPTION_PAUSED', subscriptionId, { reason });

    return { success: true, subscription };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Resume a paused subscription
 */
async function resumeSubscription(subscriptionId) {
  try {
    const subscription = await Subscription.findById(subscriptionId);

    if (!subscription) {
      return { success: false, error: 'Subscription not found' };
    }

    if (subscription.status !== 'paused') {
      return { success: false, error: `Cannot resume: status is ${subscription.status}` };
    }

    await subscription.resume();

    logEvent('info', 'SUBSCRIPTION_RESUMED', subscriptionId);

    return { success: true, subscription };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  processDueSubscriptions,
  processSubscriptionPayment,
  triggerSubscriptionPayment,
  pauseSubscription,
  resumeSubscription,
  getProcessingStats
};
