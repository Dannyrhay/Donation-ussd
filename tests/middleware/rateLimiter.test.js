const request = require('supertest');
const express = require('express');
const { ussdLimiter, callbackLimiter } = require('../../src/middleware/rateLimiter');

/**
 * Regression: Hubtel relays every subscriber from the same gateway IP.
 * A per-IP limit blocked all customers ("Error:UUE" / "rate limited").
 */
function buildUssdApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/ussd', ussdLimiter, (req, res) => {
    res.json({ SessionId: req.body.SessionId, Type: 'Response', Message: 'ok' });
  });
  return app;
}

describe('ussdLimiter', () => {
  test('does not throttle many different subscribers sharing one Hubtel IP', async () => {
    const app = buildUssdApp();

    for (let i = 0; i < 150; i++) {
      const res = await request(app)
        .post('/api/ussd')
        .send({ SessionId: `s${i}`, Mobile: `23324${String(i).padStart(7, '0')}`, Type: 'Initiation' });

      expect(res.status).toBe(200);
      expect(res.body.Type).toBe('Response');
    }
  });

  test('throttles a single subscriber with a valid Hubtel Release payload', async () => {
    const app = buildUssdApp();
    const body = { SessionId: 'abuse', Mobile: '233200000001', Type: 'Response', Message: '1' };

    let last;
    for (let i = 0; i < 31; i++) {
      last = await request(app).post('/api/ussd').send(body);
    }

    expect(last.status).toBe(200);
    expect(last.body).toMatchObject({
      SessionId: 'abuse',
      Type: 'Release',
      DataType: 'display',
      ClientState: 'rate_limited'
    });
    expect(typeof last.body.Message).toBe('string');
  });
});

describe('callbackLimiter', () => {
  test('never throttles Hubtel webhook POSTs', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/callback', callbackLimiter, express.Router().post('/fulfilment', (req, res) => {
      res.json({ ResponseCode: '0000', Status: 'TXN_SUCCESS' });
    }));

    for (let i = 0; i < 250; i++) {
      const res = await request(app).post('/api/callback/fulfilment').send({ OrderId: `o${i}` });
      expect(res.status).toBe(200);
    }
  });
});
