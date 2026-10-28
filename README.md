# Jesus Mission Fund - USSD Donation System

A USSD-based donation system built with Node.js and integrated with Hubtel APIs for mobile money payments in Ghana.

## Features

- USSD-based donation interface
- **AddToCart payment integration** - Direct in-session payment prompts
- Predefined donation amounts: GHS 5, 10, 50, 100, 500, 1000
- Custom amount option (GHS 1 - 10,000)
- Multiple frequencies: One-time, Weekly, Monthly, Quarterly, Annually
- Mobile Money support: MTN, Telecel, AirtelTigo
- **Automated recurring subscription payments** with node-cron scheduler
- PostgreSQL (Railway) via Prisma for donor and transaction tracking
- **Security features**: Rate limiting, Helmet headers, Admin authentication

## Recent Updates

### v1.1.0 - AddToCart Payment Fix
- **Fixed**: Payment prompts now work correctly using Hubtel's `AddToCart` response type
- **Added**: Automated recurring subscription scheduler (runs daily at 6 AM GMT)
- **Added**: Admin API endpoints with authentication
- **Added**: Comprehensive rate limiting for all endpoints
- **Improved**: USSD response format compliance with Hubtel API standards

## System Architecture

```
┌──────────┐      ┌──────────────┐      ┌─────────────────┐
│  Donor   │ USSD │   Hubtel     │ HTTP │   Our Server    │
│  Phone   │─────>│   Gateway    │─────>│   (Node.js)     │
└──────────┘      └──────────────┘      └────────┬────────┘
                                                 │
┌──────────┐      ┌──────────────┐               │
│  Donor   │Prompt│   Hubtel     │<──────────────┘
│  Phone   │<─────│  (AddToCart) │   Type: "AddToCart"
└──────────┘      └──────────────┘      ┌─────────────────┐
                         │              │   PostgreSQL    │
                         └─────────────>│    Database     │
                         Callback       └─────────────────┘
```

## USSD Flow

```
User Dials *713*3090#
       │
       ▼
┌─────────────────────────────┐
│ SCREEN 1: Amount Selection  │
│ 1. GHS 5    5. GHS 500      │
│ 2. GHS 10   6. GHS 1000     │
│ 3. GHS 50   7. Custom       │
│ 4. GHS 100                  │
└─────────────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ SCREEN 2: Frequency         │
│ 1. One-time  4. Quarterly   │
│ 2. Weekly    5. Annually    │
│ 3. Monthly                  │
└─────────────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ SCREEN 3: Confirmation      │
│ 1. Confirm                  │
│ 2. Cancel                   │
└─────────────────────────────┘
       │
       ▼ (AddToCart Response)
┌─────────────────────────────┐
│ Payment Prompt on Phone     │
│ "Approve payment of GHS X"  │
└─────────────────────────────┘
```

## Project Structure

```
donation-ussd/
├── src/
│   ├── config/
│   │   ├── index.js              # App configuration
│   │   └── database.js           # PostgreSQL connection (Prisma)
│   ├── controllers/
│   │   └── ussdController.js     # USSD request handler
│   ├── models/
│   │   ├── index.js              # Model exports
│   │   ├── Donor.js              # Donor schema
│   │   ├── Donation.js           # Donation schema
│   │   └── Subscription.js       # Recurring subscription schema
│   ├── routes/
│   │   ├── ussdRoutes.js         # USSD endpoints
│   │   ├── callbackRoutes.js     # Payment callback endpoints
│   │   └── adminRoutes.js        # Admin API endpoints
│   ├── services/
│   │   ├── ussdMenuService.js    # USSD menu logic + AddToCart
│   │   ├── paymentService.js     # Hubtel payment integration
│   │   ├── donationService.js    # Database operations
│   │   ├── schedulerService.js   # Cron job scheduler
│   │   └── subscriptionProcessor.js # Recurring payment processor
│   └── app.js                    # Express app entry point
├── tests/
│   ├── setup.js                  # Test configuration
│   ├── ussdMenuService.test.js   # USSD flow tests
│   └── __mocks__/                # Test mocks
├── .env                          # Environment variables
├── jest.config.js                # Test configuration
├── render.yaml                   # Render deployment config
├── package.json
└── README.md
```

## Installation

### Prerequisites

- Node.js v18+
- PostgreSQL 15+ (Railway Postgres, or Docker locally)
- Hubtel merchant account with USSD service

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Dannyrhay/Donation-ussd.git
   cd Donation-ussd
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create `.env` file**
   ```env
   # Server
   PORT=3000
   NODE_ENV=development

   # Hubtel API
   HUBTEL_API_KEY=your_api_key
   HUBTEL_API_SECRET=your_api_secret
   HUBTEL_MERCHANT_ID=your_merchant_id

   # Callback URL (your deployed server)
   CALLBACK_URL=https://your-server.com/api/callback/payment

   # Organization
   ORG_NAME=Jesus Mission Fund

   # PostgreSQL (on Railway: DATABASE_URL=${{Postgres.DATABASE_URL}})
   DATABASE_URL=postgresql://user:password@localhost:5432/donation_ussd

   # Scheduler (for recurring payments)
   SCHEDULER_ENABLED=true
   SCHEDULER_CRON=0 6 * * *

   # Admin API Key (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
   ADMIN_API_KEY=your_secure_admin_key
   ```

4. **Start the server**
   ```bash
   # Development
   npm run dev

   # Production
   npm start

   # Run tests
   npm test
   ```

## API Endpoints

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check and service status |
| `/api/ussd` | POST | USSD session handler (Hubtel sends requests here) |
| `/api/callback/payment` | POST | Payment callback from Hubtel |
| `/api/callback/payments` | GET | List all donations |
| `/api/callback/donors` | GET | List all donors |
| `/api/callback/subscriptions` | GET | List recurring subscriptions |
| `/api/callback/stats` | GET | Donation statistics |

### Admin Endpoints (Requires `X-Admin-Key` header)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/scheduler/status` | GET | Get scheduler status |
| `/api/admin/scheduler/trigger` | POST | Manually trigger subscription processing |
| `/api/admin/subscriptions` | GET | List all subscriptions with stats |
| `/api/admin/subscriptions/:id/pause` | POST | Pause a subscription |
| `/api/admin/subscriptions/:id/resume` | POST | Resume a paused subscription |

## Hubtel Integration

### USSD Request Format (from Hubtel)

```json
{
  "Type": "Initiation",
  "Mobile": "233244123456",
  "SessionId": "unique-session-id",
  "ServiceCode": "713",
  "Message": "*713*3090#",
  "Operator": "mtn",
  "Sequence": 1
}
```

### USSD Response Types

#### Standard Response (continue session)
```json
{
  "SessionId": "unique-session-id",
  "Type": "Response",
  "Message": "Menu text here",
  "Label": "Menu Title",
  "DataType": "input",
  "FieldType": "text",
  "ClientState": "current_state"
}
```

#### AddToCart Response (trigger payment)
```json
{
  "SessionId": "unique-session-id",
  "Type": "AddToCart",
  "Message": "Processing payment...",
  "Label": "Payment",
  "DataType": "display",
  "FieldType": "text",
  "ClientState": "DON-abc12345-1234567890",
  "Item": {
    "ItemName": "Donation to Jesus Mission Fund",
    "Qty": 1,
    "Price": 5
  }
}
```

#### Release Response (end session)
```json
{
  "SessionId": "unique-session-id",
  "Type": "Release",
  "Message": "Thank you message",
  "Label": "Complete",
  "DataType": "display"
}
```

### Payment Channels

| Network | Channel Code |
|---------|--------------|
| MTN Mobile Money | `mtn-gh` |
| Telecel Cash | `vodafone-gh` |
| AirtelTigo Money | `tigo-gh` |

## Recurring Subscriptions

The system automatically processes recurring subscriptions using a cron scheduler.

### How It Works

1. User selects a recurring frequency (Weekly, Monthly, Quarterly, Annually)
2. After first payment, a subscription record is created
3. Scheduler runs daily at 6 AM Ghana time (configurable)
4. For each due subscription:
   - Creates a donation record
   - Initiates Hubtel payment
   - Updates subscription dates on success
   - Pauses subscription after 3 consecutive failures

### Scheduler Configuration

```env
SCHEDULER_ENABLED=true          # Enable/disable scheduler
SCHEDULER_CRON=0 6 * * *        # Cron expression (6 AM daily)
```

## Security Features

- **Helmet**: Security HTTP headers
- **Rate Limiting**:
  - USSD: 30 requests/minute **per subscriber (Mobile)** — never per IP, because Hubtel relays every customer from the same gateway IPs. Limited requests get a valid `Release` USSD reply, not a 429.
  - Hubtel webhooks (`/payment`, `/recurring`, `/fulfilment`): not rate limited (authenticated by `CALLBACK_SECRET`)
  - Admin views under `/api/callback`: 200 requests/minute
  - Admin: 50 requests/15 minutes
  - Unmatched routes: 100 requests/15 minutes per IP
- **Admin Authentication**: `X-Admin-Key` or `Authorization: Bearer` header required (query-string keys are rejected). Admin endpoints are disabled if no key is configured.
- **USSD Authentication** (optional): set `USSD_SECRET` and use `/api/ussd?secret=<USSD_SECRET>` as the Hubtel Service Interaction URL
- **Sensitive Data Redaction**: Logs sanitize sensitive fields

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request to `main`: syntax check, tests on Node 22 and 24, and `npm audit` of production dependencies. No secrets are needed.

Railway deploys automatically on push. Enable **Wait for CI** in the Railway service settings so a commit only deploys after CI passes.

## Deployment

### Render.com

1. Connect your GitHub repository
2. Create a new Web Service
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Add environment variables in Render dashboard

### Environment Variables for Production

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `production` |
| `HUBTEL_API_KEY` | Your Hubtel API key |
| `HUBTEL_API_SECRET` | Your Hubtel API secret |
| `HUBTEL_MERCHANT_ID` | Your Hubtel merchant ID |
| `DATABASE_URL` | PostgreSQL connection string (Railway: reference `${{Postgres.DATABASE_URL}}`) |
| `CALLBACK_URL` | Your deployed callback URL |
| `ORG_NAME` | Organization name |
| `SCHEDULER_ENABLED` | `true` to enable scheduler |
| `SCHEDULER_CRON` | Cron schedule (default: `0 6 * * *`) |
| `ADMIN_API_KEY` | Secure key for admin endpoints (required — admin is disabled without it) |
| `CALLBACK_SECRET` | Shared secret appended as `?secret=` to Hubtel callback URLs |
| `USSD_SECRET` | Shared secret appended as `?secret=` to the Hubtel USSD URL |

## Database (PostgreSQL + Prisma)

- Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations/` (the init migration also adds CHECK constraints for allowed status/channel/frequency values).
- Money columns are `DECIMAL(12,2)` — exact in the database, returned to the app as numbers.
- Railway applies migrations automatically before each deploy (`railway.json` → `preDeployCommand: npm run db:migrate`).
- Changing the schema: edit `schema.prisma`, run `npm run db:migrate:dev -- --name <change>` against a local database, commit the new migration. CI fails if the schema and migrations drift.

### Local database

```bash
docker run -d --name jmf-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17-alpine
export DATABASE_URL=postgresql://postgres:dev@localhost:5432/postgres
npm run db:migrate
TEST_DATABASE_URL=$DATABASE_URL npm test   # also runs the repository integration tests
```

### One-time migration from MongoDB (cutover runbook)

1. In Railway: add a **PostgreSQL** service; on the app service set `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
2. Locally, against Railway's **public** Postgres URL, create the tables: `DATABASE_URL=<public url> npm run db:migrate`
3. Dry run (reads MongoDB only, writes nothing — review any reported problem rows):
   `MONGODB_URI=<atlas uri> DATABASE_URL=<public url> npm run db:import-mongo`
4. Copy the data while the old app is still live: `... npm run db:import-mongo -- --execute` → must end with `✔ OK`.
5. Deploy this branch (pick a quiet time).
6. Immediately run the import **again** to pick up gifts made to MongoDB between steps 4 and 5. It's safe to re-run: copied rows are skipped, and donors the new app already created are matched by phone number.
7. Dial the code, make a GHS 1 test donation, check `/api/admin/donations`.
8. Keep Atlas read-only for a few weeks as a backup, then remove `MONGODB_URI`.

## Database Schema

### Donors
- `phoneNumber` - Unique identifier
- `name` - Donor name (optional)
- `network` - Mobile network
- `totalDonated` - Lifetime total
- `donationCount` - Number of donations

### Donations
- `donor` - Reference to donor
- `amount` - Donation amount
- `channel` - Payment channel
- `frequency` - once/weekly/monthly/quarterly/annually
- `status` - pending/completed/failed
- `reference` - Unique transaction reference
- `subscription` - Reference to subscription (if recurring)

### Subscriptions
- `donor` - Reference to donor
- `amount` - Recurring amount
- `frequency` - weekly/monthly/quarterly/annually
- `status` - active/paused/cancelled/expired
- `nextPaymentDate` - Next scheduled payment
- `paymentsCompleted` - Count of successful payments
- `paymentsFailed` - Count of failed attempts
- `totalCollected` - Total amount collected

## Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage
```

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB (Atlas)
- **Payment**: Hubtel USSD & Payment APIs
- **Scheduler**: node-cron
- **Security**: Helmet, express-rate-limit
- **Testing**: Jest
- **Hosting**: Render.com

## License

ISC

## Author

Jesus Mission Fund

## Support

For issues or questions, contact the Hubtel support team or open an issue on GitHub.
