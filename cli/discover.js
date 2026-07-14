'use strict';

const { CliUsageError } = require('./arguments');

const DEFAULT_DISCOVERY_TLDS = Object.freeze(['com', 'net', 'org']);
const MAX_DISCOVERY_TLD_TEXT_LENGTH = 1024;
const MAX_DISCOVERY_TLD_TOKENS_INSPECTED = 80;

function normalizeDiscoveryTlds(raw, maximum) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError('A valid discovery TLD limit is required.');
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_DISCOVERY_TLD_TEXT_LENGTH) {
    throw new CliUsageError(`--tlds must contain at most ${MAX_DISCOVERY_TLD_TEXT_LENGTH} characters.`);
  }
  const tokens = raw.split(/[;,\s]+/).filter(Boolean);
  if (!tokens.length) throw new CliUsageError('--tlds did not contain any values.');
  if (tokens.length > MAX_DISCOVERY_TLD_TOKENS_INSPECTED) {
    throw new CliUsageError(`--tlds may inspect at most ${MAX_DISCOVERY_TLD_TOKENS_INSPECTED} values.`);
  }
  const values = [];
  const seen = new Set();
  for (const token of tokens) {
    const value = token.toLowerCase().replace(/^\./, '');
    if (!/^[a-z]{2,63}$/.test(value)) throw new CliUsageError(`Invalid TLD "${token}".`);
    if (seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    if (values.length > maximum) throw new CliUsageError(`At most ${maximum} unique TLDs are supported.`);
  }
  return values;
}

module.exports = {
  DEFAULT_DISCOVERY_TLDS,
  MAX_DISCOVERY_TLD_TEXT_LENGTH,
  MAX_DISCOVERY_TLD_TOKENS_INSPECTED,
  normalizeDiscoveryTlds,
};
