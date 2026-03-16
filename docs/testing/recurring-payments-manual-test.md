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
