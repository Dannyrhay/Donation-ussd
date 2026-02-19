# Jesus Mission Fund - USSD Donation System

A USSD-based donation system built with Node.js and integrated with Hubtel APIs for mobile money payments in Ghana.

## Features

- USSD-based donation interface
- Predefined donation amounts: GHS 5, 10, 50, 100, 500, 1000
- Custom amount option
- Multiple frequencies: One-time, Weekly, Monthly, Quarterly, Annually
- Mobile Money support: MTN, Telecel, AirtelTigo
- Recurring payment subscriptions
- MongoDB database for donor and transaction tracking

## System Architecture

```
┌──────────┐      ┌──────────────┐      ┌─────────────────┐
│  Donor   │ USSD │   Hubtel     │ HTTP │   Our Server    │
│  Phone   │─────>│   Gateway    │─────>│   (Node.js)     │
└──────────┘      └──────────────┘      └────────┬────────┘
                                                 │
┌──────────┐      ┌──────────────┐               │
│  Donor   │Prompt│   Hubtel     │<──────────────┘
│  Phone   │<─────│  Payment API │
└──────────┘      └──────────────┘      ┌─────────────────┐
                         │              │    MongoDB      │
                         └─────────────>│    Database     │
                                        └─────────────────┘
```

## USSD Flow

```
User Dials *XXX#
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
       ▼
   Payment Prompt Sent
```

## Project Structure

```
donation-ussd/
├── src/
│   ├── config/
│   │   ├── index.js          # App configuration
│   │   └── database.js       # MongoDB connection
│   ├── controllers/
│   │   └── ussdController.js # USSD request handler
│   ├── models/
│   │   ├── Donor.js          # Donor schema
│   │   ├── Donation.js       # Donation schema
│   │   └── Subscription.js   # Recurring subscription schema
│   ├── routes/
│   │   ├── ussdRoutes.js     # USSD endpoints
│   │   └── callbackRoutes.js # Payment callback endpoints
│   ├── services/
│   │   ├── ussdMenuService.js    # USSD menu logic
│   │   ├── paymentService.js     # Hubtel payment integration
│   │   └── donationService.js    # Database operations
│   └── app.js                # Express app entry point
├── .env                      # Environment variables (not in repo)
├── .gitignore
├── package.json
└── README.md
```

## Installation

### Prerequisites

- Node.js v18+
- MongoDB database
- Hubtel merchant account

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
   ```

4. **Start the server**
   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ussd` | POST | USSD session handler (Hubtel sends requests here) |
| `/api/callback/payment` | POST | Payment callback from Hubtel |
| `/api/callback/payments` | GET | List all donations |
| `/api/callback/donors` | GET | List all donors |
| `/api/callback/subscriptions` | GET | List recurring subscriptions |
| `/api/callback/stats` | GET | Donation statistics |

## Hubtel Integration

### USSD Request Format (from Hubtel)

```json
{
  "Type": "initiation",
  "Mobile": "233244123456",
  "SessionId": "unique-session-id",
  "ServiceCode": "713",
  "Message": "*713#",
  "Operator": "mtn",
  "Sequence": 1
}
```

### USSD Response Format (to Hubtel)

```json
{
  "SessionId": "unique-session-id",
  "Type": "response",
  "Message": "Menu text here",
  "ClientState": "current_state",
  "DataType": "input",
  "FieldType": "text"
}
```

### Payment Channels

| Network | Channel Code |
|---------|--------------|
| MTN Mobile Money | `mtn-gh` |
| Telecel Cash | `vodafone-gh` |
| AirtelTigo Money | `tigo-gh` |

## Deployment

### Render.com

1. Connect your GitHub repository
2. Create a new Web Service
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Add environment variables in Render dashboard

### Environment Variables for Production

Set these in your hosting platform:
- `NODE_ENV=production`
- `HUBTEL_API_KEY`
- `HUBTEL_API_SECRET`
- `HUBTEL_MERCHANT_ID`
- `MONGODB_URI`
- `CALLBACK_URL`
- `ORG_NAME`

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

### Subscriptions
- `donor` - Reference to donor
- `amount` - Recurring amount
- `frequency` - weekly/monthly/quarterly/annually
- `status` - active/paused/cancelled
- `nextPaymentDate` - Next scheduled payment

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB (Atlas)
- **Payment**: Hubtel APIs
- **Hosting**: Render.com

## License

ISC

## Author

Jesus Mission Fund
