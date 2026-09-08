// The configuration loader uses CommonJS while the preloaded server runs
// native ESM. Keep the hook in that loader's format and share the actual
// diagnostic contract with the server; there is no second guard policy here.
const report = require('./browser-server-egress-report.mts') as typeof import('./browser-server-egress-report.mts');

module.exports = report.default;
