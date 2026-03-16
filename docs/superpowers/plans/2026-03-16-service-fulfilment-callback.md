# Service Fulfilment Callback Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `POST /api/callback/fulfilment` endpoint that receives Hubtel's service fulfilment callback, marks the donation as `'fulfilled'` in MongoDB, and always responds HTTP 200 with `{ ResponseCode: "0000", Status: "TXN_SUCCESS", Message: "Fulfilled" }`.

**Architecture:** Five files change. The Donation model gains a `'fulfilled'` status, a `fulfilledAt` date field, and updated stats queries. `paymentService.js` gets a `handleFulfilmentCallback()` function and an updated `initiatePayment()` that sends `FulfilmentCallbackUrl` to Hubtel. A new route wires it all together.

**Tech Stack:** Node.js, Express 5, Mongoose 9, MongoDB (aggregation pipeline updates), Jest + Supertest for tests.

**Spec:** `docs/superpowers/specs/2026-03-16-service-fulfilment-callback-design.md`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/models/Donation.js` | Modify | Add `'fulfilled'` to enum; add `fulfilledAt` field; update `getTotalForPeriod` |
| `src/services/donationService.js` | Modify | Update `getStats()` `countDocuments` to include `'fulfilled'` |
| `src/config/index.js` | Modify | Add `fulfilmentCallbackUrl` |
| `src/services/paymentService.js` | Modify | Add `handleFulfilmentCallback()`; update `initiatePayment()`; update exports |
| `src/routes/callbackRoutes.js` | Modify | Add `POST /fulfilment` route |
| `tests/models/donation.test.js` | Create | Tests for model changes |
| `tests/services/paymentService.test.js` | Create | Tests for `handleFulfilmentCallback` |
| `tests/routes/callback.test.js` | Create | Integration test for the new route |

---

## Chunk 1: Model, Config, and Stats

### Task 1: Jest setup + Donation model tests (failing)

**Files:**
- Create: `jest.config.js`
- Create: `tests/models/donation.test.js`

- [ ] **Step 1: Create Jest config**

```js
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true
};
```

- [ ] **Step 2: Create the failing model tests**

```js
// tests/models/donation.test.js
'use strict';

// We test the schema shape without a live DB — just instantiate a model
// and inspect its schema paths and enum values.
const mongoose = require('mongoose');

// Prevent mongoose from trying to connect during tests
jest.mock('../../src/config/database', () => ({
  connectDatabase: jest.fn().mockResolvedValue(null),
  disconnectDatabase: jest.fn().mockResolvedValue(null)
}));

const Donation = require('../../src/models/Donation');

describe('Donation model schema', () => {
  test('status enum includes fulfilled', () => {
    const statusEnum = Donation.schema.path('status').enumValues;
    expect(statusEnum).toContain('fulfilled');
  });

  test('fulfilledAt field exists as a Date', () => {
    const fulfilledAtPath = Donation.schema.path('fulfilledAt');
    expect(fulfilledAtPath).toBeDefined();
    expect(fulfilledAtPath.instance).toBe('Date');
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npx jest tests/models/donation.test.js --verbose
```

Expected output: `● Donation model schema › status enum includes fulfilled` FAIL

---

### Task 2: Update Donation model — enum, field, getTotalForPeriod

**Files:**
- Modify: `src/models/Donation.js:68` (status enum)
- Modify: `src/models/Donation.js:108` (add fulfilledAt after completedAt)
- Modify: `src/models/Donation.js:173-194` (getTotalForPeriod)

- [ ] **Step 1: Add `'fulfilled'` to the status enum (line 68)**

Find:
```js
enum: ['pending', 'processing', 'completed', 'Success', 'failed', 'cancelled', 'refunded'],
```
Replace with:
```js
enum: ['pending', 'processing', 'completed', 'fulfilled', 'Success', 'failed', 'cancelled', 'refunded'],
```

- [ ] **Step 2: Add `fulfilledAt` field after `completedAt` (after line 108)**

Find:
```js
  // When payment was completed
  completedAt: {
    type: Date
  },
```
Replace with:
```js
  // When payment was completed
  completedAt: {
    type: Date
  },

  // When service was fulfilled (set by fulfilment callback)
  fulfilledAt: {
    type: Date
  },
```

- [ ] **Step 3: Update `getTotalForPeriod` to include `'fulfilled'` and both date fields**

Find the entire `getTotalForPeriod` static method:
```js
donationSchema.statics.getTotalForPeriod = async function(startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        status: 'completed',
        completedAt: {
          $gte: startDate,
          $lte: endDate
        }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);

  return result[0] || { total: 0, count: 0 };
};
```
Replace with:
```js
donationSchema.statics.getTotalForPeriod = async function(startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        status: { $in: ['completed', 'fulfilled'] },
        $or: [
          { completedAt: { $gte: startDate, $lte: endDate } },
          { fulfilledAt: { $gte: startDate, $lte: endDate } }
        ]
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);

  return result[0] || { total: 0, count: 0 };
};
```

- [ ] **Step 4: Run model tests — expect PASS**

```bash
npx jest tests/models/donation.test.js --verbose
```

Expected: both tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/Donation.js tests/models/donation.test.js jest.config.js
git commit -m "feat: add fulfilled status and fulfilledAt field to Donation model"
```

---

### Task 3: Update donationService getStats

**Files:**
- Modify: `src/services/donationService.js:264`

- [ ] **Step 1: Update countDocuments**

Find:
```js
const totalDonations = await Donation.countDocuments({ status: 'completed' });
```
Replace with:
```js
const totalDonations = await Donation.countDocuments({ status: { $in: ['completed', 'fulfilled'] } });
```

- [ ] **Step 2: Commit**

```bash
git add src/services/donationService.js
git commit -m "feat: include fulfilled donations in stats count"
```

---

### Task 4: Add fulfilmentCallbackUrl to config

**Files:**
- Modify: `src/config/index.js`

- [ ] **Step 1: Add the new config key**

Find:
```js
  callbackUrl: process.env.CALLBACK_URL,
  recurringCallbackUrl: process.env.RECURRING_CALLBACK_URL || process.env.CALLBACK_URL,
```
Replace with:
```js
  callbackUrl: process.env.CALLBACK_URL,
  recurringCallbackUrl: process.env.RECURRING_CALLBACK_URL || process.env.CALLBACK_URL,
  fulfilmentCallbackUrl: process.env.FULFILMENT_CALLBACK_URL,
```

- [ ] **Step 2: Commit**

```bash
git add src/config/index.js
git commit -m "feat: add FULFILMENT_CALLBACK_URL config"
```

---

## Chunk 2: Service and Route

### Task 5: Write failing tests for handleFulfilmentCallback

**Files:**
- Create: `tests/services/paymentService.test.js`

- [ ] **Step 1: Create the failing service tests**

```js
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
```

- [ ] **Step 2: Run tests — expect FAIL (function not yet implemented)**

```bash
npx jest tests/services/paymentService.test.js --verbose
```

Expected: FAIL — `paymentService.handleFulfilmentCallback is not a function`

---

### Task 6: Implement handleFulfilmentCallback and update initiatePayment

**Files:**
- Modify: `src/services/paymentService.js`

- [ ] **Step 1: Add `handleFulfilmentCallback` function before `module.exports`**

Add this entire function just before the `module.exports` block at the bottom of `paymentService.js`:

```js
/**
 * Handle service fulfilment callback from Hubtel
 *
 * Hubtel calls this URL after a successful payment to confirm service delivery.
 * Must ALWAYS return { ResponseCode: "0000", Status: "TXN_SUCCESS", Message: "Fulfilled" }
 * regardless of internal errors — returning anything else risks Hubtel reversing the transaction.
 *
 * @param {Object} callbackData - Callback payload from Hubtel
 * @returns {Object} Hubtel fulfilment response
 */
async function handleFulfilmentCallback(callbackData) {
  console.log('='.repeat(50));
  console.log('HUBTEL FULFILMENT CALLBACK RECEIVED');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Raw Data:', JSON.stringify(callbackData, null, 2));
  console.log('='.repeat(50));

  const FULFILMENT_RESPONSE = {
    ResponseCode: '0000',
    Status: 'TXN_SUCCESS',
    Message: 'Fulfilled'
  };

  try {
    // Extract ClientReference — same order as handlePaymentCallback
    const reference = callbackData.ClientReference
      || callbackData.Data?.ClientReference
      || callbackData.data?.ClientReference;

    if (!reference) {
      console.error('FULFILMENT: No ClientReference found in payload');
      console.error('Available keys:', Object.keys(callbackData));
      return FULFILMENT_RESPONSE;
    }

    // Use aggregation pipeline update so completedAt can be set conditionally
    // (handles race condition where fulfilment arrives before payment callback)
    const { Donation } = require('../models');
    const donation = await Donation.findOneAndUpdate(
      { reference, fulfilledAt: { $exists: false } },
      [{
        $set: {
          status: 'fulfilled',
          fulfilledAt: '$$NOW',
          completedAt: { $ifNull: ['$completedAt', '$$NOW'] }
        }
      }],
      { new: true }
    );

    if (donation) {
      console.log(`Fulfilment recorded for ${reference} (donation: ${donation._id})`);
    } else {
      console.warn(`FULFILMENT: No matching donation for reference ${reference} (already fulfilled or not found)`);
    }

  } catch (error) {
    // Never propagate errors — Hubtel must always receive TXN_SUCCESS
    console.error('FULFILMENT: Error processing callback:', error.message);
  }

  return FULFILMENT_RESPONSE;
}
```

- [ ] **Step 2: Add `handleFulfilmentCallback` to `module.exports`**

Find:
```js
module.exports = {
  initiatePayment,
  handlePaymentCallback,
  getPayment,
  getAllPayments,
  getStats,
  formatPhoneNumber
};
```
Replace with:
```js
module.exports = {
  initiatePayment,
  handlePaymentCallback,
  handleFulfilmentCallback,
  getPayment,
  getAllPayments,
  getStats,
  formatPhoneNumber
};
```

- [ ] **Step 3: Add `FulfilmentCallbackUrl` to `initiatePayment` request body**

Find the `requestBody` object in `initiatePayment` (inside the "Real Hubtel API call" block):
```js
    const requestBody = {
      CustomerName: 'Donor',
      CustomerMsisdn: formattedPhone,
      CustomerEmail: '',
      Channel: channel,
      Amount: amount,
      PrimaryCallbackUrl: config.callbackUrl,
      SecondaryCallbackUrl: config.callbackUrl,
      Description: description,
      ClientReference: reference
    };
```
Replace with:
```js
    const requestBody = {
      CustomerName: 'Donor',
      CustomerMsisdn: formattedPhone,
      CustomerEmail: '',
      Channel: channel,
      Amount: amount,
      PrimaryCallbackUrl: config.callbackUrl,
      SecondaryCallbackUrl: config.callbackUrl,
      Description: description,
      ClientReference: reference
    };

    // Only add FulfilmentCallbackUrl when configured — no fallback to avoid
    // pointing Hubtel at the wrong endpoint
    if (config.fulfilmentCallbackUrl) {
      requestBody.FulfilmentCallbackUrl = config.fulfilmentCallbackUrl;
    }
```

- [ ] **Step 4: Run service tests — expect PASS**

```bash
npx jest tests/services/paymentService.test.js --verbose
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentService.js tests/services/paymentService.test.js
git commit -m "feat: implement handleFulfilmentCallback and wire FulfilmentCallbackUrl"
```

---

### Task 7: Add the route + integration test

**Files:**
- Modify: `src/routes/callbackRoutes.js`
- Create: `tests/routes/callback.test.js`

- [ ] **Step 1: Write the failing route test**

```js
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
```

- [ ] **Step 2: Run route tests — expect FAIL**

```bash
npx jest tests/routes/callback.test.js --verbose
```

Expected: FAIL — 404 on `POST /api/callback/fulfilment`

- [ ] **Step 3: Add the fulfilment route to callbackRoutes.js**

Add this block after the closing `});` of the `POST /recurring` route handler (around line 141), before the `GET /payments` route:

```js
/**
 * POST /api/callback/fulfilment
 * Receives service fulfilment callbacks from Hubtel (one-time payments)
 *
 * IMPORTANT: Must ALWAYS return HTTP 200 with TXN_SUCCESS.
 * Returning an error status risks Hubtel reversing the payment.
 */
router.post('/fulfilment', async (req, res) => {
  console.log('='.repeat(50));
  console.log('FULFILMENT CALLBACK RECEIVED');
  console.log('='.repeat(50));

  try {
    const result = await paymentService.handleFulfilmentCallback(req.body);
    res.json(result);
  } catch (error) {
    // Catch-all: never let an error propagate to Express error handler
    // Hubtel must receive TXN_SUCCESS or it may reverse the payment
    console.error('Fulfilment callback unexpected error:', error);
    res.json({
      ResponseCode: '0000',
      Status: 'TXN_SUCCESS',
      Message: 'Fulfilled'
    });
  }
});
```

- [ ] **Step 4: Run route tests — expect PASS**

```bash
npx jest tests/routes/callback.test.js --verbose
```

Expected: all 4 tests PASS

- [ ] **Step 5: Run full test suite**

```bash
npx jest --verbose
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/callbackRoutes.js tests/routes/callback.test.js
git commit -m "feat: add POST /api/callback/fulfilment route"
```

---

### Task 8: Update app.js health check endpoint list

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add fulfilmentCallback to endpoints list in health check**

Find:
```js
      callback: '/api/callback/payment',
      recurringCallback: '/api/callback/recurring',
```
Replace with:
```js
      callback: '/api/callback/payment',
      recurringCallback: '/api/callback/recurring',
      fulfilmentCallback: '/api/callback/fulfilment',
```

- [ ] **Step 2: Update startup log**

Find:
```js
    console.log(`  Recurring:     http://localhost:${config.port}/api/callback/recurring`);
```
Replace with:
```js
    console.log(`  Recurring:     http://localhost:${config.port}/api/callback/recurring`);
    console.log(`  Fulfilment:    http://localhost:${config.port}/api/callback/fulfilment`);
```

- [ ] **Step 3: Run full test suite to confirm nothing broken**

```bash
npx jest --verbose
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/app.js
git commit -m "feat: register fulfilment callback endpoint in health check"
```
