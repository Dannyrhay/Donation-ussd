const { z } = require('zod');

/**
 * Hubtel Payment Callback Schema (One-time payments)
 */
const paymentCallbackSchema = z.object({
  SessionId: z.string().optional(),
  OrderId: z.string().optional(),
  ResponseCode: z.string().optional(),
  Status: z.string().optional(),
  // Nested objects use .passthrough(): Zod strips unknown keys by default and
  // validateBody replaces req.body, which silently deleted OrderInfo.CustomerName
  OrderInfo: z.object({
    CustomerMobileNumber: z.string().optional(),
    CustomerName: z.string().optional(),
    Payment: z.object({
      IsSuccessful: z.boolean().optional()
    }).passthrough().optional(),
    Status: z.string().optional()
  }).passthrough().optional(),
  Data: z.object({
    ResponseCode: z.string().optional(),
    Status: z.string().optional()
  }).optional()
}).passthrough(); // Allow unknown fields for flexibility with Hubtel API updates

/**
 * Hubtel Recurring Invoice Callback Schema
 */
const recurringCallbackSchema = z.object({
  ResponseCode: z.string(),
  Message: z.string().optional(),
  Data: z.object({
    RecurringInvoiceId: z.string(),
    TransactionId: z.string().optional(),
    ClientReference: z.string().optional(),
    Amount: z.number().optional(),
    CustomerMobileNumber: z.string().optional()
  }).optional()
}).passthrough();

/**
 * Hubtel Fulfilment Callback Schema
 */
const fulfilmentCallbackSchema = z.object({
  SessionId: z.string().optional(),
  OrderId: z.string().optional(),
  ServiceStatus: z.string().optional()
}).passthrough();

/**
 * Helper to validate data against a schema and return results
 */
const validate = (schema, data) => {
  try {
    const validatedData = schema.parse(data);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { 
        success: false, 
        // Zod v4 exposes .issues (.errors was removed — it threw a TypeError → 500)
        error: error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') 
      };
    }
    return { success: false, error: error.message };
  }
};

module.exports = {
  paymentCallbackSchema,
  recurringCallbackSchema,
  fulfilmentCallbackSchema,
  validate
};
