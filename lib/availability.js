'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./availability.mts');
exports.checkDomainAvailability = implementation.checkDomainAvailability;
exports.checkDnsDelegation = implementation.checkDnsDelegation;
exports.fetchHomepage = implementation.fetchHomepage;
exports.deriveWebsiteActivity = implementation.deriveWebsiteActivity;
exports.forSaleRedirectSignal = implementation.forSaleRedirectSignal;
exports.parseWhoisDate = implementation.parseWhoisDate;
