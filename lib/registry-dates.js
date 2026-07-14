// Stable CommonJS entry point retained while registry consumers remain
// JavaScript during the incremental native TypeScript migration.
const registryDates = require('./registry-dates.mts');

module.exports = registryDates;
