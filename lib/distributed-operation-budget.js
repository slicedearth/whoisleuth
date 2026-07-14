'use strict';

// Stable CommonJS entry point retained for existing backend and test consumers.
const implementation = require('./distributed-operation-budget.mts');
exports.DEFAULT_NAMESPACE = implementation.DEFAULT_NAMESPACE;
exports.DEFAULT_LEASE_TTL_MS = implementation.DEFAULT_LEASE_TTL_MS;
exports.PROVIDER_RETRY_AFTER_SECONDS = implementation.PROVIDER_RETRY_AFTER_SECONDS;
exports.DAY_WINDOW_MS = implementation.DAY_WINDOW_MS;
exports.THIRTY_DAY_WINDOW_MS = implementation.THIRTY_DAY_WINDOW_MS;
exports.ACQUIRE_SCRIPT = implementation.ACQUIRE_SCRIPT;
exports.ACQUIRE_WITH_USAGE_SCRIPT = implementation.ACQUIRE_WITH_USAGE_SCRIPT;
exports.RELEASE_SCRIPT = implementation.RELEASE_SCRIPT;
exports.STATUS_SCRIPT = implementation.STATUS_SCRIPT;
exports.normalizedRestUrl = implementation.normalizedRestUrl;
exports.normalizedToken = implementation.normalizedToken;
exports.normalizedNamespace = implementation.normalizedNamespace;
exports.normalizedLimits = implementation.normalizedLimits;
exports.normalizedUsageLimits = implementation.normalizedUsageLimits;
exports.normalizedOperationFeature = implementation.normalizedOperationFeature;
exports.createRestCommandClient = implementation.createRestCommandClient;
exports.createDistributedOperationBudget = implementation.createDistributedOperationBudget;
