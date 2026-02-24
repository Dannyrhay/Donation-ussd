require('dotenv').config();

module.exports = {
  // Server
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Hubtel API
  hubtel: {
    apiKey: process.env.HUBTEL_API_KEY,
    apiSecret: process.env.HUBTEL_API_SECRET,
    merchantId: process.env.HUBTEL_MERCHANT_ID,
    baseUrl: 'https://api.hubtel.com/v1/merchantaccount'
  },

  // Callbacks
  callbackUrl: process.env.CALLBACK_URL,

  // Organization
  orgName: process.env.ORG_NAME || 'Jesus Mission Fund',

  // Donation amounts in GHS
  donationAmounts: [5, 10, 50, 100, 500],

  // Donation frequencies
  frequencies: {
    '1': { name: 'Weekly', code: 'weekly' },
    '2': { name: 'Monthly', code: 'monthly' },
    '3': { name: 'Annually', code: 'annually' },
    '4': { name: 'One-time', code: 'once' }
  }
};
