// Covers the null-MX classification boundary: a domain
// that explicitly declares "I accept no mail" via a single root-target MX
// record (RFC 7505) was previously counted the same as a domain with a real
// mail server, incorrectly contributing to the phishing-risk score. Tests
// the pure classifyMxRecords() function directly against synthetic record
// arrays - no network access or DNS mocking needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyMxRecords } = require('../lib/dns-mx');
const typedDnsMx = require('../lib/dns-mx.mts');

test('retains the CommonJS MX entry point over the typed implementation', () => {
  assert.strictEqual(classifyMxRecords, typedDnsMx.classifyMxRecords);
});

test('a null MX record (root target, no trailing dot) is not counted as mail configured', () => {
  const result = classifyMxRecords([{ exchange: '', priority: 0 }]);
  assert.equal(result.hasMx, false);
  assert.equal(result.hasNullMx, true);
  assert.deepEqual(result.mxHosts, []);
});

test('a null MX record (literal ".") is not counted as mail configured', () => {
  const result = classifyMxRecords([{ exchange: '.', priority: 0 }]);
  assert.equal(result.hasMx, false);
  assert.equal(result.hasNullMx, true);
  assert.deepEqual(result.mxHosts, []);
});

test('a real MX record is counted as mail configured', () => {
  const result = classifyMxRecords([{ exchange: 'mail.example.test', priority: 10 }]);
  assert.equal(result.hasMx, true);
  assert.equal(result.hasNullMx, false);
  assert.deepEqual(result.mxHosts, ['mail.example.test']);
});

test('multiple real MX records are all counted', () => {
  const result = classifyMxRecords([
    { exchange: 'mx1.example.test', priority: 10 },
    { exchange: 'mx2.example.test', priority: 20 },
  ]);
  assert.equal(result.hasMx, true);
  assert.equal(result.hasNullMx, false);
  assert.deepEqual(result.mxHosts, ['mx1.example.test', 'mx2.example.test']);
});

test('no MX records at all is neither hasMx nor hasNullMx', () => {
  const result = classifyMxRecords([]);
  assert.equal(result.hasMx, false);
  assert.equal(result.hasNullMx, false);
  assert.deepEqual(result.mxHosts, []);
});
