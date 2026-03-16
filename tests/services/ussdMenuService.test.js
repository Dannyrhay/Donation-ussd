'use strict';

jest.useFakeTimers(); // prevents setInterval in ussdMenuService from leaking

jest.mock('../../src/config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(null),
  disconnectDatabase: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/donationService', () => ({
  getActiveSubscriptions: jest.fn().mockResolvedValue([]),
  cancelSubscription: jest.fn(),
  createDonation: jest.fn().mockResolvedValue({ success: true, reference: 'DON-TEST', donation: {} }),
  createSubscription: jest.fn().mockResolvedValue({ success: true, subscription: { _id: 'SUB-1' } }),
  updateDonationStatus: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../src/services/recurringInvoiceService', () => ({
  formatPhoneNumber: jest.fn(phone =>
    phone.startsWith('0') ? '233' + phone.slice(1) : phone
  ),
  detectNetwork: jest.fn(() => 'mtn-gh'),
  createRecurringInvoice: jest.fn().mockResolvedValue({
    success: true,
    data: { recurringInvoiceId: 'INV-1', requestId: 'REQ-1', verificationType: 'USSD' }
  }),
  cancelRecurringInvoice: jest.fn()
}));

jest.mock('../../src/config', () => ({
  orgName: 'Test Org',
  donationAmounts: [5, 10, 50],
  frequencies: {
    '1': { name: 'Weekly', code: 'weekly' },
    '2': { name: 'Monthly', code: 'monthly' },
    '3': { name: 'Annually', code: 'annually' },
    '4': { name: 'One-time', code: 'once' }
  },
  recurringDefaults: { startTime: '10:00', currency: 'GHS', paymentOption: 'MobileMoney' },
  hubtelRecurring: {
    posSalesId: null,
    intervals: { weekly: 'Weekly', monthly: 'Monthly', annually: 'Yearly' }
  }
}));

const donationService = require('../../src/services/donationService');
const { processRequest, clearSession, ResponseType } = require('../../src/services/ussdMenuService');

// Helper: navigate to frequency_selection step with amount GHS 5 (choice '1')
async function navigateToFrequencyMenu(sessionId, mobile = '0244000000') {
  // Step 1: Initiation → amount_selection
  await processRequest({ SessionId: sessionId, Type: 'Initiation', Message: '', Mobile: mobile, Sequence: 1 });
  // Step 2: Select amount '1' (GHS 5) → frequency_selection
  const response = await processRequest({ SessionId: sessionId, Type: 'Response', Message: '1', Mobile: mobile });
  return response;
}

describe('USSD frequency menu — cancel subscription option', () => {
  const SESSION = 'TEST-CANCEL-001';
  const MOBILE = '0244000000';

  beforeEach(async () => {
    clearSession(SESSION);
    jest.clearAllMocks();
    await navigateToFrequencyMenu(SESSION, MOBILE);
  });

  afterAll(() => {
    clearSession(SESSION);
    jest.useRealTimers();
  });

  test('frequency menu includes "5. Cancel subscription"', async () => {
    // beforeEach already navigated to frequency_selection — re-navigate from clean state
    clearSession(SESSION);
    await processRequest({ SessionId: SESSION, Type: 'Initiation', Message: '', Mobile: MOBILE, Sequence: 1 });
    const freqResponse = await processRequest({ SessionId: SESSION, Type: 'Response', Message: '1', Mobile: MOBILE });
    expect(freqResponse.Message).toContain('5. Cancel subscription');
  });

  test('selecting 5 with no active subscription re-shows frequency menu with message', async () => {
    donationService.getActiveSubscriptions.mockResolvedValue([]);

    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '5', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('no active subscription');
    expect(response.Message).toContain('Cancel subscription'); // menu is re-shown
  });

  test('selecting 5 with an active subscription transitions to cancellation_confirmation', async () => {
    donationService.getActiveSubscriptions.mockResolvedValue([{
      _id: 'SUB-ID-1',
      frequency: 'monthly',
      amount: 50
    }]);

    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '5', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('monthly');
    expect(response.Message).toContain('50');
    expect(response.Message).toContain('Confirm cancellation');
  });

  test('selecting 1-4 still works normally after adding option 5', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '2', Mobile: MOBILE
    });
    // Should go to confirmation step (Monthly selected)
    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('Monthly');
    expect(response.Message).toContain('Confirm');
  });

  test('invalid input shows updated error message mentioning 1-5', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '9', Mobile: MOBILE
    });
    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toMatch(/1-5/);
  });
});
