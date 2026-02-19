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
  RESPONSE: 'response',  // Continue session, expect user input
  RELEASE: 'release'     // End session
};

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
  if (Type === 'initiation' || Sequence === 1) {
    updateSession(SessionId, { step: 'amount_selection' });
    return {
      SessionId,
      Type: ResponseType.RESPONSE,
      Message: buildAmountMenu(),
      ClientState: 'amount_selection'
    };
  }

  // Process based on current step
  switch (session.step) {
    case 'amount_selection':
      return handleAmountSelection(SessionId, Message, session);

    case 'custom_amount':
      return handleCustomAmount(SessionId, Message, session);

    case 'frequency_selection':
      return handleFrequencySelection(SessionId, Message, session);

    case 'confirmation':
      return handleConfirmation(SessionId, Message, session, Mobile);

    default:
      clearSession(SessionId);
      return {
        SessionId,
        Type: ResponseType.RELEASE,
        Message: 'Session error. Please try again.',
        ClientState: 'error'
      };
  }
}

/**
 * Handle amount selection step
 */
function handleAmountSelection(sessionId, input, session) {
  const choice = parseInt(input);
  const amounts = config.donationAmounts;

  // Check if valid predefined amount
  if (choice >= 1 && choice <= amounts.length) {
    const amount = amounts[choice - 1];
    updateSession(sessionId, {
      step: 'frequency_selection',
      amount: amount
    });

    return {
      SessionId: sessionId,
      Type: ResponseType.RESPONSE,
      Message: buildFrequencyMenu(amount),
      ClientState: 'frequency_selection'
    };
  }

  // Custom amount option
  if (choice === amounts.length + 1) {
    updateSession(sessionId, { step: 'custom_amount' });
    return {
      SessionId: sessionId,
      Type: ResponseType.RESPONSE,
      Message: 'Enter custom amount (GHS):',
      ClientState: 'custom_amount'
    };
  }

  // Invalid input
  return {
    SessionId: sessionId,
    Type: ResponseType.RESPONSE,
    Message: `Invalid choice. Please select 1-${amounts.length + 1}\n\n` + buildAmountMenu(),
    ClientState: 'amount_selection'
  };
}

/**
 * Handle custom amount input
 */
function handleCustomAmount(sessionId, input, session) {
  const amount = parseFloat(input);

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    return {
      SessionId: sessionId,
      Type: ResponseType.RESPONSE,
      Message: 'Invalid amount. Please enter a valid number:',
      ClientState: 'custom_amount'
    };
  }

  // Minimum amount check
  if (amount < 1) {
    return {
      SessionId: sessionId,
      Type: ResponseType.RESPONSE,
      Message: 'Minimum donation is GHS 1. Please enter amount:',
      ClientState: 'custom_amount'
    };
  }

  // Maximum amount check (optional - adjust as needed)
  if (amount > 10000) {
    return {
      SessionId: sessionId,
      Type: ResponseType.RESPONSE,
      Message: 'Maximum donation is GHS 10,000. Please enter amount:',
      ClientState: 'custom_amount'
    };
  }

  updateSession(sessionId, {
    step: 'frequency_selection',
    amount: amount
  });

  return {
    SessionId: sessionId,
    Type: ResponseType.RESPONSE,
    Message: buildFrequencyMenu(amount),
    ClientState: 'frequency_selection'
  };
}

/**
 * Handle frequency selection step
 */
function handleFrequencySelection(sessionId, input, session) {
  const choice = input.trim();
  const frequencies = config.frequencies;

  if (!frequencies[choice]) {
    return {
      SessionId: sessionId,
      Type: ResponseType.RESPONSE,
      Message: 'Invalid choice. Please select 1-5:\n\n' + buildFrequencyMenu(session.amount),
      ClientState: 'frequency_selection'
    };
  }

  const frequency = frequencies[choice];
  updateSession(sessionId, {
    step: 'confirmation',
    frequency: frequency.name,
    frequencyCode: frequency.code
  });

  return {
    SessionId: sessionId,
    Type: ResponseType.RESPONSE,
    Message: buildConfirmationMenu(session.amount, frequency.name),
    ClientState: 'confirmation'
  };
}

/**
 * Handle confirmation step
 */
function handleConfirmation(sessionId, input, session, mobile) {
  const choice = input.trim();

  if (choice === '1') {
    // User confirmed - process payment
    const donationData = {
      sessionId,
      mobile,
      amount: session.amount,
      frequency: session.frequency,
      frequencyCode: session.frequencyCode
    };

    console.log('Donation confirmed:', donationData);

    // Clear session
    clearSession(sessionId);

    // For now, return success message
    // Later we'll integrate actual payment
    if (session.frequencyCode === 'once') {
      return {
        SessionId: sessionId,
        Type: ResponseType.RELEASE,
        Message: `Thank you for your donation of GHS ${session.amount} to ${config.orgName}!\n\nA payment prompt will be sent to your phone shortly. Please approve to complete.`,
        ClientState: 'completed',
        // Include donation data for processing
        donationData
      };
    } else {
      return {
        SessionId: sessionId,
        Type: ResponseType.RELEASE,
        Message: `Thank you for pledging GHS ${session.amount} ${session.frequency} to ${config.orgName}!\n\nA payment prompt will be sent to your phone. Your donation will recur ${session.frequency.toLowerCase()}.`,
        ClientState: 'completed',
        donationData
      };
    }
  }

  if (choice === '2') {
    // User cancelled
    clearSession(sessionId);
    return {
      SessionId: sessionId,
      Type: ResponseType.RELEASE,
      Message: 'Donation cancelled. Thank you for considering us. Dial again anytime!',
      ClientState: 'cancelled'
    };
  }

  // Invalid input
  return {
    SessionId: sessionId,
    Type: ResponseType.RESPONSE,
    Message: 'Invalid choice. Please select:\n1. Confirm\n2. Cancel',
    ClientState: 'confirmation'
  };
}

module.exports = {
  processRequest,
  getSession,
  clearSession,
  ResponseType
};
