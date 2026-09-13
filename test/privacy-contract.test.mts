import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  CASE_REPORT_SCHEMA_VERSION,
  CASE_SCHEMA_VERSION,
  LATEST_PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  PUBLISHED_V2_2_CASE_RESPONSE_PACKET_VERSION,
  PUBLISHED_V2_3_CASE_RESPONSE_PACKET_VERSION,
  PUBLISHED_V2_3_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_2_WORKSPACE_ARCHIVE_VERSION,
  PUBLISHED_V2_CASE_SCHEMA_VERSION,
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
  LATEST_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
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
  { id: 'local-case-files', pattern: /offline \u0060?case\u0060? command creates and updates ordinary local Case files only through explicit output.*private analyst content and file references, not attached file bytes.*locks contain only a local process ID.*Case files are unencrypted unless packaged separately with encryption/iu },
  { id: 'date', pattern: /Last updated: \d{1,2} [A-Z][a-z]+ \d{4}/u },
  { id: 'local-first', pattern: /local-first.*ordinary investigation state stays.*browser profile/iu },
  { id: 'no-general-database', pattern: /no general (?:user, )?Case,? or workspace database/iu },
  { id: 'explicit-network', pattern: /deliberately started network(?:-capable)? operation sends (?:only )?its declared bounded target or evidence/iu },
  { id: 'single-bulk-network', pattern: /Single and Bulk lookups send the selected target/iu },
  { id: 'lookup-progress-custody', pattern: /Deep Lookup may stream source-state summaries before its final response.*make no additional requests and are not saved as partial evidence/iu },
  { id: 'lookup-url-minimisation', pattern: /By default, for a URL pasted into Lookup, the browser sends only its full hostname for collection, without the port, path, query or fragment/iu },
  { id: 'lookup-selected-url', pattern: /selected URL.*Deep Lookup sends the path and query in a request body to the application server.*Fragments are not sent.*provenance omits queries.*page-derived text may contain sensitive information/iu },
  { id: 'lookup-url-credentials', pattern: /Credential-bearing URLs are rejected/iu },
  { id: 'lookup-observation-scope', pattern: /Registration queries use the registrable domain.*Deep DNS, TLS and web probes use the selected hostname.*registration-delegation checks retain their own domain/iu },
  { id: 'browser-plaintext', pattern: /IndexedDB as plaintext JSON/iu },
  { id: 'named-workspace-isolation', pattern: /Named workspaces use separate IndexedDB databases.*local directory of random identifiers, names and timestamps.*share the browser profile and storage quota.*names alone do not provide access control.*default workspace keeps existing data unchanged/iu },
  { id: 'encrypted-working-workspace', pattern: /encrypted named workspaces protect saved collection values and record identifiers using AES-256-GCM.*keyed collection integrity.*key is held only in the unlocked document, never stored or sent.*another tab unlocks independently/iu },
  { id: 'encrypted-workspace-limits', pattern: /Names, collection counts, sizes and timestamps remain visible.*does not protect an unlocked page.*deletion or rollback to an older valid database.*no passphrase reset.*original unencrypted data remains until explicitly deleted/iu },
  { id: 'named-workspace-retention', pattern: /Each tab selects its workspace.*guide progress, candidate handoffs and named-workspace Brand preferences are scoped.*Backups and imports use the explicitly selected workspace, excluding the directory and tab state.*Deleting an inactive named workspace removes its saved collections, not other workspaces or downloaded files.*Clearing site data removes all workspaces/iu },
  { id: 'posture-source-retention', pattern: /Saved settings reviews also retain source times, completeness, the profile identifier and a digest of its collection settings/iu },
  { id: 'browser-delete', pattern: /Clearing site data removes the browser workspace/iu },
  { id: 'case-compatibility', pattern: new RegExp(`Case schema ${CASE_SCHEMA_VERSION}.*exact public v1 Case schema ${PUBLIC_CASE_SCHEMA_VERSION}.*published-v2 schemas ${PUBLISHED_V2_CASE_SCHEMA_VERSION}–${PUBLISHED_V2_3_CASE_SCHEMA_VERSION} remain readable`, 'iu') },
  { id: 'unknown-source-time', pattern: /Pins and sightings with unknown observation times retain null; saving them does not create a source observation time/iu },
  { id: 'case-report', pattern: new RegExp(`Case report v${CASE_REPORT_SCHEMA_VERSION} JSON and Markdown`, 'iu') },
  { id: 'case-incident-links', pattern: /Case can (?:also )?retain controlled classifications and exact HTTP\(S\) incident links.*browser-local Case metadata/iu },
  { id: 'case-incident-title-privacy', pattern: /Separate incident Cases can share a domain.*own IDs, titles and decisions.*ordinary Case exports, reports, workspace archives and internal CLI packs.*trusted and public CLI packs exclude them/iu },
  { id: 'case-observation-reuse', pattern: /Reusing a selected observation copies only that evidence with its original timestamps, not the source Case's notes or decisions/iu },
  { id: 'case-review-copy', pattern: /Review copies are ordinary full Case exports, not redacted or encrypted.*Returned-file previews stay in page memory/iu },
  { id: 'case-review-return', pattern: /handoff entry containing the file digest and selected-record-key digest.*(?:No upload occurs|Nothing is uploaded).*file identity does not authenticate the reviewer.*(?:conflicts|Conflicting entries).*response authorisations.*unselected records are not imported/iu },
  { id: 'public-case-pack', pattern: /Public CLI case packs clear identifiers, actions, observed-effect reviews,? and closure records/iu },
  { id: 'workspace-compatibility', pattern: new RegExp(`workspace archive version ${WORKSPACE_ARCHIVE_VERSION}.*exact versions ${SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.filter(version => version !== WORKSPACE_ARCHIVE_VERSION).join(',? (?:and )?')} remain readable`, 'iu') },
  { id: 'saved-case-views', pattern: /Saved Case views retain names, search text, status, disposition and sort choices.*current workspace.*Workspace backups include them; response packets do not.*without making network requests/iu },
  { id: 'saved-review-position', pattern: /Saved review positions retain filters, search text, selected Review Item and Case references, evidence fingerprints, unfinished review forms and save time.*current workspace.*encryption when enabled.*Saving is explicit.*excluded from backups, exports and legacy rollback copies.*Resume re-evaluates current records without collection or submission.*Discarding a position removes its saved review-form copies.*Cases and currently open forms are unchanged/iu },
  { id: 'unsupported-workspace', pattern: /Versions 1 through 4.*future versions fail without.*reset, deletion,? or rewrite/iu },
  { id: 'monitoring-custody', pattern: /scheduled monitoring.*application-encrypted.*Disabling collection (?:does not delete|also leaves)/iu },
  { id: 'monitoring-key-custody', pattern: /worker runtime receives the encryption key through its deployment environment/iu },
  { id: 'monitoring-physical-delete', pattern: /Deleting a scheduled watchlist.*does not delete the Blob object.*Physical object deletion.*deployment-operator/iu },
  { id: 'contact-minimisation', pattern: /Contact page.*Turnstile token.*does not send or retain/iu },
  { id: 'cli-local', pattern: /CLI runs on the operator's machine/iu },
  { id: 'signer-trust-file', pattern: /signer trust file is read only when explicitly selected.*public-key fingerprints, labels and review notes, not private keys.*only the matching entry and the file digest, without its path or other entries.*not uploaded, discovered automatically or changed by verification/iu },
  { id: 'workflow-file-locks', pattern: /Workflow-file output uses adjacent private lock files containing a local process ID.*removed after the run.*interruption can leave one for manual recovery/iu },
  { id: 'portable-file-packages', pattern: /Portable evidence packages process selected JSON, screenshots and opaque files locally.*unchanged and unredacted.*original filenames and paths are not retained.*Unknown source times remain unknown.*review uploads nothing, executes no file and changes no saved records.*separate import preview and confirmation/iu },
  { id: 'encrypted-file-packages', pattern: /Ordinary ZIPs and evidence folders are unencrypted.*whole manifest and files with AES-256-GCM and PBKDF2-SHA-256 \(600,000 iterations\).*Passphrases and keys are not saved or sent.*authenticates the container before checking its ZIP and file identities.*does not establish who created the package.*Downloading an unlocked entry produces its original, unencrypted bytes/iu },
  { id: 'independent-backup-encryption', pattern: /File-backup groups have their own optional package encryption; encrypting the JSON does not encrypt those groups/iu },
  { id: 'workflow-evidence-reuse', pattern: /Workflow checkpoints retain selected paths, step evidence, content digests and explicit input bindings.*Reused evidence stays local without extraction files/iu },
  { id: 'active-mail-limit', pattern: /at most three selected MX hosts.*sends no message.*tests no relay, recipient, mailbox,? or catch-all/iu },
  { id: 'saved-lookup-sensitivity', pattern: /full saved Lookup.*raw RDAP publications.*WHOIS response bodies.*publicly published contacts/iu },
  { id: 'export-review', pattern: /full saved Lookup.*Review every file before sharing/iu },
  { id: 'calendar-export-minimisation', pattern: /selected Case follow-up calendar.*stable Case reference by default.*domains, recipients, Case types.*event details.*separate opt-ins/iu },
  { id: 'download-deletion', pattern: /Deleting browser data does not delete separately downloaded files/iu },
  { id: 'direct-dns-records', pattern: /query A, AAAA, CAA,? and MX once through one selected\s+public address per nameserver/iu },
  { id: 'direct-dns-retention', pattern: /retaining at most sixteen normalised values\s+for each record type/iu },
  { id: 'lookup-evidence-compatibility', pattern: new RegExp(`Lookup evidence schema ${LOOKUP_EVIDENCE_SCHEMA_VERSION}.*published v2 schemas ${PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION} and ${LATEST_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION}.*v1 schema ${V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION} remain readable`, 'iu') },
  { id: 'selected-pin-hostnames', pattern: /Explicitly selected evidence pins can include their own observation hostname in response packets.*distinct from the Case's registration domain/iu },
  { id: 'registrar-standing-network', pattern: /Registrar standing is matched locally using only the numeric IANA ID.*Lookup makes no additional IANA or ICANN request/iu },
  { id: 'integrity-limits', pattern: /Checksums and signatures.*do not prove evidence accuracy, authorship, signer identity/iu },
  { id: 'capture-disclosure', pattern: /executes remote page JavaScript.*exact requested URL, including its path and query/iu },
  { id: 'capture-manifest-import', pattern: /capture manifest.*imports only sanitised (?:manifest )?metadata and declared digests.*check and the file bytes are not saved by the Case metadata import/iu },
  { id: 'capture-attachment-check', pattern: /separate optional attachment selection reads and checks screenshot and DOM-digest bytes in page memory,? without uploading them/iu },
  { id: 'retained-originals', pattern: /Retained files require a separate explicit save.*stored unchanged in the current workspace, using its encryption when enabled.*filenames, declared sources and observation times, retention times, byte counts and digests; filesystem paths are not stored.*sensitive content that ordinary Case metadata excludes.*No file is uploaded automatically/iu },
  { id: 'retained-file-export-deletion', pattern: /Public and trusted CLI Case packs exclude these references.*JSON backups contain references only, not original bytes.*Removing a reference deletes its bytes only when no other Case in the workspace references them/iu },
  { id: 'capture-file-retention', pattern: /Case metadata import by default.*explicit retention option saves the manifest and matching original files with the Case in one transaction.*Unmatched files are excluded/iu },
  { id: 'workflow-review-confirmation', pattern: /Per-step review confirmations are recorded for the current invocation only.*retained checkpoints do not authorise a later network or human-review step/iu },
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
  const dates = [rootNotice, publicNotice].map((notice) => /Last updated: (\d{1,2} [A-Z][a-z]+ \d{4})/u.exec(notice)?.[1]);
  assert.ok(dates[0]);
  assert.equal(dates[0], dates[1], 'Both public privacy notices must describe the same revision.');
  const date = new Date(`${dates[0]} 00:00:00 UTC`);
  assert.equal(Number.isFinite(date.getTime()), true);
  assert.equal(new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date), dates[0]);
  assert.match(normalisedDisclosure, /Hosted and distributable collection does not .*execute remote page scripts/iu);
  assert.match(normalisedDisclosure, /separate repo-local rendered-capture package is an explicit authorised exception/iu);
  assert.match(normalisedDisclosure, /executes page JavaScript in a disposable, network-bounded browser/iu);

  assert.deepEqual([...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS], [
    PUBLIC_WORKSPACE_ARCHIVE_VERSION,
    PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION,
    PUBLISHED_V2_2_WORKSPACE_ARCHIVE_VERSION,
    LATEST_PUBLIC_WORKSPACE_ARCHIVE_VERSION,
    WORKSPACE_ARCHIVE_VERSION,
  ]);
  assert.equal(PUBLIC_CASE_RESPONSE_PACKET_VERSION, 6);
  assert.equal(PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION, 7);
  assert.equal(PUBLISHED_V2_2_CASE_RESPONSE_PACKET_VERSION, 8);
  assert.equal(PUBLISHED_V2_3_CASE_RESPONSE_PACKET_VERSION, 9);
});
