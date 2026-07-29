// Reviewed provenance for the bounded synthetic registry fixtures and focused
// compatibility tests. Digests cover the exact tracked source files so a
// maintenance report can distinguish age from unreviewed file changes.

export const REGISTRY_FIXTURE_PROVENANCE_SCHEMA = 'whoisleuth.registry-fixture-provenance';
export const REGISTRY_FIXTURE_PROVENANCE_VERSION = 1;

export type RegistryFixtureProvenance = Readonly<{
  path: string;
  sourceDate: string;
  verifiedAt: string;
  sha256: string;
  sourceUrls: readonly string[];
  interpretation: string;
}>;

export const REGISTRY_FIXTURE_PROVENANCE: readonly RegistryFixtureProvenance[] = Object.freeze([
  Object.freeze({
    path: 'fixtures/whois-registry-fixtures.mts',
    sourceDate: '2026-07-28',
    verifiedAt: '2026-07-28',
    sha256: '35c4b46bd6cc7ee2d1944433f3116a29c7b867902a6ba4afa507a9770e79831d',
    sourceUrls: Object.freeze([
      'https://www.iana.org/domains/root/db',
    ]),
    interpretation: 'Synthetic WHOIS layouts were reviewed against the capability catalogue and authoritative registry-access references. The digest does not establish current live-registry behavior.',
  }),
  Object.freeze({
    path: 'fixtures/rdap-registry-fixtures.mts',
    sourceDate: '2026-07-28',
    verifiedAt: '2026-07-28',
    sha256: 'daf31318abadf087584d4c3f04ed92b6cc9c94f8ac43bbdf82fd44badd0361bc',
    sourceUrls: Object.freeze([
      'https://www.rfc-editor.org/rfc/rfc9083',
      'https://www.iana.org/assignments/rdap-json-values/rdap-json-values.xhtml',
    ]),
    interpretation: 'Synthetic RDAP objects exercise bounded normalized domain, network, and autonomous-system shapes. The digest does not establish publication or completeness for a particular registry.',
  }),
  Object.freeze({
    path: 'test/whois-gt-fallback.test.mts',
    sourceDate: '2026-07-28',
    verifiedAt: '2026-07-28',
    sha256: '76c70d99ed682557c21ad861b06f727cf46b73568b99c52a79d0bcd39ee7fa39',
    sourceUrls: Object.freeze([
      'https://www.iana.org/domains/root/db/gt.html',
    ]),
    interpretation: 'The focused synthetic fallback test verifies the bounded official-web response contract without retaining or replaying live registration data.',
  }),
]);
