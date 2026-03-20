const request = require('supertest');
const express = require('express');
const { 
  authenticateAdmin, 
  authenticateCallback 
} = require('../src/middleware/auth');
const { 
  validatePaymentCallback, 
  validateRecurringCallback, 
  validateAdminRequest 
} = require('../src/middleware/validation');
const config = require('../src/config');

// Mock config for testing
jest.mock('../src/config', () => ({
  adminApiKey: 'test-admin-key',
  hubtel: {
    apiKey: 'test-hubtel-key'
  }
}));

describe('Security Middleware Tests', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe('Authentication Middleware', () => {
    test('authenticateAdmin should block unauthorized requests', async () => {
      app.get('/admin-test', authenticateAdmin, (req, res) => res.status(200).send('OK'));
      
      const response = await request(app).get('/admin-test');
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Unauthorized: Admin API key required');
    });

    test('authenticateAdmin should allow authorized requests', async () => {
      app.get('/admin-test', authenticateAdmin, (req, res) => res.status(200).send('OK'));
      
      const response = await request(app)
        .get('/admin-test')
        .set('x-admin-key', 'test-admin-key');
        
      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
    });

    test('authenticateCallback should block requests missing credentials', async () => {
      app.post('/callback-test', authenticateCallback, (req, res) => res.status(200).send('OK'));
      
      const response = await request(app).post('/callback-test').send({});
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Unauthorized: Hubtel authentication required');
    });

    test('authenticateCallback should allow requests with valid credentials', async () => {
      app.post('/callback-test', authenticateCallback, (req, res) => res.status(200).send('OK'));
      
      const response = await request(app)
        .post('/callback-test')
        .set('Authorization', 'Basic ' + Buffer.from('test-hubtel-key:').toString('base64'))
        .send({});
        
      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
    });
  });

  describe('Validation Middleware', () => {
    test('validatePaymentCallback should reject malformed payload', async () => {
      app.post('/validate-payment', validatePaymentCallback, (req, res) => res.status(200).send('OK'));
      
      const response = await request(app)
        .post('/validate-payment')
        .send({ SessionId: 'invalid-id' }); // Missing OrderInfo
        
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid payment callback data');
    });

    test('validatePaymentCallback should allow valid payload', async () => {
      app.post('/validate-payment', validatePaymentCallback, (req, res) => res.status(200).send('OK'));
      
      const response = await request(app)
        .post('/validate-payment')
        .send({
          SessionId: 'test-session',
          OrderId: 'test-order',
          OrderInfo: {
            CustomerMobileNumber: '233244123456',
            Payment: { IsSuccessful: true }
          }
        });
        
      expect(response.status).toBe(200);
    });

    test('validateAdminRequest should reject requests missing adminKey', async () => {
      app.post('/admin-action', validateAdminRequest, (req, res) => res.status(200).send('OK'));
      
      const response = await request(app)
        .post('/admin-action')
        .send({ action: 'reboot' });
        
      expect(response.status).toBe(400);
    });
  });
});
