# Privacy Notice

This is a template for whoever operates a deployment of this tool
(self-hosted or on Netlify) to adapt - fill in `[operator contact]` below
and adjust anything that doesn't match your actual deployment before
publishing it to anyone you share `SITE_PASSWORD` with.

## What personal data this tool processes

Looking up a domain returns whatever registrant contact data (name,
organisation, email, phone, address) the domain's registry or sponsoring
registrar chooses to expose in its public RDAP/WHOIS response. This tool relays
data those sources already publish rather than building a separate registrant
database. Other bounded technical and application data processed by optional
features is described below. Most registry sources redact contact data by
default (see the README), so many lookups return no personal data at all.

## Where that data goes

- **Single and bulk lookups**: proxied through the server per-request, held
  in memory only for the duration of that request, never written to a
  database or disk server-side. Single Lookup can display multiple bounded
  registry-published contacts per RDAP role and bounded normalized WHOIS
  contacts for registrant, administrative, technical, billing, and abuse
  roles. Bulk, watchlist, and case data retain only the existing compact
  primary-contact fields; these expanded contact inventories are not copied
  into browser-local investigation stores.
- **Registrar RDAP in deep Lookup**: when a registry RDAP object publishes a
  complete HTTPS link for the same domain at the sponsoring registrar, a deep
  non-compact Lookup can relay that one public registrar object as a separately
  attributed source. It is briefly cached in server memory like other registry
  responses, displayed in the transient Lookup result, and never consulted by
  availability or scoring. Fast and compact Bulk requests do not perform the
  follow-up, and registrar RDAP is not copied into browser-local watchlists,
  cases, or other compact stores. The deliberate raw unified-response view can
  contain it. The structured Lookup evidence export can retain the normalized
  portable-field comparison between registry and registrar publications,
  including both displayed source values and source-health states, but excludes
  the registrar raw object, contacts, entities, links, notices, and
  source-specific handles.
- **Optional archived-verdict search**: if the operator explicitly enables the
  URLscan adapter and a user selects it for a deep single-domain Lookup, the
  server sends only the canonical registrable domain to URLscan's Search API.
  It searches existing public scan history and never submits the domain or URL
  for scanning. The provider also receives ordinary API request metadata and
  associates the query with the operator's API credential under its own
  privacy and retention policy. WHOISleuth keeps no provider cache; the bounded
  normalized response is displayed transiently, excluded from browser-local
  stores and the structured Lookup evidence export, and never affects
  availability. Fast and compact Bulk paths never make this request.
- **Optional malware-host search**: if the operator explicitly enables the
  URLhaus adapter and a user selects it for a deep single-domain Lookup, the
  server posts only the canonical registrable domain to URLhaus's host API.
  It searches existing malware-distribution records and never submits a URL,
  sample, or report. The provider also receives ordinary API request metadata
  and associates the query with the operator's API credential under its own
  privacy and retention policy. WHOISleuth keeps no provider cache; the
  bounded normalized response is displayed transiently, excluded from
  browser-local stores and the structured Lookup evidence export, and never
  affects availability. Fast and compact Bulk paths never make this
  request. Community access is subject to not-for-profit fair-use terms;
  commercial deployments may require a paid provider agreement.
- **Optional malware-IOC search**: if the operator explicitly enables the
  ThreatFox adapter and a user selects it for a deep single-domain Lookup, the
  server sends only the canonical registrable domain in an exact-match search
  to ThreatFox. It searches retained malware indicators and never submits an
  IOC, URL, sample, or report. The provider receives ordinary API request
  metadata and associates the query with the operator's abuse.ch credential
  under its own privacy and retention policy. WHOISleuth keeps no provider
  cache; the bounded normalized response is displayed transiently, excluded
  from browser-local stores and the structured Lookup evidence export, and
  never affects availability. Fast and compact Bulk paths never make
  this request. Older indicators expire from the community API, and commercial
  deployments may require a paid provider agreement.
- **Derived external Risk context**: optional provider payloads stay transient
  and separately attributed. A lone publisher, a neutral miss, a failed
  provider, an unknown provider, or a non-phishing/non-malware category adds no
  Risk points. When positive qualifying records are corroborated across at
  least two independent publisher families, Risk model v5 can add one bounded
  factor. Multiple datasets operated by the same publisher count as one source.
  Browser-local cases and reports can retain the resulting score, model version,
  and factor label, but not the raw provider findings, references, or payloads.
- **IDN/confusable review**: performed locally in the browser from the domain
  already being displayed and, when present, the active Brand Profile's
  bounded official-domain list. It makes no additional network request and is
  not added to watchlists or analyst cases. Deliberate Lookup evidence and
  Bulk CSV exports can include the displayed analysis.
- **Deep DNS intelligence**: the server performs bounded public A, AAAA,
  CNAME, NS, MX, SPF, DMARC, and CAA queries for a registered domain. Only SPF
  and DMARC policy TXT records are retained; unrelated TXT records are
  discarded. Full Lookup and deliberate exports can contain these point-in-time
  records, while watchlists and analyst cases keep only their existing compact
  mail and nameserver fields.
- **HTTP intelligence**: Lookup can display the bounded final URL, redirect
  provenance, selected response/header metadata, and response-body fingerprint
  collected by a requested deep check. Bulk results, watchlists, and analyst
  cases retain only the final origin (never its path or query), response status,
  transport, redirect count/flags, MIME type, and presence-only security-header
  tokens. Monitor can derive a capped relationship graph and table from the
  typed projection of bounded final-origin and nameserver-set observations
  already retained in browser-local case histories. This makes no request and
  saves no separate relationship record. A deliberate local graph download can
  include the filtered case domains, exact retained relationship values,
  method, classification, source, observation time, completeness, truncation,
  limitations, and up to 8 bounded source observations per relationship as
  versioned JSON, GraphML, or GEXF. It excludes case notes, status, disposition,
  raw registry or page responses, contacts, credentials, and transient graph
  view state. Raw header values, attempt errors, and redirect inventories are
  not copied into browser-local investigation stores or graph exports.
- **Public synthetic demo** - the unauthenticated demo uses fixed fictional
  fixtures on reserved domains to represent Dashboard, Brands, Discover, Bulk,
  Lookup, and Monitor without performing a live analysis request. Its bounded
  stage flags, selected fixture identifier, synthetic case status/note, and
  follow-up state are isolated to the current tab's `sessionStorage` under
  `whoisleuth:synthetic-demo:v1`, never enter production browser-local stores,
  and are removed by the demo reset action or when that tab session ends. Any
  downloaded demo package is explicitly marked as synthetic and is not a live
  finding or evidence report.
- **Guided investigations**: an authenticated user can optionally start a fixed
  brand-sweep, infrastructure-pivot, or new-domain-triage guide for one canonical
  domain. The versioned storage contract calls the selected guide a recipe;
  schema version 2 keeps only that recipe identifier and domain,
  creation/update timestamps, active or paused state, and bounded stage
  approval, opened, and outcome markers in the current tab's `sessionStorage`
  under `whoisleuth:investigation-guide:v2`. A deployed version 1 navigation
  record can normalize into the new-domain triage recipe when no current record
  exists; future records remain untouched. Guide progress is not sent to the
  server or copied into persistent browser stores, and it is not treated as
  evidence completion. A network stage requires an explicit approval marker
  before its tool link becomes available, but opening that link still
  never starts a lookup, search, scan, submission, export, or Monitor action.
  **Export summary** requires confirmation and deliberately downloads only a
  versioned compact progress record without raw evidence, notes, credentials,
  provider responses, or scan results. A read-only local checkpoint derives
  retained observation and relationship counts from the typed investigation
  projection without deciding stage completion. **End guide** removes both
  current and migrated legacy tab records,
  and closing the tab session removes them with the rest of that tab's session
  storage.
- **TLS and certificate intelligence**: a requested deep domain scan resolves
  the domain through the public-address guard and opens one direct TLS
  connection to one validated address while retaining the domain as SNI.
  Lookup and its deliberate evidence export can include the connected public
  address, negotiated protocol/cipher/ALPN, runtime trust and hostname outcome,
  bounded public certificate identity/validity/SAN/public-key metadata, and a
  capped certificate-chain summary. Certificate bytes and TLS session material
  are not retained. Deep Bulk may compare the exact leaf-certificate SHA-256
  transiently within the current result set; the derived relationship is not
  persisted or treated as ownership evidence. The richer profile is not copied
  into browser-local cases, watchlists, profiles, or Certificate Transparency
  history.
- **Page identity**: a requested deep Lookup can derive bounded metadata from
  the homepage HTML already captured by the HTTP probe. This can include the
  document language, canonical and meta-refresh targets, selected Open Graph
  fields, generator metadata, form counts, external form-action origins,
  normalized resource counts, external resource/embedded origins, mail-contact
  domains, download context, and recognized public tracking identifiers. URL
  credentials, queries, fragments, resource/download paths, form-action paths,
  and complete email addresses are not retained.
  Page identity can also include versioned SHA-256 fingerprints for the exact
  captured body, noise-reduced normalized HTML, static tag structure, and form
  structure; a fuzzy visible-text SimHash; and bounded external-resource-host
  and public-tracking-identifier sets with deterministic set digests.
  Intermediate normalized markup and visible text are discarded immediately
  after fingerprinting. These digests support comparison but do not prove page
  authorship, ownership, intent, or maliciousness.
  The complete summary is not copied into Bulk, watchlists, or analyst cases;
  it appears only in the transient Lookup result and a deliberate Lookup
  evidence export. A user can explicitly capture a much narrower official-site
  baseline in a Brand Profile. That browser-local baseline retains only the
  observation time, official domain, page title, canonical host, favicon
  hashes, versioned page fingerprints, and bounded external-resource host and
  recognized tracking-identifier sets. It never stores page HTML, URL paths,
  query strings, headers, redirects, parser diagnostics, or raw responses.
  Bulk can transiently derive bounded scan-local relationships from its
  nameserver, IP-address, favicon, recognized public-tracking-identifier, and
  configured official-asset-host observations. These relationships stay in
  memory for the current result set, trigger no additional requests, and are
  not copied into browser-local stores or exports.
  When a compatible current Lookup result is available, its normalized
  fingerprints are compared with the active profile baseline locally in the
  browser. Normalized HTML, visible text, DOM/form structure, resource hosts,
  and tracking identifiers remain separate comparison components; there is no
  combined similarity score and the comparison does not affect Risk scoring.
  The derived comparison itself is transient and is not added to cases,
  watchlists, profiles, or evidence exports.
- **Technology indicators**: a requested deep Lookup can derive a versioned
  technology profile from the selected HTTP server header, generator metadata,
  normalized resource origins, and capped static HTML already collected for
  the page-identity analysis. The profile retains only curated technology
  names, categories, confidence levels, evidence classes, and fixed
  explanations. It does not retain matched markup, arbitrary header values,
  URL paths, or signature input. This analysis makes no additional request,
  changes no availability or Risk result, and is not copied into compact
  browser-local cases, watchlists, profiles, or Bulk results. An unmatched
  signature is not evidence that a technology is absent.
- **Brand Profiles / Shortlist / Watchlist / Campaigns / Certificate search
  history**: saved in your own browser's `localStorage`, not on the server -
  only visible to whoever is using that browser.
  The appearance selector can also retain one bounded `dark`, `light`, or
  `system` preference under `whoisleuth:theme:v1`. It is never sent to the
  server. It is included only when you deliberately download a unified
  workspace archive so the receiving browser can restore the selected
  appearance; without a saved value the site follows the browser's
  operating-system preference.
  Campaigns retain a bounded label, optional description, and normalized case
  domain membership only. They do not copy case evidence, notes, status, or
  disposition, and deriving or editing them makes no network request.
  Watchlists retain a bounded timeline of material scan changes alongside
  their latest results; older timeline events are automatically discarded.
  Structured Certificate Transparency searches retain bounded per-keyword
  domain baselines and check summaries so Discover can identify domains that
  are new since the previous complete search. Capped or legacy results never
  replace a complete baseline. Brand Profile page baselines are captured only
  on explicit request and are stored only when the profile is saved. A failed
  or inconclusive recapture does not replace an existing baseline.
  Cleared via each entry's **Remove**/**Delete** button, the **Clear all**
  button in either panel, the campaign deletion controls, the deletion controls
  under **Previous certificate searches**, or by clearing the browser's site
  data. Clearing site data also removes the saved appearance preference.
- **Optional hosted scheduled monitoring**: disabled by default. When the
  operator explicitly enables the Netlify worker and a scheduled watchlist is
  present, it retains the bounded watchlist name, canonical domains, interval,
  timestamps, compact fast registration evidence, six recent change events,
  and an opaque resumable run cursor. It never stores raw RDAP/WHOIS payloads,
  expanded contacts, analyst notes, browser sessions, or deep website content.
  The complete state is encrypted and authenticated with AES-256-GCM before it
  is written to the site-wide Netlify Blob store; Netlify stores the ciphertext
  and ordinary object metadata, while its function runtime necessarily
  processes the decrypted state transiently to run requested public lookups.
  The scheduled worker has no public route. A separate authenticated management
  route lets a signed-in user deliberately schedule a browser-local watchlist,
  read the bounded hosted projection, pause/resume it, replace its hosted
  snapshot, restore that compact snapshot into the current browser, or delete
  the hosted copy. Mutations require a same-origin request and request bodies
  are capped at 1 MiB. This deployment uses one shared login and has no
  per-user roles or audit identities, so every person given that login can view
  and manage the same hosted scheduled-watchlist state. Restoring a snapshot
  creates or replaces a browser-local watchlist only after explicit
  confirmation. Disabling the worker stops Blob and lookup work but does not
  delete existing ciphertext; the operator or an authenticated user must
  remove hosted state deliberately when its history is no longer required.
  Replacing or losing the encryption key without migrating the state makes the
  retained ciphertext unreadable.
- **Local exports**: CSV, JSON, Markdown, HTML, GraphML, GEXF, and other stated
  formats are downloaded directly to your device. Campaign exports
  contain campaign labels, descriptions, domain membership, timestamps, and
  stated interpretation limits; they do not include case evidence or notes.
  Single-lookup
  evidence JSON includes the raw RDAP and WHOIS responses, so it may contain
  registry-published contact data. A deliberate unified workspace archive can
  contain cases and their analyst notes, campaigns, Brand Profiles, watchlists,
  shortlist entries, custom detection rules, active-profile selection, and
  theme preference. It uses a versioned manifest with per-section SHA-256
  checksums, previews conflicts before a non-destructive merge, and excludes
  sessions, passwords, API credentials, hosted-monitor encryption keys, raw
  upstream payloads, tab state, Certificate Transparency history, and unrelated
  browser storage. It is unencrypted, so secure it like the analyst records it
  contains. Nothing is uploaded or retained by the
  server when you export. From that point on, the file is yours to manage -
  store it appropriately and delete it once you no longer need it.
- **Official-domain posture audits**: handled per request and discarded. The
  server queries public DNS, the domain registry's RDAP service for DNSSEC
  delegation status, and (only when advertised) the official domain's own
  `mta-sts` HTTPS policy host. DKIM selector names saved in a Brand Profile
  are included in the request so those exact public DNS records can be checked.
- **Outreach / abuse-report drafts**: build a `mailto:` link and copy
  pre-filled text to your clipboard. Nothing is sent automatically; a
  human reviews and sends each one from their own mail client.
- **Optional distributed operation limits**: when the operator configures the
  shared REST counter provider, it receives only bounded operation classes,
  opaque random lease identifiers, expiry timestamps, and a one-way hash of
  the already-opaque session fingerprint. If the operator also enables durable
  usage accounting, it stores bounded operation-feature identifiers, fixed
  24-hour/30-day bucket identifiers, and integer counts. It does not receive
  lookup targets, registry data, evidence, responses, notes, browser-local
  records, or session tokens. Leases expire after five minutes and empty keys
  are removed on release; usage counters expire shortly after their fixed
  window ends. Deployments without this optional configuration keep
  concurrency state in server memory only and have no durable usage counters.

The signed session cookie is stateless and valid for up to 30 days. Signing
out removes it from that browser but does not revoke a captured copy; the
operator must rotate `SESSION_SECRET` (or the shared password when it is also
used for signing) to invalidate all outstanding sessions before expiry.

## Audience measurement

This template does not assume that audience measurement is enabled. Deployments
should avoid advertising, behavioural profiling, and cross-site tracking. If an
operator introduces privacy-preserving audience measurement, it should be
limited to public pages and documented here before use, including its provider,
data fields, retention, and available controls. Protected-route activity,
lookup terms, query strings, saved evidence, and session identifiers should
remain outside that measurement surface.

## Legal basis for processing

Using this tool to monitor domains/brands you have a legitimate interest in
(the **Report abuse** flow, watchlist monitoring) is generally supported by
"legitimate interest." Using the **outreach** (acquisition) flow to contact
a registrant is closer to direct marketing and a weaker legitimate-interest
case - keep it low-volume, human-reviewed (already enforced by the
mailto-link pattern), and honor any request to stop being contacted.

## Data subject rights

Since there is no individual user-account database, a request from a
registrant to access/delete their data is fulfilled by deleting whatever you
personally exported (CSV/JSON files) or saved (shortlist/watchlist entries and
history) about them, and not re-querying afterward. Use the **Clear all**
buttons for browser-local records; an operator who enabled hosted scheduled
monitoring must also remove the relevant encrypted Blob state. Public support
requests are not handled through the deployed site; people authorised to use
the protected console should contact the operator who provided access. Direct
data-subject requests to:
`[operator contact]`.

## Hosting / sub-processors

- Self-hosted: data stays on whatever server you run `server.mts` on.
- Netlify: request handling runs on Netlify's infrastructure. If optional
  scheduled monitoring is enabled, its Functions runtime also performs the
  bounded lookups and its site-wide Blobs service retains the application-
  encrypted state and ordinary object metadata. Check Netlify's own Data
  Processing Addendum if you're operating this beyond a personal/internal
  scale.
- Upstash: only when the operator explicitly configures distributed operation
  limits, the minimal lease and optional fixed-window counter metadata
  described above is processed through its HTTPS REST service. Operators
  should review its terms, select an appropriate region and retention posture,
  and keep the write token secret.
- Upstream RDAP/WHOIS servers, public DNS, `crt.sh` (Certificate Transparency
  search), a deep-scanned domain's TLS endpoint, and an audited domain's own
  MTA-STS policy host are queried live,
  on demand - they're the data sources, not sub-processors this tool shares
  stored data with.
- URLscan: only when the operator configures the optional adapter and a user
  explicitly selects archived-verdict search, its API receives the canonical
  registrable domain and ordinary request metadata. Operators should review
  URLscan's terms, privacy policy, account quota, and commercial-use posture;
  the integration uses search only and never submits targets for scanning.
- URLhaus: only when the operator configures the optional adapter and a user
  explicitly selects malware-host search, its API receives the canonical
  registrable domain and ordinary request metadata. Operators should review
  the provider's fair-use terms, privacy policy, account quota, and
  commercial-use posture; the integration performs host lookup only and never
  submits URLs, samples, or reports.
- ThreatFox: only when the operator configures the optional adapter and a user
  explicitly selects malware-IOC search, its API receives the canonical
  registrable domain and ordinary request metadata. Operators should review
  abuse.ch fair-use terms, privacy policy, account quota, data-retention window,
  and commercial-use posture; the integration performs exact-match search only
  and never submits indicators, URLs, samples, or reports.

## Security measures

Shared-password session auth (`lib/auth.mts`), per-IP rate limiting
(`lib/rate-limit.mts`), SSRF-guarded outbound fetches (`lib/safe-fetch.mts`), and
public-address-pinned one-connection TLS collection (`lib/tls-intelligence.mts`)
are the technical measures in place. See [LICENSE](LICENSE) - provided as is,
with no warranty.
