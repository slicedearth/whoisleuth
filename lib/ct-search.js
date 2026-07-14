'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./ct-search.mts');
exports.searchCertificateTransparency = implementation.searchCertificateTransparency;
exports.summarizeCtResults = implementation.summarizeCtResults;
