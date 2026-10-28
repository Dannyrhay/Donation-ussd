/**
 * Convert Prisma records into plain objects the rest of the app expects.
 *
 * - Decimal columns (money) are stored exactly in Postgres; JS code and Hubtel
 *   payloads work with Numbers, so they're converted at this boundary.
 * - `_id` mirrors `id` so admin API responses keep the shape they had under
 *   MongoDB (any dashboard reading `_id` keeps working).
 */

function isDecimal(value) {
  return value !== null && typeof value === 'object' && typeof value.toNumber === 'function';
}

function toPlain(record) {
  if (record === null || record === undefined) return record;
  if (Array.isArray(record)) return record.map(toPlain);
  if (typeof record !== 'object' || record instanceof Date) return record;

  const plain = {};
  for (const [key, value] of Object.entries(record)) {
    if (isDecimal(value)) {
      plain[key] = value.toNumber();
    } else if (value && typeof value === 'object' && !(value instanceof Date) && (key === 'donor' || key === 'subscription' || Array.isArray(value))) {
      // Nested relations (include: { donor: true }, etc.)
      plain[key] = toPlain(value);
    } else {
      plain[key] = value;
    }
  }

  if (plain.id !== undefined && plain._id === undefined) {
    plain._id = plain.id;
  }

  return plain;
}

module.exports = { toPlain };
