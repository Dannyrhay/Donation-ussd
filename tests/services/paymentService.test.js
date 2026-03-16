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
  const basePayload = {
    ResponseCode: '0000',
    Status: 'Success',
    Data: {
      Amount: 10,
      ClientReference: 'DON-1234567890',
      TransactionId: 'HBT-TXN-001',
      CustomerMsisdn: '233244000000'
    }
  };

  test('updates donation to fulfilled when found and not yet fulfilled', async () => {
    const mockDonation = { _id: 'abc', status: 'completed', reference: 'DON-1234567890' };
    mockFindOneAndUpdate.mockResolvedValue(mockDonation);

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { reference: 'DON-1234567890', fulfilledAt: { $exists: false } },
      expect.any(Array), // aggregation pipeline
      { new: true }
    );
    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('still returns TXN_SUCCESS when donation not found (findOneAndUpdate returns null)', async () => {
    mockFindOneAndUpdate.mockResolvedValue(null);

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('still returns TXN_SUCCESS when ClientReference is missing', async () => {
    const result = await paymentService.handleFulfilmentCallback({});

    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('still returns TXN_SUCCESS when DB throws', async () => {
    mockFindOneAndUpdate.mockRejectedValue(new Error('DB error'));

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('extracts ClientReference from top-level field', async () => {
    mockFindOneAndUpdate.mockResolvedValue({});
    const payload = { ClientReference: 'DON-TOP-LEVEL', Data: {} };

    await paymentService.handleFulfilmentCallback(payload);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'DON-TOP-LEVEL' }),
      expect.any(Array),
      { new: true }
    );
  });

  test('extracts ClientReference from lowercase data field', async () => {
    mockFindOneAndUpdate.mockResolvedValue({});
    const payload = { data: { ClientReference: 'DON-LOWERCASE' } };

    await paymentService.handleFulfilmentCallback(payload);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'DON-LOWERCASE' }),
      expect.any(Array),
      { new: true }
    );
  });
});
