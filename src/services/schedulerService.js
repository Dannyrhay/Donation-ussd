const cron = require('node-cron');
const subscriptionProcessor = require('./subscriptionProcessor');
const config = require('../config');

/**
 * Scheduler Service
 *
 * Manages scheduled tasks for the donation system.
 *
 * NOTE: With Hubtel Recurring Invoice API integration, Hubtel now handles
 * the scheduling and automatic debit processing for recurring subscriptions.
 * This scheduler is kept for:
 * 1. Processing legacy subscriptions not managed by Hubtel (managedByHubtel: false)
 * 2. Cleanup of expired subscriptions
 * 3. Generating reports and statistics
 *
 * Security measures:
 * - Configurable schedule via environment variables
 * - Graceful shutdown handling
 * - Health check endpoint support
 * - Comprehensive logging
 */

let subscriptionJob = null;
let isRunning = false;
let lastRunTime = null;
let lastRunResult = null;

// Default schedule: 6 AM daily (Ghana timezone UTC+0)
const DEFAULT_CRON_SCHEDULE = '0 6 * * *';

/**
 * Get the cron schedule from environment or default
 */
function getCronSchedule() {
  return process.env.SCHEDULER_CRON || DEFAULT_CRON_SCHEDULE;
}

/**
 * Check if scheduler is enabled
 */
function isSchedulerEnabled() {
  // Default to true in production, false in development
  if (process.env.SCHEDULER_ENABLED !== undefined) {
    return process.env.SCHEDULER_ENABLED === 'true';
  }
  return config.nodeEnv === 'production';
}

/**
 * Run the subscription processing job
 */
async function runSubscriptionJob() {
  if (isRunning) {
    console.log('[SCHEDULER] Job already running, skipping...');
    return null;
  }

  isRunning = true;
  const startTime = new Date();

  console.log('='.repeat(60));
  console.log('[SCHEDULER] Starting subscription processing job');
  console.log('[SCHEDULER] Time:', startTime.toISOString());
  console.log('='.repeat(60));

  try {
    const result = await subscriptionProcessor.processDueSubscriptions();

    lastRunTime = startTime;
    lastRunResult = {
      success: true,
      ...result,
      duration: Date.now() - startTime.getTime()
    };

    console.log('[SCHEDULER] Job completed successfully');
    console.log('[SCHEDULER] Results:', JSON.stringify(lastRunResult, null, 2));

    return lastRunResult;

  } catch (error) {
    console.error('[SCHEDULER] Job failed:', error.message);

    lastRunTime = startTime;
    lastRunResult = {
      success: false,
      error: error.message,
      duration: Date.now() - startTime.getTime()
    };

    return lastRunResult;

  } finally {
    isRunning = false;
    console.log('='.repeat(60));
  }
}

/**
 * Initialize and start the scheduler
 */
function start() {
  if (!isSchedulerEnabled()) {
    console.log('[SCHEDULER] Scheduler is disabled (set SCHEDULER_ENABLED=true to enable)');
    return false;
  }

  const schedule = getCronSchedule();

  // Validate cron expression
  if (!cron.validate(schedule)) {
    console.error(`[SCHEDULER] Invalid cron schedule: ${schedule}`);
    return false;
  }

  console.log('[SCHEDULER] Initializing scheduler...');
  console.log(`[SCHEDULER] Schedule: ${schedule}`);
  console.log(`[SCHEDULER] Environment: ${config.nodeEnv}`);

  // Create the cron job
  subscriptionJob = cron.schedule(schedule, async () => {
    await runSubscriptionJob();
  }, {
    scheduled: true,
    timezone: 'Africa/Accra' // Ghana timezone
  });

  console.log('[SCHEDULER] Scheduler started successfully');
  console.log('[SCHEDULER] Next run will be at the scheduled time');

  return true;
}

/**
 * Stop the scheduler gracefully
 */
function stop() {
  if (subscriptionJob) {
    subscriptionJob.stop();
    subscriptionJob = null;
    console.log('[SCHEDULER] Scheduler stopped');
  }
}

/**
 * Get scheduler status for health checks
 */
function getStatus() {
  return {
    enabled: isSchedulerEnabled(),
    running: isRunning,
    schedule: getCronSchedule(),
    timezone: 'Africa/Accra',
    lastRunTime: lastRunTime?.toISOString() || null,
    lastRunResult,
    jobScheduled: subscriptionJob !== null
  };
}

/**
 * Manually trigger the subscription job
 * Useful for testing or admin actions
 */
async function triggerNow() {
  console.log('[SCHEDULER] Manual trigger requested');
  return await runSubscriptionJob();
}

/**
 * Schedule a one-time delayed job
 * Useful for retry logic
 */
function scheduleDelayed(delayMs, callback) {
  setTimeout(callback, delayMs);
}

module.exports = {
  start,
  stop,
  getStatus,
  triggerNow,
  runSubscriptionJob,
  scheduleDelayed
};
