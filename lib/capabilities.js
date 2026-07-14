// Stable CommonJS entry point retained while the Express server remains
// JavaScript during the incremental native TypeScript migration.
const capabilities = require('./capabilities.mts');

module.exports = capabilities;
