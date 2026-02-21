const config = require('../config');

/**
 * USSD Menu Service
 * Handles the flow of USSD menus for donations
 *
 * Flow:
 * 1. Welcome -> Select Amount
 * 2. Select Amount -> Select Frequency
 * 3. Select Frequency -> Confirm
 * 4. Confirm -> Process Payment
 */

// In-memory session storage (use Redis/DB in production)
const sessions = new Map();

/**
 * Response types for Hubtel USSD
 */
const ResponseType = {
  RESPONSE: 'Response',      // Continue session, expect user input
  RELEASE: 'Release',        // End session
  ADDTOCART: 'AddToCart'     // Trigger payment prompt
};

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
    Message: `Processing payment of GHS ${amount}...`,
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
  menu += '1. One-time\n';
  menu += '2. Weekly\n';
  menu += '3. Monthly\n';
  menu += '4. Quarterly\n';
  menu += '5. Annually';

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
  menu += '2. Cancel';

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
 * Process USSD request and return appropriate response
 */
function processRequest(ussdRequest) {
  const { SessionId, Type, Message, Mobile, Sequence } = ussdRequest;

  // Get current session
  const session = getSession(SessionId);

  console.log(`Processing: SessionId=${SessionId}, Step=${session.step}, Input=${Message}`);

  // Initial request (user just dialed the code)
  // Hubtel sends Type as "Initiation" (capital I)
  if (Type === 'Initiation' || Type === 'initiation' || Sequence === 1) {
    updateSession(SessionId, { step: 'amount_selection' });
    return buildResponse(SessionId, ResponseType.RESPONSE, buildAmountMenu(), {
      label: 'Select Amount',
      clientState: 'amount_selection',
      dataType: 'input',
      fieldType: 'number'
    });
  }

  // Process based on current step
  switch (session.step) {
    case 'amount_selection':
      return handleAmountSelection(SessionId, Message);

    case 'custom_amount':
      return handleCustomAmount(SessionId, Message);

    case 'frequency_selection':
      return handleFrequencySelection(SessionId, Message, session);

    case 'confirmation':
      return handleConfirmation(SessionId, Message, session, Mobile);

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
  const amount = parseFloat(input);

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    return buildResponse(sessionId, ResponseType.RESPONSE, 'Invalid amount. Please enter a valid number:', {
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
function handleFrequencySelection(sessionId, input, session) {
  const choice = input.trim();
  const frequencies = config.frequencies;

  if (!frequencies[choice]) {
    return buildResponse(sessionId, ResponseType.RESPONSE,
      'Invalid choice. Please select 1-5:\n\n' + buildFrequencyMenu(session.amount), {
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
 * Handle confirmation step
 */
function handleConfirmation(sessionId, input, session, mobile) {
  const choice = input.trim();

  if (choice === '1') {
    // User confirmed - trigger payment via AddToCart
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

    // Update session with payment info (for callback handling)
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
