# Service Fulfilment Callback — Design Spec
**Date:** 2026-03-16
**Scope:** Standard (one-time) Hubtel mobile money payment flow only

---

## Overview

Hubtel's collect-money API supports a `FulfilmentCallbackUrl`. After a successful payment, Hubtel calls this URL to ask the merchant to confirm service delivery. The merchant must respond with HTTP 200 and a specific JSON structure (`ResponseCode`, `Status`, `Message`). Failure to respond correctly risks Hubtel reversing the transaction.

This spec covers implementing the fulfilment endpoint for the DonationUSSD platform's one-time donation flow.

---

## Architecture

Five files change. No new files are created.

| File | Change |
|---|---|
| `src/config/index.js` | Add `fulfilmentCallbackUrl` from `FULFILMENT_CALLBACK_URL` env var (no fallback — see Config section) |
| `src/services/paymentService.js` | Add `handleFulfilmentCallback()` function; add it to `module.exports`; update `initiatePayment()` to include `FulfilmentCallbackUrl` in the Hubtel request body |
| `src/routes/callbackRoutes.js` | Add `POST /api/callback/fulfilment` route delegating to `paymentService.handleFulfilmentCallback()` |
| `src/models/Donation.js` | Add `'fulfilled'` to status enum; add `fulfilledAt: { type: Date }` field; update `getTotalForPeriod()` to match `{ $in: ['completed', 'fulfilled'] }` on status and use `$or` on `completedAt`/`fulfilledAt` for the date filter |
| `src/services/donationService.js` | Update `getStats()` line 264 — `countDocuments({ status: 'completed' })` → `countDocuments({ status: { $in: ['completed', 'fulfilled'] } })` |

---

## Data Flow

When a one-time payment succeeds, Hubtel sends two callbacks in sequence:

```
1. POST /api/callback/payment     — existing; updates donation status → "completed"
2. POST /api/callback/fulfilment  — new; updates donation status → "fulfilled"
```

Fulfilment handler steps:

1. Receive Hubtel payload; extract `ClientReference` using the same order as `handlePaymentCallback`:
   ```js
   callbackData.ClientReference
     || callbackData.Data?.ClientReference
     || callbackData.data?.ClientReference
   ```
2. Update donation using `Donation.findOneAndUpdate()` with a conditional write. Use a MongoDB aggregation pipeline update (array syntax) so `completedAt` can be set conditionally — ensuring period stats work even in the race condition where the payment callback hasn't run yet:
   ```js
   Donation.findOneAndUpdate(
     { reference, fulfilledAt: { $exists: false } },  // only match un-fulfilled docs
     [{
       $set: {
         status: 'fulfilled',
         fulfilledAt: '$$NOW',
         completedAt: { $ifNull: ['$completedAt', '$$NOW'] }  // set only if not already present
       }
     }],
     { new: true }
   )
   ```
   If the filter finds no document (donation already fulfilled or not found), `findOneAndUpdate` returns `null` — log accordingly and still respond `TXN_SUCCESS`.
3. Respond **always with HTTP 200** and Hubtel's required format:
   ```json
   { "ResponseCode": "0000", "Status": "TXN_SUCCESS", "Message": "Fulfilled" }
   ```

---

## Error Handling

**Critical rule:** The fulfilment route must **always return HTTP 200** with `TXN_SUCCESS`. This is architecturally different from the existing `/api/callback/payment` route, which returns HTTP 500 on exceptions. The `try/catch` in the new route must catch all errors and still return HTTP 200 — never let an exception propagate to Express's error handler.

| Scenario | Behaviour |
|---|---|
| Donation found, status `"completed"` | Update to `"fulfilled"`, set `fulfilledAt`, respond HTTP 200 `TXN_SUCCESS` |
| Donation found, status not `"completed"` (race condition — payment callback hasn't run yet) | Still update to `"fulfilled"`, log warning, respond HTTP 200 `TXN_SUCCESS` |
| Donation already `"fulfilled"` (Hubtel retry) | `findOneAndUpdate` filter (`fulfilledAt: { $exists: false }`) finds no match → returns `null`; log and respond HTTP 200 `TXN_SUCCESS`. Nothing is written. |
| Donation not found | Log warning with reference, respond HTTP 200 `TXN_SUCCESS` |
| DB error | Log error, respond HTTP 200 `TXN_SUCCESS` |
| Missing `ClientReference` in payload | Log error, respond HTTP 200 `TXN_SUCCESS` |

---

## Hubtel Payload (Inbound)

```json
{
  "ResponseCode": "0000",
  "Status": "Success",
  "Data": {
    "Amount": 10,
    "Charges": 0,
    "AmountAfterCharges": 10,
    "ClientReference": "DON-1234567890",
    "TransactionId": "HUBTEL-TXN-ID",
    "CustomerMsisdn": "233244000000",
    "Description": "One-time donation"
  }
}
```

## Required Response (Outbound)

HTTP 200 always. Body:
```json
{
  "ResponseCode": "0000",
  "Status": "TXN_SUCCESS",
  "Message": "Fulfilled"
}
```

---

## Configuration

New env var: `FULFILMENT_CALLBACK_URL`

Added to `config/index.js` under the `callbackUrl` section:
```js
fulfilmentCallbackUrl: process.env.FULFILMENT_CALLBACK_URL
```

**No fallback.** Unlike `recurringCallbackUrl`, falling back to `CALLBACK_URL` would silently point to the wrong endpoint (`/api/callback/payment`). If `FULFILMENT_CALLBACK_URL` is not set, `FulfilmentCallbackUrl` is omitted from the Hubtel request body in `initiatePayment()` (same guard pattern as the existing Hubtel credentials check).

The `FulfilmentCallbackUrl` field is added to the Hubtel payment request body in `initiatePayment()`, alongside the existing `PrimaryCallbackUrl` and `SecondaryCallbackUrl`. Only added when the config value is present.

---

## Donation Model Changes

- Add `'fulfilled'` to the status enum (lowercase, consistent with existing values like `'completed'`, `'pending'`)
- Add `fulfilledAt: { type: Date }` field (optional, set on first fulfilment only)

### Stats / Reporting

`Donation.getTotalForPeriod()` currently matches `status: 'completed'` and filters by `completedAt`. Both must be updated in the same change:

```js
$match: {
  status: { $in: ['completed', 'fulfilled'] },
  $or: [
    { completedAt: { $gte: startDate, $lte: endDate } },
    { fulfilledAt: { $gte: startDate, $lte: endDate } }
  ]
}
```

The `$or` on both date fields handles the race condition where a donation reaches `'fulfilled'` before `'completed'` (payment callback hasn't fired yet) — in that case, `completedAt` is absent but `fulfilledAt` is set.

Additionally, `donationService.getStats()` line 264 must be updated:
```js
// Before:
const totalDonations = await Donation.countDocuments({ status: 'completed' });
// After:
const totalDonations = await Donation.countDocuments({ status: { $in: ['completed', 'fulfilled'] } });
```

Both changes are **in scope** — they are direct consequences of the status transition introduced here.

---

## Exports

`handleFulfilmentCallback` must be added to `module.exports` at the bottom of `paymentService.js`:
```js
module.exports = {
  initiatePayment,
  handlePaymentCallback,
  handleFulfilmentCallback,   // ← add this
  getPayment,
  getAllPayments,
  getStats,
  formatPhoneNumber
};
```

---

## Out of Scope

- Recurring invoice fulfilment (separate flow)
- Notification or SMS on fulfilment
