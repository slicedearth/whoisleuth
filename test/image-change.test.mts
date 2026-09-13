import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareImagePixels, IMAGE_CHANGE_GRID_AXIS } from '../packages/comparison/image-change.mts';
import { compareObservationContexts, readCaptureConditions } from '../packages/comparison/capture-context.mts';

function image(width = 4, height = 3) { const pixels = new Uint8Array(width * height * 4); for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255; return { width, height, pixels }; }
const context = { observedAt: '2026-09-13T00:00:00.000Z', observerLabel: 'analyst-a', vantageLabel: 'declared-egress-a', conditions: {
  browser: 'chromium', browserVersion: '151.0.0.0', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, locale: 'en-US', timezone: 'UTC', colourScheme: 'light' as const,
} };

test('pixel comparison finds exact changed coordinates and never merges them into a risk score', () => {
  const left = image(), right = image(); right.pixels[(1 * 4 + 2) * 4] = 255;
  const result = compareImagePixels(left, right);
  assert.equal(result.state, 'different'); assert.equal(result.changedPixels, 1); assert.equal(result.comparedPixels, 12);
  assert.deepEqual(result.tiles, [{ x: 2, y: 1, width: 1, height: 1, changedPixels: 1, comparedPixels: 1 }]);
  assert.equal(result.changedPercent, 100 / 12); assert.ok(!('risk' in result));
  assert.equal(compareImagePixels(left, image()).state, 'same_pixels');
});
test('overlapping exclusions form a union; excluding everything is not image equality', () => {
  const left = image(), right = image(); right.pixels[0] = 255;
  const result = compareImagePixels(left, right, [{ kind: 'redact', x: 0, y: 0, width: 2, height: 2 }, { kind: 'redact', x: 1, y: 1, width: 2, height: 2 }]);
  assert.equal(result.excludedPixels, 7); assert.equal(result.comparedPixels, 5); assert.equal(result.changedPixels, 0);
  const all = compareImagePixels(left, right, [{ kind: 'redact', x: 0, y: 0, width: 4, height: 3 }]);
  assert.equal(all.state, 'all_excluded'); assert.equal(all.changedPercent, null);
});
test('dimensions remain incompatible without silently resizing either source', () => {
  const result = compareImagePixels(image(), image(3, 4));
  assert.equal(result.state, 'dimensions_differ'); assert.equal(result.changedPercent, null); assert.equal(result.comparedPixels, 0);
});
test('transparent hidden colours do not become visible differences', () => {
  const left = image(1, 1), right = image(1, 1); left.pixels.fill(0); right.pixels.set([255, 90, 7, 0]);
  assert.equal(compareImagePixels(left, right).state, 'same_pixels');
  right.pixels[3] = 255; assert.equal(compareImagePixels(left, right).state, 'different');
});
test('grid grouping retains every changed pixel including edge tiles', () => {
  const left = image(65, 49), right = image(65, 49); right.pixels.fill(255);
  const result = compareImagePixels(left, right);
  assert.ok(result.tiles.length <= IMAGE_CHANGE_GRID_AXIS ** 2);
  assert.equal(result.tiles.reduce((sum, tile) => sum + tile.changedPixels, 0), 65 * 49);
  assert.equal(result.changedPixels, 65 * 49); assert.equal(result.changedPercent, 100);
  assert.ok(result.tiles.every(tile => tile.x + tile.width <= 65 && tile.y + tile.height <= 49));
});
test('pixels and masks are admitted before comparison without silent clipping', () => {
  const source = image();
  for (const value of [{ ...source, width: 10001 }, { ...source, pixels: new Uint8Array(1) }, { ...source, pixels: new Uint8Array(new SharedArrayBuffer(48)) }]) assert.throws(() => compareImagePixels(value, source), TypeError);
  for (const mask of [{ kind: 'redact', x: 3, y: 0, width: 2, height: 1 }, { kind: 'redact', x: 0.5, y: 0, width: 1, height: 1 }, { kind: 'outline', x: 0, y: 0, width: 1, height: 1 }]) assert.throws(() => compareImagePixels(source, source, [mask as never]), TypeError);
  assert.throws(() => compareImagePixels(source, source, Array.from({ length: 65 }, () => ({ kind: 'redact', x: 0, y: 0, width: 1, height: 1 }))), TypeError);
});
test('missing and different capture conditions stay separate from verified independence', () => {
  assert.equal(readCaptureConditions(undefined), null);
  const equal = compareObservationContexts([context, context]);
  assert.equal(equal.time.state, 'same_instant'); assert.equal(equal.labels, 'repeated'); assert.equal(equal.independence, 'not_verified');
  const distinct = compareObservationContexts([context, { ...context, observedAt: '2026-09-13T02:00:00.000Z', vantageLabel: 'declared-egress-b', conditions: { ...context.conditions, locale: 'en-AU' } }]);
  assert.equal(distinct.labels, 'distinct'); assert.equal(distinct.independence, 'not_verified'); assert.equal(distinct.time.spanMilliseconds, 7_200_000);
  assert.equal(distinct.rows.find(row => row.id === 'locale')?.state, 'different');
  const unknown = compareObservationContexts([context, { observedAt: null, observerLabel: null, vantageLabel: null }]);
  assert.equal(unknown.time.state, 'unknown'); assert.equal(unknown.time.spanMilliseconds, null); assert.equal(unknown.labels, 'incomplete');
  assert.ok(unknown.rows.every(row => row.state === 'unknown'));
});
test('context readers reject unsupported fields, malformed times and unbounded conditions', () => {
  assert.throws(() => readCaptureConditions({ ...context.conditions, extra: true }), TypeError);
  assert.throws(() => readCaptureConditions({ ...context.conditions, deviceScaleFactor: Infinity }), TypeError);
  assert.throws(() => readCaptureConditions({ ...context.conditions, viewport: { width: 10000, height: 10000 } }), TypeError);
  assert.throws(() => compareObservationContexts([context, { ...context, observedAt: '2026-09-13' }]), TypeError);
  assert.throws(() => compareObservationContexts([context, { ...context, vantageLabel: 'x'.repeat(81) }]), TypeError);
});
