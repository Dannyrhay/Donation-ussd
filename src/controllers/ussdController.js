const ussdMenuService = require('../services/ussdMenuService');
const paymentService = require('../services/paymentService');

/**
 * Handle incoming USSD requests from Hubtel
 *
 * Hubtel sends POST requests to this endpoint with the following format:
 * {
 *   "Type": "initiation" | "response",
 *   "Mobile": "233xxxxxxxxx",
 *   "SessionId": "unique-session-id",
 *   "ServiceCode": "xxx",
 *   "Message": "user input",
 *   "Operator": "mtn" | "vodafone" | "airtel" | "tigo",
 *   "Sequence": 1,
 *   "ClientState": "",
 *   "Platform": "USSD"
 * }
 */
async function handleUssdRequest(req, res) {
  try {
    // Extract USSD request data
    const ussdRequest = {
      Type: req.body.Type,
      Mobile: req.body.Mobile,
      SessionId: req.body.SessionId,
      ServiceCode: req.body.ServiceCode,
      Message: req.body.Message,
      Operator: req.body.Operator,
      Sequence: req.body.Sequence,
      ClientState: req.body.ClientState,
      Platform: req.body.Platform
    };

    console.log('='.repeat(50));
    console.log('Incoming USSD Request:');
    console.log(`  Mobile: ${ussdRequest.Mobile}`);
    console.log(`  Type: ${ussdRequest.Type}`);
    console.log(`  Message: ${ussdRequest.Message}`);
    console.log(`  Sequence: ${ussdRequest.Sequence}`);
    console.log(`  Operator: ${ussdRequest.Operator}`);
    console.log('='.repeat(50));

    // Process the USSD request through our menu service
    const response = ussdMenuService.processRequest(ussdRequest);

    console.log('USSD Response:');
    console.log(`  Type: ${response.Type}`);
    console.log(`  Message: ${response.Message.substring(0, 100)}...`);
    console.log('='.repeat(50));

    // If donation was confirmed, trigger payment
    if (response.donationData) {
      // Process payment asynchronously (don't wait for it)
      processPaymentAsync(response.donationData, ussdRequest.Operator);
    }

    // Send response back to Hubtel
    res.json({
      SessionId: response.SessionId,
      Type: response.Type,
      Message: response.Message,
      ClientState: response.ClientState || '',
      DataType: 'input',
      FieldType: 'text'
    });

  } catch (error) {
    console.error('USSD Error:', error);

    // Send error response
    res.json({
      SessionId: req.body.SessionId,
      Type: 'release',
      Message: 'An error occurred. Please try again later.',
      ClientState: 'error'
    });
  }
}

/**
 * Process payment asynchronously after USSD session ends
 */
async function processPaymentAsync(donationData, operator) {
  try {
    console.log('Processing payment for:', donationData);

    // Map operator to Hubtel channel
    const channelMap = {
      'mtn': 'mtn-gh',
      'vodafone': 'vodafone-gh',
      'tigo': 'tigo-gh',
      'airtel': 'tigo-gh'  // AirtelTigo uses tigo-gh
    };

    const channel = channelMap[operator.toLowerCase()] || 'mtn-gh';

    // Initiate payment
    const paymentResult = await paymentService.initiatePayment({
      phoneNumber: donationData.mobile,
      amount: donationData.amount,
      channel: channel,
      description: `Donation to Jesus Mission Fund - ${donationData.frequency}`,
      reference: `DON-${donationData.sessionId.substring(0, 8)}`,
      frequency: donationData.frequencyCode
    });

    console.log('Payment initiated:', paymentResult);

  } catch (error) {
    console.error('Payment processing error:', error.message);
    // In production, you might want to:
    // - Store failed payments for retry
    // - Send SMS notification to donor
    // - Alert administrators
  }
}

module.exports = {
  handleUssdRequest
};
