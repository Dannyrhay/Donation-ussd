'use strict';

jest.mock('../../src/config', () => ({
  hubtel: { apiKey: 'test-key', apiSecret: 'test-secret' },
  hubtelRecurring: {
    posSalesId: null,
    baseUrl: 'https://rip.hubtel.com/api/proxy',
    intervals: { weekly: 'Weekly', monthly: 'Monthly', annually: 'Yearly' }
  },
  recurringDefaults: { startTime: '10:00', currency: 'GHS', paymentOption: 'MobileMoney' },
  orgName: 'Test Org'
}));

const {
  handleRecurringCallback,
  createRecurringInvoice
} = require('../../src/services/recurringInvoiceService');

describe('handleRecurringCallback', () => {
  test('success callback (0000) — sets success:true with invoice and amount', () => {
    const payload = {
      ResponseCode: '0000',
      Message: 'Payment successful',
      Data: {
        RecurringInvoiceId: 'INV-001',
        TransactionId: 'TXN-001',
        ClientReference: 'REF-001',
        Amount: 50,
        AmountCharged: 50,
        Charges: 0,
        CustomerMobileNumber: '233244000000'
      }
    };

    const result = handleRecurringCallback(payload);

    expect(result.success).toBe(true);
    expect(result.failed).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.recurringInvoiceId).toBe('INV-001');
    expect(result.transactionId).toBe('TXN-001');
    expect(result.clientReference).toBe('REF-001');
    expect(result.amount).toBe(50);
  });

  test('failure callback (2001) — sets failed:true', () => {
    const payload = {
      ResponseCode: '2001',
      Message: 'Insufficient funds',
      Data: {
        RecurringInvoiceId: 'INV-002',
        ClientReference: 'REF-002'
      }
    };

    const result = handleRecurringCallback(payload);

    expect(result.failed).toBe(true);
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.responseCode).toBe('2001');
  });

  test('cancellation callback (0005) — sets cancelled:true', () => {
    const payload = {
      ResponseCode: '0005',
      Message: 'Invoice cancelled',
      Data: { RecurringInvoiceId: 'INV-003' }
    };

    const result = handleRecurringCallback(payload);

    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.failed).toBe(false);
  });

  test('unknown response code — all flags false', () => {
    const payload = { ResponseCode: '9999', Data: {} };

    const result = handleRecurringCallback(payload);

    expect(result.success).toBe(false);
    expect(result.failed).toBe(false);
    expect(result.cancelled).toBe(false);
  });

  test('missing Data field — does not throw, fields are undefined', () => {
    const payload = { ResponseCode: '0000' };

    expect(() => handleRecurringCallback(payload)).not.toThrow();
    const result = handleRecurringCallback(payload);
    expect(result.recurringInvoiceId).toBeUndefined();
    expect(result.amount).toBeUndefined();
  });
});
