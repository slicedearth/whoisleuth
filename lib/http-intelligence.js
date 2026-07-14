'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./http-intelligence.mts');
exports.MAX_HTTP_PROVENANCE_URL = implementation.MAX_HTTP_PROVENANCE_URL;
exports.MAX_HTTP_REDIRECTS = implementation.MAX_HTTP_REDIRECTS;
exports.MAX_HTTP_ATTEMPTS = implementation.MAX_HTTP_ATTEMPTS;
exports.normalizeProvenanceUrl = implementation.normalizeProvenanceUrl;
exports.buildHttpObservation = implementation.buildHttpObservation;
exports.failedHttpObservation = implementation.failedHttpObservation;
exports.skippedHttpObservation = implementation.skippedHttpObservation;
