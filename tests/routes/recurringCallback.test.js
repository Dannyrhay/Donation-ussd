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

const mongoose = require('mongoose');

function makeMockSubscription(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    donor: new mongoose.Types.ObjectId(),
    phoneNumber: '233244000000',
    amount: 50,
    channel: 'mtn-gh',
    frequency: 'monthly',
    status: 'active',
    recordPayment: jest.fn().mockResolvedValue({}),
    recordFailure: jest.fn().mockResolvedValue({}),
    cancel: jest.fn().mockResolvedValue({}),
    ...overrides
  };
}

jest.mock('../../src/models', () => ({
  Subscription: {
    findByRecurringInvoiceId: jest.fn(),
    findByClientReference: jest.fn()
  },
  Donation: {
    create: jest.fn().mockResolvedValue({})
  },
  Donor: {}
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
const { Subscription, Donation } = require('../../src/models');

const RECURRING_URL = '/api/callback/recurring';

describe('POST /api/callback/recurring', () => {
  let mockSubscription;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscription = makeMockSubscription();
  });

  test('successful payment (0000) — records donation and responds 200', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue({
      success: true,
      failed: false,
      cancelled: false,
      recurringInvoiceId: 'INV-001',
      transactionId: 'TXN-001',
      clientReference: 'REF-001',
      amount: 50
    });
    Subscription.findByRecurringInvoiceId.mockResolvedValue(mockSubscription);

    const res = await request(app)
      .post(RECURRING_URL)
      .send({ ResponseCode: '0000', Data: { RecurringInvoiceId: 'INV-001' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSubscription.recordPayment).toHaveBeenCalledWith(50);
    expect(Donation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumber: mockSubscription.phoneNumber,
        amount: 50,
        source: 'hubtel_recurring',
        status: 'Success'
      })
    );
  });

  test('failed payment (2001) — calls recordFailure and responds 200', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue({
      success: false,
      failed: true,
      cancelled: false,
      recurringInvoiceId: 'INV-001',
      message: 'Insufficient funds'
    });
    Subscription.findByRecurringInvoiceId.mockResolvedValue(mockSubscription);

    const res = await request(app)
      .post(RECURRING_URL)
      .send({ ResponseCode: '2001', Data: { RecurringInvoiceId: 'INV-001' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSubscription.recordFailure).toHaveBeenCalledWith('Insufficient funds');
    expect(Donation.create).not.toHaveBeenCalled();
  });

  test('cancellation (0005) — calls subscription.cancel and responds 200', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue({
      success: false,
      failed: false,
      cancelled: true,
      recurringInvoiceId: 'INV-001'
    });
    Subscription.findByRecurringInvoiceId.mockResolvedValue(mockSubscription);

    const res = await request(app)
      .post(RECURRING_URL)
      .send({ ResponseCode: '0005', Data: { RecurringInvoiceId: 'INV-001' } });

    expect(res.status).toBe(200);
    expect(mockSubscription.cancel).toHaveBeenCalledWith('Cancelled by Hubtel');
  });

  test('no matching subscription — responds 200 with informational message', async () => {
    recurringInvoiceService.handleRecurringCallback.mockReturnValue({
      success: true,
      failed: false,
      cancelled: false,
      recurringInvoiceId: 'INV-UNKNOWN',
      clientReference: 'REF-UNKNOWN'
    });
    Subscription.findByRecurringInvoiceId.mockResolvedValue(null);
    Subscription.findByClientReference.mockResolvedValue(null);

    const res = await request(app)
      .post(RECURRING_URL)
      .send({ ResponseCode: '0000', Data: { RecurringInvoiceId: 'INV-UNKNOWN' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('no matching subscription');
    expect(Donation.create).not.toHaveBeenCalled();
  });
});
