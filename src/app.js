const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const { connectDatabase } = require('./config/database');
const { sanitize } = require('./utils/logger');
const { auditLog, ussdAuth } = require('./middleware/auth');
const { 
  generalLimiter, 
  ussdLimiter, 
  adminLimiter, 
  callbackLimiter 
} = require('./middleware/rateLimiter');
const ussdRoutes = require('./routes/ussdRoutes');
const callbackRoutes = require('./routes/callbackRoutes');
const adminRoutes = require('./routes/adminRoutes');
const schedulerService = require('./services/schedulerService');

const app = express();

/**
 * Security Middleware
 */

// Helmet - Set various HTTP headers for security
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API
  crossOriginEmbedderPolicy: false
}));

// Trust proxy (for Render.com and other PaaS)
app.set('trust proxy', 1);

// NOTE: No global rate limiter here. Hubtel sends every customer's USSD
// traffic from the same few IPs, so a global per-IP limit blocks everyone.

/**
 * Body Parsing Middleware
 */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/**
 * Request Logging Middleware
 */
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const path = req.path;
  const ip = req.ip || req.connection.remoteAddress;

  console.log(`[${timestamp}] ${method} ${path} - IP: ${ip}`);

  // Log body with sanitization
  if (req.body && Object.keys(req.body).length > 0) {
    const sanitizedBody = sanitize(req.body);
    console.log('Body:', JSON.stringify(sanitizedBody, null, 2));
  }

  next();
});

/**
 * Health Check Endpoint
 */
app.get('/', (req, res) => {
  const schedulerStatus = schedulerService.getStatus();

  res.json({
    status: 'running',
    service: `${config.orgName} USSD Donation Service`,
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    scheduler: {
      enabled: schedulerStatus.enabled,
      running: schedulerStatus.running,
      lastRun: schedulerStatus.lastRunTime
    },
    endpoints: {
      ussd: '/api/ussd',
      callback: '/api/callback/payment',
      recurringCallback: '/api/callback/recurring',
      fulfilmentCallback: '/api/callback/fulfilment',
      stats: '/api/callback/stats',
      donations: '/api/callback/payments',
      subscriptions: '/api/callback/subscriptions',
      donors: '/api/callback/donors',
      admin: '/api/admin (requires authentication)'
    }
  });
});

/**
 * Routes with Specialized Rate Limiting
 */
// ussdAuth runs before the limiter so spoofed requests can't exhaust a real customer's quota
app.use('/api/ussd', ussdAuth, ussdLimiter, ussdRoutes);
app.use('/api/callback', callbackLimiter, callbackRoutes);
app.use('/api/admin', adminLimiter, auditLog, adminRoutes);

// General limiter only for unmatched routes (scanners / 404 noise)
app.use(generalLimiter);

/**
 * 404 Handler
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

/**
 * Error Handling Middleware
 */
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined
  });
});

/**
 * Start Server
 */
async function startServer() {
  // Connect to MongoDB
  const dbConnection = await connectDatabase();

  if (!dbConnection) {
    console.log('');
    console.log('WARNING: Running without database connection');
    console.log('Donations will NOT be saved to database');
    console.log('');
  }

  // Start Express server
  app.listen(config.port, () => {
    console.log('='.repeat(60));
    console.log(`${config.orgName} USSD Donation Service`);
    console.log('='.repeat(60));
    console.log(`Server running on port ${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Database: ${dbConnection ? 'Connected' : 'Not connected'}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  USSD:          http://localhost:${config.port}/api/ussd`);
    console.log(`  Callback:      http://localhost:${config.port}/api/callback/payment`);
    console.log(`  Recurring:     http://localhost:${config.port}/api/callback/recurring`);
    console.log(`  Fulfilment:    http://localhost:${config.port}/api/callback/fulfilment`);
    console.log(`  Stats:         http://localhost:${config.port}/api/callback/stats`);
    console.log(`  Admin:         http://localhost:${config.port}/api/admin`);
    console.log('');
    console.log('Security:');
    console.log('  - Helmet security headers enabled');
    console.log('  - Rate limiting enabled');
    console.log('  - Admin authentication required');
    console.log('');

    // Start the scheduler
    if (dbConnection) {
      const schedulerStarted = schedulerService.start();
      if (schedulerStarted) {
        console.log('Scheduler:');
        const status = schedulerService.getStatus();
        console.log(`  - Schedule: ${status.schedule}`);
        console.log(`  - Timezone: ${status.timezone}`);
        console.log('');
      }
    } else {
      console.log('Scheduler: Disabled (no database connection)');
      console.log('');
    }

    console.log('='.repeat(60));
  });
}

/**
 * Graceful Shutdown
 */
async function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);

  // Stop the scheduler
  schedulerService.stop();
  console.log('Scheduler stopped');

  // Disconnect database
  const { disconnectDatabase } = require('./config/database');
  await disconnectDatabase();
  console.log('Database disconnected');

  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start the server
startServer();

module.exports = app;
