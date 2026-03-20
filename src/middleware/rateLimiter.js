const rateLimit = require('express-rate-limit');

/**
 * General API Rate Limiter
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    success: false,
    error: 'Too many requests, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * USSD Endpoint Rate Limiter (Higher limit for Hubtel)
 */
const ussdLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    success: false,
    error: 'Too many USSD requests'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Admin Endpoint Rate Limiter (Stricter)
 */
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  message: {
    success: false,
    error: 'Too many admin requests'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Callback Endpoint Rate Limiter (Higher for Hubtel webhooks)
 */
const callbackLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute
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
