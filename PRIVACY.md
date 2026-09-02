# Privacy notice

Last updated: 2 September 2026.

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
- analyst-supplied Brand Profiles, watchlists, Cases, notes, assertions,
  response actions, desired state and review decisions;
- imported evidence files and their bounded provenance;
- authentication and operation-control metadata; and
- local output files selected by the operator.

Many registration sources redact personal contact fields. WHOISleuth relays or
normalises what the selected source publishes; it does not build a separate
registrant database.

The public synthetic demo uses fixed fictional evidence on reserved domains and
does not query a live target or write protected workspace data.

## Browser-local processing

The authenticated Console stores bounded workspace collections in IndexedDB as
plaintext JSON. These include Cases, Brand Profiles, watchlists, shortlist
entries, campaigns, certificate-search history, custom rules, retained
relationship observations, saved Bulk sessions, website snapshots,
investigation templates, Bulk review state and Analyst Review Item state. They
are visible to anyone able to use the browser profile.

Tab-scoped dictionaries, candidate handoffs, guided-investigation progress and
similar transient state use bounded memory or `sessionStorage`. The one-use
candidate handoff uses a random token and is removed when accepted. Appearance
preference can use `localStorage`. These records are not uploaded merely because
they exist.

The browser can derive searches, filters, timelines, relationship views,
posture comparisons, evidence-gap queues and response preflight from retained
records without another request. Derived views do not create evidence, prove a
target state or silently mark an item reviewed.

Creating or refreshing a Case is deliberate. Current Case schema 14 can retain
the exact normalised submitted hostname on a new evidence snapshot and the
observation time of a reviewed response route. Published v2 Case schema 13 and
exact public v1 Case schema 12 remain readable and migrate directly; migrated
fields can remain null because WHOISleuth does not reconstruct them from weaker
evidence. Case report v10 JSON and Markdown do not add the snapshot hostname.

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

Selected registration bootstrap and public registration responses can remain
briefly in server memory to reduce duplicate upstream requests. Optional
security.txt and external intelligence results are not retained as a hosted
investigation record. Hosting, edge and function providers can retain ordinary
request or function-log metadata under their own configured policies.

Deep collection can disclose the target or related bounded query to the
applicable registry or registrar, public DNS resolver, nameserver, HTTP origin,
TLS endpoint, certificate-search service, security.txt endpoint or selected
public-address registration service. Each recipient can observe the source
network address and apply its own logging, rate limits and retention.

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

## Local CLI and active operations

The CLI runs on the operator's machine and does not use the hosted application
or session. Offline plans, comparisons, verification, reports and local imports
make no network request. Networked commands disclose their target and source
boundary in focused help and can be rate-limited or logged by those sources.

Local input is bounded before parsing. Output goes to stdout unless the operator
deliberately selects a local file. Existing files are refused unless replacement
is explicit. CLI files are not uploaded to WHOISleuth and remain under the
operator's retention and deletion control.

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

Imports and exports are deliberate local actions. Importers validate bounded
envelopes before preview or merge; omission never deletes destination data.
Imported evidence remains attributed to its file and declared source and is not
treated as freshly collected or true merely because it parsed.

The current writer emits workspace archive version 7. Exact versions 5 and 6
remain readable. Version 5 migrates to an explicitly empty Analyst Review Item
section without inventing decisions; version 6 migrates its existing sections
directly. Versions 1 through 4 are unsupported. Future versions fail without
empty import, reset, deletion or rewrite. Release 1.47.4 can export the exact
version-5 and Case-schema-12 public baseline before moving to v2.

The optional encrypted workspace envelope remains version 1. Encryption and
decryption happen in browser memory using password-based authenticated
encryption. The passphrase and derived key are not persisted or sent. Encryption
protects the downloaded file while locked, not an open Console, active IndexedDB,
malicious extension, compromised device or weak passphrase.

Different exports have different sensitivity:

- a full saved Lookup can contain targets, bounded source endpoints and timings,
  raw RDAP publications, WHOIS response bodies and publicly published contacts;
- current Lookup evidence schema 27 excludes raw registration payloads,
  expanded contacts, credentials and complete query-bearing URLs, while exact
  public schema 26 remains readable and may contain public contact fields;
- Case, workspace, Case-pack, graph, campaign and response files can identify
  investigated targets or contain analyst-authored material; and
- defensive exports contain reviewed selected domains and rollback metadata but
  are never uploaded or applied automatically.

Review every file before sharing.

Checksums and signatures can detect content change or verify a mathematical key
relationship under their named contract. They do not prove evidence accuracy,
authorship, signer identity, recipient authorisation or safety.

## Optional local rendered capture

The repo-local capture package is an explicit authorised-capture action outside
hosted and distributable collection. It executes remote page JavaScript in a
disposable network-bounded browser. Each admitted resource operator receives the
exact requested URL, including its path and query.

The local manifest does not include dedicated request-path or query fields, but
the page-controlled title can reproduce them. A local fixed-size screenshot
necessarily preserves visible rendered content and may include page text or a
page-reflected path or query until the operator deletes it. Captures remain
local, are not uploaded to WHOISleuth and persist until the operator deletes
them. Bounded text and tag-sequence digests are comparison aids, not exact DOM,
visibility or page-identity claims.

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

IndexedDB is plaintext, hosting providers can retain ordinary logs, public
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
