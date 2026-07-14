'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./lookup.mts');
exports.runUnifiedLookup = implementation.runUnifiedLookup;
exports.LOOKUP_DIAGNOSTICS_VERSION = implementation.LOOKUP_DIAGNOSTICS_VERSION;
exports.LOOKUP_ERROR_CODES = implementation.LOOKUP_ERROR_CODES;
