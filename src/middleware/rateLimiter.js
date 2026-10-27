const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * IMPORTANT: Hubtel relays ALL USSD sessions and webhooks from a small pool of
 * gateway IPs. Never apply a per-IP limiter to Hubtel traffic — every customer
 * would share one bucket and Hubtel shows "Error:UUE" once it fills.
 */

/**
 * Fallback limiter for unmatched routes (scanners / 404 noise)
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // 100 requests per window per IP
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * USSD Endpoint Rate Limiter
 *
 * Keyed per subscriber (Mobile), not per IP, so one customer can't starve the rest.
 * Requires body parsing to run first. When limited, replies with a valid Hubtel
 * USSD payload (HTTP 200) so the customer sees a message instead of "Error:UUE".
 */
const ussdLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 30, // 30 USSD steps per subscriber per minute (a full session is ~5)
  keyGenerator: (req) => {
    const mobile = req.body && req.body.Mobile;
    return mobile ? `ussd:${String(mobile)}` : ipKeyGenerator(req.ip);
  },
  handler: (req, res) => {
    console.warn(`[RATE LIMIT] USSD limit hit for ${req.body && req.body.Mobile ? 'subscriber' : 'IP ' + req.ip}`);
    res.status(200).json({
      SessionId: req.body && req.body.SessionId,
      Type: 'Release',
      Message: 'Too many requests. Please wait a minute and dial again.',
      Label: 'Busy',
      DataType: 'display',
      FieldType: 'text',
      ClientState: 'rate_limited'
    });
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Admin Endpoint Rate Limiter (Stricter)
 */
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 50, // 50 requests per window
  message: {
    success: false,
    error: 'Too many admin requests'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Hubtel webhook paths (relative to /api/callback). These are authenticated by
 * CALLBACK_SECRET and must never be throttled — a 429 on /fulfilment risks
 * Hubtel reversing the payment.
 */
const HUBTEL_WEBHOOK_PATHS = ['/payment', '/recurring', '/fulfilment'];

/**
 * Callback Router Rate Limiter — only throttles the admin GET views under /api/callback
 */
const callbackLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 200, // 200 requests per minute
  skip: (req) => req.method === 'POST' && HUBTEL_WEBHOOK_PATHS.includes(req.path),
  message: {
    success: false,
    error: 'Too many callback requests'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  generalLimiter,
  ussdLimiter,
  adminLimiter,
  callbackLimiter
};
