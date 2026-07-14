// Stable CommonJS entry point retained while registry consumers remain
// JavaScript during the incremental native TypeScript migration.
const lookupCache = require('./lookup-cache.mts');

module.exports = lookupCache;
