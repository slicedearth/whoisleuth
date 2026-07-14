'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./domain-posture.mts');
exports.normalizeAuditDomain = implementation.normalizeAuditDomain;
exports.normalizeDkimSelectors = implementation.normalizeDkimSelectors;
exports.matchesMtaPattern = implementation.matchesMtaPattern;
exports.buildPostureReport = implementation.buildPostureReport;
exports.checkDomainPosture = implementation.checkDomainPosture;
