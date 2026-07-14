'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./dns-intelligence.mts');
exports.collectDnsIntelligence = implementation.collectDnsIntelligence;
exports.skippedDnsIntelligence = implementation.skippedDnsIntelligence;
exports.normalizeAddresses = implementation.normalizeAddresses;
exports.normalizeHostnames = implementation.normalizeHostnames;
exports.normalizeMx = implementation.normalizeMx;
exports.normalizeTxtPolicies = implementation.normalizeTxtPolicies;
exports.normalizeCaa = implementation.normalizeCaa;
