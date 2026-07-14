// Stable CommonJS entry point retained while the Express server remains
// JavaScript during the incremental native TypeScript migration.
const rateLimit = require('./rate-limit.mts');

module.exports = rateLimit;
