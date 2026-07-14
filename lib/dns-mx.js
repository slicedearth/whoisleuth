// Stable CommonJS entry point retained while DNS consumers remain JavaScript
// during the incremental native TypeScript migration.
const dnsMx = require('./dns-mx.mts');

module.exports = dnsMx;
