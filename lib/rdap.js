'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./rdap.mts');
exports.BOOTSTRAP_TTL_MS = implementation.BOOTSTRAP_TTL_MS;
exports.BOOTSTRAP_STALE_TTL_MS = implementation.BOOTSTRAP_STALE_TTL_MS;
exports.fetchBootstrap = implementation.fetchBootstrap;
exports.clearRdapBootstrapCache = implementation.clearRdapBootstrapCache;
exports.fetchRdapRecord = implementation.fetchRdapRecord;
exports.fetchRdapFromBases = implementation.fetchRdapFromBases;
exports.fetchRegistrarRdapRecord = implementation.fetchRegistrarRdapRecord;
exports.selectRegistrarRdapLink = implementation.selectRegistrarRdapLink;
exports.uniqueBases = implementation.uniqueBases;
exports.parseRdap = implementation.parseRdap;
exports.normalizeRdapEvents = implementation.normalizeRdapEvents;
exports.summarizeLifecycle = implementation.summarizeLifecycle;
