import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  CASE_REPORT_SCHEMA_VERSION,
  CASE_SCHEMA_VERSION,
  LATEST_PUBLIC_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_3_WORKSPACE_ARCHIVE_VERSION,
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
const PUBLIC_NOTICE_URL = new URL(
  '../frontend/src/routes/(public)/privacy/+page.svelte',
  import.meta.url,
);
const DISCLOSURE_URL = new URL('../DISCLOSURE', import.meta.url);

type PrivacyFact = Readonly<{
  id: string;
  clauses: readonly RegExp[];
}>;

function compact(value: string): string {
  return value
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const SHARED_PRIVACY_FACTS: readonly PrivacyFact[] = Object.freeze([
  {
    id: 'lesson-template-provenance',
    clauses: [
      /Lesson-based template revisions retain authored guidance, applicability, reason, source-template identity and content hashes of the source template and selected lesson/iu,
      /do not copy the Case identity or note text automatically/iu,
      /template, manual-playbook and workspace exports/iu,
      /hashes can correlate the same lesson across exports and are not anonymisation/iu,
    ],
  },
  {
    id: 'offline-message-intake',
    clauses: [
      /Message intake processes selected text, email, calendar, still PNG, PDF, DOCX and HAR files locally, without opening links or executing attachments/iu,
      /Exact URLs remain in the temporary review/iu,
      /summaries omit paths, queries, fragments, message bodies, subjects and address local parts/iu,
      /Selecting a destination fills Lookup without starting collection/iu,
      /retaining the unredacted original requires a separate choice/iu,
      /do not establish account compromise/iu,
    ],
  },
  {
    id: 'document-and-har-intake',
    clauses: [
      /Document review retains source and part digests, page references/iu,
      /Passwords are not requested or retained/iu,
      /HAR review retains request sequence, origins, method and MIME categories, status and reported timings/iu,
      /excludes headers, cookies, bodies, usernames and private URL components/iu,
      /does not replay requests/iu,
    ],
  },
  {
    id: 'identity-event-minimisation',
    clauses: [
      /Identity-event review reads selected JSON exports locally/iu,
      /application and resource-tenant identifiers/iu,
      /file-local actor labels/iu,
      /Usernames, raw actor identifiers, IP addresses, tokens, session identifiers and provider error text are excluded/iu,
      /analyst-selected field and time scope/iu,
      /does not establish account compromise/iu,
      /No provider API is contacted/iu,
    ],
  },
  {
    id: 'authentication-source-trust',
    clauses: [
      /Authentication review also retains the message-part and header positions/iu,
      /restricted service identifiers/iu,
      /domain-only evaluated properties/iu,
      /receiver trust explicitly selected by the analyst/iu,
      /trust is not inherited between parts or inferred from a service name/iu,
    ],
  },
  {
    id: 'explicit-dns-inheritance',
    clauses: [
      /Inherited DMARC and direct parent delegation are off by default/iu,
      /separate settings-review checkbox or CLI/iu,
      /--include-inherited-dns/iu,
      /32 additional TXT questions within ten seconds/iu,
      /reporting-destination boundaries and authorisation/iu,
      /one parent NS question/iu,
      /at most two parent servers/iu,
      /registration-domain NS question over pinned public-address DNS\/TCP/iu,
      /No mail is sent/iu,
      /not reporting addresses/iu,
      /checkbox is not saved/iu,
      /ordinary Lookup, Bulk and monitoring do not enable these requests/iu,
    ],
  },
  {
    id: 'current-rdap-discovery',
    clauses: [
      /RDAP follows current IANA bootstrap discovery even when a retained catalogue records no service/iu,
      /newly published endpoint may receive the selected registration query within existing request budgets/iu,
      /WHOIS access restrictions remain enforced/iu,
      /missing discovery is not evidence of domain absence/iu,
    ],
  },
  {
    id: 'login-counter-scope',
    clauses: [
      /Login burst controls retain bounded in-memory counters keyed by IPv4 address or IPv6 \/64 for five-minute windows/iu,
      /local to each runtime instance/iu,
    ],
  },
  {
    id: 'capture-network-lifetime',
    clauses: [
      /Only the pinned collector may contact resource operators/iu,
      /browser-lifetime deny-only proxy refuses direct connections, including teardown attempts, without retaining their destinations or content/iu,
      /Refused attempts leave the capture partial/iu,
      /Speculative DNS and direct QUIC are disabled/iu,
    ],
  },
  {
    id: 'local-application-storage',
    clauses: [
      /local application stores saved collections, recovery drafts and retained original files/iu,
      /explicitly selected filesystem workspace, not IndexedDB/iu,
      /plaintext at rest/iu,
      /Encrypted portable backups remain separate/iu,
      /authenticated loopback process/iu,
      /folder is displayed locally and is not included in exports/iu,
    ],
  },
  {
    id: 'local-application-delete',
    clauses: [
      /Appearance preferences and tab state remain browser-local/iu,
      /Clearing site data or signing out does not delete the filesystem workspace/iu,
      /Stop every application instance/iu,
      /Unsupported future workspace formats are preserved without writing/iu,
    ],
  },
  {
    id: 'local-application-requests',
    clauses: [
      /private launch link grants a local session/iu,
      /Starting the application makes no collection request/iu,
      /Explicit collection runs from this machine/iu,
      /--offline/iu,
      /disables collection/iu,
    ],
  },
  {
    id: 'bagit-local-files',
    clauses: [
      /BagIt exports include unchanged selected files and source declarations/iu,
      /unencrypted ZIP or new folder/iu,
      /review reads only selected local files/iu,
      /fetch.txt locations are never requested/iu,
      /File paths and fetch locations are omitted from review reports/iu,
      /Checksums do not establish source identity, trusted time or factual accuracy/iu,
      /No file is imported or executed/iu,
      /files remain until deliberately deleted/iu,
    ],
  },
  {
    id: 'workspace-replacement',
    clauses: [
      /encrypted replacement copies saved collections, recovery drafts and referenced original files/iu,
      /separately chosen passphrase/iu,
      /without changing the source/iu,
      /missing files and changed records prevent a complete verification/iu,
      /encrypted original still accepts its old passphrase/iu,
      /not an independent backup/iu,
    ],
  },
  {
    id: 'workspace-idle-lock',
    clauses: [
      /Optional idle locking is off by default/iu,
      /minute setting stays in workspace-scoped session storage for this tab/iu,
      /no investigation data/iu,
      /keeping saved encrypted drafts but discarding other unsaved page state/iu,
      /Cancelling a leave-page prompt keeps the tab unlocked/iu,
      /Suspended browser execution can delay an automatic lock/iu,
    ],
  },
  {
    id: 'case-handoff',
    clauses: [
      /Encrypted Case handoffs include one full private Case and explicitly selected original bytes/iu,
      /unfinished forms, authentication state and other Cases are excluded/iu,
      /does not import file bytes, status, actions, authorisations or closures/iu,
    ],
  },
  {
    id: 'case-practice',
    clauses: [
      /Case-form practice keeps edits and unfinished forms only in page memory/iu,
      /Restarting, reloading or leaving discards them/iu,
      /does not open the saved-work database, export practice files or expose collection and reporting controls/iu,
    ],
  },
  {
    id: 'local-case-files',
    clauses: [
      /offline \u0060?case\u0060? command creates and updates ordinary local Case files only through explicit output/iu,
      /private analyst content and file references, not attached file bytes/iu,
      /locks contain only a local process ID/iu,
      /Case files are unencrypted unless packaged separately with encryption/iu,
    ],
  },
  { id: 'date', clauses: [/Last updated: \d{1,2} [A-Z][a-z]+ \d{4}/u] },
  {
    id: 'local-first',
    clauses: [/local-first/iu, /ordinary investigation state stays/iu, /browser profile/iu],
  },
  { id: 'no-general-database', clauses: [/no general (?:user, )?Case,? or workspace database/iu] },
  {
    id: 'explicit-network',
    clauses: [
      /deliberately started network(?:-capable)? operation sends (?:only )?its declared bounded target or evidence/iu,
    ],
  },
  { id: 'single-bulk-network', clauses: [/Single and Bulk lookups send the selected target/iu] },
  {
    id: 'lookup-progress-custody',
    clauses: [
      /Deep Lookup may stream source-state summaries before its final response/iu,
      /make no additional requests and are not saved as partial evidence/iu,
    ],
  },
  {
    id: 'lookup-url-minimisation',
    clauses: [
      /By default, for a URL pasted into Lookup, the browser sends only its full hostname for collection, without the port, path, query or fragment/iu,
    ],
  },
  {
    id: 'lookup-selected-url',
    clauses: [
      /selected URL/iu,
      /Deep Lookup sends the path and query in a request body to the application server/iu,
      /Fragments are not sent/iu,
      /provenance omits queries/iu,
      /page-derived text may contain sensitive information/iu,
    ],
  },
  { id: 'lookup-url-credentials', clauses: [/Credential-bearing URLs are rejected/iu] },
  {
    id: 'lookup-observation-scope',
    clauses: [
      /Registration queries use the registrable domain/iu,
      /Deep DNS, TLS and web probes use the selected hostname/iu,
      /registration-delegation checks retain their own domain/iu,
    ],
  },
  { id: 'browser-plaintext', clauses: [/IndexedDB as plaintext JSON/iu] },
  {
    id: 'named-workspace-isolation',
    clauses: [
      /Named workspaces use separate IndexedDB databases/iu,
      /local directory of random identifiers, names and timestamps/iu,
      /share the browser profile and storage quota/iu,
      /names alone do not provide access control/iu,
      /default workspace keeps existing data unchanged/iu,
    ],
  },
  {
    id: 'encrypted-working-workspace',
    clauses: [
      /encrypted named workspaces protect saved collection values and record identifiers using AES-256-GCM/iu,
      /keyed collection integrity/iu,
      /key is held only in the unlocked document, never stored or sent/iu,
      /another tab unlocks independently/iu,
    ],
  },
  {
    id: 'encrypted-workspace-limits',
    clauses: [
      /Names, collection counts, sizes and timestamps remain visible/iu,
      /does not protect an unlocked page/iu,
      /deletion or rollback to an older valid database/iu,
      /no passphrase reset/iu,
      /original unencrypted data remains until explicitly deleted/iu,
    ],
  },
  {
    id: 'named-workspace-retention',
    clauses: [
      /Each tab selects its workspace/iu,
      /guide progress, candidate handoffs and named-workspace Brand preferences are scoped/iu,
      /Backups and imports use the explicitly selected workspace, excluding the directory and tab state/iu,
      /Deleting an inactive named workspace removes its saved collections, not other workspaces or downloaded files/iu,
      /Clearing site data removes all workspaces/iu,
    ],
  },
  {
    id: 'posture-source-retention',
    clauses: [
      /Saved settings reviews also retain source times, completeness, the profile identifier and a digest of its collection settings/iu,
    ],
  },
  { id: 'browser-delete', clauses: [/Clearing site data removes the browser workspace/iu] },
  {
    id: 'case-compatibility',
    clauses: [
      new RegExp(`Case schema ${CASE_SCHEMA_VERSION}`, 'iu'),
      new RegExp(`exact public v1 Case schema ${PUBLIC_CASE_SCHEMA_VERSION}`, 'iu'),
      new RegExp(
        `published-v2 schemas ${PUBLISHED_V2_CASE_SCHEMA_VERSION}–${LATEST_PUBLIC_CASE_SCHEMA_VERSION} remain readable`,
        'iu',
      ),
    ],
  },
  {
    id: 'case-requested-evidence',
    clauses: [
      /Provider evidence requests retain the original submitted-packet digest/iu,
      /Amendments link to those request events without rewriting the original packet/iu,
      /browser-local until exported; public Case packs exclude them/iu,
    ],
  },
  {
    id: 'case-evidence-relationships',
    clauses: [
      /Analyst-declared evidence relationships retain pin identities, their basis and any withdrawal reason/iu,
      /without assuming independent corroboration/iu,
      /public Case packs exclude them/iu,
    ],
  },
  {
    id: 'managed-indicator-files',
    clauses: [
      /Managed indicator revisions are selected files, not a browser-local collection/iu,
      /Previewing or revising them makes no requests/iu,
      /not submitted or applied automatically/iu,
      /Content digests do not authenticate authors/iu,
    ],
  },
  {
    id: 'unknown-source-time',
    clauses: [
      /Pins and sightings with unknown observation times retain null; saving them does not create a source observation time/iu,
    ],
  },
  {
    id: 'case-report',
    clauses: [new RegExp(`Case report v${CASE_REPORT_SCHEMA_VERSION} JSON and Markdown`, 'iu')],
  },
  {
    id: 'case-incident-links',
    clauses: [
      /Case can (?:also )?retain controlled classifications and exact HTTP\(S\) incident links/iu,
      /browser-local Case metadata/iu,
    ],
  },
  {
    id: 'case-incident-title-privacy',
    clauses: [
      /Separate incident Cases can share a domain/iu,
      /own IDs, titles and decisions/iu,
      /ordinary Case exports, reports, workspace archives and internal CLI packs/iu,
      /trusted and public CLI packs exclude them/iu,
    ],
  },
  {
    id: 'case-observation-reuse',
    clauses: [
      /Reusing a selected observation copies only that evidence with its original timestamps, not the source Case's notes or decisions/iu,
    ],
  },
  {
    id: 'case-review-copy',
    clauses: [
      /Review copies are ordinary full Case exports, not redacted or encrypted/iu,
      /Returned-file previews stay in page memory/iu,
    ],
  },
  {
    id: 'case-review-return',
    clauses: [
      /handoff entry containing the file digest and selected-record-key digest/iu,
      /(?:No upload occurs|Nothing is uploaded)/iu,
      /file identity does not authenticate the reviewer/iu,
      /(?:conflicts|Conflicting entries)/iu,
      /response authorisations/iu,
      /unselected records are not imported/iu,
    ],
  },
  {
    id: 'public-case-pack',
    clauses: [
      /Public CLI case packs clear identifiers, actions, observed-effect reviews,? and closure records/iu,
    ],
  },
  {
    id: 'workspace-compatibility',
    clauses: [
      new RegExp(`workspace archive version ${WORKSPACE_ARCHIVE_VERSION}`, 'iu'),
      new RegExp(
        `exact versions ${SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.filter((version) => version !== WORKSPACE_ARCHIVE_VERSION).join(',? (?:and )?')} remain readable`,
        'iu',
      ),
    ],
  },
  {
    id: 'saved-review-position',
    clauses: [
      /Saved review positions retain filters, search text, selected Review Item and Case references, evidence fingerprints, unfinished review forms and save time/iu,
      /current workspace/iu,
      /encryption when enabled/iu,
      /Saving is explicit/iu,
      /excluded from backups, exports and legacy rollback copies/iu,
      /Resume re-evaluates current records without collection or submission/iu,
      /Discarding a position removes its saved review-form copies/iu,
      /Cases and currently open forms are unchanged/iu,
    ],
  },
  {
    id: 'unsupported-workspace',
    clauses: [
      /Versions 1 through 4/iu,
      /future versions fail without/iu,
      /reset, deletion,? or rewrite/iu,
    ],
  },
  {
    id: 'monitoring-custody',
    clauses: [
      /scheduled monitoring/iu,
      /application-encrypted/iu,
      /Disabling collection (?:does not delete|also leaves)/iu,
    ],
  },
  {
    id: 'monitoring-key-custody',
    clauses: [/worker runtime receives the encryption key through its deployment environment/iu],
  },
  {
    id: 'monitoring-physical-delete',
    clauses: [
      /Deleting a scheduled watchlist/iu,
      /does not delete the Blob object/iu,
      /Physical object deletion/iu,
      /deployment-operator/iu,
    ],
  },
  {
    id: 'contact-minimisation',
    clauses: [/Contact page/iu, /Turnstile token/iu, /does not send or retain/iu],
  },
  { id: 'cli-local', clauses: [/CLI runs on the operator's machine/iu] },
  {
    id: 'signer-trust-file',
    clauses: [
      /signer trust file is read only when explicitly selected/iu,
      /public-key fingerprints, labels and review notes, not private keys/iu,
      /only the matching entry and the file digest, without its path or other entries/iu,
      /not uploaded, discovered automatically or changed by verification/iu,
    ],
  },
  {
    id: 'workflow-file-locks',
    clauses: [
      /Workflow-file output uses adjacent private lock files containing a local process ID/iu,
      /removed after the run/iu,
      /interruption can leave one for manual recovery/iu,
    ],
  },
  {
    id: 'portable-file-packages',
    clauses: [
      /Portable evidence packages process selected JSON, screenshots and opaque files locally/iu,
      /unchanged and unredacted/iu,
      /original filenames and paths are not retained/iu,
      /Unknown source times remain unknown/iu,
      /review uploads nothing, executes no file and changes no saved records/iu,
      /separate import preview and confirmation/iu,
    ],
  },
  {
    id: 'encrypted-file-packages',
    clauses: [
      /Ordinary ZIPs and evidence folders are unencrypted/iu,
      /whole manifest and files with AES-256-GCM and PBKDF2-SHA-256 \(600,000 iterations\)/iu,
      /Passphrases and keys are not saved or sent/iu,
      /authenticates the container before checking its ZIP and file identities/iu,
      /does not establish who created the package/iu,
      /Downloading an unlocked entry produces its original, unencrypted bytes/iu,
    ],
  },
  {
    id: 'independent-backup-encryption',
    clauses: [
      /File-backup groups have their own optional package encryption; encrypting the JSON does not encrypt those groups/iu,
    ],
  },
  {
    id: 'workflow-evidence-reuse',
    clauses: [
      /Workflow checkpoints retain selected paths, step evidence, content digests and explicit input bindings/iu,
      /Reused evidence stays local without extraction files/iu,
    ],
  },
  {
    id: 'active-mail-limit',
    clauses: [
      /at most three selected MX hosts/iu,
      /sends no message/iu,
      /tests no relay, recipient, mailbox,? or catch-all/iu,
    ],
  },
  {
    id: 'saved-lookup-sensitivity',
    clauses: [
      /full saved Lookup/iu,
      /raw RDAP publications/iu,
      /WHOIS response bodies/iu,
      /publicly published contacts/iu,
    ],
  },
  { id: 'export-review', clauses: [/Review every file before sharing/iu] },
  {
    id: 'calendar-export-minimisation',
    clauses: [
      /selected Case follow-up calendar/iu,
      /stable Case reference by default/iu,
      /domains, recipients, Case types/iu,
      /event details/iu,
      /separate opt-ins/iu,
    ],
  },
  {
    id: 'download-deletion',
    clauses: [/Deleting browser data does not delete separately downloaded files/iu],
  },
  {
    id: 'direct-dns-records',
    clauses: [
      /query A, AAAA, CAA,? and MX once through one selected\s+public address per nameserver/iu,
    ],
  },
  {
    id: 'direct-dns-retention',
    clauses: [/retaining at most sixteen normalised values\s+for each record type/iu],
  },
  {
    id: 'lookup-evidence-compatibility',
    clauses: [
      new RegExp(`Lookup evidence schema ${LOOKUP_EVIDENCE_SCHEMA_VERSION}`, 'iu'),
      new RegExp(
        `published v2 schemas ${PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION} and ${LATEST_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION}`,
        'iu',
      ),
      new RegExp(`v1 schema ${V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION} remain readable`, 'iu'),
    ],
  },
  {
    id: 'selected-pin-hostnames',
    clauses: [
      /Explicitly selected evidence pins can include their own observation hostname in response packets/iu,
      /distinct from the Case's registration domain/iu,
    ],
  },
  {
    id: 'registrar-standing-network',
    clauses: [
      /Registrar standing is matched locally using only the numeric IANA ID/iu,
      /Lookup makes no additional IANA or ICANN request/iu,
    ],
  },
  {
    id: 'integrity-limits',
    clauses: [
      /Checksums and signatures/iu,
      /do not prove evidence accuracy, authorship, signer identity/iu,
    ],
  },
  {
    id: 'capture-disclosure',
    clauses: [
      /executes remote page JavaScript/iu,
      /exact requested URL, including its path and query/iu,
    ],
  },
  {
    id: 'image-comparison-retention',
    clauses: [
      /Changed-pixel results and comparison exclusions stay in page memory/iu,
      /Exclusions do not redact files/iu,
      /Comparing another capture does not save or import it/iu,
    ],
  },
  {
    id: 'capture-condition-retention',
    clauses: [
      /manifests retain browser version, viewport, scale, locale, timezone and colour scheme/iu,
      /declarations can enter imported metadata and shared exports/iu,
      /do not verify identity, location or independent collection/iu,
    ],
  },
  {
    id: 'capture-manifest-import',
    clauses: [
      /capture manifest/iu,
      /imports only sanitised (?:manifest )?metadata and declared digests/iu,
      /check and the file bytes are not saved by the Case metadata import/iu,
    ],
  },
  {
    id: 'capture-channel-ledger',
    clauses: [
      /request-channel ledger retains validated origins/iu,
      /excludes paths, queries, headers and body content/iu,
      /refused direct connections retain counts only/iu,
    ],
  },
  {
    id: 'capture-attachment-check',
    clauses: [
      /separate optional attachment selection reads and checks screenshot and DOM-digest bytes in page memory,? without uploading them/iu,
    ],
  },
  {
    id: 'retained-originals',
    clauses: [
      /Retained files require a separate explicit save/iu,
      /stored unchanged in the current workspace, using its encryption when enabled/iu,
      /filenames, declared sources and observation times, retention times, byte counts and digests; filesystem paths are not stored/iu,
      /sensitive content that ordinary Case metadata excludes/iu,
      /No file is uploaded automatically/iu,
    ],
  },
  {
    id: 'retained-file-export-deletion',
    clauses: [
      /Public and trusted CLI Case packs exclude these references/iu,
      /JSON backups contain references only, not original bytes/iu,
      /Removing a reference deletes its bytes only when no other Case in the workspace references them/iu,
    ],
  },
  {
    id: 'capture-file-retention',
    clauses: [
      /Case metadata import by default/iu,
      /explicit retention option saves the manifest and matching original files with the Case in one transaction/iu,
      /Unmatched files are excluded/iu,
    ],
  },
  {
    id: 'workflow-review-confirmation',
    clauses: [
      /Per-step review confirmations are recorded for the current invocation only/iu,
      /retained checkpoints do not authorise a later network or human-review step/iu,
    ],
  },
  {
    id: 'platform-reporting-navigation',
    clauses: [
      /Opening an official (?:platform reporting|provider) route is deliberate external navigation/iu,
      /does not prefetch/iu,
      /or submit Case data/iu,
    ],
  },
  {
    id: 'no-automatic-action',
    clauses: [
      /does not automatically submit reports, contact recipients, acquire domains, apply/iu,
      /controls,? or change/iu,
      /infrastructure/iu,
    ],
  },
  {
    id: 'non-inference',
    clauses: [
      /Missing, blocked, stale, malformed, partial, unavailable,? or unsupported evidence never becomes absence, safety, ownership, control, intent,? or remediation/iu,
    ],
  },
  {
    id: 'saved-views',
    clauses: [
      /Saved Case views retain names, search text, status, disposition and sort choices within the current workspace/iu,
      /Workspace backups include them; response packets do not/iu,
      /without making network requests/iu,
    ],
  },
]);

function paragraphHasFact(paragraph: string, fact: PrivacyFact): boolean {
  return fact.clauses.every((clause) => clause.test(paragraph));
}

test('privacy clauses allow sentence reordering but cannot borrow a disclosure from another paragraph', async () => {
  const notice = await readFile(ROOT_NOTICE_URL, 'utf8');
  const paragraph = notice
    .split(/\n\s*\n/u)
    .map(compact)
    .find((value) => value.startsWith('Document review retains'));
  const fact = SHARED_PRIVACY_FACTS.find((value) => value.id === 'document-and-har-intake');
  assert.ok(paragraph && fact);
  assert.equal(
    paragraphHasFact(
      paragraph
        .split(/(?<=\.)\s+/u)
        .reverse()
        .join(' '),
      fact,
    ),
    true,
  );
  const missing = paragraph.replace(/It does not replay requests\./u, '');
  assert.notEqual(missing, paragraph);
  assert.equal(
    [missing, 'An unrelated feature does not replay requests.'].some((value) =>
      paragraphHasFact(value, fact),
    ),
    false,
  );
});

test('public privacy notices share the current material data-handling contract', async () => {
  const [rootNotice, publicNotice, disclosure] = await Promise.all([
    readFile(ROOT_NOTICE_URL, 'utf8'),
    readFile(PUBLIC_NOTICE_URL, 'utf8'),
    readFile(DISCLOSURE_URL, 'utf8'),
  ]);

  const missing: string[] = [];
  for (const [label, notice] of [
    ['PRIVACY.md', rootNotice],
    ['/privacy', publicNotice],
  ] as const) {
    // Keep the facts independent of their order, but scoped to this disclosure.
    const paragraphs =
      label === 'PRIVACY.md'
        ? notice.split(/\n\s*\n/u)
        : [...notice.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gu)].map((match) => match[1]!);
    const normalised = paragraphs.map(compact);
    for (const fact of SHARED_PRIVACY_FACTS) {
      if (!normalised.some((paragraph) => paragraphHasFact(paragraph, fact)))
        missing.push(`${label}: ${fact.id}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    'Each material fact must be disclosed together, not assembled from unrelated paragraphs.',
  );

  const normalisedDisclosure = compact(disclosure);
  const dates = [rootNotice, publicNotice].map(
    (notice) => /Last updated: (\d{1,2} [A-Z][a-z]+ \d{4})/u.exec(notice)?.[1],
  );
  assert.ok(dates[0]);
  assert.equal(dates[0], dates[1], 'Both public privacy notices must describe the same revision.');
  const date = new Date(`${dates[0]} 00:00:00 UTC`);
  assert.equal(Number.isFinite(date.getTime()), true);
  assert.equal(
    new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date),
    dates[0],
  );
  assert.match(
    normalisedDisclosure,
    /Hosted and distributable collection does not .*execute remote page scripts/iu,
  );
  assert.match(
    normalisedDisclosure,
    /separate repo-local rendered-capture package is an explicit authorised exception/iu,
  );
  assert.match(
    normalisedDisclosure,
    /executes page JavaScript in a disposable, network-bounded browser/iu,
  );

  assert.deepEqual(
    [...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS],
    [
      PUBLIC_WORKSPACE_ARCHIVE_VERSION,
      PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION,
      PUBLISHED_V2_2_WORKSPACE_ARCHIVE_VERSION,
      PUBLISHED_V2_3_WORKSPACE_ARCHIVE_VERSION,
      WORKSPACE_ARCHIVE_VERSION,
    ],
  );
  assert.equal(PUBLIC_CASE_RESPONSE_PACKET_VERSION, 6);
  assert.equal(PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION, 7);
  assert.equal(PUBLISHED_V2_2_CASE_RESPONSE_PACKET_VERSION, 8);
  assert.equal(PUBLISHED_V2_3_CASE_RESPONSE_PACKET_VERSION, 9);
});
