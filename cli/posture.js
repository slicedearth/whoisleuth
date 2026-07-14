'use strict';

// Stable CommonJS entry point retained while the CLI runner remains
// JavaScript during the incremental native TypeScript migration.
const posture = require('./posture.mts');

module.exports = posture;
