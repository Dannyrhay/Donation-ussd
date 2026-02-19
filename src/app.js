const express = require('express');
const config = require('./config');
const { connectDatabase } = require('./config/database');
const ussdRoutes = require('./routes/ussdRoutes');
const callbackRoutes = require('./routes/callbackRoutes');

const app = express();

// Middleware to parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware (for development)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: `${config.orgName} USSD Donation Service`,
    timestamp: new Date().toISOString(),
    endpoints: {
      ussd: '/api/ussd',
      callback: '/api/callback/payment',
      stats: '/api/callback/stats',
      donations: '/api/callback/payments',
      subscriptions: '/api/callback/subscriptions',
      donors: '/api/callback/donors'
    }
  });
});

// Routes
app.use('/api/ussd', ussdRoutes);
app.use('/api/callback', callbackRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined
  });
});

// Start server
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
    console.log('='.repeat(50));
    console.log(`${config.orgName} USSD Donation Service`);
    console.log('='.repeat(50));
    console.log(`Server running on port ${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Database: ${dbConnection ? 'Connected' : 'Not connected'}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  USSD:          http://localhost:${config.port}/api/ussd`);
    console.log(`  Callback:      http://localhost:${config.port}/api/callback/payment`);
    console.log(`  Stats:         http://localhost:${config.port}/api/callback/stats`);
    console.log(`  Donations:     http://localhost:${config.port}/api/callback/payments`);
    console.log(`  Subscriptions: http://localhost:${config.port}/api/callback/subscriptions`);
    console.log(`  Donors:        http://localhost:${config.port}/api/callback/donors`);
    console.log('='.repeat(50));
  });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  const { disconnectDatabase } = require('./config/database');
  await disconnectDatabase();
  process.exit(0);
});

startServer();

module.exports = app;
