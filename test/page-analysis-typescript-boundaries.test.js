const test = require('node:test');
const assert = require('node:assert/strict');

test('page-analysis CommonJS entry points resolve to their typed implementations', () => {
  assert.strictEqual(
    require('../lib/domain-posture-parsers').parseDmarcRecords,
    require('../lib/domain-posture-parsers.mts').parseDmarcRecords,
  );
  assert.strictEqual(
    require('../lib/perceptual-hash').faviconPerceptualHash,
    require('../lib/perceptual-hash.mts').faviconPerceptualHash,
  );
  assert.strictEqual(
    require('../lib/page-fingerprints').createPageFingerprints,
    require('../lib/page-fingerprints.mts').createPageFingerprints,
  );
  assert.strictEqual(
    require('../lib/html-signals').extractHtmlSignals,
    require('../lib/html-signals.mts').extractHtmlSignals,
  );
  assert.strictEqual(
    require('../lib/favicon').fetchFaviconHash,
    require('../lib/favicon.mts').fetchFaviconHash,
  );
});
