// tests/routes/callback.test.js
'use strict';

const request = require('supertest');

// Mock paymentService so we don't need a real DB or Hubtel
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

// Mock donationService
jest.mock('../../src/services/donationService', () => ({
  cancelSubscription: jest.fn().mockResolvedValue({ success: true, subscription: {} })
}));

// Mock recurringInvoiceService
jest.mock('../../src/services/recurringInvoiceService', () => ({
  handleRecurringCallback: jest.fn().mockReturnValue({
    recurringInvoiceId: null, clientReference: null, success: false, failed: false, cancelled: false
  })
}));

// Mock models
jest.mock('../../src/models', () => ({
  Subscription: {
    findByRecurringInvoiceId: jest.fn().mockResolvedValue(null),
    findByClientReference: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ populate: jest.fn().mockResolvedValue([]) }) })
  },
  Donation: { create: jest.fn() },
  Donor: { find: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }) }
}));

// Mock scheduler so app.js doesn't start a cron
jest.mock('../../src/services/schedulerService', () => ({
  start: jest.fn(),
  stop: jest.fn(),
  getStatus: jest.fn().mockReturnValue({ enabled: false, running: false, schedule: '', timezone: '' })
}));

// Mock DB
jest.mock('../../src/config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(null),
  disconnectDatabase: jest.fn().mockResolvedValue(null)
}));

const app = require('../../src/app');
const paymentService = require('../../src/services/paymentService');

describe('POST /api/callback/fulfilment', () => {
  const validPayload = {
    ResponseCode: '0000',
    Status: 'Success',
    Data: {
      Amount: 10,
      ClientReference: 'DON-1234567890',
      TransactionId: 'HBT-001',
      CustomerMsisdn: '233244000000'
    }
  };

  test('returns HTTP 200 with TXN_SUCCESS on valid payload', async () => {
    const res = await request(app)
      .post('/api/callback/fulfilment')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.ResponseCode).toBe('0000');
    expect(res.body.Status).toBe('TXN_SUCCESS');
    expect(res.body.Message).toBe('Fulfilled');
  });

  test('calls paymentService.handleFulfilmentCallback with request body', async () => {
    await request(app)
      .post('/api/callback/fulfilment')
      .send(validPayload);

    expect(paymentService.handleFulfilmentCallback).toHaveBeenCalledWith(validPayload);
  });

  test('returns HTTP 200 with TXN_SUCCESS even when service throws', async () => {
    paymentService.handleFulfilmentCallback.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app)
      .post('/api/callback/fulfilment')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.Status).toBe('TXN_SUCCESS');
  });

  test('returns HTTP 200 with TXN_SUCCESS on empty body', async () => {
    paymentService.handleFulfilmentCallback.mockResolvedValueOnce({
      ResponseCode: '0000',
      Status: 'TXN_SUCCESS',
      Message: 'Fulfilled'
    });

    const res = await request(app)
      .post('/api/callback/fulfilment')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.Status).toBe('TXN_SUCCESS');
  });
});
