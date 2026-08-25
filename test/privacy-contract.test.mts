import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  CASE_REPORT_SCHEMA_VERSION,
  CASE_RESPONSE_PACKET_VERSION,
  CASE_SCHEMA_VERSION,
  PUBLIC_CASE_RESPONSE_PACKET_VERSION,
  PUBLIC_CASE_SCHEMA_VERSION,
  PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  WORKSPACE_ARCHIVE_VERSION,
} from '../packages/contracts/case-portability.mts';
import {
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
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
  { id: 'date', pattern: /Last updated: 24 August 2026/u },
  { id: 'local-first', pattern: /local-first.*ordinary investigation state stays.*browser profile/iu },
  { id: 'no-general-database', pattern: /no general (?:user, )?Case,? or workspace database/iu },
  { id: 'explicit-network', pattern: /deliberately started network(?:-capable)? operation sends (?:only )?its declared bounded target or evidence/iu },
  { id: 'browser-plaintext', pattern: /IndexedDB as plaintext JSON/iu },
  { id: 'browser-delete', pattern: /Clearing site data removes the browser workspace/iu },
  { id: 'case-compatibility', pattern: new RegExp(`Case schema ${CASE_SCHEMA_VERSION}.*exact public Case schema ${PUBLIC_CASE_SCHEMA_VERSION} remains readable`, 'iu') },
  { id: 'case-report', pattern: new RegExp(`Case report v${CASE_REPORT_SCHEMA_VERSION} JSON and Markdown`, 'iu') },
  { id: 'public-case-pack', pattern: /Public CLI case packs clear identifiers, actions, observed-effect reviews,? and closure records/iu },
  { id: 'workspace-compatibility', pattern: new RegExp(`workspace archive version ${WORKSPACE_ARCHIVE_VERSION}.*exact version ${PUBLIC_WORKSPACE_ARCHIVE_VERSION} remains readable`, 'iu') },
  { id: 'unsupported-workspace', pattern: /Versions 1 through 4.*future versions fail without.*reset, deletion,? or rewrite/iu },
  { id: 'monitoring-custody', pattern: /scheduled monitoring.*application-encrypted.*Disabling collection (?:does not delete|also leaves)/iu },
  { id: 'monitoring-key-custody', pattern: /worker runtime receives the encryption key through its deployment environment/iu },
  { id: 'monitoring-physical-delete', pattern: /Deleting a scheduled watchlist.*does not delete the Blob object.*Physical object deletion.*deployment-operator/iu },
  { id: 'contact-minimisation', pattern: /Contact page.*Turnstile token.*does not send or retain/iu },
  { id: 'cli-local', pattern: /CLI runs on the operator's machine/iu },
  { id: 'active-mail-limit', pattern: /at most three selected MX hosts.*sends no message.*tests no relay, recipient, mailbox,? or catch-all/iu },
  { id: 'saved-lookup-sensitivity', pattern: /full saved Lookup.*raw RDAP publications.*WHOIS response bodies.*publicly published contacts/iu },
  { id: 'lookup-evidence-compatibility', pattern: new RegExp(`Lookup evidence schema ${LOOKUP_EVIDENCE_SCHEMA_VERSION}.*exact public schema ${PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION} remains readable`, 'iu') },
  { id: 'integrity-limits', pattern: /Checksums and signatures.*do not prove evidence accuracy, authorship, signer identity/iu },
  { id: 'capture-disclosure', pattern: /executes remote page JavaScript.*exact requested URL, including its path and query/iu },
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
    WORKSPACE_ARCHIVE_VERSION,
  ]);
  assert.equal(PUBLIC_CASE_RESPONSE_PACKET_VERSION, 6);
  assert.equal(CASE_RESPONSE_PACKET_VERSION, 7);
});
