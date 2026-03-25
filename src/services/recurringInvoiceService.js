const axios = require('axios');
const config = require('../config');
const { sanitize } = require('../utils/logger');

/**
 * Hubtel Recurring Invoice Service
 *
 * Handles integration with Hubtel's Recurring Invoice API for automated
 * recurring payments. Hubtel manages the scheduling and debit processing.
 *
 * API Endpoints:
 * - Create Invoice: POST /api/proxy/{POS_Sales_ID}/create-invoice
 * - Verify Invoice: POST /api/proxy/verify-invoice
 * - Cancel Invoice: DELETE /api/proxy/{POS_Sales_ID}/cancel-invoice/{recurringInvoiceId}
 */

/**
 * Create Basic Auth header for Hubtel API
 */
function getAuthHeader() {
  const credentials = `${config.hubtel.apiKey}:${config.hubtel.apiSecret}`;
  const encoded = Buffer.from(credentials).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Format phone number to international format (233...)
 */
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = '233' + cleaned.substring(1);
  }

  if (!cleaned.startsWith('233')) {
    cleaned = '233' + cleaned;
  }

  return cleaned;
}

/**
 * Detect mobile network from phone number.
 * Returns Hubtel recurring channel code for MTN/Vodafone,
 * or 'at_gh' (sentinel) for AirtelTigo (not supported for recurring invoices).
 *
 * MTN Ghana:        024, 025, 053, 054, 055, 059  -> mtn_gh_rec
 * Vodafone/Telecel: 020, 050                      -> vodafone_gh_rec
 * AirtelTigo:       026, 027, 056, 057            -> at_gh (recurring NOT supported)
 */
function detectNetwork(phoneNumber) {
  const cleaned = formatPhoneNumber(phoneNumber);
  // E.164 format: 233XXXXXXXXX — strip country code to get local number, then take first 3 digits
  // e.g. 233244123456 -> local '0244123456' -> prefix '024'
  const localNumber = '0' + cleaned.substring(3);
  const prefix = localNumber.substring(0, 3);

  const mtnPrefixes = ['024', '025', '053', '054', '055', '059'];
  const vodafonePrefixes = ['020', '050'];
  const airtelTigoPrefixes = ['026', '027', '056', '057'];

  if (mtnPrefixes.includes(prefix)) {
    return 'mtn_gh_rec';
  } else if (vodafonePrefixes.includes(prefix)) {
    return 'vodafone_gh_rec';
  } else if (airtelTigoPrefixes.includes(prefix)) {
    // AirtelTigo is not supported by Hubtel for recurring invoices
    return 'at_gh';
  }

  // Default to MTN if prefix is unrecognised
  return 'mtn_gh_rec';
}

/**
 * Returns true if the phone number belongs to AirtelTigo,
 * which does not support Hubtel recurring invoices.
 */
function isAirtelTigo(phoneNumber) {
  return detectNetwork(phoneNumber) === 'at_gh';
}


/**
 * Calculate invoice end date based on frequency
 * Weekly: 1 year from now
 * Monthly: 2 years from now
 * Annually: 10 years from now
 */
function calculateEndDate(frequency) {
  const endDate = new Date();

  switch (frequency) {
    case 'weekly':
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;
    case 'monthly':
      endDate.setFullYear(endDate.getFullYear() + 2);
      break;
    case 'annually':
      endDate.setFullYear(endDate.getFullYear() + 10);
      break;
    default:
      endDate.setFullYear(endDate.getFullYear() + 1);
  }

  // Return YYYY-MM-DDTHH:mm:ss
  return endDate.toISOString().split('.')[0];
}

/**
 * Create a recurring invoice with Hubtel
 *
 * @param {Object} invoiceData
 * @param {string} invoiceData.phoneNumber - Customer phone number
 * @param {number} invoiceData.amount - Recurring amount
 * @param {string} invoiceData.frequency - weekly, monthly, annually
 * @param {string} invoiceData.description - Invoice description
 * @param {string} invoiceData.customerName - Optional customer name
 * @param {string} invoiceData.clientReference - Your reference ID
 */
async function createRecurringInvoice(invoiceData) {
  const {
    phoneNumber,
    amount,
    frequency,
    description,
    customerName,
    clientReference
  } = invoiceData;

  const formattedPhone = formatPhoneNumber(phoneNumber);
  const channel = detectNetwork(phoneNumber);
  const paymentInterval = config.hubtelRecurring.intervals[frequency];

  if (channel === 'at_gh') {
    return {
      success: false,
      error: 'AirtelTigo numbers are not supported for recurring invoices. Use one-time payment instead.'
    };
  }

  if (!paymentInterval) {
    return {
      success: false,
      error: `Invalid frequency: ${frequency}. Use weekly, monthly, or annually.`
    };
  }

  // Check if API credentials are configured
  if (!config.hubtelRecurring.posSalesId) {
    console.log('='.repeat(50));
    console.log('RECURRING INVOICE SIMULATION (No POS Sales ID configured)');
    console.log('='.repeat(50));
    console.log(`Phone: ${formattedPhone}`);
    console.log(`Amount: GHS ${amount}`);
    console.log(`Frequency: ${frequency} (${paymentInterval})`);
    console.log(`Channel: ${channel}`);
    console.log(`Reference: ${clientReference}`);
    console.log('='.repeat(50));

    return {
      success: true,
      simulated: true,
      data: {
        recurringInvoiceId: `SIM-${Date.now()}`,
        requestId: `REQ-${Date.now()}`,
        verificationType: 'USSD',
        clientReference
      },
      message: 'Recurring invoice simulated (configure HUBTEL_POS_SALES_ID for real invoices)'
    };
  }

  // Hubtel expects YYYY-MM-DDTHH:mm:ss
  const formatHubtelDate = (date) => {
    const d = new Date(date);
    return d.toISOString().split('.')[0];
  };

  // Hubtel requires OrderDate to be in the future. We'll set it to 10 minutes from now.
  const futureDate = new Date();
  futureDate.setMinutes(futureDate.getMinutes() + 2);
  const orderDate = formatHubtelDate(futureDate);
  const invoiceEndDate = formatHubtelDate(calculateEndDate(frequency));

  const requestBody = {
    orderDate,
    invoiceEndDate,
    description: description || `Recurring donation to ${config.orgName}`,
    startTime: config.recurringDefaults.startTime,
    paymentInterval,
    customerMobileNumber: formattedPhone,
    paymentOption: config.recurringDefaults.paymentOption,
    channel,
    customerName: customerName || 'Donor',
    recurringAmount: amount,
    totalAmount: amount,
    initialAmount: amount,
    currency: config.recurringDefaults.currency,
    callbackUrl: config.recurringCallbackUrl
  };





  const fullUrl = `${config.hubtelRecurring.baseUrl}/${config.hubtelRecurring.posSalesId}/create-invoice`;

  console.log('='.repeat(50));
  console.log('CREATING HUBTEL RECURRING INVOICE');
  console.log('URL:', fullUrl);
  console.log('Request Body:', JSON.stringify(sanitize(requestBody), null, 2));
  console.log('='.repeat(50));


  try {
    const response = await axios.post(
      fullUrl,
      requestBody,
      {
        headers: {
          'Authorization': getAuthHeader(),
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      }
    );


    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('='.repeat(50));

    // Check response code - 0001 is success/pending for mobile money, 0000 for cards/general
    if (response.data.responseCode === '0001' || response.data.responseCode === '0000') {
      // Success - pending verification
      return {
        success: true,
        simulated: false,
        data: {
          recurringInvoiceId: response.data.data?.recurringInvoiceId,
          requestId: response.data.data?.requestId,
          verificationType: response.data.data?.verificationType,
          otpPrefix: response.data.data?.otpPrefix,
          clientReference
        },
        message: response.data.message || 'Invoice created successfully'
      };
    } else {
      console.error(`RECURRING INVOICE FAILED: Code ${response.data.responseCode}, Message: ${response.data.message}`);
      return {
        success: false,
        error: response.data.message || 'Failed to create recurring invoice',
        responseCode: response.data.responseCode
      };
    }


  } catch (error) {
    console.error('Hubtel Recurring Invoice Error:', error.response?.data || error.message);

    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    };
  }
}

/**
 * Verify a recurring invoice with OTP
 * Note: For USSD flow, we skip OTP verification as per Hubtel developer guidance
 *
 * @param {Object} verifyData
 * @param {string} verifyData.recurringInvoiceId - Invoice ID from create response
 * @param {string} verifyData.requestId - Request ID from create response
 * @param {string} verifyData.otpCode - OTP code (format: PREFIX-1234)
 */
async function verifyRecurringInvoice(verifyData) {
  const { recurringInvoiceId, requestId, otpCode } = verifyData;

  if (!config.hubtelRecurring.posSalesId) {
    console.log('VERIFY INVOICE SIMULATION');
    return {
      success: true,
      simulated: true,
      data: { recurringInvoiceId },
      message: 'Invoice verification simulated'
    };
  }

  const requestBody = {
    recurringInvoiceId,
    requestId,
    otpCode
  };

  console.log('Verifying recurring invoice:', requestBody);

  try {
    const response = await axios.post(
      `${config.hubtelRecurring.baseUrl}/verify-invoice`,
      requestBody,
      {
        headers: {
          'Authorization': getAuthHeader(),
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    console.log('Verify Response:', JSON.stringify(response.data, null, 2));

    if (response.data.responseCode === '0001') {
      return {
        success: true,
        data: {
          recurringInvoiceId: response.data.data?.recurringInvoiceId
        },
        message: response.data.message
      };
    } else {
      return {
        success: false,
        error: response.data.message,
        responseCode: response.data.responseCode
      };
    }

  } catch (error) {
    console.error('Verify Invoice Error:', error.response?.data || error.message);

    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Cancel a recurring invoice
 *
 * @param {string} recurringInvoiceId - The invoice ID to cancel
 */
async function cancelRecurringInvoice(recurringInvoiceId) {
  if (!config.hubtelRecurring.posSalesId) {
    console.log('CANCEL INVOICE SIMULATION');
    return {
      success: true,
      simulated: true,
      message: 'Invoice cancellation simulated'
    };
  }

  console.log(`Cancelling recurring invoice: ${recurringInvoiceId}`);

  try {
    const response = await axios.delete(
      `${config.hubtelRecurring.baseUrl}/${config.hubtelRecurring.posSalesId}/cancel-invoice/${recurringInvoiceId}`,
      {
        headers: {
          'Authorization': getAuthHeader(),
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    console.log('Cancel Response:', JSON.stringify(response.data, null, 2));

    if (response.data.responseCode === '0000' || response.data.responseCode === '0005') {
      return {
        success: true,
        message: response.data.Message || 'Invoice cancelled successfully'
      };
    } else {
      return {
        success: false,
        error: response.data.Message || 'Failed to cancel invoice'
      };
    }

  } catch (error) {
    console.error('Cancel Invoice Error:', error.response?.data || error.message);

    return {
      success: false,
      error: error.response?.data?.Message || error.message
    };
  }
}

/**
 * Handle recurring invoice callback from Hubtel
 *
 * Hubtel sends callbacks for:
 * - Initial payment success/failure
 * - Each recurring payment success/failure
 * - Invoice cancellation
 *
 * @param {Object} callbackData - Callback payload from Hubtel
 */
function handleRecurringCallback(callbackData) {
  console.log('='.repeat(50));
  console.log('HUBTEL RECURRING CALLBACK RECEIVED');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Data:', JSON.stringify(sanitize(callbackData), null, 2));
  console.log('='.repeat(50));

  const responseCode = callbackData.ResponseCode;
  const message = callbackData.Message;
  const data = callbackData.Data || {};

  // Determine callback type and status
  const isSuccess = responseCode === '0000';
  const isFailed = responseCode === '2001';
  const isCancelled = responseCode === '0005';

  const result = {
    success: isSuccess,
    failed: isFailed,
    cancelled: isCancelled,
    responseCode,
    message,
    recurringInvoiceId: data.RecurringInvoiceId,
    transactionId: data.TransactionId,
    clientReference: data.ClientReference,
    amount: data.Amount,
    amountCharged: data.AmountCharged,
    charges: data.Charges,
    customerMobileNumber: data.CustomerMobileNumber,
    orderDate: data.OrderDate,
    invoiceEndDate: data.InvoiceEndDate,
    initialAmount: data.InitialAmount,
    recurringAmount: data.RecurringAmount
  };

  if (isSuccess) {
    console.log(`Recurring payment successful for invoice ${result.recurringInvoiceId}`);
  } else if (isFailed) {
    console.log(`Recurring payment failed for invoice ${result.recurringInvoiceId}`);
  } else if (isCancelled) {
    console.log(`Invoice ${result.recurringInvoiceId} has been cancelled`);
  }

  return result;
}

module.exports = {
  createRecurringInvoice,
  verifyRecurringInvoice,
  cancelRecurringInvoice,
  handleRecurringCallback,
  formatPhoneNumber,
  detectNetwork,
  isAirtelTigo
};
