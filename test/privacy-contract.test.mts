import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  CASE_REPORT_SCHEMA_VERSION,
  CASE_RESPONSE_PACKET_VERSION,
  CASE_SCHEMA_VERSION,
  PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION,
  PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION,
  PUBLIC_CASE_RESPONSE_PACKET_VERSION,
  PUBLIC_CASE_SCHEMA_VERSION,
  PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  WORKSPACE_ARCHIVE_VERSION,
} from '../packages/contracts/case-portability.mts';
import {
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
} from '../lib/evidence-export.mts';

const ROOT_NOTICE_URL = new URL('../PRIVACY.md', import.meta.url);
const PUBLIC_NOTICE_URL = new URL('../frontend/src/routes/(public)/privacy/+page.svelte', import.meta.url);
const DISCLOSURE_URL = new URL('../DISCLOSURE', import.meta.url);

type PrivacyFact = Readonly<{
  id: string;
  pattern: RegExp;
}>;

function compact(value: string): string {
  return value.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
}

const SHARED_PRIVACY_FACTS: readonly PrivacyFact[] = Object.freeze([
  { id: 'date', pattern: /Last updated: 4 September 2026/u },
  { id: 'local-first', pattern: /local-first.*ordinary investigation state stays.*browser profile/iu },
  { id: 'no-general-database', pattern: /no general (?:user, )?Case,? or workspace database/iu },
  { id: 'explicit-network', pattern: /deliberately started network(?:-capable)? operation sends (?:only )?its declared bounded target or evidence/iu },
  { id: 'single-bulk-network', pattern: /Single and Bulk lookups send the selected target/iu },
  { id: 'browser-plaintext', pattern: /IndexedDB as plaintext JSON/iu },
  { id: 'browser-delete', pattern: /Clearing site data removes the browser workspace/iu },
  { id: 'case-compatibility', pattern: new RegExp(`Case schema ${CASE_SCHEMA_VERSION}.*exact public v1 Case schema ${PUBLIC_CASE_SCHEMA_VERSION} remain(?:s)? readable`, 'iu') },
  { id: 'case-report', pattern: new RegExp(`Case report v${CASE_REPORT_SCHEMA_VERSION} JSON and Markdown`, 'iu') },
  { id: 'case-incident-links', pattern: /Case can (?:also )?retain controlled classifications and exact HTTP\(S\) incident links.*browser-local Case metadata/iu },
  { id: 'public-case-pack', pattern: /Public CLI case packs clear identifiers, actions, observed-effect reviews,? and closure records/iu },
  { id: 'workspace-compatibility', pattern: new RegExp(`workspace archive version ${WORKSPACE_ARCHIVE_VERSION}.*exact versions ${PUBLIC_WORKSPACE_ARCHIVE_VERSION} and ${PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION} remain readable`, 'iu') },
  { id: 'unsupported-workspace', pattern: /Versions 1 through 4.*future versions fail without.*reset, deletion,? or rewrite/iu },
  { id: 'monitoring-custody', pattern: /scheduled monitoring.*application-encrypted.*Disabling collection (?:does not delete|also leaves)/iu },
  { id: 'monitoring-key-custody', pattern: /worker runtime receives the encryption key through its deployment environment/iu },
  { id: 'monitoring-physical-delete', pattern: /Deleting a scheduled watchlist.*does not delete the Blob object.*Physical object deletion.*deployment-operator/iu },
  { id: 'contact-minimisation', pattern: /Contact page.*Turnstile token.*does not send or retain/iu },
  { id: 'cli-local', pattern: /CLI runs on the operator's machine/iu },
  { id: 'active-mail-limit', pattern: /at most three selected MX hosts.*sends no message.*tests no relay, recipient, mailbox,? or catch-all/iu },
  { id: 'saved-lookup-sensitivity', pattern: /full saved Lookup.*raw RDAP publications.*WHOIS response bodies.*publicly published contacts/iu },
  { id: 'export-review', pattern: /full saved Lookup.*Review every file before sharing/iu },
  { id: 'download-deletion', pattern: /Deleting browser data does not delete separately downloaded files/iu },
  { id: 'direct-dns-records', pattern: /query A, AAAA, CAA,? and MX once through one selected\s+public address per nameserver/iu },
  { id: 'direct-dns-retention', pattern: /retaining at most sixteen normalised values\s+for each record type/iu },
  { id: 'lookup-evidence-compatibility', pattern: new RegExp(`Lookup evidence schema ${LOOKUP_EVIDENCE_SCHEMA_VERSION}.*published v2 schema ${PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION}.*v1 schema ${V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION} remain readable`, 'iu') },
  { id: 'registrar-standing-network', pattern: /Registrar standing is matched locally using only the numeric IANA ID.*Lookup makes no additional IANA or ICANN request/iu },
  { id: 'integrity-limits', pattern: /Checksums and signatures.*do not prove evidence accuracy, authorship, signer identity/iu },
  { id: 'capture-disclosure', pattern: /executes remote page JavaScript.*exact requested URL, including its path and query/iu },
  { id: 'capture-manifest-import', pattern: /capture manifest.*imports only sanitised manifest metadata and.*digests.*artefact bytes stay outside WHOISleuth/iu },
  { id: 'platform-reporting-navigation', pattern: /Opening an official (?:platform reporting|provider) route is deliberate external navigation.*does not prefetch.*or submit Case data/iu },
  { id: 'no-automatic-action', pattern: /does not automatically submit reports, contact recipients, acquire domains, apply.*controls,? or change.*infrastructure/iu },
  { id: 'non-inference', pattern: /Missing, blocked, stale, malformed, partial, unavailable,? or unsupported evidence never becomes absence, safety, ownership, control, intent,? or remediation/iu },
]);

test('public privacy notices share the current material data-handling contract', async () => {
  const [rootNotice, publicNotice, disclosure] = await Promise.all([
    readFile(ROOT_NOTICE_URL, 'utf8'),
    readFile(PUBLIC_NOTICE_URL, 'utf8'),
    readFile(DISCLOSURE_URL, 'utf8'),
  ]);

  for (const [label, notice] of [['PRIVACY.md', rootNotice], ['/privacy', publicNotice]] as const) {
    const normalised = compact(notice);
    for (const fact of SHARED_PRIVACY_FACTS) {
      assert.match(normalised, fact.pattern, `${label} omits privacy fact ${fact.id}`);
    }
  }

  const normalisedDisclosure = compact(disclosure);
  assert.match(normalisedDisclosure, /Hosted and distributable collection does not .*execute remote page scripts/iu);
  assert.match(normalisedDisclosure, /separate repo-local rendered-capture package is an explicit authorised exception/iu);
  assert.match(normalisedDisclosure, /executes page JavaScript in a disposable, network-bounded browser/iu);

  assert.deepEqual([...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS], [
    PUBLIC_WORKSPACE_ARCHIVE_VERSION,
    PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION,
    WORKSPACE_ARCHIVE_VERSION,
  ]);
  assert.equal(PUBLIC_CASE_RESPONSE_PACKET_VERSION, 6);
  assert.equal(PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION, 7);
  assert.equal(CASE_RESPONSE_PACKET_VERSION, 8);
});
