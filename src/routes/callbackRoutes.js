const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const donationService = require('../services/donationService');
const recurringInvoiceService = require('../services/recurringInvoiceService');

/**
 * Callback Routes
 *
 * These endpoints receive callbacks from Hubtel after payment events
 * and provide admin endpoints for viewing donations.
 */

/**
 * POST /api/callback/payment
 * Receives payment status callbacks from Hubtel (one-time payments)
 */
router.post('/payment', async (req, res) => {
  console.log('='.repeat(50));
  console.log('PAYMENT CALLBACK RECEIVED');
  console.log('='.repeat(50));

  try {
    const result = await paymentService.handlePaymentCallback(req.body);

    if (result) {
      console.log(`Payment ${result.reference} status: ${result.status}`);

      res.json({
        success: true,
        message: 'Callback processed',
        paymentStatus: result.status
      });
    } else {
      console.log('Payment not found for callback');
      res.json({
        success: false,
        message: 'Payment reference not found'
      });
    }

  } catch (error) {
    console.error('Callback processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing callback'
    });
  }
});

/**
 * POST /api/callback/recurring
 * Receives recurring invoice callbacks from Hubtel
 *
 * Hubtel sends callbacks for:
 * - Initial payment (after invoice creation)
 * - Each recurring payment
 * - Invoice cancellation
 */
router.post('/recurring', async (req, res) => {
  console.log('='.repeat(50));
  console.log('RECURRING INVOICE CALLBACK RECEIVED');
  console.log('='.repeat(50));

  try {
    // Process the callback
    const result = recurringInvoiceService.handleRecurringCallback(req.body);

    // Find the subscription by recurring invoice ID
    const { Subscription, Donation, Donor } = require('../models');

    let subscription = null;
    if (result.recurringInvoiceId) {
      subscription = await Subscription.findByRecurringInvoiceId(result.recurringInvoiceId);
    }

    // If not found by invoice ID, try client reference
    if (!subscription && result.clientReference) {
      subscription = await Subscription.findByClientReference(result.clientReference);
    }

    if (subscription) {
      if (result.success) {
        // Payment successful
        await subscription.recordPayment(result.amount || subscription.amount);

        // Record donation
        await Donation.create({
          donor: subscription.donor,
          phoneNumber: subscription.phoneNumber,
          amount: result.amount || subscription.amount,
          channel: subscription.channel,
          frequency: subscription.frequency,
          subscription: subscription._id,
          reference: `REC-${result.transactionId || Date.now()}`,
          status: 'Success',
          description: `Recurring ${subscription.frequency} donation`,
          source: 'hubtel_recurring',
          hubtelTransactionId: result.transactionId
        });

        console.log(`Recurring payment recorded for subscription ${subscription._id}`);

      } else if (result.failed) {
        // Payment failed
        await subscription.recordFailure(result.message);
        console.log(`Recurring payment failed for subscription ${subscription._id}`);

      } else if (result.cancelled) {
        // Invoice cancelled
        await subscription.cancel('Cancelled by Hubtel');
        console.log(`Subscription ${subscription._id} cancelled`);
      }

      res.json({
        success: true,
        message: 'Recurring callback processed',
        subscriptionId: subscription._id.toString(),
        status: subscription.status
      });
    } else {
      // No subscription found, but still acknowledge the callback
      console.log('No subscription found for recurring callback');
      console.log('Invoice ID:', result.recurringInvoiceId);
      console.log('Client Reference:', result.clientReference);

      res.json({
        success: true,
        message: 'Callback received but no matching subscription found',
        data: result
      });
    }

  } catch (error) {
    console.error('Recurring callback error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing recurring callback'
    });
  }
});

/**
 * GET /api/callback/payments
 * List all payments/donations
 */
router.get('/payments', async (req, res) => {
  try {
    const { status, phone, limit } = req.query;

    const payments = await paymentService.getAllPayments({
      status,
      phoneNumber: phone,
      limit: parseInt(limit) || 100
    });

    res.json({
      success: true,
      count: payments.length,
      donations: payments
    });

  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payments'
    });
  }
});

/**
 * GET /api/callback/payment/:reference
 * Get specific payment by reference
 */
router.get('/payment/:reference', async (req, res) => {
  try {
    const payment = await paymentService.getPayment(req.params.reference);

    if (payment) {
      res.json({
        success: true,
        donation: payment
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment'
    });
  }
});

/**
 * GET /api/callback/stats
 * Get donation statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await paymentService.getStats();

    if (stats) {
      res.json({
        success: true,
        stats
      });
    } else {
      res.json({
        success: false,
        message: 'Could not fetch statistics'
      });
    }

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

/**
 * GET /api/callback/subscriptions
 * Get all active subscriptions
 */
router.get('/subscriptions', async (req, res) => {
  try {
    const { Subscription } = require('../models');
    const subscriptions = await Subscription.find()
      .sort({ createdAt: -1 })
      .populate('donor');

    res.json({
      success: true,
      count: subscriptions.length,
      subscriptions
    });

  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscriptions'
    });
  }
});

/**
 * POST /api/callback/subscriptions/:id/cancel
 * Cancel a subscription
 */
router.post('/subscriptions/:id/cancel', async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await donationService.cancelSubscription(
      req.params.id,
      reason || 'Cancelled via API'
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Subscription cancelled',
        subscription: result.subscription
      });
    } else {
      res.status(404).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel subscription'
    });
  }
});

/**
 * GET /api/callback/donors
 * Get all donors
 */
router.get('/donors', async (req, res) => {
  try {
    const { Donor } = require('../models');
    const donors = await Donor.find()
      .sort({ totalDonated: -1 });

    res.json({
      success: true,
      count: donors.length,
      donors
    });

  } catch (error) {
    console.error('Error fetching donors:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch donors'
    });
  }
});

module.exports = router;
