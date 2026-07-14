'use strict';

// Stable CommonJS entry point retained while the CLI process boundary remains
// JavaScript during the incremental native TypeScript migration.
const errors = require('./errors.mts');

module.exports = errors;
