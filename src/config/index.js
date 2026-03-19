require('dotenv').config();

module.exports = {
  // Server
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Hubtel API - Standard Payment
  hubtel: {
    apiKey: process.env.HUBTEL_API_KEY,
    apiSecret: process.env.HUBTEL_API_SECRET,
    merchantId: process.env.HUBTEL_MERCHANT_ID,
    baseUrl: 'https://api.hubtel.com/v1/merchantaccount'
  },

  // Hubtel Recurring Invoice API
  hubtelRecurring: {
    posSalesId: process.env.HUBTEL_POS_SALES_ID,
    baseUrl: 'https://rip.hubtel.com/api/proxy',
    // Channel mapping for recurring payments
    channels: {
      'mtn-gh': 'mtn_gh_rec',
      'vodafone-gh': 'vodafone_gh_rec',
      'tigo-gh': 'vodafone_gh_rec'
    },
    // Interval mapping for Hubtel API
    intervals: {
      'weekly': 'WEEKLY',
      'monthly': 'MONTHLY',
      'annually': 'YEARLY'
    }

  },

  // Callbacks
  callbackUrl: process.env.CALLBACK_URL,
  recurringCallbackUrl: process.env.RECURRING_CALLBACK_URL || process.env.CALLBACK_URL,
  fulfilmentCallbackUrl: process.env.FULFILMENT_CALLBACK_URL,
  // Hubtel's acknowledgement endpoint — we POST TXN_SUCCESS here after processing a fulfilment callback
  hubtelFulfilmentAckUrl: process.env.HUBTEL_FULFILMENT_ACK_URL || 'https://gs-callback.hubtel.com/callback',

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
  },

  // Recurring invoice defaults
  recurringDefaults: {
    startTime: '10:00',
    currency: 'GHS',
    paymentOption: 'MobileMoney'
  }
};
