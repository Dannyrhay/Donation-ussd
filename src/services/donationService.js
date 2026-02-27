const { Donor, Donation, Subscription } = require('../models');
const { v4: uuidv4 } = require('uuid');

/**
 * Donation Service
 *
 * Handles database operations for donations and subscriptions
 */

/**
 * Create a new donation record
 */
async function createDonation(data) {
  const {
    phoneNumber,
    amount,
    channel,
    frequency,
    sessionId,
    description
  } = data;

  try {
    // Find or create donor
    const donor = await Donor.findOrCreateByPhone(
      phoneNumber,
      channel.split('-')[0] // Extract network from channel (e.g., 'mtn' from 'mtn-gh')
    );

    // Generate unique reference
    const reference = `DON-${Date.now()}-${uuidv4().substring(0, 8)}`;

    // Create donation record
    const donation = await Donation.create({
      donor: donor._id,
      phoneNumber,
      amount,
      channel,
      frequency,
      reference,
      sessionId,
      description: description || `Donation to Jesus Mission Fund`,
      status: 'pending',
      source: 'ussd'
    });

    console.log(`Donation created: ${reference} - GHS ${amount} from ${phoneNumber}`);

    return {
      success: true,
      donation,
      donor,
      reference
    };

  } catch (error) {
    console.error('Error creating donation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Create a subscription for recurring donations
 * Now integrates with Hubtel Recurring Invoice API
 */
async function createSubscription(data) {
  const {
    phoneNumber,
    amount,
    channel,
    frequency,
    sessionId,
    recurringInvoiceId,
    hubtelRequestId,
    hubtelVerificationType,
    clientReference,
    managedByHubtel = true
  } = data;

  try {
    // Find or create donor
    const networkCode = channel.includes('_rec')
      ? channel.replace('_gh_rec', '')
      : channel.split('-')[0];
    const donor = await Donor.findOrCreateByPhone(phoneNumber, networkCode);

    // Calculate first payment date and end date
    const nextPaymentDate = new Date();
    let invoiceEndDate = new Date();

    switch (frequency) {
      case 'weekly':
        invoiceEndDate.setFullYear(invoiceEndDate.getFullYear() + 1);
        break;
      case 'monthly':
        invoiceEndDate.setFullYear(invoiceEndDate.getFullYear() + 2);
        break;
      case 'annually':
        invoiceEndDate.setFullYear(invoiceEndDate.getFullYear() + 10);
        break;
    }

    // Create subscription
    const subscription = await Subscription.create({
      donor: donor._id,
      phoneNumber,
      amount,
      channel,
      frequency,
      status: recurringInvoiceId ? 'active' : 'pending',
      recurringInvoiceId,
      hubtelRequestId,
      hubtelVerificationType,
      clientReference,
      nextPaymentDate,
      invoiceEndDate,
      originalSessionId: sessionId,
      source: 'ussd',
      managedByHubtel
    });

    console.log(`Subscription created: ${subscription._id} - GHS ${amount} ${frequency} from ${phoneNumber}`);
    if (recurringInvoiceId) {
      console.log(`Hubtel Invoice ID: ${recurringInvoiceId}`);
    }

    return {
      success: true,
      subscription,
      donor
    };

  } catch (error) {
    console.error('Error creating subscription:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update donation status after payment callback
 */
async function updateDonationStatus(reference, status, callbackData) {
  try {
    const donation = await Donation.findOne({ reference });

    if (!donation) {
      console.error(`Donation not found: ${reference}`);
      return { success: false, error: 'Donation not found' };
    }

    if (status === 'completed' || status === 'Success') {
      await donation.markCompleted(callbackData);
      console.log(`Donation completed: ${reference}`);
    } else {
      await donation.markFailed(callbackData, status);
      console.log(`Donation failed: ${reference} - ${status}`);
    }

    return {
      success: true,
      donation
    };

  } catch (error) {
    console.error('Error updating donation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get donation by reference
 */
async function getDonationByReference(reference) {
  return Donation.findOne({ reference }).populate('donor');
}

/**
 * Get all donations for a phone number
 */
async function getDonationsByPhone(phoneNumber) {
  return Donation.find({ phoneNumber }).sort({ createdAt: -1 });
}

/**
 * Get active subscriptions for a phone number
 */
async function getActiveSubscriptions(phoneNumber) {
  return Subscription.findActiveByPhone(phoneNumber);
}

/**
 * Cancel a subscription
 * Also cancels the Hubtel recurring invoice if applicable
 */
async function cancelSubscription(subscriptionId, reason) {
  try {
    const subscription = await Subscription.findById(subscriptionId);

    if (!subscription) {
      return { success: false, error: 'Subscription not found' };
    }

    // If managed by Hubtel and has invoice ID, cancel on Hubtel
    if (subscription.managedByHubtel && subscription.recurringInvoiceId) {
      const recurringService = require('./recurringInvoiceService');
      const hubtelResult = await recurringService.cancelRecurringInvoice(subscription.recurringInvoiceId);

      if (!hubtelResult.success && !hubtelResult.simulated) {
        console.warn('Failed to cancel Hubtel invoice:', hubtelResult.error);
        // Continue with local cancellation even if Hubtel fails
      }
    }

    await subscription.cancel(reason);

    return {
      success: true,
      subscription
    };

  } catch (error) {
    console.error('Error cancelling subscription:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get subscriptions due for payment (for scheduler)
 */
async function getDueSubscriptions() {
  return Subscription.findDueForPayment();
}

/**
 * Get donation statistics
 */
async function getStats() {
  try {
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [todayStats, monthStats, yearStats, subscriptionStats] = await Promise.all([
      Donation.getTotalForPeriod(startOfDay, new Date()),
      Donation.getTotalForPeriod(startOfMonth, new Date()),
      Donation.getTotalForPeriod(startOfYear, new Date()),
      Subscription.getStats()
    ]);

    const donorCount = await Donor.countDocuments();
    const totalDonations = await Donation.countDocuments({ status: 'completed' });

    return {
      today: todayStats,
      thisMonth: monthStats,
      thisYear: yearStats,
      subscriptions: subscriptionStats,
      totalDonors: donorCount,
      totalDonations
    };

  } catch (error) {
    console.error('Error getting stats:', error);
    return null;
  }
}

module.exports = {
  createDonation,
  createSubscription,
  updateDonationStatus,
  getDonationByReference,
  getDonationsByPhone,
  getActiveSubscriptions,
  cancelSubscription,
  getDueSubscriptions,
  getStats
};
