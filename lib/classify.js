// Stable CommonJS entry point retained while backend modules migrate to
// Node's native erasable TypeScript support.
const { classifyQuery, MAX_ASN } = require('./classify.mts');

module.exports = { classifyQuery, MAX_ASN };
