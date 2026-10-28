const request = require('supertest');
const express = require('express');
const { adminAuth, callbackAuth, ussdAuth } = require('../src/middleware/auth');
const { validateBody } = require('../src/middleware/validation');
const { paymentCallbackSchema, recurringCallbackSchema } = require('../src/utils/validation');
const { parsePagination, escapeRegex } = require('../src/utils/pagination');

const ENV_KEYS = ['ADMIN_TOKEN', 'ADMIN_API_KEY', 'CALLBACK_SECRET', 'USSD_SECRET'];

describe('Security Middleware Tests', () => {
  let app;
  let savedEnv;

  beforeEach(() => {
    savedEnv = {};
    ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; delete process.env[k]; });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
    jest.restoreAllMocks();
  });

  describe('adminAuth', () => {
    beforeEach(() => {
      app.get('/admin-test', adminAuth, (req, res) => res.status(200).send('OK'));
    });

    test('fails closed (503) when no admin key is configured — no hardcoded fallback', async () => {
      const res = await request(app).get('/admin-test').set('x-admin-key', 'admin_secret_token_123');
      expect(res.status).toBe(503);
    });

    test('rejects missing or wrong key with 401', async () => {
      process.env.ADMIN_TOKEN = 'test-admin-key';

      expect((await request(app).get('/admin-test')).status).toBe(401);
      expect((await request(app).get('/admin-test').set('x-admin-key', 'nope')).status).toBe(401);
    });

    test('accepts X-Admin-Key header', async () => {
      process.env.ADMIN_TOKEN = 'test-admin-key';
      const res = await request(app).get('/admin-test').set('x-admin-key', 'test-admin-key');
      expect(res.status).toBe(200);
      expect(res.text).toBe('OK');
    });

    test('accepts Authorization: Bearer token', async () => {
      process.env.ADMIN_API_KEY = 'test-admin-key';
      const res = await request(app).get('/admin-test').set('Authorization', 'Bearer test-admin-key');
      expect(res.status).toBe(200);
    });

    test('rejects key passed in the query string (leaks into logs)', async () => {
      process.env.ADMIN_TOKEN = 'test-admin-key';
      const res = await request(app).get('/admin-test?adminKey=test-admin-key');
      expect(res.status).toBe(401);
    });
  });

  describe('callbackAuth', () => {
    beforeEach(() => {
      app.post('/callback-test', callbackAuth, (req, res) => res.status(200).send('OK'));
    });

    test('allows requests when CALLBACK_SECRET is unset (backwards compatible)', async () => {
      expect((await request(app).post('/callback-test').send({})).status).toBe(200);
    });

    test('blocks wrong or missing secret when configured', async () => {
      process.env.CALLBACK_SECRET = 's3cret';
      expect((await request(app).post('/callback-test').send({})).status).toBe(401);
      expect((await request(app).post('/callback-test?secret=bad').send({})).status).toBe(401);
    });

    test('allows correct secret', async () => {
      process.env.CALLBACK_SECRET = 's3cret';
      expect((await request(app).post('/callback-test?secret=s3cret').send({})).status).toBe(200);
    });
  });

  describe('ussdAuth', () => {
    beforeEach(() => {
      app.get('/ussd', ussdAuth, (req, res) => res.status(200).send('INFO'));
      app.post('/ussd', ussdAuth, (req, res) => res.status(200).send('OK'));
    });

    test('allows requests when USSD_SECRET is unset (backwards compatible)', async () => {
      expect((await request(app).post('/ussd').send({ Mobile: '233244000000' })).status).toBe(200);
    });

    test('blocks spoofed POSTs without the secret when configured', async () => {
      process.env.USSD_SECRET = 'u55d';
      expect((await request(app).post('/ussd').send({ Mobile: '233244000000' })).status).toBe(401);
      expect((await request(app).post('/ussd?secret=wrong').send({})).status).toBe(401);
    });

    test('allows Hubtel POSTs with the secret, and GET info page without it', async () => {
      process.env.USSD_SECRET = 'u55d';
      expect((await request(app).post('/ussd?secret=u55d').send({})).status).toBe(200);
      expect((await request(app).get('/ussd')).status).toBe(200);
    });
  });

  describe('validateBody', () => {
    test('rejects malformed recurring callback with 400 and details', async () => {
      app.post('/validate', validateBody(recurringCallbackSchema), (req, res) => res.status(200).send('OK'));

      const res = await request(app).post('/validate').send({ Data: { RecurringInvoiceId: 123 } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid request data');
      expect(res.body.details).toEqual(expect.stringContaining('ResponseCode'));
    });

    test('allows valid payment callback and keeps unknown Hubtel fields', async () => {
      app.post('/validate', validateBody(paymentCallbackSchema), (req, res) => res.status(200).json(req.body));

      const res = await request(app)
        .post('/validate')
        .send({
          SessionId: 'test-session',
          OrderId: 'test-order',
          OrderInfo: { CustomerMobileNumber: '233244123456', Payment: { IsSuccessful: true } },
          ExtraField: 'kept'
        });

      expect(res.status).toBe(200);
      expect(res.body.ExtraField).toBe('kept');
    });
  });

  describe('paymentCallbackSchema', () => {
    test('keeps OrderInfo.CustomerName and other nested Hubtel fields (regression: were stripped)', async () => {
      app.post('/validate', validateBody(paymentCallbackSchema), (req, res) => res.status(200).json(req.body));

      const res = await request(app)
        .post('/validate')
        .send({
          SessionId: 's',
          OrderInfo: {
            CustomerMobileNumber: '233244123456',
            CustomerName: 'Ama Mensah',
            CustomerEmail: 'ama@example.com',
            Payment: { IsSuccessful: true, AmountPaid: 5 }
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.OrderInfo.CustomerName).toBe('Ama Mensah');
      expect(res.body.OrderInfo.CustomerEmail).toBe('ama@example.com');
      expect(res.body.OrderInfo.Payment.AmountPaid).toBe(5);
    });
  });

  describe('pagination helpers', () => {
    test('caps limit and rejects junk', () => {
      expect(parsePagination({ limit: '9999999' })).toEqual({ limit: 500, skip: 0 });
      expect(parsePagination({ limit: 'abc', skip: '-5' })).toEqual({ limit: 100, skip: 0 });
      expect(parsePagination({ limit: '20', skip: '40' })).toEqual({ limit: 20, skip: 40 });
    });

    test('escapeRegex neutralises regex metacharacters', () => {
      const pattern = new RegExp(escapeRegex('(a+)+$'));
      expect(pattern.test('(a+)+$')).toBe(true);
      expect(pattern.test('aaaa')).toBe(false);
    });
  });
});
