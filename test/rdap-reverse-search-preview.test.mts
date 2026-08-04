import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRdapReverseSearchPreviews,
  MAX_RDAP_REVERSE_SEARCH_PREVIEWS,
} from '../frontend/src/lib/analysis/rdap-reverse-search-preview.ts';

const advertised = {
  reverseSearch: {
    state: 'advertised',
  },
};

test('reverse-search preview requires an advertised capability', () => {
  const parsed = {
    entitiesByRole: {
      registrar: [{ handle: 'REG-1', name: 'Example Registrar' }],
    },
  };
  assert.deepEqual(buildRdapReverseSearchPreviews(parsed, {}), []);
  assert.deepEqual(
    buildRdapReverseSearchPreviews(parsed, { reverseSearch: { state: 'unknown' } }),
    [],
  );
});

test('reverse-search preview exposes bounded exact disclosures without making a request', () => {
  const previews = buildRdapReverseSearchPreviews({
    entitiesByRole: {
      registrant: [{
        handle: 'ENTITY-123',
        name: 'Example Holder',
        names: ['Example Holder'],
        email: 'holder@example.test',
        emails: ['holder@example.test'],
      }],
    },
  }, advertised);
  assert.deepEqual(
    previews.map((preview) => preview.property),
    ['role', 'handle', 'fn', 'email'],
  );
  assert.equal(
    previews.find((preview) => preview.property === 'email')?.queryShape,
    '/domains/reverse_search/entity?email=holder%40example.test',
  );
  assert.match(
    previews.find((preview) => preview.property === 'handle')?.disclosure ?? '',
    /exact handle value “ENTITY-123”/u,
  );
});

test('reverse-search preview honors declared properties and global result bounds', () => {
  const previews = buildRdapReverseSearchPreviews({
    entitiesByRole: Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `role-${index}`,
        [{ handle: `HANDLE-${index}`, name: `Name ${index}` }],
      ]),
    ),
  }, {
    reverseSearch: {
      state: 'advertised',
      properties: ['handle', 'not-registered'],
    },
  });
  assert.equal(previews.length, MAX_RDAP_REVERSE_SEARCH_PREVIEWS);
  assert.ok(previews.every((preview) => preview.property === 'handle'));
});

test('reverse-search preview removes controls and deduplicates normalized values', () => {
  const previews = buildRdapReverseSearchPreviews({
    entitiesByRole: {
      technical: [{
        handle: 'ABC\u0000-1',
        name: ' Example   Name ',
        names: ['Example Name'],
      }],
    },
  }, advertised);
  assert.equal(previews.some((preview) => preview.value.includes('\u0000')), false);
  assert.equal(previews.filter((preview) => preview.property === 'fn').length, 1);
});
