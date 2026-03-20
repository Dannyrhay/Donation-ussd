const crypto = require('crypto');

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Admin Authentication Middleware
 * 
 * Protects administrative endpoints using:
 * 1. Authorization: Bearer <token>
 * 2. X-Admin-Key header
 * 3. adminKey query parameter
 */
const adminAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.split(' ')[1];
  const apiKey = req.headers['x-admin-key'] || req.query.adminKey || bearerToken;

  const validKey = process.env.ADMIN_TOKEN || process.env.ADMIN_API_KEY || 'admin_secret_token_123';

  if (!apiKey || !timingSafeEqual(apiKey, validKey)) {
    console.warn(`[AUTH] Unauthorized admin access attempt from IP: ${req.ip}`);
    return res.status(401).json({
      success: false,
      error: 'Unauthorized access. Valid ADMIN_TOKEN or X-Admin-Key required.'
    });
  }

  next();
};

/**
 * Hubtel Callback Authentication Middleware
 */
const callbackAuth = (req, res, next) => {
  const providedSecret = req.query.secret;
  const expectedSecret = process.env.CALLBACK_SECRET;

  if (!expectedSecret) {
    console.warn('WARNING: CALLBACK_SECRET not set. Callback endpoints are currently insecure.');
    return next();
  }

  if (!providedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    console.error(`[AUTH] Unauthorized callback attempt from IP: ${req.ip}`);
    return res.status(401).json({
      success: false,
      message: 'Unauthorized callback connection'
    });
  }

  next();
};

/**
 * Simple Audit Logging Middleware
 */
const auditLog = (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[AUDIT] ${timestamp} - ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
};

module.exports = {
  adminAuth,
  callbackAuth,
  auditLog
};
