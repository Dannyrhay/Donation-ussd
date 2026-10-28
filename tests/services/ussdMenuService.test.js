'use strict';

jest.useFakeTimers(); // prevents setInterval in ussdMenuService from leaking

jest.mock('../../src/config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(null),
  disconnectDatabase: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/donationService', () => ({
  getActiveSubscriptions: jest.fn().mockResolvedValue([]),
  getDonor: jest.fn().mockResolvedValue(null),
  cancelSubscription: jest.fn(),
  createDonation: jest.fn().mockResolvedValue({ success: true, reference: 'DON-TEST', donation: {} }),
  createSubscription: jest.fn().mockResolvedValue({ success: true, subscription: { id: 'SUB-1' } }),
  updateDonationStatus: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../src/services/recurringInvoiceService', () => ({
  formatPhoneNumber: jest.fn(phone =>
    phone.startsWith('0') ? '233' + phone.slice(1) : phone
  ),
  detectNetwork: jest.fn(() => 'mtn-gh'),
  isAirtelTigo: jest.fn(() => false),
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
      id: 'SUB-ID-1',
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

describe('USSD cancellation confirmation step', () => {
  const SESSION = 'TEST-CANCEL-002';
  const MOBILE = '0244000000';

  async function navigateToCancellationConfirmation(sessionId, mobile) {
    clearSession(sessionId);
    jest.clearAllMocks();
    await processRequest({ SessionId: sessionId, Type: 'Initiation', Message: '', Mobile: mobile, Sequence: 1 });
    await processRequest({ SessionId: sessionId, Type: 'Response', Message: '1', Mobile: mobile });

    donationService.getActiveSubscriptions.mockResolvedValue([{
      id: 'SUB-ID-2',
      frequency: 'weekly',
      amount: 20
    }]);
    await processRequest({ SessionId: sessionId, Type: 'Response', Message: '5', Mobile: mobile });
  }

  beforeEach(async () => {
    await navigateToCancellationConfirmation(SESSION, MOBILE);
  });

  afterAll(() => {
    clearSession(SESSION);
  });

  test('replying 1 calls cancelSubscription and returns Release with success message', async () => {
    donationService.cancelSubscription.mockResolvedValue({
      success: true,
      subscription: { id: 'SUB-ID-2', status: 'cancelled' }
    });

    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '1', Mobile: MOBILE
    });

    expect(donationService.cancelSubscription).toHaveBeenCalledWith('SUB-ID-2', 'Cancelled by user via USSD');
    expect(response.Type).toBe(ResponseType.RELEASE);
    expect(response.Message).toContain('cancelled');
  });

  test('replying 2 returns to frequency_selection', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '2', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('Cancel subscription');
  });

  test('replying 0 returns to frequency_selection', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '0', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('Cancel subscription');
  });

  test('cancelSubscription failure returns Release with error message', async () => {
    donationService.cancelSubscription.mockResolvedValue({
      success: false,
      error: 'Hubtel cancel failed'
    });

    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '1', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RELEASE);
    expect(response.Message).toContain('could not cancel');
  });

  test('invalid input re-shows confirmation menu', async () => {
    const response = await processRequest({
      SessionId: SESSION, Type: 'Response', Message: '9', Mobile: MOBILE
    });

    expect(response.Type).toBe(ResponseType.RESPONSE);
    expect(response.Message).toContain('Confirm cancellation');
  });
});

describe('USSD one-time payment — customer name sent to Hubtel', () => {
  // amount '1' (GHS 5) → frequency '4' (One-time) → confirm '1' → AddToCart
  async function confirmOneTime(sessionId, mobile) {
    await navigateToFrequencyMenu(sessionId, mobile);
    await processRequest({ SessionId: sessionId, Type: 'Response', Message: '4', Mobile: mobile });
    return processRequest({ SessionId: sessionId, Type: 'Response', Message: '1', Mobile: mobile });
  }

  test('omits CustomerName for unknown donors instead of sending placeholder "Donor"', async () => {
    donationService.getDonor.mockResolvedValueOnce(null);

    const res = await confirmOneTime('name-unknown', '0244000001');

    expect(res.Type).toBe(ResponseType.ADDTOCART);
    expect(res).not.toHaveProperty('CustomerName');
  });

  test('omits CustomerName when stored name is the legacy "Donor" placeholder', async () => {
    donationService.getDonor.mockResolvedValueOnce({ name: 'Donor' });

    const res = await confirmOneTime('name-legacy', '0244000002');

    expect(res).not.toHaveProperty('CustomerName');
  });

  test('sends the real name when the donor has one', async () => {
    donationService.getDonor.mockResolvedValueOnce({ name: 'Ama Mensah' });

    const res = await confirmOneTime('name-known', '0244000003');

    expect(res.CustomerName).toBe('Ama Mensah');
  });
});

describe('USSD one-time payment — pending donation is recorded', () => {
  const recurringInvoiceService = require('../../src/services/recurringInvoiceService');

  async function confirmOneTime(sessionId, mobile) {
    await navigateToFrequencyMenu(sessionId, mobile);
    await processRequest({ SessionId: sessionId, Type: 'Response', Message: '4', Mobile: mobile });
    return processRequest({ SessionId: sessionId, Type: 'Response', Message: '1', Mobile: mobile });
  }

  beforeEach(() => jest.clearAllMocks());

  test('creates a pending one-time donation before returning AddToCart (regression: nothing was saved)', async () => {
    recurringInvoiceService.detectNetwork.mockReturnValueOnce('vodafone_gh_rec');

    const res = await confirmOneTime('record-1', '0204000001');

    expect(res.Type).toBe(ResponseType.ADDTOCART);
    expect(donationService.createDonation).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumber: '233204000001',
      amount: 5,
      channel: 'vodafone-gh',
      frequency: 'once',
      sessionId: 'record-1'
    }));
  });

  test('still returns the payment prompt if saving the donation fails', async () => {
    donationService.createDonation.mockResolvedValueOnce({ success: false, error: 'db down' });

    const res = await confirmOneTime('record-2', '0244000002');

    expect(res.Type).toBe(ResponseType.ADDTOCART);
  });

  test('recurring donations do not create a one-time donation record', async () => {
    await navigateToFrequencyMenu('record-3', '0244000003');
    await processRequest({ SessionId: 'record-3', Type: 'Response', Message: '2', Mobile: '0244000003' }); // Monthly
    await processRequest({ SessionId: 'record-3', Type: 'Response', Message: '1', Mobile: '0244000003' });

    expect(donationService.createDonation).not.toHaveBeenCalled();
  });
});
