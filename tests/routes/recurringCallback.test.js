'use strict';

jest.mock('../../src/config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(null),
  disconnectDatabase: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../src/services/schedulerService', () => ({
  start: jest.fn(),
  stop: jest.fn(),
  getStatus: jest.fn().mockReturnValue({ enabled: false, running: false, schedule: '', timezone: '' })
}));

// handleRecurringCallback is SYNCHRONOUS — use mockReturnValue, not mockResolvedValue
jest.mock('../../src/services/recurringInvoiceService', () => ({
  handleRecurringCallback: jest.fn()
}));

function makeMockSubscription(overrides = {}) {
  return {
    id: 'sub-1',
    donorId: 'donor-1',
    phoneNumber: '233244000000',
    amount: 50,
    channel: 'mtn-gh',
    frequency: 'monthly',
    status: 'active',
    ...overrides
  };
}

jest.mock('../../src/models', () => ({
  Subscription: {
    findByRecurringInvoiceId: jest.fn(),
    findByClientReference: jest.fn(),
    recordRecurringPayment: jest.fn(),
    recordFailure: jest.fn(),
    cancel: jest.fn()
  },
  Donation: {},
  Donor: {},
  isUniqueViolation: (err) => Boolean(err && err.code === 'P2002')
}));

jest.mock('../../src/services/paymentService', () => ({
  handlePaymentCallback: jest.fn().mockResolvedValue({ reference: 'DON-TEST', status: 'completed' }),
  handleFulfilmentCallback: jest.fn().mockResolvedValue({
    ResponseCode: '0000',
    Status: 'TXN_SUCCESS',
    Message: 'Fulfilled'
  }),
  getAllPayments: jest.fn().mockResolvedValue([]),
  getPayment: jest.fn().mockResolvedValue(null),
  getStats: jest.fn().mockResolvedValue({})
}));

jest.mock('../../src/services/donationService', () => ({
  cancelSubscription: jest.fn().mockResolvedValue({ success: true, subscription: {} })
}));

const request = require('supertest');
const app = require('../../src/app');
const recurringInvoiceService = require('../../src/services/recurringInvoiceService');
const { Subscription } = require('../../src/models');

const RECURRING_URL = '/api/callback/recurring';
const VALID_BODY = { ResponseCode: '0000', Data: { RecurringInvoiceId: 'INV-001' } };

function successResult(overrides = {}) {
  return {
    success: true,
    failed: false,
    cancelled: false,
    recurringInvoiceId: 'INV-001',
    transactionId: 'TXN-001',
    clientReference: 'REF-001',
    amount: 75,
    ...overrides
  };
}

describe('POST /api/callback/recurring', () => {
  let mockSubscription;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscription = makeMockSubscription();
    Subscription.findByRecurringInvoiceId.mockResolvedValue(mockSubscription);
    Subscription.findByClientReference.mockResolvedValue(null);
  });

  test('successful payment (0000) — records donation + subscription in one transaction, responds 200', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue(successResult());
    Subscription.recordRecurringPayment.mockResolvedValue({
      donation: { id: 'don-1' },
      subscription: { ...mockSubscription, paymentsCompleted: 1 }
    });

    const res = await request(app).post(RECURRING_URL).send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.subscriptionId).toBe('sub-1');
    expect(Subscription.recordRecurringPayment).toHaveBeenCalledWith(mockSubscription, {
      amount: 75,
      reference: 'REC-TXN-001',
      transactionId: 'TXN-001'
    });
  });

  test('falls back to subscription amount when callback has none', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue(successResult({ amount: undefined }));
    Subscription.recordRecurringPayment.mockResolvedValue({ donation: {}, subscription: mockSubscription });

    await request(app).post(RECURRING_URL).send(VALID_BODY);

    expect(Subscription.recordRecurringPayment).toHaveBeenCalledWith(
      mockSubscription,
      expect.objectContaining({ amount: 50 })
    );
  });

  test('duplicate success callback (same TransactionId) — acknowledges 200 without double-counting', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue(successResult());
    const dupError = Object.assign(new Error('Unique constraint failed on the fields: (`reference`)'), { code: 'P2002' });
    Subscription.recordRecurringPayment.mockRejectedValue(dupError);

    const res = await request(app).post(RECURRING_URL).send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Recurring callback already processed');
  });

  test('database error while recording — returns 500 so Hubtel retries (transaction rolled back)', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue(successResult());
    Subscription.recordRecurringPayment.mockRejectedValue(new Error('connection lost'));

    const res = await request(app).post(RECURRING_URL).send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('failed payment (2001) — calls recordFailure and responds 200', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue({
      success: false,
      failed: true,
      cancelled: false,
      recurringInvoiceId: 'INV-001',
      message: 'Insufficient funds'
    });
    Subscription.recordFailure.mockResolvedValue({ ...mockSubscription, paymentsFailed: 1 });

    const res = await request(app)
      .post(RECURRING_URL)
      .send({ ResponseCode: '2001', Data: { RecurringInvoiceId: 'INV-001' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Subscription.recordFailure).toHaveBeenCalledWith('sub-1', 'Insufficient funds');
    expect(Subscription.recordRecurringPayment).not.toHaveBeenCalled();
  });

  test('cancellation (0005) — cancels subscription and responds 200 with new status', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue({
      success: false,
      failed: false,
      cancelled: true,
      recurringInvoiceId: 'INV-001'
    });
    Subscription.cancel.mockResolvedValue({ ...mockSubscription, status: 'cancelled' });

    const res = await request(app)
      .post(RECURRING_URL)
      .send({ ResponseCode: '0005', Data: { RecurringInvoiceId: 'INV-001' } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(Subscription.cancel).toHaveBeenCalledWith('sub-1', 'Cancelled by Hubtel');
  });

  test('no matching subscription — responds 200 with informational message', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue(successResult({ recurringInvoiceId: 'INV-UNKNOWN' }));
    Subscription.findByRecurringInvoiceId.mockResolvedValue(null);

    const res = await request(app)
      .post(RECURRING_URL)
      .send({ ResponseCode: '0000', Data: { RecurringInvoiceId: 'INV-UNKNOWN' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Callback received but no matching subscription found');
    expect(Subscription.recordRecurringPayment).not.toHaveBeenCalled();
  });

  test('handler exception — returns HTTP 500', async () => {
    recurringInvoiceService.handleRecurringCallback.mockImplementation(() => {
      throw new Error('Unexpected error');
    });

    const res = await request(app).post(RECURRING_URL).send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  test('invalid payload — returns 400 with validation details (not a crash)', async () => {
    const res = await request(app)
      .post(RECURRING_URL)
      .send({ ResponseCode: '0000', Data: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request data');
    expect(res.body.details).toContain('Data.RecurringInvoiceId');
  });
});
