'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./safe-fetch.mts');
exports.MAX_REDIRECTS = implementation.MAX_REDIRECTS;
exports.MAX_SAFE_FETCH_URL_LENGTH = implementation.MAX_SAFE_FETCH_URL_LENGTH;
exports.safeFetch = implementation.safeFetch;
exports.safeFetchDetailed = implementation.safeFetchDetailed;
exports.readTextCapped = implementation.readTextCapped;
exports.readBytesCapped = implementation.readBytesCapped;
exports.isPrivateAddress = implementation.isPrivateAddress;
exports.resolvePublicAddresses = implementation.resolvePublicAddresses;
