'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./whois.mts');
exports.buildWhoisChain = implementation.buildWhoisChain;
exports.parseWhoisChain = implementation.parseWhoisChain;
exports.analyzeWhoisChainAuthority = implementation.analyzeWhoisChainAuthority;
exports.whoisQuery = implementation.whoisQuery;
exports.queryWhoisAddress = implementation.queryWhoisAddress;
exports.buildWhoisChainUncached = implementation.buildWhoisChainUncached;
exports.fetchGtRegistryWhois = implementation.fetchGtRegistryWhois;
