# Recurring Payment Tests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automated Jest tests verifying recurring invoice callback parsing and the `/api/callback/recurring` route, plus a manual test guide for confirming Hubtel charges at the correct interval.

**Architecture:** Three new files. No existing source files are modified. Unit tests cover `handleRecurringCallback` parsing and `createRecurringInvoice` outbound payload; integration tests cover the `/api/callback/recurring` route via supertest; the manual guide covers ngrok setup, sandbox invoice creation, and next-day charge verification.

**Tech Stack:** Node.js/CommonJS, Jest, Supertest, Mongoose (mocked)

---

## File Map

| File | Action |
|---|---|
| `tests/services/recurringInvoiceService.test.js` | Create — unit tests for `handleRecurringCallback` + `createRecurringInvoice` |
| `tests/routes/recurringCallback.test.js` | Create — integration tests for `POST /api/callback/recurring` |
| `docs/testing/recurring-payments-manual-test.md` | Create — manual test guide |

---

## Chunk 1: Unit tests for `recurringInvoiceService`

### Task 1: Unit tests for `handleRecurringCallback`

**Files:**
- Create: `tests/services/recurringInvoiceService.test.js`

**Context:** `handleRecurringCallback` is a **synchronous** function (not `async`). It parses `callbackData.ResponseCode` and `callbackData.Data.*` fields and returns a plain object. It does not call any database or HTTP methods — no mocking required beyond the module itself.

- [ ] **Step 1: Write failing tests**

Create `tests/services/recurringInvoiceService.test.js`:

```js
'use strict';

// recurringInvoiceService only uses axios and config for create/cancel/verify.
// handleRecurringCallback is pure — no external dependencies to mock.
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

// ─── handleRecurringCallback ───────────────────────────────────────────────

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
```

- [ ] **Step 2: Run tests to confirm they pass immediately**

```bash
npx jest tests/services/recurringInvoiceService.test.js --no-coverage -t "handleRecurringCallback"
```

Expected: all 5 tests PASS. (`handleRecurringCallback` is already implemented — these tests document and lock in existing behaviour.)

- [ ] **Step 3: Commit**

```bash
git add tests/services/recurringInvoiceService.test.js
git commit -m "test: add handleRecurringCallback unit tests"
```

---

### Task 2: Unit tests for `createRecurringInvoice` outbound payload

**Files:**
- Modify: `tests/services/recurringInvoiceService.test.js` (append)

**Context:** `createRecurringInvoice` calls `axios.post`. Mock `axios` with `jest.mock('axios')`. The config mock sets `posSalesId: null` (simulation branch), so tests must temporarily override the config to set a non-null `posSalesId`. The simplest way: mock config with `posSalesId: 'POS-TEST'` in a nested `describe` block with its own `jest.mock` override — but Jest doesn't support multiple `jest.mock` for the same module in one file easily. Instead, mutate `config.hubtelRecurring.posSalesId` inside `beforeEach` and restore in `afterEach`.

Wait — the config is mocked as a plain object at the top of the file. We can directly mutate `config.hubtelRecurring.posSalesId = 'POS-TEST'` in a `beforeEach` and reset to `null` after.

- [ ] **Step 1: Write failing tests**

Append to `tests/services/recurringInvoiceService.test.js`:

```js
// ─── createRecurringInvoice — request body ─────────────────────────────────

jest.mock('axios');
const axios = require('axios');
const config = require('../../src/config');

describe('createRecurringInvoice — outbound request body', () => {
  const PHONE = '0244000000';
  const AMOUNT = 30;
  const CLIENT_REF = 'TEST-REF-001';

  beforeEach(() => {
    // Enable real API path by providing a posSalesId
    config.hubtelRecurring.posSalesId = 'POS-TEST';
    config.hubtelRecurring.baseUrl = 'https://rip.hubtel.com/api/proxy';
    axios.post.mockResolvedValue({
      data: {
        responseCode: '0001',
        message: 'Success',
        data: { recurringInvoiceId: 'INV-SIM', requestId: 'REQ-SIM' }
      }
    });
  });

  afterEach(() => {
    config.hubtelRecurring.posSalesId = null;
    jest.clearAllMocks();
  });

  test('weekly — PaymentInterval is Weekly and end date is ~1 year from now', async () => {
    await createRecurringInvoice({
      phoneNumber: PHONE, amount: AMOUNT, frequency: 'weekly',
      description: 'Test', clientReference: CLIENT_REF
    });

    const body = axios.post.mock.calls[0][1];
    expect(body.PaymentInterval).toBe('Weekly');

    const endYear = new Date(body.InvoiceEndDate).getFullYear();
    const expectedYear = new Date().getFullYear() + 1;
    expect(Math.abs(endYear - expectedYear)).toBeLessThanOrEqual(1);
  });

  test('monthly — PaymentInterval is Monthly and end date is ~2 years from now', async () => {
    await createRecurringInvoice({
      phoneNumber: PHONE, amount: AMOUNT, frequency: 'monthly',
      description: 'Test', clientReference: CLIENT_REF
    });

    const body = axios.post.mock.calls[0][1];
    expect(body.PaymentInterval).toBe('Monthly');

    const endYear = new Date(body.InvoiceEndDate).getFullYear();
    const expectedYear = new Date().getFullYear() + 2;
    expect(Math.abs(endYear - expectedYear)).toBeLessThanOrEqual(1);
  });

  test('annually — PaymentInterval is Yearly and end date is ~10 years from now', async () => {
    await createRecurringInvoice({
      phoneNumber: PHONE, amount: AMOUNT, frequency: 'annually',
      description: 'Test', clientReference: CLIENT_REF
    });

    const body = axios.post.mock.calls[0][1];
    expect(body.PaymentInterval).toBe('Yearly');

    const endYear = new Date(body.InvoiceEndDate).getFullYear();
    const expectedYear = new Date().getFullYear() + 10;
    expect(Math.abs(endYear - expectedYear)).toBeLessThanOrEqual(1);
  });
});
```

**Note on `InvoiceEndDate` parsing:** `createRecurringInvoice` calls `formatHubtelDate` which produces `MM/DD/YYYY HH:MM:SS` format. `new Date('03/16/2027 10:00:00')` parses this correctly in Node.js. The year-tolerance check (`Math.abs(endYear - expectedYear) <= 1`) accounts for any day-boundary edge.

- [ ] **Step 2: Run tests to confirm they pass**

```bash
npx jest tests/services/recurringInvoiceService.test.js --no-coverage -t "createRecurringInvoice"
```

Expected: all 3 tests PASS. (The function is already implemented — these tests document the outbound payload contract.)

- [ ] **Step 3: Run the full service test file**

```bash
npx jest tests/services/recurringInvoiceService.test.js --no-coverage
```

Expected: all 8 tests PASS (5 handleRecurringCallback + 3 createRecurringInvoice).

- [ ] **Step 4: Commit**

```bash
git add tests/services/recurringInvoiceService.test.js
git commit -m "test: add createRecurringInvoice outbound payload tests"
```

---

## Chunk 2: Integration tests for the recurring callback route

### Task 3: Integration tests for `POST /api/callback/recurring`

**Files:**
- Create: `tests/routes/recurringCallback.test.js`

**Context:** The `/api/callback/recurring` route (in `src/routes/callbackRoutes.js` lines 60-141):
1. Calls `recurringInvoiceService.handleRecurringCallback(req.body)` — **synchronous, no await**.
2. Looks up subscription via `Subscription.findByRecurringInvoiceId` then `Subscription.findByClientReference`.
3. On success: calls `subscription.recordPayment`, then `Donation.create`.
4. On failure: calls `subscription.recordFailure`.
5. On cancellation: calls `subscription.cancel`.
6. Always returns HTTP 200.

**Critical:** Mock `handleRecurringCallback` with `jest.fn().mockReturnValue(...)` (synchronous mock), NOT `mockResolvedValue`.

Mock paths from `tests/routes/`:
- `../../src/services/recurringInvoiceService`
- `../../src/models`

- [ ] **Step 1: Write failing tests**

Create `tests/routes/recurringCallback.test.js`:

```js
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

// Build a mock subscription with the methods the route calls
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/routes/recurringCallback.test.js --no-coverage
```

Expected: all 4 tests FAIL — the route exists but nothing is wired up yet from the test perspective (the existing route code is already implemented; these tests are locking in existing behavior, so they should actually PASS on first run).

> **Note:** Unlike new feature tests, these tests verify existing route behavior. They should pass immediately if the route is implemented correctly. If any fail, that indicates a discrepancy between the test setup and the actual route implementation — investigate before proceeding.

- [ ] **Step 3: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/routes/recurringCallback.test.js
git commit -m "test: add integration tests for recurring callback route"
```

---

## Chunk 3: Manual test guide

### Task 4: Write the manual recurring payment test guide

**Files:**
- Create: `docs/testing/recurring-payments-manual-test.md`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p docs/testing
```

Create `docs/testing/recurring-payments-manual-test.md`:

```markdown
# Recurring Payments — Manual Test Guide

Use this guide to verify that Hubtel actually charges donors at the configured interval (daily, weekly, monthly, or annually) and that your server receives and records each payment correctly.

---

## Prerequisites

- Hubtel sandbox credentials set in `.env`:
  ```
  HUBTEL_API_KEY=your_sandbox_key
  HUBTEL_API_SECRET=your_sandbox_secret
  HUBTEL_POS_SALES_ID=your_sandbox_pos_id
  HUBTEL_MERCHANT_ID=your_sandbox_merchant_id
  ```
- [ngrok](https://ngrok.com/) installed and authenticated
- Node.js 18+ and MongoDB running locally
- Server dependencies installed: `npm install`

---

## Step 1: Expose your local server to the internet

Hubtel needs a public URL to send callbacks. ngrok creates a temporary tunnel:

```bash
ngrok http 3000
```

Copy the `https://` URL from the output, e.g.:
```
https://abc123.ngrok-free.app
```

Set your callback URLs in `.env` and restart the server:
```
CALLBACK_URL=https://abc123.ngrok-free.app/api/callback/payment
RECURRING_CALLBACK_URL=https://abc123.ngrok-free.app/api/callback/recurring
FULFILMENT_CALLBACK_URL=https://abc123.ngrok-free.app/api/callback/fulfilment
```

```bash
npm start
```

---

## Step 2: Create a recurring invoice via USSD

Dial the USSD short code assigned to your Hubtel account, or simulate the flow via the API:

```bash
# Simulate USSD initiation
curl -s -X POST http://localhost:3000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{
    "SessionId": "TEST-REC-001",
    "Type": "Initiation",
    "Mobile": "233244000000",
    "Sequence": 1
  }' | jq .

# Select amount (e.g. GHS 5 = choice 1)
curl -s -X POST http://localhost:3000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{"SessionId":"TEST-REC-001","Type":"Response","Message":"1","Mobile":"233244000000"}' | jq .

# Select frequency (1=Weekly, 2=Monthly, 3=Annually)
curl -s -X POST http://localhost:3000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{"SessionId":"TEST-REC-001","Type":"Response","Message":"1","Mobile":"233244000000"}' | jq .

# Confirm
curl -s -X POST http://localhost:3000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{"SessionId":"TEST-REC-001","Type":"Response","Message":"1","Mobile":"233244000000"}' | jq .
```

The server log will print:
```
CREATING HUBTEL RECURRING INVOICE
Response: { "responseCode": "0001", "data": { "recurringInvoiceId": "...", ... } }
```

Note the `recurringInvoiceId` for later.

---

## Step 3: Confirm the first charge

Watch the ngrok request inspector at **http://127.0.0.1:4040** and your server logs.

Within a few minutes of invoice creation, Hubtel's sandbox will send a payment callback to `/api/callback/recurring` with `ResponseCode: "0000"`. You should see:

**Server log:**
```
RECURRING INVOICE CALLBACK RECEIVED
Recurring payment successful for invoice <invoice-id>
Recurring payment recorded for subscription <subscription-id>
```

**Verify in the database:**
```bash
curl -s http://localhost:3000/api/callback/subscriptions | jq '.subscriptions[0].status'
# Expected: "active"

curl -s http://localhost:3000/api/callback/payments | jq '.donations[0]'
# Expected: a donation with source "hubtel_recurring" and status "Success"
```

---

## Step 4: Verify the next charge (does "weekly" charge the next week?)

### Option A: Use the Hubtel sandbox simulation trigger (recommended)

Log in to the Hubtel sandbox dashboard. Navigate to your recurring invoice and look for a **"Simulate next payment"** button or equivalent. Clicking it sends another `ResponseCode: "0000"` callback immediately. Check your server logs and database for a second donation record.

### Option B: Wait for the real interval

If the sandbox does not have a simulation trigger:

1. Create a recurring invoice with the shortest available interval
2. Wait for the interval to elapse (e.g. the next calendar day for daily)
3. Watch the ngrok inspector for an incoming POST to `/api/callback/recurring`
4. Verify:
   - The callback `ResponseCode` is `"0000"`
   - A new `Donation` document appears in MongoDB with `createdAt` on the next day
   - `subscription.lastPaymentDate` is updated

### How to confirm "daily takes money the next day"

1. Create a `weekly` or `daily` invoice today
2. Note the timestamp of the **first** donation (`createdAt`)
3. When the second callback arrives, compare the new donation's `createdAt` against the first
4. The difference should match the configured interval (7 days for weekly, 1 day for daily)

```bash
curl -s http://localhost:3000/api/callback/payments | \
  jq '[.donations[] | select(.source=="hubtel_recurring")] | sort_by(.createdAt) | .[-2:] | map(.createdAt)'
# Shows the timestamps of the two most recent recurring donations
```

---

## Step 5: Test cancellation via USSD

Use the USSD flow to cancel the subscription:

```bash
# Initiation
curl -s -X POST http://localhost:3000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{"SessionId":"TEST-CANCEL-001","Type":"Initiation","Mobile":"233244000000","Sequence":1}' | jq .

# Select amount (e.g. 1 = GHS 5)
curl -s -X POST http://localhost:3000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{"SessionId":"TEST-CANCEL-001","Type":"Response","Message":"1","Mobile":"233244000000"}' | jq .

# Select "5. Cancel subscription"
curl -s -X POST http://localhost:3000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{"SessionId":"TEST-CANCEL-001","Type":"Response","Message":"5","Mobile":"233244000000"}' | jq .
# Expected: shows "Your weekly subscription of GHS 5 will be cancelled. 1. Confirm..."

# Confirm cancellation
curl -s -X POST http://localhost:3000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{"SessionId":"TEST-CANCEL-001","Type":"Response","Message":"1","Mobile":"233244000000"}' | jq .
# Expected: "Your subscription has been cancelled."
```

Verify in the Hubtel sandbox dashboard that the recurring invoice now shows as cancelled.

---

## Troubleshooting

| Problem | Check |
|---|---|
| No callback received | ngrok tunnel still running? `RECURRING_CALLBACK_URL` set correctly in `.env`? Server restarted after `.env` change? |
| `responseCode: "0001"` but no charge | This is the invoice creation acknowledgement, not a charge. Wait for Hubtel to process the first payment. |
| Callback received but no donation record | Check server logs for errors. Is MongoDB connected? |
| ngrok URL expired | ngrok free tier URLs expire — restart ngrok and update `.env` |
```

- [ ] **Step 2: Run the full test suite to confirm nothing is broken**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add docs/testing/recurring-payments-manual-test.md
git commit -m "docs: add recurring payments manual test guide"
```
