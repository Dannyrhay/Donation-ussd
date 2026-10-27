const mongoose = require('mongoose');

// When the DB is unreachable, mongoose queues queries for 10s by default. That
// stalls USSD replies past Hubtel's timeout ("Error:UUE"). Fail fast instead —
// USSD code paths already catch DB errors and show a message.
mongoose.set('bufferTimeoutMS', 3000);

/**
 * Database Connection Module
 *
 * Connects to MongoDB (local or Atlas cloud)
 */

async function connectDatabase() {
  const mongoUri = process.env.MONGODB_URI;

  // Skip connection if no URI provided
  if (!mongoUri) {
    console.log('='.repeat(50));
    console.log('MONGODB_URI not set - running without database');
    console.log('='.repeat(50));
    return null;
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000, // 10 second timeout
      connectTimeoutMS: 10000
    });

    console.log('='.repeat(50));
    console.log('MongoDB Connected Successfully');
    console.log(`Database: ${mongoose.connection.name}`);
    console.log('='.repeat(50));

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
    });

    return mongoose.connection;

  } catch (error) {
    console.error('='.repeat(50));
    console.error('MongoDB Connection Failed');
    console.error('Error:', error.message);
    console.error('='.repeat(50));
    console.error('');
    console.error('Make sure MongoDB is running or provide MONGODB_URI in .env');
    console.error('');
    console.error('Options:');
    console.error('1. Install MongoDB locally: https://www.mongodb.com/try/download/community');
    console.error('2. Use MongoDB Atlas (free): https://www.mongodb.com/atlas');
    console.error('');

    // Don't crash the app - continue without database
    // (useful for testing USSD flow without DB)
    return null;
  }
}

async function disconnectDatabase() {
  await mongoose.disconnect();
  console.log('MongoDB disconnected');
}

module.exports = {
  connectDatabase,
  disconnectDatabase
};
