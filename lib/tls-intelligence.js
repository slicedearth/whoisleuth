'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./tls-intelligence.mts');
exports.TLS_PROFILE_VERSION = implementation.TLS_PROFILE_VERSION;
exports.TLS_TIMEOUT_MS = implementation.TLS_TIMEOUT_MS;
exports.MAX_RESOLVED_ADDRESSES = implementation.MAX_RESOLVED_ADDRESSES;
exports.MAX_CHAIN_CERTIFICATES = implementation.MAX_CHAIN_CERTIFICATES;
exports.MAX_ALT_NAMES = implementation.MAX_ALT_NAMES;
exports.normalizeTlsHostname = implementation.normalizeTlsHostname;
exports.normalizePublicAddressRecords = implementation.normalizePublicAddressRecords;
exports.normalizeAltNames = implementation.normalizeAltNames;
exports.buildTlsObservation = implementation.buildTlsObservation;
exports.failedTlsObservation = implementation.failedTlsObservation;
exports.skippedTlsObservation = implementation.skippedTlsObservation;
exports.collectTlsIntelligence = implementation.collectTlsIntelligence;
