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
- MongoDB database for donor and transaction tracking
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
                         │              │    MongoDB      │
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
│   │   └── database.js           # MongoDB connection
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
- MongoDB database
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

   # MongoDB
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/donation_ussd

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
  - USSD: 60 requests/minute
  - Callbacks: 100 requests/minute
  - Admin: 50 requests/15 minutes
- **Admin Authentication**: API key required for admin endpoints
- **Sensitive Data Redaction**: Logs sanitize sensitive fields

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
| `MONGODB_URI` | MongoDB connection string |
| `CALLBACK_URL` | Your deployed callback URL |
| `ORG_NAME` | Organization name |
| `SCHEDULER_ENABLED` | `true` to enable scheduler |
| `SCHEDULER_CRON` | Cron schedule (default: `0 6 * * *`) |
| `ADMIN_API_KEY` | Secure key for admin endpoints |

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
