# Recurring Payment Tests — Design Spec
**Date:** 2026-03-16
**Scope:** Automated Jest tests for recurring invoice callback handling + manual test guide for verifying Hubtel charges at the correct interval

---

## Overview

Two deliverables:

1. **Automated test suite** — Jest tests covering `recurringInvoiceService` callback parsing and the `/api/callback/recurring` route. These run in CI and verify the system correctly records payments, failures, and cancellations without real money moving.

2. **Manual test guide** — A Markdown document explaining how to create a real recurring invoice in Hubtel's sandbox, expose a local server with ngrok, and confirm the first and second charges arrive on time (answering "does daily actually charge the next day?").

---

## Architecture

Three new files. No existing files modified.

| File | Purpose |
|---|---|
| `tests/services/recurringInvoiceService.test.js` | Unit tests for `handleRecurringCallback()` and `createRecurringInvoice()` request body construction |
| `tests/routes/recurringCallback.test.js` | Integration tests for `POST /api/callback/recurring` via supertest |
| `docs/testing/recurring-payments-manual-test.md` | Step-by-step manual test guide |

---

## Automated Tests

### `tests/services/recurringInvoiceService.test.js`

**`handleRecurringCallback()` — 5 tests**

| Test | Input | Expected |
|---|---|---|
| Success callback (`0000`) | `{ ResponseCode: '0000', Data: { RecurringInvoiceId: 'INV-1', TransactionId: 'TXN-1', ClientReference: 'REF-1', Amount: 50 } }` | `result.success === true`, `result.recurringInvoiceId === 'INV-1'`, `result.amount === 50` |
| Failure callback (`2001`) | `{ ResponseCode: '2001', Message: 'Insufficient funds' }` | `result.failed === true`, `result.success === false` |
| Cancellation callback (`0005`) | `{ ResponseCode: '0005' }` | `result.cancelled === true`, `result.failed === false` |
| Unknown response code | `{ ResponseCode: '9999' }` | `result.success === false`, `result.failed === false`, `result.cancelled === false` |
| Missing Data field | `{ ResponseCode: '0000' }` (no `Data`) | `result.recurringInvoiceId === undefined`, `result.amount === undefined`, does not throw |

**`createRecurringInvoice()` — request body construction — 3 tests**

These mock `axios.post` and verify the outbound payload. `HUBTEL_POS_SALES_ID` must be set in the test environment so the simulation branch is not taken.

| Test | Frequency | Expected in request body |
|---|---|---|
| Weekly | `'weekly'` | `PaymentInterval: 'Weekly'`; `InvoiceEndDate` is ~1 year from now |
| Monthly | `'monthly'` | `PaymentInterval: 'Monthly'`; `InvoiceEndDate` is ~2 years from now |
| Annually | `'annually'` | `PaymentInterval: 'Yearly'`; `InvoiceEndDate` is ~10 years from now |

Mocking: `jest.mock('axios')` — `axios.post.mockResolvedValue({ data: { responseCode: '0001', data: { recurringInvoiceId: 'SIM-1', requestId: 'REQ-1' } } })`.

End-date assertions: assert year is `currentYear + N ± 1` (tolerance for day boundary).

---

### `tests/routes/recurringCallback.test.js`

Integration tests via supertest. Mocks `../../src/models` (Subscription + Donation) and `../../src/services/recurringInvoiceService`.

**Critical — sync mock:** `handleRecurringCallback` is a **synchronous** function (`function`, not `async function`). The route calls it **without `await`** (`callbackRoutes.js` line 67). It must therefore be mocked with `jest.fn().mockReturnValue({...})`, **not** `mockResolvedValue`. Using `mockResolvedValue` would make `result` in the route handler a pending Promise object — every property access (`result.success`, `result.recurringInvoiceId`, etc.) would return `undefined` and all four route tests would produce silent false negatives.

**4 tests**

| Test | Setup | Expected |
|---|---|---|
| Successful payment — records donation | `handleRecurringCallback` returns success result; `Subscription.findByRecurringInvoiceId` returns mock subscription; `subscription.recordPayment` resolves; `Donation.create` resolves | HTTP 200, `{ success: true }`, `Donation.create` called with correct fields |
| Failed payment — records failure | `handleRecurringCallback` returns `{ failed: true }`; subscription found | HTTP 200, `subscription.recordFailure` called |
| Cancellation — cancels subscription | `handleRecurringCallback` returns `{ cancelled: true }`; subscription found | HTTP 200, `subscription.cancel` called with `'Cancelled by Hubtel'` |
| No matching subscription | `handleRecurringCallback` returns result; `findByRecurringInvoiceId` returns null; `findByClientReference` returns null | HTTP 200, `{ success: true, message: 'Callback received but no matching subscription found' }` |

Mock subscription object shape:
```js
{
  _id: new mongoose.Types.ObjectId(),
  donor: new mongoose.Types.ObjectId(),
  phoneNumber: '233244000000',
  amount: 50,
  channel: 'mtn-gh',
  frequency: 'monthly',
  status: 'active',
  recordPayment: jest.fn().mockResolvedValue({}),
  recordFailure: jest.fn().mockResolvedValue({}),
  cancel: jest.fn().mockResolvedValue({})
}
```

---

## Manual Test Guide (`docs/testing/recurring-payments-manual-test.md`)

### Sections

**1. Prerequisites**
- Hubtel sandbox credentials (`HUBTEL_POS_SALES_ID`, `HUBTEL_API_KEY`, `HUBTEL_API_SECRET`)
- ngrok installed and authenticated
- Local server running (`npm start`)

**2. Expose local server**
```bash
ngrok http 3000
# Copy the https URL, e.g. https://abc123.ngrok.io
```
Set `RECURRING_CALLBACK_URL=https://abc123.ngrok.io/api/callback/recurring` in `.env` and restart.

**3. Create a recurring invoice (weekly)**

Use the USSD flow or call the API directly:
```bash
curl -X POST http://localhost:3000/api/ussd \
  -H "Content-Type: application/json" \
  -d '{ "SessionId": "TEST-001", "Type": "Initiation", "Mobile": "233244000000" }'
# Navigate through the menu: select amount → select "1. Weekly" → confirm
```

**4. Confirm first charge**
- Check ngrok request inspector (`http://127.0.0.1:4040`) for an incoming POST to `/api/callback/recurring`
- Check server logs for "Recurring payment recorded"
- Query the database: `GET /api/callback/subscriptions` — subscription status should be `active`

**5. Verify next charge (daily/weekly)**

> **Important:** Hubtel sandbox may not wait a full week. Check the Hubtel sandbox dashboard for a "simulate next payment" button, or contact Hubtel support to request a manual trigger.

If Hubtel does not have a simulation trigger:
- Set up the recurring invoice with the shortest supported interval
- Wait for the interval to elapse
- Watch ngrok and server logs for the second callback
- Verify a new `Donation` record was created in the database with `source: 'hubtel_recurring'`

**6. Verify cancellation**
```bash
curl -X POST http://localhost:3000/api/callback/subscriptions/{id}/cancel \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Test cancellation" }'
```
Check Hubtel dashboard — invoice should show as cancelled.

**7. What to check to confirm "daily takes money the next day"**
- After creating a `daily` invoice, check the Hubtel sandbox dashboard the next calendar day
- A successful charge will appear as an incoming callback at `/api/callback/recurring` with `ResponseCode: "0000"`
- The ngrok inspector will show the POST request with timestamp
- A new `Donation` document in MongoDB will have `createdAt` on the next day

---

## Out of Scope

- Automated interval timing tests (would require real time passage or Hubtel test hooks not yet documented)
- Load or stress testing of the callback endpoint
- Testing the USSD cancellation flow introduced in the companion spec
