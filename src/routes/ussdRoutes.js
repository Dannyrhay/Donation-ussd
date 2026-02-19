const express = require('express');
const router = express.Router();
const ussdController = require('../controllers/ussdController');

/**
 * USSD Routes
 *
 * POST /api/ussd - Main USSD endpoint (Hubtel sends requests here)
 *
 * This is the endpoint you'll configure in your Hubtel dashboard
 * as the "Service Interaction URL" for your USSD application.
 */

// Main USSD endpoint - handles all USSD interactions
router.post('/', ussdController.handleUssdRequest);

// Also handle GET for testing in browser
router.get('/', (req, res) => {
  res.json({
    service: 'USSD Donation Service',
    status: 'active',
    usage: 'Send POST requests to this endpoint',
    expectedFormat: {
      Type: 'initiation | response',
      Mobile: '233xxxxxxxxx',
      SessionId: 'unique-id',
      Message: 'user input',
      Operator: 'mtn | vodafone | tigo | airtel',
      Sequence: 1
    }
  });
});

module.exports = router;
