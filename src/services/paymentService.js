const axios = require('axios');
const config = require('../config');
const { sanitize } = require('../utils/logger');
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
    frequency,
    customerName
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
      // Optional — omit rather than send a placeholder Hubtel would store as the name
      ...(customerName ? { CustomerName: customerName } : {}),
      CustomerMsisdn: formattedPhone,
      CustomerEmail: '',
      Channel: channel,
      Amount: amount,
      PrimaryCallbackUrl: config.callbackUrl,
      SecondaryCallbackUrl: config.callbackUrl,
      Description: description,
      ClientReference: reference
    };

    // Only add FulfilmentCallbackUrl when configured — no fallback to avoid
    // pointing Hubtel at the wrong endpoint
    if (config.fulfilmentCallbackUrl) {
      requestBody.FulfilmentCallbackUrl = config.fulfilmentCallbackUrl;
    }

    console.log('Hubtel Payment Request:', JSON.stringify(sanitize(requestBody), null, 2));

    const response = await axios.post(
      `${config.hubtel.baseUrl}/merchants/${config.hubtel.merchantId}/receive/mobilemoney`,
      requestBody,
      {
        headers: {
          'Authorization': getAuthHeader(),
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      }
    );

    console.log('Hubtel Payment Response:', JSON.stringify(response.data, null, 2));

    // Store Hubtel's SessionId and OrderId from the initiation response
    // These are used to match payment and fulfilment callbacks back to this donation
    const hubtelSessionId = response.data?.Data?.SessionId || response.data?.data?.SessionId;
    const hubtelOrderId = response.data?.Data?.OrderId || response.data?.data?.OrderId;
    if (hubtelSessionId || hubtelOrderId) {
      const { Donation } = require('../models');
      await Donation.findOneAndUpdate({ reference }, { hubtelSessionId, hubtelOrderId });
      console.log(`Stored Hubtel identifiers — SessionId: ${hubtelSessionId}, OrderId: ${hubtelOrderId}`);
    }

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
 *
 * Hubtel sends callbacks in various formats:
 * - Status: "Success", "Successful", "Paid", "Failed", "Pending"
 * - ResponseCode: "0000" for success
 * - Data.Status or top-level Status
 */
async function handlePaymentCallback(callbackData) {
  console.log('='.repeat(50));
  console.log('HUBTEL PAYMENT CALLBACK RECEIVED:');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Raw Data:', JSON.stringify(sanitize(callbackData), null, 2));
  console.log('='.repeat(50));

  // Hubtel payment callback format:
  //   SessionId        — Hubtel's payment session ID (generated at payment processing, NOT at initiation)
  //   OrderId          — Hubtel's internal order ID (same — not available at initiation)
  //   OrderInfo        — payment result: CustomerMobileNumber, Items, Payment.IsSuccessful, etc.
  //   ExtraData        — additional data
  const sessionId = callbackData.SessionId;
  const orderId = callbackData.OrderId;
  const customerPhone = callbackData.OrderInfo?.CustomerMobileNumber;
  const customerName = callbackData.OrderInfo?.CustomerName;

  // Update donor name if we have a real one and it's currently 'Donor' or empty
  if (customerName && customerName !== 'Donor' && customerPhone) {
    try {
      // (was `mongoose.model('Donor')` with mongoose never imported — threw a
      // ReferenceError on every callback, so real names were never saved)
      const { Donor } = require('../models');
      const donor = await Donor.findOne({ phoneNumber: formatPhoneNumber(customerPhone) });
      if (donor && (!donor.name || donor.name === 'Donor')) {
        donor.name = customerName;
        await donor.save();
        console.log(`Updated donor name for ${customerPhone} to ${customerName}`);
      }
    } catch (err) {
      console.error('Failed to update donor name from callback:', err.message);
    }
  }

  // Determine if payment was successful
  // OrderInfo.Payment.IsSuccessful is the definitive flag in the new callback format
  const isSuccessful = callbackData.OrderInfo?.Payment?.IsSuccessful === true;
  const responseCode = callbackData.ResponseCode || callbackData.Data?.ResponseCode;
  const statusValue = callbackData.OrderInfo?.Status
    || callbackData.Status
    || callbackData.Data?.Status
    || callbackData.data?.Status;

  const isSuccess = isSuccessful
    || responseCode === '0000'
    || statusValue === 'Success'
    || statusValue === 'Successful'
    || statusValue === 'Paid'
    || statusValue === 'completed';

  const finalStatus = isSuccess ? 'Success' : (statusValue || 'Failed');

  console.log(`SessionId: ${sessionId} | OrderId: ${orderId} | CustomerPhone: ${customerPhone}`);
  console.log(`IsSuccessful: ${isSuccessful} | Status Value: ${statusValue} | Final Status: ${finalStatus}`);

  // Fulfilment payload — echo SessionId and OrderId back to Hubtel to confirm service delivery
  const fulfilmentPayload = {
    SessionId: sessionId,
    OrderId: orderId,
    ServiceStatus: isSuccess ? 'success' : 'failed',
    MetaData: null
  };

  // Look up donation:
  //   1. hubtelSessionId / hubtelOrderId — only available if Hubtel returns them at initiation (may not)
  //   2. CustomerMobileNumber — most reliable since it's always in the callback and stored on donation
  const { Donation } = require('../models');
  let donation = null;

  if (sessionId) {
    donation = await Donation.findOne({ hubtelSessionId: sessionId });
  }
  if (!donation && orderId) {
    donation = await Donation.findOne({ hubtelOrderId: orderId });
  }
  if (!donation && customerPhone) {
    // Match the most recent pending one-time donation for this phone number
    donation = await Donation.findOne({
      phoneNumber: customerPhone,
      frequency: 'once',
      status: 'pending'
    });
  }

  if (!donation) {
    console.error('ERROR: No donation found for callback');
    console.error(`SessionId: ${sessionId} | OrderId: ${orderId} | Phone: ${customerPhone}`);

    // Still send fulfilment to Hubtel even if we can't record it locally
    await sendFulfilmentToHubtel(fulfilmentPayload);
    return null;
  }

  // Store Hubtel identifiers on the donation for future reference
  if (sessionId || orderId) {
    await Donation.findOneAndUpdate(
      { _id: donation._id },
      { hubtelSessionId: sessionId, hubtelOrderId: orderId }
    );
  }

  const reference = donation.reference;
  const result = await donationService.updateDonationStatus(reference, finalStatus, callbackData);

  if (result.success) {
    console.log(`Payment ${reference} updated to: ${result.donation.status}`);
    // Send fulfilment confirmation to Hubtel
    await sendFulfilmentToHubtel(fulfilmentPayload);
    return result.donation;
  }

  console.error(`Failed to update donation ${reference}`);
  await sendFulfilmentToHubtel(fulfilmentPayload);
  return null;
}

/**
 * POST fulfilment payload to Hubtel's callback endpoint.
 * Hubtel expects this after every payment callback to confirm service delivery.
 */
async function sendFulfilmentToHubtel(payload) {
  const ackUrl = config.hubtelFulfilmentAckUrl;
  console.log(`FULFILMENT: Sending to ${ackUrl}:`, JSON.stringify(payload));
  try {
    const ackResponse = await axios.post(ackUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`FULFILMENT: Response status: ${ackResponse.status}`);
  } catch (err) {
    console.warn(`FULFILMENT: POST failed: ${err.message}`);
  }
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

/**
 * Handle service fulfilment callback from Hubtel
 *
 * Hubtel calls this URL after a successful payment to confirm service delivery.
 * Must ALWAYS return { ResponseCode: "0000", Status: "TXN_SUCCESS", Message: "Fulfilled" }
 * regardless of internal errors — returning anything else risks Hubtel reversing the transaction.
 *
 * @param {Object} callbackData - Callback payload from Hubtel
 * @returns {Object} Hubtel fulfilment response
 */
async function handleFulfilmentCallback(callbackData) {
  console.log('='.repeat(50));
  console.log('HUBTEL FULFILMENT CALLBACK RECEIVED');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Raw Data:', JSON.stringify(sanitize(callbackData), null, 2));
  console.log('='.repeat(50));

  const FULFILMENT_RESPONSE = {
    ResponseCode: '0000',
    Status: 'TXN_SUCCESS',
    Message: 'Fulfilled'
  };

  try {
    // Hubtel fulfilment callback fields (real payload format):
    //   SessionId    — the USSD session ID from the original payment request
    //   OrderId      — Hubtel's internal order ID (stored on donation at initiation)
    //   ServiceStatus — "success" if the payment was successful
    //   MetaData     — optional metadata

    const serviceStatus = callbackData.ServiceStatus;
    if (serviceStatus && serviceStatus.toLowerCase() !== 'success') {
      console.warn(`FULFILMENT: ServiceStatus is "${serviceStatus}" — not marking as fulfilled`);
      return FULFILMENT_RESPONSE;
    }

    const { Donation } = require('../models');

    // Hubtel's SessionId in the callback = the payment session ID returned at initiation
    // (stored as hubtelSessionId on the donation — distinct from the USSD sessionId)
    const sessionId = callbackData.SessionId;
    const orderId = callbackData.OrderId;

    if (!sessionId && !orderId) {
      console.error('FULFILMENT: No SessionId or OrderId found in payload');
      console.error('Available keys:', Object.keys(callbackData));
      return FULFILMENT_RESPONSE;
    }

    const pipeline = [{ $set: { status: 'fulfilled', fulfilledAt: '$$NOW', completedAt: { $ifNull: ['$completedAt', '$$NOW'] } } }];
    const opts = { new: true };

    // Use aggregation pipeline update so completedAt can be set conditionally
    // (handles race condition where fulfilment arrives before payment callback)
    let donation = sessionId
      ? await Donation.findOneAndUpdate({ hubtelSessionId: sessionId, fulfilledAt: { $exists: false } }, pipeline, opts)
      : null;

    // Fallback: try OrderId
    if (!donation && orderId) {
      donation = await Donation.findOneAndUpdate(
        { hubtelOrderId: orderId, fulfilledAt: { $exists: false } }, pipeline, opts
      );
    }

    if (donation) {
      console.log(`Fulfilment recorded for donation ${donation._id} (hubtelSessionId: ${sessionId}, hubtelOrderId: ${orderId})`);
    } else {
      console.warn(`FULFILMENT: No matching donation found (hubtelSessionId: ${sessionId}, hubtelOrderId: ${orderId})`);
    }

  } catch (error) {
    // Never propagate errors — Hubtel must always receive TXN_SUCCESS
    console.error('FULFILMENT: Error processing callback:', error.message);
  }

  // POST fulfilment confirmation back to Hubtel
  // Payload echoes SessionId/OrderId from their callback with ServiceStatus: "success"
  await sendFulfilmentToHubtel({
    SessionId: callbackData.SessionId,
    OrderId: callbackData.OrderId,
    ServiceStatus: 'success',
    MetaData: null
  });

  return FULFILMENT_RESPONSE;
}

module.exports = {
  initiatePayment,
  handlePaymentCallback,
  handleFulfilmentCallback,
  getPayment,
  getAllPayments,
  getStats,
  formatPhoneNumber
};
