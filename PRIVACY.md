# Privacy notice

Last updated: 13 September 2026.

This notice describes the public WHOISleuth deployment. A self-hosted operator
must adapt it when hosting, authentication, enabled providers, retention or
contact routes differ.

WHOISleuth is local-first: ordinary investigation state stays in the current
browser profile, and the server has no general user, Case or workspace database.
Network collection, local retention, export and active review are separate
deliberate actions.

The generated [privacy/data-flow catalogue](docs/privacy-data-flow-catalogue.md)
and [JSON reference](docs/privacy-data-flow-catalogue.json) list the recipients,
retention classes and export boundaries for each capability.

## Practical summary

1. **What leaves the device?** Only a deliberately started network-capable
   operation sends its declared bounded target or evidence fields to the hosted
   service, public source, target service or explicitly selected provider.
2. **What stays in the browser?** Deliberately retained Cases, profiles,
   watchlists and other workspace records stay in the current browser profile.
3. **What can be hosted?** Ordinary workspace data is not hosted. Optional
   scheduled monitoring stores only its documented compact
   application-encrypted projection and bounded object metadata when configured.
4. **How long is data retained?** Transient processing ends with the request or
   bounded cache lifetime. Browser data remains until removed or site data is
   cleared. Downloaded and CLI files remain until the operator deletes them.
5. **What is automatic?** WHOISleuth does not automatically submit reports,
   contact recipients, acquire domains, apply defensive controls or change
   external infrastructure.

Missing, blocked, stale, malformed, partial, unavailable or unsupported evidence
never becomes absence, safety, ownership, control, intent or remediation.

## Information processed

Depending on the selected operation, WHOISleuth can process:

- a domain, hostname, IP address, ASN, nameserver, certificate-search term or
  other explicit technical target;
- public registry and registrar RDAP, WHOIS, DNS, routing, HTTP, TLS,
  certificate, security.txt and provider evidence;
- registry-published contact names, organisations, addresses, email addresses
  and telephone numbers where the source exposes them;
- analyst-supplied Brand Profiles, watchlists, Cases, classifications, exact
  incident links, notes, assertions, response actions, desired state and review
  decisions;
- imported evidence files and their bounded provenance;
- authentication and operation-control metadata; and
- local output files selected by the operator.

Many registration sources redact personal contact fields. WHOISleuth relays or
normalises what the selected source publishes; it does not build a separate
registrant database.

The public synthetic demo uses fixed fictional evidence on reserved domains and
does not query a live target or write protected workspace data.

## Browser-local processing

The default workspace and unencrypted named workspaces store bounded
collections in IndexedDB as plaintext JSON. These include Cases, Brand Profiles, watchlists, shortlist
entries, campaigns, certificate-search history, custom rules, retained
relationship observations, saved Bulk sessions, website snapshots,
investigation templates, Bulk review state and saved List column choices, saved Case views and Analyst Review Item state. They
are visible to anyone able to use the browser profile.

Retained files require a separate explicit save. Selected originals are stored
unchanged in the current workspace, using its encryption when enabled. Case
references include filenames, declared sources and observation times, retention
times, byte counts and digests; filesystem paths are not stored. Originals can
contain sensitive content that ordinary Case metadata excludes. Public and
trusted CLI Case packs exclude these references. JSON backups contain references
only, not original bytes. Removing a reference deletes its bytes only when no
other Case in the workspace references them. No file is uploaded automatically.

Image comparison and region editing run in page memory. Explicitly retained
edits are separate PNG files with their own digests, source-file fingerprints
and region instructions. They keep the source observation time; originals are
not overwritten. Unsaved image edits are not recovery drafts. Removing a source
can leave its derivative and fingerprint without the original bytes.

Unfinished Case response forms are saved automatically as bounded recovery
drafts in the selected workspace. They remain separate from submitted Case
records, use the workspace's encryption when enabled, and are excluded from
portable backups, exports and legacy rollback copies. Drafts remain until
submitted, explicitly discarded, or removed with their Case or workspace.
Do not enter credentials into analyst forms. Storage health reads the browser's
site-wide estimates; a persistence request happens only when selected and does
not create a backup. Backup preparation is remembered only during that visit;
the app cannot confirm that a file was kept or restored.

Saved review positions retain filters, search text, selected Review Item and
Case references, evidence fingerprints, unfinished review forms and save time in the current workspace,
using its encryption when enabled. Saving is explicit; later navigation does
not update that checkpoint. Positions are excluded from backups, exports and
legacy rollback copies. Resume re-evaluates current records without collection
or submission. Discarding a position removes its saved review-form copies;
Cases and currently open forms are unchanged.

Tab-scoped dictionaries, candidate handoffs, guided-investigation progress and
similar transient state use bounded memory or `sessionStorage`. The one-use
candidate handoff uses a random token and is removed when accepted. Appearance
preferences (colour, reading density and decorative effects) can use `localStorage`. These records are not uploaded merely because
they exist.

Named workspaces use separate IndexedDB databases and a local directory of
random identifiers, names and timestamps. They share the browser profile and
storage quota; names alone do not provide access control. The default
workspace keeps existing data unchanged. Each tab selects its workspace in
`sessionStorage`; guide progress, candidate handoffs and named-workspace Brand
preferences are scoped to that selection. Appearance stays browser-wide.
Backups and imports use the explicitly selected workspace, excluding the
directory and tab state. Deleting an inactive named workspace removes its saved
collections, not other workspaces or downloaded files. Clearing site data
removes all workspaces.

Optional encrypted named workspaces protect saved collection values and record
identifiers using AES-256-GCM and keyed collection integrity checks. A
passphrase-derived key is held only in the unlocked document, never stored or
sent. Reloading, locking or leaving the Console requires another unlock;
another tab unlocks independently. Guide progress, candidate handoffs and Brand
selection stay in memory in an encrypted workspace, not session storage.
Names, collection counts, sizes and timestamps remain visible. Encryption does
not protect an unlocked page, a compromised device, weak passphrases, deletion
or rollback to an older valid database. There is no passphrase reset. Transfer
existing work through a reviewed encrypted backup into a new workspace; the
original unencrypted data remains until explicitly deleted.

Selected Case context uses only page memory and the existing local Case store.
The selection clears on reload or sign-out and does not initiate collection.

Saved Bulk rows and deliberately retained relationships can include bounded
contributing-source identities, states and observation times, not raw responses.
Older records remain readable with missing provenance marked unknown.

The browser can derive searches, filters, timelines, relationship views,
posture comparisons, evidence-gap queues and response preflight from retained
records without another request. Derived views do not create evidence, prove a
target state or silently mark an item reviewed.

Creating or refreshing a Case is deliberate. Current Case schema 16 can retain
the exact normalised submitted hostname and the DNS, TLS and web observation
hostname on a new evidence snapshot, analyst
decision confidence and its basis, and a response route's observation and
review times. Pins and sightings with unknown observation times retain null;
saving them does not create a source observation time.
Saved recheck questions retain an analyst-entered hostname, comparison conditions
and optional baseline reference. Answers retain the question context as reviewed.
These remain browser-local until exported and are excluded from public Case
packs with other analyst assertions and independent review records.
Individual source refreshes keep minimised facts in page memory, separate from
the original Lookup. Explicitly selected facts can be saved through the same
Case checkpoint controls or downloaded in a readable comparison. Raw source
payloads and contacts are not retained by the refresh review; leaving or
reloading Lookup clears its transient history.
Exact public v1 Case schema 12 and published-v2 schemas 13–15
remain readable and migrate directly; migrated fields can remain null, unknown
or blank because WHOISleuth does not reconstruct them from weaker evidence.
Case report v12 JSON and Markdown do not add the snapshot hostname.
Explicitly selected evidence pins can include their own observation hostname
in response packets; this remains distinct from the Case's registration domain.

A Case can also retain controlled classifications and exact HTTP(S) incident
links as browser-local Case metadata. Exact links can contain public paths,
queries and fragments, so they can be sensitive even when embedded credentials
are rejected. They remain local until the analyst opens, exports or otherwise
shares them.

Separate incident Cases can share a domain while retaining their own IDs,
titles and decisions. Titles are analyst-entered text: ordinary Case exports,
reports, workspace archives and internal CLI packs retain them. Trusted and
public CLI packs exclude them. Reusing a selected observation copies only that
evidence with its original timestamps, not the source Case's notes or decisions.

Review copies are ordinary full Case exports, not redacted or encrypted.
Returned-file previews stay in page memory. Adding selected notes, pins,
decisions or assertions saves them locally with their original record times,
plus a handoff entry containing the file digest and selected-record-key digest.
No upload occurs; file identity does not authenticate the reviewer. Existing
conflicts, response authorisations and unselected records are not imported.

Brand Profiles can retain official-channel URLs and handles, rights owners,
registration identifiers, jurisdictions, source URLs and review notes. These
records can be sensitive and remain browser-local until deliberately exported.
Saved settings reviews also retain source times, completeness, the profile
identifier and a digest of its collection settings. They do not retain raw
DNS or registry responses.

Public CLI Case packs clear identifiers, actions, observed-effect reviews and
closure records for the public audience. Trusted and internal Case packs and
ordinary Case or workspace exports can contain exact investigated hostnames and
analyst context.

Failed local reads, quota errors, partial collections and unsupported versions
remain explicit. They do not become empty collections or evidence of absence.
Clearing site data removes the browser workspace, including retained Case
hostname history.

## Hosted collection

Single and Bulk lookups send the selected target and requested mode to the
WHOISleuth deployment. The server performs only the declared bounded requests
to relevant public sources and target services. It returns a bounded response
and does not write ordinary investigation results to a server-side workspace.
Deep Lookup may stream source-state summaries before its final response. These
updates make no additional requests and are not saved as partial evidence.

Selected registration bootstrap and public registration responses can remain
briefly in server memory to reduce duplicate upstream requests. Optional
security.txt and external intelligence results are not retained as a hosted
investigation record. Hosting, edge and function providers can retain ordinary
request or function-log metadata under their own configured policies.

By default, for a URL pasted into Lookup, the browser sends only its full hostname for
collection, without the port, path, query or fragment. Credential-bearing URLs
are rejected. Deliberate retention of an exact Incident URL in a Case remains
separate from that collection request.

Explicit **selected URL** collection in Deep Lookup sends the path and query
in a request body to the application server, then to the website and its
followed redirects. Fragments are not sent. CLI `--deep --exact-url` makes the
same deliberate selection. Retained HTTP provenance omits queries, but paths
and page-derived text may contain sensitive information. Compact Case facts
and website snapshots retain the selection mode, not the URL path or query;
they cannot establish a same-page temporal comparison.

Registration queries use the registrable domain. Deep DNS, TLS and web probes
use the selected hostname; registration-delegation checks retain their own domain.
Fast, compact, Bulk and monitoring collection scope is unchanged.

Deep collection can disclose the target or related bounded query to the
applicable registry or registrar, public DNS resolver, nameserver, HTTP origin,
TLS endpoint, certificate-search service, security.txt endpoint or selected
public-address registration service. Each recipient can observe the source
network address and apply its own logging, rate limits and retention.

Homepage HTML is processed transiently within the [request-policy limits](https://www.whoisleuth.com/request-policy).
Raw HTML is not added to browser-local records or ordinary evidence exports.
Capture and analysis limits are disclosed as incomplete evidence, not absence.

Deep domain collection can query A, AAAA, CAA and MX once through one selected
public address per nameserver, retaining at most sixteen normalised values
for each record type. Direct-authority results stay separately attributed.

Supporting sources remain separately attributed. DNS, website, certificate,
provider and analyst evidence cannot independently decide domain registration,
ownership, control, safety, activity, intent or maliciousness.

## Optional providers and hosted monitoring

Optional external intelligence adapters are disabled unless configured and
explicitly selected. Depending on that selection, the canonical registrable
domain can be sent to the configured search-only URLscan, URLhaus or ThreatFox
adapter. These integrations do not submit a URL, sample, scan or report. A
provider miss, failure or quota response is not evidence of safety.

The checked-in SSLBL certificate projection is local and digest-checked. Lookup
does not send its target or certificate to SSLBL. Opening a separately labelled
matching-record link is ordinary deliberate navigation to that provider.

Registrar standing is matched locally using only the numeric IANA ID already
present in registration evidence. Lookup makes no additional IANA or ICANN
request for it.

Optional scheduled monitoring is disabled by default. When configured, the
worker retains only the bounded application-encrypted compact watchlist
projection and ordinary object metadata needed to operate it. The hosting
Blob store receives ciphertext, not the browser workspace or the key embedded
in that object. The configured worker runtime receives the encryption key
through its deployment environment, so an operator or hosting runtime with
environment access can decrypt the state while configured. Deleting a
scheduled watchlist rewrites the encrypted logical state; it does not delete
the Blob object. Disabling collection also leaves the object in place. Physical
object deletion is a separate deployment-operator action through the hosting
platform, as documented in the operations guide.

Each scheduled run uses the Fast compact collection contract: registration-led
RDAP and the bounded authoritative DNS fallback where required. It omits WHOIS,
HTTP, TLS, page, and optional intelligence collection, so a scheduled result is
not a current website or page-content check.

When malformed, duplicate, excessive or inconsistent scheduled-monitor state
is recovered, the authenticated management response can include an ephemeral
bounded count by fixed recovery category. It never includes malformed targets,
watchlist names, source records, lease tokens, ciphertext or raw payloads, and
the recovery projection is not written back into the encrypted durable state.

Optional distributed operation controls can send only bounded operation class,
opaque lease, expiry and one-way opaque-session fingerprint metadata to the
configured counter provider. Optional durable usage accounting stores fixed
bucket identifiers and integer counts. It receives no lookup target, evidence,
Case, note, browser record or session token.

## Authentication and contact

The protected Console uses one signed `HttpOnly`, `SameSite=Lax` session cookie.
Its configured lifetime defaults to 7 days and cannot exceed 30 days. The cookie
is required for authentication and is not used for advertising or behavioural
tracking. Signing out removes the local cookie but does not revoke a captured
copy; rotating the signing secret invalidates outstanding sessions.

The public Contact page keeps the subject and message in page memory. To reveal
a configured privacy or security role address, the browser sends only the fixed
contact category and a short-lived Turnstile token to this deployment. The
server sends the token—not the draft, target data or role address—to Cloudflare
for verification, then returns the configured role address. The browser creates
a local email draft. WHOISleuth does not send or retain the message and accepts
no attachment.

The public deployment contains no individual user-account database and no
advertising or behavioural audience measurement.

Opening an official platform reporting route is deliberate external navigation.
WHOISleuth does not prefetch the route or submit Case data. The destination or
local mail application receives only what ordinary navigation and the analyst's
later form or email entry provides, under that provider's own terms and privacy
notice.

## Local CLI and active operations

The CLI runs on the operator's machine and does not use the hosted application
or session. Offline plans, comparisons, verification, reports and local imports
make no network request. Networked commands disclose their target and source
boundary in focused help and can be rate-limited or logged by those sources.

Local input is bounded before parsing. Output goes to stdout unless the operator
deliberately selects a local file. Existing files are refused unless replacement
is explicit. CLI files are not uploaded to WHOISleuth and remain under the
operator's retention and deletion control.

An optional signer trust file is read only when explicitly selected. It contains
public-key fingerprints, labels and review notes, not private keys. Trust reports
include only the matching entry and the file digest, without its path or other
entries. The file is not uploaded, discovered automatically or changed by verification.

Workflow-file output uses adjacent private lock files containing a local process
ID. They are removed after the run; interruption can leave one for manual recovery.
Workflow checkpoints retain selected paths, step evidence, content digests and
explicit input bindings. Reused evidence stays local without extraction files.
Per-step review confirmations are recorded for the current invocation only;
retained checkpoints do not authorise a later network or human-review step.

Optional metadata CSV retains source versions, collection and report times,
collection origin and source-health states alongside the selected results.
Selected Bulk CSV exports include a review manifest with targets, review filters,
source states, observation times and compact Brand Profile provenance. Raw
responses, contacts, Profile contents and notes are excluded.

The offline `mail-headers` command parses only the bounded header block from a
selected message or standard input. Its output can retain a header digest,
domain-only identity and routing, reported authentication states, and
observation counts. It does not retain address local parts, display names,
subject, body, attachments, or raw header values, and makes no network request.

The isolated `dnssec-validate` and `mail-transport` commands require a selected
literal public resolver, local trust-anchor document and explicit
owned-or-authorised acknowledgement. Mail transport also requires a separate
active-probe acknowledgement. It handles at most three selected MX hosts
sequentially, sends `EHLO` and uses `STARTTLS` only when advertised. It sends no
message, authenticates no account and tests no relay, recipient, mailbox or
catch-all behaviour.

The selected resolver and MX operators receive the applicable DNS questions or
bounded transport connection and can retain ordinary network metadata. DNSSEC,
TLSA/DANE, PKIX, STARTTLS and address-authentication states remain separate.

## Imports, exports and sensitive files

Portable evidence packages process selected JSON, screenshots and opaque files
locally. File bytes are unchanged and unredacted by packaging;
original filenames and paths are not retained in the manifest. Declared source
identities, source times and local packaging events can be included. Unknown
source times remain unknown. Package review uploads nothing, executes no file
and changes no saved records. A workspace file requires its separate import
preview and confirmation. Checksum identity, supported format, signature trust,
timestamp assurance and factual accuracy remain separate results. Downloaded
packages remain until the operator deletes them.
Ordinary ZIPs and evidence folders are unencrypted. Optional encrypted packages
protect the whole manifest and files with AES-256-GCM and PBKDF2-SHA-256
(600,000 iterations). Their version-1 header contains only format parameters,
random salt and IV, and byte length. Passphrases and keys are not saved or sent;
the CLI reads a passphrase only from an explicitly selected local file. Unlocking
authenticates the container before checking its ZIP and file identities. It does
not establish who created the package. Downloading an unlocked entry produces
its original, unencrypted bytes. Encryption does not protect an unlocked page,
compromised device or weak passphrase.
Evidence folders use the same manifest and file identities. Folder review reads
only the selected files. Direct browser output requires a folder picker grant,
creates a new child folder and reads its files back for verification; handles
are not saved or used for background access. CLI output requires a new explicit
path. Cancelled or failed writes may leave partial private output for deliberate
inspection or deletion. Selected Case-file exports are not complete workspace
backups and do not include Case metadata or unselected files.
Explicit inline review shows paged JSON text or locally decoded PNG pixels,
without running document scripts, following links or making page requests.
Capture attachment checks compare selected bytes with manifest declarations;
matching bytes do not authenticate the capture. Review state is held in page
memory and cleared when closed or when the page is left.

Imports and exports are deliberate local actions. Importers validate bounded
envelopes before preview or merge; omission never deletes destination data.
Imported evidence remains attributed to its file and declared source and is not
treated as freshly collected or true merely because it parsed.

The findings preview shows the normalised Case fields and any shortening before
retention. Only selected findings or intelligence claims are imported. A local
finding-content digest distinguishes reimports from changed evidence; it is an
identity aid, not anonymisation or proof that the source is authentic. Full Case
exports and reports retain it; recipient response packets omit it.

Saved Case views retain names, search text, status, disposition and sort choices
within the current workspace. Workspace backups include them; response packets
do not. Applying a view filters retained Cases without making network requests.

The current writer emits workspace archive version 9. Exact versions 5, 6, 7 and 8
remain readable. Versions 5–8 gain an empty saved-views section without removing
existing views. Version 5 also gains an empty Analyst Review Item section without
inventing decisions. Versions 1 through 4 are unsupported. Future versions fail without
empty import, reset, deletion or rewrite. Release 1.47.4 can export the exact
version-5 and Case-schema-12 public baseline before moving to v2.

The optional encrypted workspace envelope remains version 1. Encryption and
decryption happen in browser memory using password-based authenticated
encryption. The passphrase and derived key are not persisted or sent. Encryption
protects the downloaded file while locked, not an open Console or an unencrypted working workspace,
malicious extension, compromised device or weak passphrase.

Recovery rehearsal restores a reviewed backup into a new, separately named
browser-local workspace without switching the active workspace. An encrypted
backup requires an encrypted rehearsal destination. Selected original files or
evidence packages are matched by complete byte length and digest; filenames do
not establish a match. Rehearsal checks restored data and referenced files, but
does not apply preferences to the active tab. Its data remains until deliberately
deleted, including after leaving the page. File-backup groups have their own
optional package encryption; encrypting the JSON does not encrypt those groups.

Different exports have different sensitivity:

- a full saved Lookup can contain targets, bounded source endpoints and timings,
  raw RDAP publications, WHOIS response bodies and publicly published contacts;
- current Lookup evidence schema 29 excludes raw registration payloads,
  expanded contacts, credentials and complete query-bearing URLs. Published v2
  schemas 27 and 28 and exact v1 schema 26 remain readable; schema 26 may contain public
  contact fields;
- Case, workspace, Case-pack, graph, campaign and response files can identify
  investigated targets or contain analyst-authored material; and
- selected Case follow-up calendars identify only the stable Case reference by
  default. Investigated domains, recipients, Case types and event details are
  separate opt-ins, and a calendar or synchronisation provider can retain any
  field the analyst chooses to include; and
- defensive exports contain reviewed selected domains and rollback metadata but
  are never uploaded or applied automatically.

Review every file before sharing.

Checksums and signatures can detect content change or verify a mathematical key
relationship under their named contract. They do not prove evidence accuracy,
authorship, signer identity, recipient authorisation or safety.

## Optional local rendered capture

The optional capture companion is an explicit authorised-capture action outside
the hosted application and main CLI. It executes remote page JavaScript in a
disposable network-bounded browser. Each admitted resource operator receives the
exact requested URL, including its path and query.

The local manifest does not include dedicated request-path or query fields, but
the page-controlled title can reproduce them. A local fixed-size screenshot
necessarily preserves visible rendered content and may include page text or a
page-reflected path or query until the operator deletes it. Captures remain
local, are not uploaded to WHOISleuth and persist until the operator deletes
them. Bounded text and tag-sequence digests are comparison aids, not exact DOM,
visibility or page-identity claims.

When an analyst selects a local capture manifest for one Case, the browser
validates it before preview and imports only sanitised manifest metadata and
declared digests. A separate optional attachment selection reads and checks
screenshot and DOM-digest bytes in page memory, without uploading them. That
check and the file bytes are not saved by the Case metadata import by default.
An explicit retention option saves the manifest and matching original files
with the Case in one transaction. Unmatched files are excluded from that action.
A portable evidence package can preserve explicitly selected files separately.

## Retention and deletion

| Data | Retention and deletion |
| --- | --- |
| Transient hosted results | End with the bounded operation or cache lifetime; ordinary hosting logs follow the operator's platform configuration. |
| Session cookie | Remains until expiry, sign-out or browser removal; rotate the signing secret for global invalidation. |
| Browser workspace | Remains until removed through the relevant control or browser site data is cleared. |
| Optional monitoring | Deleting a scheduled watchlist rewrites the encrypted logical state. The Blob object remains until the deployment operator deletes that object through the hosting platform. |
| Downloaded and CLI files | Remain on the operator's filesystem until the operator deletes them. |
| Contact draft | Remains in page/email-client memory; WHOISleuth does not retain it. |

Deleting browser data does not delete separately downloaded files. Disabling a
feature does not delete data already retained by its operator.

## Security and limitations

Controls include signed sessions, request-rate and operation limits, restrictive
browser policies, bounded parsing, public-address validation, redirect
revalidation, DNS-rebinding resistance and pinned-address connections. Browser
future versions are preserved without write where promised; portable future
versions are rejected before merge.

Unencrypted workspaces are readable in IndexedDB, hosting providers can retain ordinary logs, public
sources can publish inaccurate or personal data, and downloaded files can be
copied outside WHOISleuth. Review sensitive output before sharing. Missing,
blocked, stale, malformed, partial, unavailable or unsupported evidence remains
explicitly qualified.

## Operators, rights and contact

Operators are responsible for an appropriate lawful basis, authorisation,
provider terms, retention and response process for their use. This notice is not
legal advice. Requests concerning source-published registration data may need to
be directed to the responsible registry or registrar. Browser records and local
exports remain under the user's or operator's control; an operator who enables
hosted monitoring must also manage its encrypted object.

The public deployment uses Netlify for hosting and functions and Cloudflare
Turnstile for protected contact verification. Upstash is used only when the
operator configures distributed operation controls. Public registries,
registrars, DNS infrastructure, target services, certificate-search services
and explicitly selected providers receive only the applicable bounded request.
These services can operate in other countries and apply their own terms.

Use the protected `/contact` page for a privacy request, outbound-request
concern or security report. A self-hosted operator must configure and monitor
its own role addresses.

See the [threat model](docs/threat-model.md),
[browser-local data architecture](docs/browser-local-data.md) and
[security policy](SECURITY.md) for further technical guidance. The software is
provided as is, without warranty.
