/**
 * Pagination & query helpers for admin list endpoints.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Parse ?limit & ?skip safely: integers only, capped, never NaN or negative.
 */
function parsePagination(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const rawLimit = parseInt(query.limit, 10);
  const rawSkip = parseInt(query.skip, 10);

  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const skip = Number.isFinite(rawSkip) && rawSkip > 0 ? rawSkip : 0;

  return { limit, skip };
}

/**
 * Escape user input before using it in a MongoDB $regex (prevents regex injection / ReDoS).
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  parsePagination,
  escapeRegex,
  MAX_LIMIT
};
