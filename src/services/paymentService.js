const axios = require('axios');
const config = require('../config');
const donationService = require('./donationService');

/**
 * Payment Service
 * Handles Hubtel Mobile Money payment integration with database storage
 */

/**
 * Create Basic Auth header
 */
function getAuthHeader() {
  const credentials = `${config.hubtel.apiKey}:${config.hubtel.apiSecret}`;
  const encoded = Buffer.from(credentials).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Format phone number to international format
 * Converts 0244123456 to 233244123456
 */
function formatPhoneNumber(phone) {
  // Remove any spaces or special characters
  let cleaned = phone.replace(/\D/g, '');

  // If starts with 0, replace with 233
  if (cleaned.startsWith('0')) {
    cleaned = '233' + cleaned.substring(1);
  }

  // If doesn't start with 233, add it
  if (!cleaned.startsWith('233')) {
    cleaned = '233' + cleaned;
  }

  return cleaned;
}

/**
 * Initiate mobile money payment
 *
 * @param {Object} paymentData
 * @param {string} paymentData.phoneNumber - Customer phone number
 * @param {number} paymentData.amount - Amount to charge
 * @param {string} paymentData.channel - Payment channel (mtn-gh, vodafone-gh, tigo-gh)
 * @param {string} paymentData.description - Transaction description
 * @param {string} paymentData.sessionId - USSD session ID
 * @param {string} paymentData.frequency - Payment frequency (once, weekly, monthly, etc.)
 */
async function initiatePayment(paymentData) {
  const {
    phoneNumber,
    amount,
    channel,
    description,
    sessionId,
    frequency
  } = paymentData;

  const formattedPhone = formatPhoneNumber(phoneNumber);

  // Create donation record in database
  const donationResult = await donationService.createDonation({
    phoneNumber: formattedPhone,
    amount,
    channel,
    frequency,
    sessionId,
    description
  });

  if (!donationResult.success) {
    console.error('Failed to create donation record:', donationResult.error);
  }

  const reference = donationResult.reference || `DON-${Date.now()}`;

  // If recurring, create subscription
  if (frequency !== 'once' && donationResult.success) {
    const subscriptionResult = await donationService.createSubscription({
      phoneNumber: formattedPhone,
      amount,
      channel,
      frequency,
      sessionId
    });

    if (subscriptionResult.success) {
      console.log(`Subscription created for ${frequency} payments`);
    }
  }

  // Check if Hubtel credentials are configured
  if (!config.hubtel.apiKey || config.hubtel.apiKey === 'your_api_key_here') {
    console.log('='.repeat(50));
    console.log('PAYMENT SIMULATION (No Hubtel credentials configured)');
    console.log('='.repeat(50));
    console.log(`Reference: ${reference}`);
    console.log(`Would charge: GHS ${amount}`);
    console.log(`Phone: ${formattedPhone}`);
    console.log(`Channel: ${channel}`);
    console.log(`Frequency: ${frequency}`);
    console.log('Donation saved to database: ' + (donationResult.success ? 'Yes' : 'No'));
    console.log('='.repeat(50));

    return {
      success: true,
      simulated: true,
      message: 'Payment simulated (configure Hubtel credentials for real payments)',
      reference,
      donation: donationResult.donation
    };
  }

  // Real Hubtel API call
  try {
    const requestBody = {
      CustomerName: 'Donor',
      CustomerMsisdn: formattedPhone,
      CustomerEmail: '',
      Channel: channel,
      Amount: amount,
      PrimaryCallbackUrl: config.callbackUrl,
      SecondaryCallbackUrl: config.callbackUrl,
      Description: description,
      ClientReference: reference
    };

    console.log('Hubtel Payment Request:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post(
      `${config.hubtel.baseUrl}/merchants/${config.hubtel.merchantId}/receive/mobilemoney`,
      requestBody,
      {
        headers: {
          'Authorization': getAuthHeader(),
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Hubtel Payment Response:', JSON.stringify(response.data, null, 2));

    return {
      success: true,
      simulated: false,
      message: 'Payment prompt sent to customer',
      reference,
      hubtelResponse: response.data,
      donation: donationResult.donation
    };

  } catch (error) {
    console.error('Hubtel Payment Error:', error.response?.data || error.message);

    // Update donation status to failed
    if (donationResult.donation) {
      await donationService.updateDonationStatus(
        reference,
        'failed',
        { error: error.response?.data || error.message }
      );
    }

    return {
      success: false,
      error: error.response?.data || error.message,
      message: 'Failed to initiate payment',
      reference
    };
  }
}

/**
 * Handle payment callback from Hubtel
 */
async function handlePaymentCallback(callbackData) {
  console.log('='.repeat(50));
  console.log('Payment Callback Received:');
  console.log(JSON.stringify(callbackData, null, 2));
  console.log('='.repeat(50));

  const reference = callbackData.ClientReference || callbackData.Data?.ClientReference;
  const status = callbackData.Status || callbackData.Data?.Status;

  if (!reference) {
    console.error('No reference in callback data');
    return null;
  }

  // Update donation in database
  const result = await donationService.updateDonationStatus(reference, status, callbackData);

  if (result.success) {
    console.log(`Payment ${reference} updated to: ${result.donation.status}`);
    return result.donation;
  }

  return null;
}

/**
 * Get payment/donation by reference
 */
async function getPayment(reference) {
  return donationService.getDonationByReference(reference);
}

/**
 * Get all donations (with optional filters)
 */
async function getAllPayments(filters = {}) {
  const { Donation } = require('../models');

  let query = {};

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.phoneNumber) {
    query.phoneNumber = filters.phoneNumber;
  }

  return Donation.find(query)
    .sort({ createdAt: -1 })
    .limit(filters.limit || 100)
    .populate('donor');
}

/**
 * Get donation statistics
 */
async function getStats() {
  return donationService.getStats();
}

module.exports = {
  initiatePayment,
  handlePaymentCallback,
  getPayment,
  getAllPayments,
  getStats,
  formatPhoneNumber
};
