// tests/services/paymentService.test.js
'use strict';

// Mock the repositories
jest.mock('../../src/models', () => ({
  Donation: {
    findByHubtelSessionId: jest.fn(),
    findByHubtelOrderId: jest.fn(),
    findLatestPendingOnceByPhone: jest.fn(),
    setHubtelIds: jest.fn().mockResolvedValue(undefined),
    markFulfilledByHubtelSessionId: jest.fn(),
    markFulfilledByHubtelOrderId: jest.fn(),
    list: jest.fn().mockResolvedValue([])
  },
  Donor: {
    setNameIfMissing: jest.fn().mockResolvedValue(true)
  }
}));
const { Donation, Donor } = require('../../src/models');

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

  test('updates donation to fulfilled using hubtelSessionId lookup', async () => {
    Donation.markFulfilledByHubtelSessionId.mockResolvedValue('abc');

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(Donation.markFulfilledByHubtelSessionId).toHaveBeenCalledWith('8d440a43a98b4614b9df22b79c8190b8');
    expect(Donation.markFulfilledByHubtelOrderId).not.toHaveBeenCalled();
    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('falls back to hubtelOrderId lookup when SessionId lookup returns null', async () => {
    Donation.markFulfilledByHubtelSessionId.mockResolvedValue(null);
    Donation.markFulfilledByHubtelOrderId.mockResolvedValue('abc');

    await paymentService.handleFulfilmentCallback(basePayload);

    expect(Donation.markFulfilledByHubtelOrderId).toHaveBeenCalledWith('97473921905444d2ae166ec4c38787d5');
  });

  test('skips DB update and still returns TXN_SUCCESS when ServiceStatus is not success', async () => {
    const result = await paymentService.handleFulfilmentCallback({
      ...basePayload,
      ServiceStatus: 'failed'
    });

    expect(Donation.markFulfilledByHubtelSessionId).not.toHaveBeenCalled();
    expect(Donation.markFulfilledByHubtelOrderId).not.toHaveBeenCalled();
    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('still returns TXN_SUCCESS when both SessionId and OrderId are missing', async () => {
    const result = await paymentService.handleFulfilmentCallback({ ServiceStatus: 'success' });

    expect(Donation.markFulfilledByHubtelSessionId).not.toHaveBeenCalled();
    expect(Donation.markFulfilledByHubtelOrderId).not.toHaveBeenCalled();
    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('still returns TXN_SUCCESS when donation not found', async () => {
    Donation.markFulfilledByHubtelSessionId.mockResolvedValue(null);
    Donation.markFulfilledByHubtelOrderId.mockResolvedValue(null);

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('still returns TXN_SUCCESS when DB throws', async () => {
    Donation.markFulfilledByHubtelSessionId.mockRejectedValue(new Error('DB error'));

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });

  test('posts fulfilment payload (SessionId/OrderId/ServiceStatus) to Hubtel ack URL', async () => {
    Donation.markFulfilledByHubtelSessionId.mockResolvedValue('abc');

    await paymentService.handleFulfilmentCallback(basePayload);

    expect(axios.post).toHaveBeenCalledWith(
      'https://gs-callback.hubtel.com/callback',
      {
        SessionId: '8d440a43a98b4614b9df22b79c8190b8',
        OrderId: '97473921905444d2ae166ec4c38787d5',
        ServiceStatus: 'success',
        MetaData: null
      },
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
  });

  test('still returns TXN_SUCCESS even when ack POST to Hubtel fails', async () => {
    Donation.markFulfilledByHubtelSessionId.mockResolvedValue('abc');
    axios.post.mockRejectedValue(new Error('Network error'));

    const result = await paymentService.handleFulfilmentCallback(basePayload);

    expect(result.ResponseCode).toBe('0000');
    expect(result.Status).toBe('TXN_SUCCESS');
  });
});

describe('handlePaymentCallback', () => {
  // Real Hubtel payment callback format:
  //   { SessionId, OrderId, ExtraData, OrderInfo: { CustomerMobileNumber, Payment: { IsSuccessful } } }
  const mockDonation = { id: 'abc', reference: 'DON-1234567890', status: 'pending' };

  const basePayload = {
    SessionId: '8d440a43a98b4614b9df22b79c8190b8',
    OrderId: '97473921905444d2ae166ec4c38787d5',
    OrderInfo: {
      CustomerMobileNumber: '233244000000',
      Payment: { IsSuccessful: true, AmountPaid: 5 }
    },
    ExtraData: {}
  };

  beforeEach(() => {
    const donationService = require('../../src/services/donationService');
    donationService.updateDonationStatus.mockResolvedValue({ success: true, donation: mockDonation });
    Donation.findByHubtelSessionId.mockResolvedValue(null);
    Donation.findByHubtelOrderId.mockResolvedValue(null);
    Donation.findLatestPendingOnceByPhone.mockResolvedValue(null);
  });

  test('detects success from OrderInfo.Payment.IsSuccessful', async () => {
    Donation.findByHubtelSessionId.mockResolvedValue(mockDonation);
    const donationService = require('../../src/services/donationService');

    await paymentService.handlePaymentCallback(basePayload);

    expect(donationService.updateDonationStatus).toHaveBeenCalledWith('DON-1234567890', 'Success', basePayload);
    expect(Donation.setHubtelIds).toHaveBeenCalledWith('abc', {
      hubtelSessionId: '8d440a43a98b4614b9df22b79c8190b8',
      hubtelOrderId: '97473921905444d2ae166ec4c38787d5'
    });
  });

  test('falls back to phone number lookup when hubtelSessionId/OrderId miss', async () => {
    // hubtelSessionId / OrderId lookups miss (defaults); phone lookup hits
    Donation.findLatestPendingOnceByPhone.mockResolvedValue(mockDonation);
    const donationService = require('../../src/services/donationService');

    await paymentService.handlePaymentCallback(basePayload);

    expect(Donation.findLatestPendingOnceByPhone).toHaveBeenCalledWith('233244000000');
    expect(donationService.updateDonationStatus).toHaveBeenCalledWith('DON-1234567890', 'Success', basePayload);
  });

  test('sends fulfilment payload to Hubtel after successful payment', async () => {
    Donation.findByHubtelSessionId.mockResolvedValue(mockDonation);

    await paymentService.handlePaymentCallback(basePayload);

    expect(axios.post).toHaveBeenCalledWith(
      'https://gs-callback.hubtel.com/callback',
      {
        SessionId: '8d440a43a98b4614b9df22b79c8190b8',
        OrderId: '97473921905444d2ae166ec4c38787d5',
        ServiceStatus: 'success',
        MetaData: null
      },
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    );
  });

  test('still sends fulfilment to Hubtel even when no donation found', async () => {
    const result = await paymentService.handlePaymentCallback(basePayload);

    expect(result).toBeNull();
    expect(axios.post).toHaveBeenCalledWith(
      'https://gs-callback.hubtel.com/callback',
      expect.objectContaining({ SessionId: '8d440a43a98b4614b9df22b79c8190b8' }),
      expect.any(Object)
    );
  });

  test('saves the real customer name from the callback (regression: was never saved)', async () => {
    await paymentService.handlePaymentCallback({
      ...basePayload,
      OrderInfo: { ...basePayload.OrderInfo, CustomerMobileNumber: '0244000000', CustomerName: 'Ama Mensah' }
    });

    expect(Donor.setNameIfMissing).toHaveBeenCalledWith('233244000000', 'Ama Mensah');
  });

  test('ignores the "Donor" placeholder name', async () => {
    await paymentService.handlePaymentCallback({
      ...basePayload,
      OrderInfo: { ...basePayload.OrderInfo, CustomerName: 'Donor' }
    });

    expect(Donor.setNameIfMissing).not.toHaveBeenCalled();
  });
});
