import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import fixtures from '../fixtures/rdap-registry-fixtures.mts';
import { parseRdap } from '../lib/rdap.mts';

function nestedHandle(parsed: Record<string, unknown>, key: string): unknown {
  const value = parsed[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).handle || null
    : null;
}

function lifecycleValue(parsed: Record<string, unknown>, key: string): unknown {
  const lifecycle = parsed.lifecycle;
  return lifecycle && typeof lifecycle === 'object' && !Array.isArray(lifecycle)
    ? (lifecycle as Record<string, unknown>)[key] || null
    : null;
}

function observed(parsed: Record<string, unknown>, key: string): unknown {
  if (key === 'registrarHandle') return nestedHandle(parsed, 'registrar');
  if (key === 'registrantHandle') return nestedHandle(parsed, 'registrant');
  if (key === 'orgHandle') return nestedHandle(parsed, 'org');
  if (key === 'abuseHandle') return nestedHandle(parsed, 'abuse');
  if (key === 'relatedLink') {
    const links = Array.isArray(parsed.links) ? parsed.links : [];
    const related = links.find((link) => (
      link && typeof link === 'object' && !Array.isArray(link)
      && (link as Record<string, unknown>).rel === 'related'
    ));
    return related && typeof related === 'object' && !Array.isArray(related)
      ? (related as Record<string, unknown>).href || null
      : null;
  }
  if (key === 'createdDate') return lifecycleValue(parsed, 'createdDate');
  if (key === 'updatedDate') return lifecycleValue(parsed, 'updatedDate');
  return parsed[key];
}

describe('RDAP registry compatibility fixtures', () => {
  for (const fixture of fixtures) {
    test(fixture.name, () => {
      const parsed = parseRdap(fixture.type, fixture.input);
      assert.ok(parsed, `${fixture.name}: parsed result`);
      for (const [key, expected] of Object.entries(fixture.expected)) {
        assert.deepEqual(observed(parsed, key), expected, `${fixture.name}: ${key}`);
      }
    });
  }
});
