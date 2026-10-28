const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const donationService = require('../services/donationService');
const recurringInvoiceService = require('../services/recurringInvoiceService');
const { adminAuth, callbackAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validation');
const { parsePagination } = require('../utils/pagination');
const { 
  paymentCallbackSchema, 
  recurringCallbackSchema, 
  fulfilmentCallbackSchema
} = require('../utils/validation');

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
router.post('/payment', callbackAuth, validateBody(paymentCallbackSchema), async (req, res) => {
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
router.post('/recurring', callbackAuth, validateBody(recurringCallbackSchema), async (req, res) => {
  console.log('='.repeat(50));
  console.log('RECURRING INVOICE CALLBACK RECEIVED');
  console.log('='.repeat(50));

  try {
    // Process the callback
    const result = recurringInvoiceService.handleRecurringCallback(req.body);

    // Find the subscription by recurring invoice ID
    const { Subscription, isUniqueViolation } = require('../models');

    let subscription = null;
    if (result.recurringInvoiceId) {
      subscription = await Subscription.findByRecurringInvoiceId(result.recurringInvoiceId);
    }

    // If not found by invoice ID, try client reference
    if (!subscription && result.clientReference) {
      subscription = await Subscription.findByClientReference(result.clientReference);
    }

    if (subscription) {
      let updated = subscription;

      if (result.success) {
        // Payment successful
        //
        // Idempotency: Hubtel retries callbacks. The Donation insert and the
        // subscription update run in ONE transaction, guarded by the Donation's
        // unique `reference` (REC-<transactionId>). A retry fails the insert, the
        // transaction rolls back, and we acknowledge without counting twice.
        if (!result.transactionId) {
          console.warn(`Recurring callback without TransactionId for subscription ${subscription.id} — cannot deduplicate`);
        }

        const amount = result.amount || subscription.amount;
        const reference = `REC-${result.transactionId || Date.now()}`;

        try {
          ({ subscription: updated } = await Subscription.recordRecurringPayment(subscription, {
            amount,
            reference,
            transactionId: result.transactionId
          }));
        } catch (err) {
          if (isUniqueViolation(err)) {
            console.log(`Duplicate recurring callback for ${reference} — already recorded, acknowledging`);
            return res.json({
              success: true,
              message: 'Recurring callback already processed',
              subscriptionId: subscription.id,
              status: subscription.status
            });
          }
          throw err;
        }

        console.log(`Recurring payment recorded for subscription ${subscription.id}`);

      } else if (result.failed) {
        // Payment failed
        updated = await Subscription.recordFailure(subscription.id, result.message);
        console.log(`Recurring payment failed for subscription ${subscription.id}`);

      } else if (result.cancelled) {
        // Invoice cancelled
        updated = await Subscription.cancel(subscription.id, 'Cancelled by Hubtel');
        console.log(`Subscription ${subscription.id} cancelled`);
      }

      res.json({
        success: true,
        message: 'Recurring callback processed',
        subscriptionId: subscription.id,
        status: updated.status
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
 * POST /api/callback/fulfilment
 * Receives service fulfilment callbacks from Hubtel (one-time payments)
 *
 * IMPORTANT: Must ALWAYS return HTTP 200 with TXN_SUCCESS.
 * Returning an error status risks Hubtel reversing the payment.
 */
router.post('/fulfilment', callbackAuth, validateBody(fulfilmentCallbackSchema), async (req, res) => {
  console.log('='.repeat(50));
  console.log('FULFILMENT CALLBACK RECEIVED');
  console.log('='.repeat(50));

  try {
    const result = await paymentService.handleFulfilmentCallback(req.body);
    res.json(result);
  } catch (error) {
    // Catch-all: never let an error propagate to Express error handler
    // Hubtel must receive TXN_SUCCESS or it may reverse the payment
    console.error('Fulfilment callback unexpected error:', error);
    res.json({
      ResponseCode: '0000',
      Status: 'TXN_SUCCESS',
      Message: 'Fulfilled'
    });
  }
});

/**
 * GET /api/callback/payments
 * List all payments/donations
 */
router.get('/payments', adminAuth, async (req, res) => {
  try {
    const { status, phone } = req.query;
    const { limit } = parsePagination(req.query);

    const payments = await paymentService.getAllPayments({
      status,
      phoneNumber: phone,
      limit
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
router.get('/payment/:reference', adminAuth, async (req, res) => {
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
router.get('/stats', adminAuth, async (req, res) => {
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
router.get('/subscriptions', adminAuth, async (req, res) => {
  try {
    const { Subscription } = require('../models');
    const { limit, skip } = parsePagination(req.query);

    const [subscriptions, total] = await Promise.all([
      Subscription.list({}, { skip, limit, includeDonor: true }),
      Subscription.count()
    ]);

    res.json({
      success: true,
      total,
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
router.post('/subscriptions/:id/cancel', adminAuth, async (req, res) => {
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
router.get('/donors', adminAuth, async (req, res) => {
  try {
    const { Donor } = require('../models');
    const { limit, skip } = parsePagination(req.query);

    const [donors, total] = await Promise.all([
      Donor.list({ skip, limit, sortBy: 'totalDonated' }),
      Donor.count()
    ]);

    res.json({
      success: true,
      total,
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
