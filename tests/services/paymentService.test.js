// tests/services/paymentService.test.js
'use strict';

// Mock the models barrel
const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
jest.mock('../../src/models', () => ({
  Donation: {
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate
  }
}));

// Mock config
jest.mock('../../src/config', () => ({
  hubtel: { apiKey: null, apiSecret: null, merchantId: null, baseUrl: '' },
  callbackUrl: 'http://test/callback',
  fulfilmentCallbackUrl: 'http://test/fulfilment',
  hubtelFulfilmentAckUrl: 'https://gs-callback.hubtel.com/callback'
}));

// Mock donationService to avoid DB calls
jest.mock('../../src/services/donationService', () => ({
  createDonation: jest.fn().mockResolvedValue({ success: true, reference: 'DON-TEST', donation: {} }),
  createSubscription: jest.fn(),
  updateDonationStatus: jest.fn(),
  getDonationByReference: jest.fn(),
  getStats: jest.fn()
}));

// Mock axios to prevent real HTTP calls for the ack POST
jest.mock('axios');
const axios = require('axios');

const paymentService = require('../../src/services/paymentService');

beforeEach(() => {
  jest.clearAllMocks();
  // Default: ack POST succeeds
  axios.post.mockResolvedValue({ status: 200 });
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

  test('posts TXN_SUCCESS acknowledgement to Hubtel ack URL', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ _id: 'abc' });

    await paymentService.handleFulfilmentCallback(basePayload);

    expect(axios.post).toHaveBeenCalledWith(
      'https://gs-callback.hubtel.com/callback',
      { ResponseCode: '0000', Status: 'TXN_SUCCESS', Message: 'Fulfilled' },
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
  });

  test('still returns TXN_SUCCESS even when ack POST to Hubtel fails', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ _id: 'abc' });
    axios.post.mockRejectedValue(new Error('Network error'));

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });
});

describe('handlePaymentCallback', () => {
  // Real Hubtel payment callback format:
  //   { SessionId, OrderId, ExtraData, OrderInfo: { Status, Amount, ... } }
  const mockDonation = { _id: 'abc', reference: 'DON-1234567890', status: 'pending' };

  const basePayload = {
    SessionId: '8d440a43a98b4614b9df22b79c8190b8',
    OrderId: '97473921905444d2ae166ec4c38787d5',
    OrderInfo: { Status: 'Success', Amount: 5 },
    ExtraData: null
  };

  beforeEach(() => {
    // donationService.updateDonationStatus is already mocked above
    const donationService = require('../../src/services/donationService');
    donationService.updateDonationStatus.mockResolvedValue({ success: true, donation: mockDonation });
  });

  test('finds donation by SessionId and marks it Success', async () => {
    mockFindOne.mockResolvedValue(mockDonation);

    const result = await paymentService.handlePaymentCallback(basePayload);

    expect(mockFindOne).toHaveBeenCalledWith({ sessionId: '8d440a43a98b4614b9df22b79c8190b8' });
    expect(result).toEqual(mockDonation);
    const donationService = require('../../src/services/donationService');
    expect(donationService.updateDonationStatus).toHaveBeenCalledWith('DON-1234567890', 'Success', basePayload);
  });

  test('falls back to OrderId when SessionId lookup returns null', async () => {
    mockFindOne
      .mockResolvedValueOnce(null)          // SessionId lookup misses
      .mockResolvedValueOnce(mockDonation); // OrderId lookup hits

    await paymentService.handlePaymentCallback(basePayload);

    expect(mockFindOne).toHaveBeenCalledTimes(2);
    expect(mockFindOne).toHaveBeenLastCalledWith({ hubtelOrderId: '97473921905444d2ae166ec4c38787d5' });
  });

  test('reads payment status from OrderInfo.Status', async () => {
    mockFindOne.mockResolvedValue(mockDonation);
    const donationService = require('../../src/services/donationService');

    await paymentService.handlePaymentCallback({ ...basePayload, OrderInfo: { Status: 'Failed' } });

    expect(donationService.updateDonationStatus).toHaveBeenCalledWith('DON-1234567890', 'Failed', expect.any(Object));
  });

  test('returns null when no donation found by any identifier', async () => {
    mockFindOne.mockResolvedValue(null);

    const result = await paymentService.handlePaymentCallback(basePayload);

    expect(result).toBeNull();
    const donationService = require('../../src/services/donationService');
    expect(donationService.updateDonationStatus).not.toHaveBeenCalled();
  });
});
