/**
 * Logger utility for log sanitization and consistent formatting.
 * Prevents accidental logging of PII (phone numbers) and sensitive tokens.
 */

const SENSITIVE_KEYS = [
  'adminKey', 'apiKey', 'apiSecret', 'password', 'token', 
  'clientSecret', 'secret', 'authorization', 'cookie'
];

/**
 * Sanitize a phone number by masking middle digits
 * E.g., 233244123456 -> 23324****456
 */
function sanitizePhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') return phoneNumber;
  if (phoneNumber.length < 7) return phoneNumber;
  return `${phoneNumber.slice(0, 5)}****${phoneNumber.slice(-3)}`;
}

/**
 * Recursively sanitize an object
 */
function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = Array.isArray(obj) ? [] : {};

  for (const [key, value] of Object.entries(obj)) {
    // Redact sensitive keys
    if (SENSITIVE_KEYS.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    } 
    // Sanitize phone number keys
    else if (['phoneNumber', 'mobileNumber', 'customerMobileNumber', 'msisdn', 'phone'].some(pk => key.toLowerCase().includes(pk))) {
      sanitized[key] = sanitizePhoneNumber(value);
    }
    // Recursive call for nested objects
    else if (value && typeof value === 'object') {
      sanitized[key] = sanitize(value);
    } 
    // Default value
    else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Log an object with sanitization
 */
function logInfo(message, data) {
  if (data) {
    console.log(message, JSON.stringify(sanitize(data), null, 2));
  } else {
    console.log(message);
  }
}

module.exports = {
  sanitize,
  sanitizePhoneNumber,
  logInfo
};
