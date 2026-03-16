const config = require('../config');
const recurringInvoiceService = require('./recurringInvoiceService');
const donationService = require('./donationService');

/**
 * USSD Menu Service
 * Handles the flow of USSD menus for donations
 *
 * Flow:
 * 1. Welcome -> Select Amount
 * 2. Select Amount -> Select Frequency
 * 3. Select Frequency -> Confirm
 * 4. Confirm -> Process Payment
 *    - One-time: AddToCart (standard payment)
 *    - Recurring: Hubtel Recurring Invoice API
 */

// In-memory session storage (use Redis/DB in production)
const sessions = new Map();

// Session timeout in milliseconds (3 minutes for USSD)
const SESSION_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Response types for Hubtel USSD
 */
const ResponseType = {
  RESPONSE: 'Response',      // Continue session, expect user input
  RELEASE: 'Release',        // End session
  ADDTOCART: 'AddToCart'     // Trigger payment prompt (for one-time payments)
};

/**
 * Check if frequency is recurring (not one-time)
 */
function isRecurringFrequency(frequencyCode) {
  return frequencyCode && frequencyCode !== 'once';
}

/**
 * Build a standardized USSD response with all required Hubtel fields
 */
function buildResponse(sessionId, type, message, options = {}) {
  const response = {
    SessionId: sessionId,
    Type: type,
    Message: message,
    Label: options.label || message.split('\n')[0].substring(0, 50),
    DataType: options.dataType || 'input',
    FieldType: options.fieldType || 'text',
    ClientState: options.clientState || ''
  };

  // Include donation data if present (for internal tracking)
  if (options.donationData) {
    response.donationData = options.donationData;
  }

  // Include Item for AddToCart responses
  if (options.item) {
    response.Item = options.item;
  }

  return response;
}

/**
 * Build AddToCart response for payment
 * This triggers the mobile money payment prompt
 */
function buildAddToCartResponse(sessionId, amount, description, clientReference) {
  return {
    SessionId: sessionId,
    Type: ResponseType.ADDTOCART,
    Message: `Thank you for giving to the Lord. Your contribution to JMF is received. God bless you richly.`,
    Label: 'Payment',
    DataType: 'display',
    FieldType: 'text',
    ClientState: clientReference,
    Item: {
      ItemName: description,
      Qty: 1,
      Price: amount
    }
  };
}

/**
 * Build the welcome/amount selection menu
 */
function buildAmountMenu() {
  let menu = `Welcome to ${config.orgName}\n`;
  menu += 'Select donation amount (GHS):\n';

  config.donationAmounts.forEach((amount, index) => {
    menu += `${index + 1}. GHS ${amount}\n`;
  });

  menu += `${config.donationAmounts.length + 1}. Enter custom amount`;

  return menu;
}

/**
 * Build the frequency selection menu
 */
function buildFrequencyMenu(amount) {
  let menu = `Amount: GHS ${amount}\n`;
  menu += 'Select frequency:\n';
  menu += '1. Weekly\n';
  menu += '2. Monthly\n';
  menu += '3. Annually\n';
  menu += '4. One-time\n';
  menu += '5. Cancel subscription\n';
  menu += '0. Back';

  return menu;
}

/**
 * Build the confirmation menu
 */
function buildConfirmationMenu(amount, frequency) {
  let menu = `Confirm Donation:\n`;
  menu += `Amount: GHS ${amount}\n`;
  menu += `Frequency: ${frequency}\n\n`;
  menu += '1. Confirm\n';
  menu += '2. Cancel\n';
  menu += '0. Back';

  return menu;
}

/**
 * Get or create session data
 */
function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      step: 'amount_selection',
      amount: null,
      frequency: null,
      createdAt: new Date()
    });
  }
  return sessions.get(sessionId);
}

/**
 * Update session data
 */
function updateSession(sessionId, data) {
  const session = getSession(sessionId);
  Object.assign(session, data);
  sessions.set(sessionId, session);
}

/**
 * Clear session data
 */
function clearSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Check if session has expired
 */
function isSessionExpired(session) {
  if (!session || !session.createdAt) return true;
  const age = Date.now() - new Date(session.createdAt).getTime();
  return age > SESSION_TIMEOUT_MS;
}

/**
 * Clean up expired sessions (called periodically)
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (isSessionExpired(session)) {
      sessions.delete(sessionId);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

/**
 * Process USSD request and return appropriate response
 */
async function processRequest(ussdRequest) {
  const { SessionId, Type, Message, Mobile, Sequence } = ussdRequest;

  // Get current session
  const session = getSession(SessionId);

  console.log(`Processing: SessionId=${SessionId}, Step=${session.step}, Input=${Message}`);

  // Initial request (user just dialed the code)
  // Hubtel sends Type as "Initiation" (capital I)
  if (Type === 'Initiation' || Type === 'initiation' || Sequence === 1) {
    updateSession(SessionId, { step: 'amount_selection', createdAt: new Date() });
    return buildResponse(SessionId, ResponseType.RESPONSE, buildAmountMenu(), {
      label: 'Select Amount',
      clientState: 'amount_selection',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  // Check for session timeout
  if (isSessionExpired(session)) {
    clearSession(SessionId);
    return buildResponse(SessionId, ResponseType.RELEASE,
      'Session timed out. Please dial again to continue.', {
        label: 'Session Expired',
        clientState: 'timeout',
        dataType: 'display'
      });
  }

  // Process based on current step
  switch (session.step) {
    case 'amount_selection':
      return handleAmountSelection(SessionId, Message);

    case 'custom_amount':
      return handleCustomAmount(SessionId, Message);

    case 'frequency_selection':
      return await handleFrequencySelection(SessionId, Message, session, Mobile);

    case 'confirmation':
      return await handleConfirmation(SessionId, Message, session, Mobile);

    case 'cancellation_confirmation':
      return await handleCancellationConfirmation(SessionId, Message, session);

    default:
      clearSession(SessionId);
      return buildResponse(SessionId, ResponseType.RELEASE, 'Session error. Please try again.', {
        label: 'Error',
        clientState: 'error',
        dataType: 'display'
      });
  }
}

/**
 * Handle amount selection step
 */
function handleAmountSelection(sessionId, input) {
  const choice = parseInt(input);
  const amounts = config.donationAmounts;

  // Check if valid predefined amount
  if (choice >= 1 && choice <= amounts.length) {
    const amount = amounts[choice - 1];
    updateSession(sessionId, {
      step: 'frequency_selection',
      amount: amount
    });

    return buildResponse(sessionId, ResponseType.RESPONSE, buildFrequencyMenu(amount), {
      label: 'Select Frequency',
      clientState: 'frequency_selection',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  // Custom amount option
  if (choice === amounts.length + 1) {
    updateSession(sessionId, { step: 'custom_amount' });
    return buildResponse(sessionId, ResponseType.RESPONSE, 'Enter custom amount (GHS):', {
      label: 'Custom Amount',
      clientState: 'custom_amount',
      dataType: 'input',
      fieldType: 'decimal'
    });
  }

  // Invalid input
  return buildResponse(sessionId, ResponseType.RESPONSE,
    `Invalid choice. Please select 1-${amounts.length + 1}\n\n` + buildAmountMenu(), {
      label: 'Invalid Selection',
      clientState: 'amount_selection',
      dataType: 'input',
      fieldType: 'number'
    });
}

/**
 * Handle custom amount input
 */
function handleCustomAmount(sessionId, input) {
  // Handle back option
  if (input.trim() === '0') {
    updateSession(sessionId, { step: 'amount_selection' });
    return buildResponse(sessionId, ResponseType.RESPONSE, buildAmountMenu(), {
      label: 'Select Amount',
      clientState: 'amount_selection',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  const amount = parseFloat(input);

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    return buildResponse(sessionId, ResponseType.RESPONSE, 'Invalid amount. Enter amount or 0 to go back:', {
      label: 'Invalid Amount',
      clientState: 'custom_amount',
      dataType: 'input',
      fieldType: 'decimal'
    });
  }

  // Minimum amount check
  if (amount < 1) {
    return buildResponse(sessionId, ResponseType.RESPONSE, 'Minimum donation is GHS 1. Please enter amount:', {
      label: 'Amount Too Low',
      clientState: 'custom_amount',
      dataType: 'input',
      fieldType: 'decimal'
    });
  }

  // Maximum amount check
  if (amount > 10000) {
    return buildResponse(sessionId, ResponseType.RESPONSE, 'Maximum donation is GHS 10,000. Please enter amount:', {
      label: 'Amount Too High',
      clientState: 'custom_amount',
      dataType: 'input',
      fieldType: 'decimal'
    });
  }

  updateSession(sessionId, {
    step: 'frequency_selection',
    amount: amount
  });

  return buildResponse(sessionId, ResponseType.RESPONSE, buildFrequencyMenu(amount), {
    label: 'Select Frequency',
    clientState: 'frequency_selection',
    dataType: 'input',
    fieldType: 'number'
  });
}

/**
 * Handle frequency selection step
 */
async function handleFrequencySelection(sessionId, input, session, mobile) {
  const choice = input.trim();
  const frequencies = config.frequencies;

  if (choice === '0') {
    updateSession(sessionId, { step: 'amount_selection', amount: null });
    return buildResponse(sessionId, ResponseType.RESPONSE, buildAmountMenu(), {
      label: 'Select Amount',
      clientState: 'amount_selection',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  if (choice === '5') {
    const formattedPhone = recurringInvoiceService.formatPhoneNumber(mobile);
    let subscriptions;
    try {
      subscriptions = await donationService.getActiveSubscriptions(formattedPhone);
    } catch (err) {
      console.error('Error looking up subscriptions:', err);
      return buildResponse(sessionId, ResponseType.RESPONSE,
        'An error occurred. Please try again.\n\n' + buildFrequencyMenu(session.amount), {
          label: 'Error',
          clientState: 'frequency_selection',
          dataType: 'input',
          fieldType: 'number'
        });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return buildResponse(sessionId, ResponseType.RESPONSE,
        'You have no active subscription to cancel.\n\n' + buildFrequencyMenu(session.amount), {
          label: 'No Subscription',
          clientState: 'frequency_selection',
          dataType: 'input',
          fieldType: 'number'
        });
    }

    const subscription = subscriptions[0];
    updateSession(sessionId, {
      step: 'cancellation_confirmation',
      cancelSubscriptionId: subscription._id,
      cancelFrequency: subscription.frequency,
      cancelAmount: subscription.amount
    });

    const confirmMenu =
      `Your ${subscription.frequency} subscription of GHS ${subscription.amount} will be cancelled.\n\n` +
      '1. Confirm cancellation\n' +
      '2. Keep subscription\n' +
      '0. Back';

    return buildResponse(sessionId, ResponseType.RESPONSE, confirmMenu, {
      label: 'Confirm Cancellation',
      clientState: 'cancellation_confirmation',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  if (!frequencies[choice]) {
    return buildResponse(sessionId, ResponseType.RESPONSE,
      'Invalid choice. Select 1-5 or 0 to go back:\n\n' + buildFrequencyMenu(session.amount), {
        label: 'Invalid Frequency',
        clientState: 'frequency_selection',
        dataType: 'input',
        fieldType: 'number'
      });
  }

  const frequency = frequencies[choice];
  updateSession(sessionId, {
    step: 'confirmation',
    frequency: frequency.name,
    frequencyCode: frequency.code
  });

  return buildResponse(sessionId, ResponseType.RESPONSE, buildConfirmationMenu(session.amount, frequency.name), {
    label: 'Confirm Donation',
    clientState: 'confirmation',
    dataType: 'input',
    fieldType: 'number'
  });
}

/**
 * Handle cancellation confirmation step
 */
async function handleCancellationConfirmation(sessionId, input, session) {
  const choice = input.trim();

  const confirmMenu =
    `Your ${session.cancelFrequency} subscription of GHS ${session.cancelAmount} will be cancelled.\n\n` +
    '1. Confirm cancellation\n' +
    '2. Keep subscription\n' +
    '0. Back';

  if (choice === '0' || choice === '2') {
    updateSession(sessionId, { step: 'frequency_selection' });
    return buildResponse(sessionId, ResponseType.RESPONSE, buildFrequencyMenu(session.amount), {
      label: 'Select Frequency',
      clientState: 'frequency_selection',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  if (choice === '1') {
    const result = await donationService.cancelSubscription(
      session.cancelSubscriptionId,
      'Cancelled by user via USSD'
    );

    if (result.success) {
      clearSession(sessionId);
      return buildResponse(sessionId, ResponseType.RELEASE,
        'Your subscription has been cancelled. Thank you for your support.', {
          label: 'Cancelled',
          clientState: 'subscription_cancelled',
          dataType: 'display'
        });
    } else {
      clearSession(sessionId);
      return buildResponse(sessionId, ResponseType.RELEASE,
        'Sorry, we could not cancel your subscription. Please contact support.', {
          label: 'Cancel Failed',
          clientState: 'cancel_failed',
          dataType: 'display'
        });
    }
  }

  return buildResponse(sessionId, ResponseType.RESPONSE, confirmMenu, {
    label: 'Invalid Choice',
    clientState: 'cancellation_confirmation',
    dataType: 'input',
    fieldType: 'number'
  });
}

/**
 * Handle confirmation step
 */
async function handleConfirmation(sessionId, input, session, mobile) {
  const choice = input.trim();

  // Handle back option - go to frequency selection
  if (choice === '0') {
    updateSession(sessionId, { step: 'frequency_selection', frequency: null, frequencyCode: null });
    return buildResponse(sessionId, ResponseType.RESPONSE, buildFrequencyMenu(session.amount), {
      label: 'Select Frequency',
      clientState: 'frequency_selection',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  if (choice === '1') {
    // User confirmed
    const donationData = {
      sessionId,
      mobile,
      amount: session.amount,
      frequency: session.frequency,
      frequencyCode: session.frequencyCode
    };

    console.log('Donation confirmed:', donationData);

    // Generate a unique reference for tracking
    const clientReference = `DON-${sessionId.substring(0, 8)}-${Date.now()}`;

    // Build description based on frequency
    const description = session.frequencyCode === 'once'
      ? `Donation to ${config.orgName}`
      : `${session.frequency} donation to ${config.orgName}`;

    // Check if this is a recurring donation
    if (isRecurringFrequency(session.frequencyCode)) {
      // Use Hubtel Recurring Invoice API for subscriptions
      console.log('Creating recurring invoice for:', session.frequencyCode);

      try {
        const invoiceResult = await recurringInvoiceService.createRecurringInvoice({
          phoneNumber: mobile,
          amount: session.amount,
          frequency: session.frequencyCode,
          description,
          clientReference
        });

        if (invoiceResult.success) {
          // Create subscription record in database
          const channel = recurringInvoiceService.detectNetwork(mobile);
          const subscriptionResult = await donationService.createSubscription({
            phoneNumber: recurringInvoiceService.formatPhoneNumber(mobile),
            amount: session.amount,
            channel,
            frequency: session.frequencyCode,
            sessionId,
            recurringInvoiceId: invoiceResult.data?.recurringInvoiceId,
            hubtelRequestId: invoiceResult.data?.requestId,
            hubtelVerificationType: invoiceResult.data?.verificationType,
            clientReference,
            managedByHubtel: true
          });

          if (subscriptionResult.success) {
            console.log(`Subscription created: ${subscriptionResult.subscription._id}`);
          }

          // Update session with recurring invoice info
          updateSession(sessionId, {
            step: 'recurring_created',
            clientReference,
            recurringInvoiceId: invoiceResult.data?.recurringInvoiceId,
            paymentInitiated: new Date()
          });

          // Return success message - Hubtel will handle the payment prompt
          clearSession(sessionId);
          return buildResponse(sessionId, ResponseType.RELEASE,
            `Thank you for giving to the Lord. Your contribution to JMF is received. God bless you richly.`, {
              label: 'Subscription Created',
              clientState: clientReference,
              dataType: 'display',
              donationData: {
                ...donationData,
                clientReference,
                recurringInvoiceId: invoiceResult.data?.recurringInvoiceId,
                isRecurring: true
              }
            });
        } else {
          // Failed to create recurring invoice
          console.error('Recurring invoice failed:', invoiceResult.error);
          return buildResponse(sessionId, ResponseType.RELEASE,
            'Sorry, we could not set up your recurring donation. Please try again later.', {
              label: 'Setup Failed',
              clientState: 'error',
              dataType: 'display'
            });
        }
      } catch (error) {
        console.error('Recurring invoice error:', error);
        return buildResponse(sessionId, ResponseType.RELEASE,
          'An error occurred. Please try again later.', {
            label: 'Error',
            clientState: 'error',
            dataType: 'display'
          });
      }
    }

    // One-time donation - use AddToCart
    updateSession(sessionId, {
      step: 'payment_pending',
      clientReference,
      paymentInitiated: new Date()
    });

    // Return AddToCart response to trigger payment prompt
    return buildAddToCartResponse(sessionId, session.amount, description, clientReference);
  }

  if (choice === '2') {
    // User cancelled
    clearSession(sessionId);
    return buildResponse(sessionId, ResponseType.RELEASE, 'Donation cancelled. Thank you for considering us. Dial again anytime!', {
      label: 'Cancelled',
      clientState: 'cancelled',
      dataType: 'display'
    });
  }

  // Invalid input
  return buildResponse(sessionId, ResponseType.RESPONSE, 'Invalid choice. Please select:\n1. Confirm\n2. Cancel', {
    label: 'Invalid Choice',
    clientState: 'confirmation',
    dataType: 'input',
    fieldType: 'number'
  });
}

module.exports = {
  processRequest,
  getSession,
  clearSession,
  ResponseType
};
