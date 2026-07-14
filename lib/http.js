// Stable CommonJS entry point retained while backend modules migrate to
// Node's native erasable TypeScript support.
const { json } = require('./http.mts');

module.exports = { json };
