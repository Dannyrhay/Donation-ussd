const express = require('express');
const router = express.Router();
const schedulerService = require('../services/schedulerService');
const subscriptionProcessor = require('../services/subscriptionProcessor');
const { Subscription, Donation, Donor } = require('../models');
const { adminAuth } = require('../middleware/auth');
const { parsePagination, escapeRegex } = require('../utils/pagination');

/**
 * Admin Routes
 *
 * Protected endpoints for managing subscriptions and the scheduler.
 */

// Apply admin auth to all routes
router.use(adminAuth);

/**
 * GET /api/admin/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/admin/scheduler/status
 * Get scheduler status
 */
router.get('/scheduler/status', (req, res) => {
  const status = schedulerService.getStatus();
  res.json({
    success: true,
    scheduler: status
  });
});

/**
 * POST /api/admin/scheduler/trigger
 * Manually trigger subscription processing
 */
router.post('/scheduler/trigger', async (req, res) => {
  try {
    console.log('[ADMIN] Manual scheduler trigger requested');

    const result = await schedulerService.triggerNow();

    res.json({
      success: true,
      message: 'Subscription processing completed',
      result
    });
  } catch (error) {
    console.error('[ADMIN] Scheduler trigger error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/subscriptions
 * List all subscriptions with filters
 */
router.get('/subscriptions', async (req, res) => {
  try {
    const { status, phone } = req.query;
    const { limit, skip } = parsePagination(req.query);

    const query = {};
    if (status) query.status = status;
    if (phone) query.phoneNumber = { $regex: escapeRegex(phone) };

    const subscriptions = await Subscription.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('donor');

    const total = await Subscription.countDocuments(query);

    res.json({
      success: true,
      total,
      count: subscriptions.length,
      subscriptions
    });
  } catch (error) {
    console.error('[ADMIN] List subscriptions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/subscriptions/stats
 * Get subscription statistics
 */
router.get('/subscriptions/stats', async (req, res) => {
  try {
    const stats = await subscriptionProcessor.getProcessingStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('[ADMIN] Stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/subscriptions/due
 * Get subscriptions due for payment
 */
router.get('/subscriptions/due', async (req, res) => {
  try {
    const dueSubscriptions = await Subscription.findDueForPayment();

    res.json({
      success: true,
      count: dueSubscriptions.length,
      subscriptions: dueSubscriptions
    });
  } catch (error) {
    console.error('[ADMIN] Due subscriptions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/subscriptions/:id
 * Get specific subscription details
 */
router.get('/subscriptions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid subscription ID'
      });
    }

    const subscription = await Subscription.findById(id).populate('donor');

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found'
      });
    }

    // Get related donations
    const donations = await Donation.find({ subscription: id })
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      subscription,
      recentDonations: donations
    });
  } catch (error) {
    console.error('[ADMIN] Get subscription error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/subscriptions/:id/trigger
 * Manually trigger payment for a specific subscription
 */
router.post('/subscriptions/:id/trigger', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid subscription ID'
      });
    }

    console.log(`[ADMIN] Manual payment trigger for subscription: ${id}`);

    const result = await subscriptionProcessor.triggerSubscriptionPayment(id);

    if (result.success) {
      res.json({
        success: true,
        message: 'Payment triggered successfully',
        result
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || result.reason
      });
    }
  } catch (error) {
    console.error('[ADMIN] Trigger payment error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/subscriptions/:id/pause
 * Pause a subscription
 */
router.post('/subscriptions/:id/pause', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid subscription ID'
      });
    }

    const result = await subscriptionProcessor.pauseSubscription(
      id,
      reason || 'Paused by admin'
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Subscription paused',
        subscription: result.subscription
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('[ADMIN] Pause subscription error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/subscriptions/:id/resume
 * Resume a paused subscription
 */
router.post('/subscriptions/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid subscription ID'
      });
    }

    const result = await subscriptionProcessor.resumeSubscription(id);

    if (result.success) {
      res.json({
        success: true,
        message: 'Subscription resumed',
        subscription: result.subscription
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('[ADMIN] Resume subscription error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/subscriptions/:id/cancel
 * Cancel a subscription
 */
router.post('/subscriptions/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid subscription ID'
      });
    }

    const subscription = await Subscription.findById(id);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found'
      });
    }

    await subscription.cancel(reason || 'Cancelled by admin');

    console.log(`[ADMIN] Subscription cancelled: ${id}`);

    res.json({
      success: true,
      message: 'Subscription cancelled',
      subscription
    });
  } catch (error) {
    console.error('[ADMIN] Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/donations
 * List donations with filters
 */
router.get('/donations', async (req, res) => {
  try {
    const { status, phone, subscriptionId } = req.query;
    const { limit, skip } = parsePagination(req.query);

    const query = {};
    if (status) query.status = status;
    if (phone) query.phoneNumber = { $regex: escapeRegex(phone) };
    if (subscriptionId) query.subscription = subscriptionId;

    const donations = await Donation.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('donor')
      .populate('subscription');

    const total = await Donation.countDocuments(query);

    res.json({
      success: true,
      total,
      count: donations.length,
      donations
    });
  } catch (error) {
    console.error('[ADMIN] List donations error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/donors
 * List donors
 */
router.get('/donors', async (req, res) => {
  try {
    const { sortBy = 'totalDonated' } = req.query;
    const { limit, skip } = parsePagination(req.query);

    const sortOptions = {};
    sortOptions[sortBy] = -1;

    const donors = await Donor.find()
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);

    const total = await Donor.countDocuments();

    res.json({
      success: true,
      total,
      count: donors.length,
      donors
    });
  } catch (error) {
    console.error('[ADMIN] List donors error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
