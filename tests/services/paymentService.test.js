// tests/services/paymentService.test.js
'use strict';

// Mock the models barrel — handleFulfilmentCallback uses require('../models')
// so we must mock that resolved path, not the individual Donation file
const mockFindOneAndUpdate = jest.fn();
jest.mock('../../src/models', () => ({
  Donation: { findOneAndUpdate: mockFindOneAndUpdate }
}));

// Mock config
jest.mock('../../src/config', () => ({
  hubtel: { apiKey: null, apiSecret: null, merchantId: null, baseUrl: '' },
  callbackUrl: 'http://test/callback',
  fulfilmentCallbackUrl: 'http://test/fulfilment'
}));

// Mock donationService to avoid DB calls
jest.mock('../../src/services/donationService', () => ({
  createDonation: jest.fn().mockResolvedValue({ success: true, reference: 'DON-TEST', donation: {} }),
  createSubscription: jest.fn(),
  updateDonationStatus: jest.fn(),
  getDonationByReference: jest.fn(),
  getStats: jest.fn()
}));

const paymentService = require('../../src/services/paymentService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handleFulfilmentCallback', () => {
  // Real Hubtel fulfilment callback format (as documented by Hubtel):
  //   POST https://gs-callback.hubtel.com:9055/callback
  //   { SessionId, OrderId, ServiceStatus, MetaData }
  const basePayload = {
    SessionId: '8d440a43a98b4614b9df22b79c8190b8',
    OrderId: '97473921905444d2ae166ec4c38787d5',
    ServiceStatus: 'success',
    MetaData: null
  };

  test('updates donation to fulfilled using SessionId lookup', async () => {
    const mockDonation = { _id: 'abc', status: 'completed' };
    mockFindOneAndUpdate.mockResolvedValue(mockDonation);

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { sessionId: '8d440a43a98b4614b9df22b79c8190b8', fulfilledAt: { $exists: false } },
      expect.any(Array),
      { new: true }
    );
    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('falls back to OrderId lookup when SessionId lookup returns null', async () => {
    // First call (by sessionId) returns null, second call (by hubtelOrderId) finds the donation
    mockFindOneAndUpdate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'abc' });

    await paymentService.handleFulfilmentCallback(basePayload);

    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(mockFindOneAndUpdate).toHaveBeenLastCalledWith(
      { hubtelOrderId: '97473921905444d2ae166ec4c38787d5', fulfilledAt: { $exists: false } },
      expect.any(Array),
      { new: true }
    );
  });

  test('skips DB update and still returns TXN_SUCCESS when ServiceStatus is not success', async () => {
    const result = await paymentService.handleFulfilmentCallback({
      ...basePayload,
      ServiceStatus: 'failed'
    });

    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('still returns TXN_SUCCESS when both SessionId and OrderId are missing', async () => {
    const result = await paymentService.handleFulfilmentCallback({ ServiceStatus: 'success' });

    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('still returns TXN_SUCCESS when donation not found', async () => {
    mockFindOneAndUpdate.mockResolvedValue(null);

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('still returns TXN_SUCCESS when DB throws', async () => {
    mockFindOneAndUpdate.mockRejectedValue(new Error('DB error'));

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });
});
