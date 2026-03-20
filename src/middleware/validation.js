const { validate } = require('../utils/validation');

/**
 * Validation Middleware Factory
 * 
 * Creates a middleware that validates the request body against a schema.
 * 
 * @param {Object} schema - Zod schema to validate against
 * @returns {Function} Express middleware
 */
const validateBody = (schema) => (req, res, next) => {
  const result = validate(schema, req.body);

  if (!result.success) {
    console.warn(`[VALIDATION] Request to ${req.path} from IP: ${req.ip} failed validation: ${result.error}`);
    return res.status(400).json({
      success: false,
      error: 'Invalid request data',
      details: result.error
    });
  }

  // Update req.body with validated and parsed data
  req.body = result.data;
  next();
};

module.exports = {
  validateBody
};
