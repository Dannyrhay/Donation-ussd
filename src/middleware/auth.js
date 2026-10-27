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
 * Log a warning only once per process (avoids flooding logs on every request)
 */
const warnedOnce = new Set();
function warnOnce(key, message) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
}

/**
 * Admin Authentication Middleware
 *
 * Protects administrative endpoints using:
 * 1. Authorization: Bearer <token>
 * 2. X-Admin-Key header
 *
 * Query-string keys (?adminKey=) are NOT accepted — URLs end up in proxy and access logs.
 */
const adminAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const apiKey = req.headers['x-admin-key'] || bearerToken;

  const validKey = process.env.ADMIN_TOKEN || process.env.ADMIN_API_KEY;

  // Fail closed: never fall back to a hardcoded key
  if (!validKey) {
    console.error('[AUTH] ADMIN_TOKEN / ADMIN_API_KEY not set — admin endpoints disabled');
    return res.status(503).json({
      success: false,
      error: 'Admin access not configured'
    });
  }

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
    warnOnce('callback', 'WARNING: CALLBACK_SECRET not set. Callback endpoints are currently insecure.');
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
 * Hubtel USSD Authentication Middleware
 *
 * Without this, anyone can POST to /api/ussd with any Mobile and act as that
 * customer (e.g. cancel their subscription). Enable by setting USSD_SECRET and
 * configuring the Hubtel Service Interaction URL as /api/ussd?secret=<USSD_SECRET>.
 * Must run BEFORE ussdLimiter so spoofed traffic can't burn a real customer's quota.
 */
const ussdAuth = (req, res, next) => {
  // Only the POST endpoint drives sessions; GET is a harmless info page
  if (req.method !== 'POST') return next();

  const expectedSecret = process.env.USSD_SECRET;

  if (!expectedSecret) {
    warnOnce('ussd', 'WARNING: USSD_SECRET not set. /api/ussd accepts requests from anyone.');
    return next();
  }

  if (!timingSafeEqual(req.query.secret, expectedSecret)) {
    console.error(`[AUTH] Unauthorized USSD request from IP: ${req.ip}`);
    return res.status(401).json({
      success: false,
      message: 'Unauthorized'
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
  ussdAuth,
  auditLog
};
