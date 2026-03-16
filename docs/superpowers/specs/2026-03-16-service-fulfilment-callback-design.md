# Service Fulfilment Callback — Design Spec
**Date:** 2026-03-16
**Scope:** Standard (one-time) Hubtel mobile money payment flow only

---

## Overview

Hubtel's collect-money API supports a `FulfilmentCallbackUrl`. After a successful payment, Hubtel calls this URL to ask the merchant to confirm service delivery. The merchant must respond with a specific JSON structure (`ResponseCode`, `Status`, `Message`). Failure to respond correctly risks Hubtel reversing the transaction.

This spec covers implementing the fulfilment endpoint for the DonationUSSD platform's one-time donation flow.

---

## Architecture

Four files change. No new files are created.

| File | Change |
|---|---|
| `src/config/index.js` | Add `fulfilmentCallbackUrl` reading from `FULFILMENT_CALLBACK_URL` env var |
| `src/services/paymentService.js` | Add `handleFulfilmentCallback()` function; update `initiatePayment()` to include `FulfilmentCallbackUrl` in Hubtel request body |
| `src/routes/callbackRoutes.js` | Add `POST /api/callback/fulfilment` route delegating to `paymentService.handleFulfilmentCallback()` |
| `src/models/Donation.js` | Add `"Fulfilled"` as a valid status enum value; add `fulfilledAt` Date field |

---

## Data Flow

When a one-time payment succeeds, Hubtel sends two callbacks in sequence:

```
1. POST /api/callback/payment     — existing; updates donation status → "Success"
2. POST /api/callback/fulfilment  — new; updates donation status → "Fulfilled"
```

Fulfilment handler steps:

1. Receive Hubtel payload; extract `ClientReference` from `Data.ClientReference` or top-level `ClientReference`
2. Look up donation by reference in MongoDB
3. Update donation status to `"Fulfilled"`, set `fulfilledAt` to current timestamp
4. Respond with Hubtel's required format:
   ```json
   { "ResponseCode": "0000", "Status": "TXN_SUCCESS", "Message": "Fulfilled" }
   ```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Donation found, status `"Success"` | Update to `"Fulfilled"`, set `fulfilledAt`, respond `TXN_SUCCESS` |
| Donation found, status not `"Success"` (race condition) | Still update to `"Fulfilled"`, log warning, respond `TXN_SUCCESS` |
| Donation not found | Log warning with reference, respond `TXN_SUCCESS` |
| DB error | Log error, respond `TXN_SUCCESS` |
| Missing `ClientReference` in payload | Log error, respond `TXN_SUCCESS` |

**Core principle:** Always return `TXN_SUCCESS` to Hubtel regardless of internal errors. Hubtel must never reverse a real payment due to an internal lookup or DB failure. Internal failures surface through logs.

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
fulfilmentCallbackUrl: process.env.FULFILMENT_CALLBACK_URL || process.env.CALLBACK_URL
```

Falls back to `CALLBACK_URL` if not set (consistent with how `recurringCallbackUrl` is handled).

The `FulfilmentCallbackUrl` field is added to the Hubtel payment request body in `initiatePayment()`, alongside the existing `PrimaryCallbackUrl` and `SecondaryCallbackUrl`.

---

## Donation Model Changes

- Add `"Fulfilled"` to the status enum
- Add `fulfilledAt: { type: Date }` field

---

## Out of Scope

- Recurring invoice fulfilment (separate flow, not part of this spec)
- Notification or SMS on fulfilment
- Idempotency guard (Hubtel may retry; double-fulfilment is benign — status stays `"Fulfilled"`)
