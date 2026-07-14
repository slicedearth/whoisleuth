// Stable CommonJS entry point retained while the Express server remains
// JavaScript during the incremental native TypeScript migration.
const auth = require('./auth.mts');

module.exports = auth;
