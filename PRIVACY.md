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

- **Custom Discover dictionary**: optional pasted or imported terms are
  normalized and capped at 100 unique entries, 32 characters per term, and
  4,096 input characters. They remain transient in the current browser tab,
  are not sent to the server or saved in the browser-local workspace, and are
  used only after the user selects **Generate candidates**. If selected
  candidates continue to Bulk, only the resulting domain names and bounded
  mutation provenance follow the normal lookup path; the original dictionary
  list does not.
- **Single and bulk lookups**: proxied through the server and never written to
  an ordinary investigation database or disk server-side. Request data is
  transient, while bounded registry bootstrap and selected public RDAP/WHOIS
  results can remain briefly in memory to reduce duplicate upstream requests.
  Single Lookup can display multiple bounded
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
- **Observed network context in deep Lookup**: after the existing TLS and DNS
  collection, a deep non-compact domain Lookup can select one retained public
  endpoint address and perform one logical IP RDAP enrichment through the
  existing bounded safe-fetch and cache boundary. The transient result keeps a
  separately attributed network name and holder, handle, bounded CIDRs, address
  range, country, network type, database freshness, and source provenance. Raw
  IP RDAP data and published network contacts are excluded from this summary.
  It can be displayed and deliberately exported, but it is not copied into
  compact Bulk responses, cases, watchlists, profiles, or monitoring state and
  never affects availability or Risk. The underlying public IP RDAP response is
  briefly cached in server memory like other RDAP responses. The selected
  address can belong to a CDN, proxy, load balancer, or shared edge and is not
  proof of an origin host, hosting control, ownership, intent, or maliciousness.
- **Analyst-controlled external evidence pivots**: a completed Lookup can show
  a collapsed set of ordinary links to reviewed public registration,
  top-level-domain delegation, Certificate Transparency, archived-page,
  routing, interconnection, and site-status tools. The links are constructed
  only from a locally revalidated canonical domain, top-level domain, public
  address or prefix, or public ASN already present in the Lookup result.
  WHOISleuth does not prefetch those destinations, call their APIs, embed their
  pages, retain their responses, or use them for availability, Risk, cases,
  exports, Bulk, or monitoring. Each link names the destination and exact value
  it will receive. That value leaves WHOISleuth only after the analyst opens
  the link, under the destination's own privacy and retention terms.
- **Optional security.txt disclosure lookup**: when selected for a deep
  single-domain Lookup, the server starts one bounded HTTPS collection at the
  standardized security.txt location on the exact entered hostname. It retains
  only normalized published contacts, policy and encryption references,
  preferred languages, canonical locations, expiry, and source health. The
  response body is discarded after parsing and no server cache is used. The
  normalized result can be displayed and deliberately exported, but it is not
  copied into compact Bulk responses, cases, watchlists, profiles, or
  monitoring state and never affects availability or Risk. Publication does
  not authorize testing or prove that a contact is monitored.
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
  least two independent publisher families, Risk model v6 can add one bounded
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
  mail and nameserver fields. Deep non-compact domain Lookup can add one SOA
  query and retain its bounded zone-maintenance fields. It can also send one
  HTTPS resource-record query through up to three validated literal addresses
  from the deployment's configured DNS resolvers. The result retains bounded
  service priority, mode, effective target, TTL, ALPN identifiers, port,
  address hints, mandatory keys, and the names and lengths of other recognized
  parameters. Opaque parameter values are discarded. WHOISleuth does not
  follow service-binding aliases or connect to published targets, ports, or
  address hints, and it does not disclose the query to a new third-party DNS
  service. A deep non-compact
  Lookup of a public IP address can add one PTR query and retain up to eight
  normalized reverse-DNS names as a separately attributed source. Fast,
  compact, Bulk, monitoring, private/special-purpose IP, and availability/Risk
  paths do not run the PTR query. These requests use the deployment's DNS
  resolver. PTR, SOA, and HTTPS service-binding publications are public
  point-in-time context and do not prove ownership, hosting control, intent,
  or safety.
- **HTTP intelligence**: Lookup can display the bounded final URL, redirect
  provenance, selected response metadata, presence-only security-header
  markers, and response-body fingerprint
  collected by a requested deep check. Bulk results, watchlists, and analyst
  cases retain only the final origin (never its path or query), response status,
  transport, redirect count/flags, MIME type, and presence-only security-header
  tokens. Monitor can derive a capped relationship graph and table from the
  typed projection of bounded final-origin and nameserver-set observations
  already retained in browser-local case histories. That automatic projection
  makes no request and saves no separate relationship record. A bounded
  connected-cluster view can be labelled, split, merged, or dismissed in the
  current browser view without changing any case or source observation. Its
  deliberate JSON export contains the reviewed cluster projection, exact
  contributing relationship values, case domains, provenance, completeness,
  and limitations, but excludes case notes, contacts, raw upstream responses,
  credentials, and unrelated case fields. A deliberate
  local graph download can
  include the filtered case domains, exact retained relationship values,
  method, classification, source, observation time, completeness, truncation,
  limitations, and up to 8 bounded source observations per relationship as
  versioned JSON, GraphML, or GEXF. It excludes case notes, status, disposition,
  raw registry or page responses, contacts, credentials, and transient graph
  view state. Selected security-policy values are discarded after the
  transient analysis described below. Other raw header values, attempt errors,
  and redirect inventories are not copied into browser-local investigation
  stores or graph exports.
- **Analyst-selected relationship observations**: Bulk can compare bounded
  nameserver, IP-address, native certificate, public tracking-identifier,
  favicon, and configured official-asset-host observations inside the current
  result set. Nothing is saved automatically. Selecting **Retain observation**
  stores only one normalized relationship value, its bounded member domains,
  method, observed and retained times, source and schema version, completeness,
  truncation, fixed description, and stated limitations in the browser's
  IndexedDB database. It excludes the complete Bulk result, raw RDAP/WHOIS or
  page responses, contacts, credentials, and unrelated DNS or HTTP evidence.
  Monitor can review or delete the record, local search can find its known
  fields, and a disposable typed envelope can adapt it into the local search
  and graph projection without a new request or another stored copy. The
  IndexedDB record remains authoritative; the envelope is bounded, performs no
  writes, and is discarded after use. The record is derived evidence and does
  not prove ownership, coordination, intent, or maliciousness.
- **Public synthetic demo** - the unauthenticated demo uses fixed fictional
  fixtures on reserved domains to represent Dashboard, Brands, Discover, Bulk,
  Lookup, and Monitor without performing a live analysis request. Its bounded
  stage flags, selected fixture identifier, synthetic case status/note, and
  follow-up state are isolated to the current tab's `sessionStorage` under
  `whoisleuth:synthetic-demo:v1`, never enter production browser-local stores,
  and are removed by the demo reset action or when that tab session ends. Any
  downloaded demo package is explicitly marked as synthetic and is not a live
  finding or evidence report.
- **Transient Console navigation state**: Lookup and Bulk keep their current
  form values, results, filters, sorting, and pagination in memory during
  authenticated client-side navigation in the same tab. This state includes
  the complete Lookup response currently displayed, including its
  separately attributed raw RDAP and WHOIS source sections, rather than a
  compact evidence snapshot. It is not written to `localStorage`,
  `sessionStorage`, IndexedDB, the server, or a workspace archive. Signing out,
  a full reload, or closing the tab clears it. Deliberate case, watchlist,
  shortlist, download, and archive actions remain the only ways those tools
  retain or export selected evidence.
- **Guided investigations**: an authenticated user can optionally start a standard
  brand-sweep, infrastructure-pivot, or new-domain-triage guide for one canonical
  domain, or a bounded analyst-authored template derived from one of those
  guides. The versioned storage contract calls the selected guide a recipe;
  schema version 4 keeps only that recipe identifier, an optional compact
  template snapshot, official or starting
  domain, an optional analyst-selected candidate domain, up to 25 canonical
  domains carried from a guided Bulk comparison, an explicit truncation marker,
  creation/update timestamps, active or paused state, and bounded stage
  approval, opened, and outcome markers. Partial and skipped stages also retain
  a required review reason of up to 500 characters in the current tab's `sessionStorage`
  under `whoisleuth:investigation-guide:v4`. Deployed version 1, 2, and 3 records
  can normalize without inventing a custom template when no current record
  exists; future records remain untouched. A saved template can customise
  bounded guidance, omit allowlisted steps, and add approval gates. It cannot
  add arbitrary actions, run code, start collection, submit evidence, change a
  case, or remove a required request gate. Guide progress is not sent to the
  server or copied into persistent browser stores, and it is not treated as
  evidence completion. The guide can pre-fill or preserve a bounded profile,
  discovery, lookup, Bulk, or case target, and carries the bounded comparison
  set into a Monitor review queue without creating cases automatically. It
  focuses the relevant tool control and can show a compact return control while
  its main panel is outside the viewport; none of those behaviours submits the
  focused form. A network stage displays its request implications and requires
  an explicit approval marker before navigation, but opening that tool still
  never starts a lookup, search, scan, submission, export, or Monitor action.
  **Export summary** requires confirmation and deliberately downloads only a
  versioned compact progress record, including bounded stage-review reasons,
  without raw evidence, case notes, credentials, provider responses, or scan
  results. A read-only local checkpoint derives retained observation and
  relationship counts from the typed investigation projection. A separate
  case-handoff checklist summarizes browser-local disposition, decision,
  evidence-pin, and open-question structure. Neither view decides stage
  completion or makes a finding about the target. **End guide** removes both
  current and migrated legacy tab records,
  and closing the tab session removes them with the rest of that tab's session
  storage.
- **TLS and certificate intelligence**: a requested deep domain scan resolves
  the domain through the public-address guard and opens one direct TLS
  connection to one validated address while retaining the domain as SNI.
  Lookup and its deliberate evidence export can include the connected public
  address, negotiated protocol/cipher/ALPN, runtime trust and hostname outcome,
  bounded public certificate identity/validity/SAN/public-key metadata,
  signature algorithm and OID, extended-key-usage purposes, fixed SAN class
  counts, classified AIA presence counts, and a capped certificate-chain
  summary. Email, URI, directory-name, registered-ID, other-name, and
  unclassified SAN values are counted but not retained. AIA responder and
  issuer locations are classified as HTTP, HTTPS, or other, then discarded
  without being followed. Certificate bytes and TLS session material are not
  retained. Deep Bulk may compare the exact leaf-certificate SHA-256
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
  A transient brand-mimicry review can organize those comparison components
  with existing favicon, official-asset, password-field, and bounded
  review-language observations. It adds no collection, combined score, or
  persistence, and it does not infer copying, ownership, control, intent, or
  maliciousness.
  The derived comparison itself is transient and is not added to cases,
  watchlists, profiles, or evidence exports.
- **Service and transition review**: a deep Lookup can organize already
  collected DNS aliases, nameservers, web routing, mail publication, TLS
  source health, lifecycle statuses, and transfer locks into transient manual
  review prompts. Alias targets are not followed, provider accounts are not
  queried, and claimability is not tested. The derived views are not persisted
  or exported and do not label a dependency dangling, vulnerable, safe, or
  controlled. Registry and registrar policy entries are prompts for external
  confirmation, not inferred policy facts.
- **Structured identity metadata**: a requested deep Lookup can examine
  JSON-LD already present in the captured homepage response. It retains only
  curated schema types, bounded labels, declared HTTP(S) origins, and
  normalized `sameAs` hostnames. It discards the raw JSON-LD immediately after
  analysis and never retains contact fields, arbitrary properties, complete
  URLs, paths, queries, or fragments. Referenced JSON-LD is not fetched.
  Publisher-declared metadata does not prove identity, ownership, control,
  safety, or maliciousness. This analysis makes no additional request, does
  not affect availability or Risk scoring, and is excluded from compact Bulk
  results and browser-local cases, watchlists, and profiles. It appears in the
  transient deep Lookup result and can be included in a deliberate full Lookup
  evidence export.
- **Credential collection surface**: a requested deep Lookup can classify
  capped live input elements already present in the captured homepage response
  from semantic `type` and `autocomplete` declarations. It retains only fixed
  counts for password, email, username, one-time-code, and payment-related
  purposes, form methods, and same-origin, external-origin, missing, cleartext,
  or unclassified action relationships. Category counts can overlap, and
  cleartext is a transport subset of a same-origin or external-origin count.
  Field names, values, labels, placeholders, arbitrary attributes, complete
  action URLs, paths, queries, and fragments are never retained. External form
  submission can be legitimate and is not a phishing, vulnerability, ownership,
  intent, or maliciousness finding. This analysis makes no additional request,
  does not interact with a form, does not affect availability or Risk scoring,
  and is excluded from compact Bulk results and browser-local cases, watchlists,
  and profiles. It can appear in a deliberate full Lookup evidence export.
- **Technology indicators**: a requested deep Lookup can derive a versioned
  technology profile from the selected HTTP server header, generator metadata,
  normalized resource origins, and capped static HTML already collected for
  the page-identity analysis. A site-builder or commerce platform is not
  identified from a retained third-party resource origin alone; that origin
  must be corroborated by page, generator, or additional storefront evidence.
  Delivery origins remain separately attributed. The profile retains only curated technology
  names, categories, confidence levels, evidence classes, and fixed
  explanations. A nested browser-library profile can also match up to 64
  observed script elements and 65,536 cumulative inline-script characters
  against a pinned local Retire.js catalogue. It retains only the apparent
  component and version, detection method, bounded advisory identifiers,
  weakness classes, severity, catalogue version, source health, and fixed
  limitations. Referenced scripts are not fetched or executed, and script
  references, paths, queries, matched inline content, and hashes are not
  retained. An advisory match does not establish reachability or
  exploitability. The technology profile does not retain matched markup,
  arbitrary header values, URL paths, or signature input. This analysis makes
  no additional request, changes no availability or Risk result, and is not
  copied into compact browser-local cases, watchlists, profiles, or Bulk
  results. An unmatched signature is not evidence that a technology or
  browser library is absent.
- **Page role and client-side behaviour**: a requested deep Lookup can derive
  fixed, explainable page-role labels and client-side behaviour indicators from
  the same capped static HTML tokenizer pass. Role evidence uses only fixed
  descriptions derived from semantic form declarations, selected static
  markers, the bounded page title, and existing parked-page classification.
  Behaviour evidence uses only fixed indicators and bounded counts for inline
  handlers and selected browser APIs in retained inline-script prefixes.
  Referenced scripts are not fetched, code is not executed, and no script
  contents, references, paths, queries, hashes, page text, arbitrary
  attributes, or matched source fragments are retained. These heuristic
  profiles do not establish purpose, legitimacy, tracking, credential theft,
  vulnerability, reachability, execution, ownership, intent, safety, or
  maliciousness. They are excluded from compact Bulk results and ordinary
  browser-local case, watchlist, and profile records, but can appear in a
  deliberate full Lookup evidence export.
- **Passive security posture**: a requested deep Lookup can interpret the
  existing HTTP response, bounded static form and resource summaries, one TLS
  handshake, DNSSEC publication, and CAA query as a separate versioned posture
  profile. It retains fixed finding identifiers, categories, state and tone
  labels, fixed explanations, fixed evidence classes, and bounded counts. It
  can review bounded Content-Security-Policy, Strict-Transport-Security,
  Referrer-Policy, and response-cookie attributes from the selected response
  without another request. It does not copy response-header values, cookie
  names or values, paths, domains, nonces, hashes, reporting endpoints, TLS
  error strings, URLs, certificate contents, DNS record contents, or page
  markup into the derived profile.
  Observed absence is explicitly limited to the selected response or retained
  static evidence. The analysis makes no extra request, performs no active
  vulnerability testing, and does not affect availability or Risk scoring.
  It is excluded from compact browser-local cases, watchlists, profiles, and
  Bulk results, but is included when the user deliberately downloads a full
  Lookup evidence export.
- **Brand Profiles / Shortlist / Watchlist / Cases / Campaigns / Certificate
  search history / Custom rules / Retained relationship observations / Saved
  Bulk sessions / Website profile snapshots / Investigation templates**: saved
  as bounded records in your own browser's IndexedDB database, not on the
  server, and visible to whoever can use that browser profile. On the first
  authenticated load after this storage change, WHOISleuth normalizes
  supported legacy `localStorage` documents and
  copies them into a versioned IndexedDB manifest without deleting the source
  documents. Later IndexedDB writes are authoritative and do not automatically
  update those legacy sources. A deliberate Dashboard control can refresh the
  legacy compatibility copies before returning to an older build, subject to
  local-storage quota. The IndexedDB record codec is currently plaintext JSON;
  SHA-256 manifest digests detect corruption but are not encryption. A
  downloaded workspace archive remains the safer portable backup and can be
  wrapped in passphrase-based authenticated encryption entirely in the
  browser. This protects the downloaded file while locked, not the active
  browser database or an open Console.
  Saved Bulk sessions retain only the analyst-provided name, bounded domain
  queue, scan mode, compact settled result fields, per-source completion
  states, and session timestamps needed to load, compare, or resume unstarted
  domains. They exclude raw source payloads, complete Lookup responses,
  registrant and abuse contacts, and Certificate Transparency rows. Saving and
  loading make no network request; an explicit resume sends only domains that
  had no settled row through the selected Bulk mode.
  Compact Deep rows and saved Bulk sessions can retain one nullable null-MX
  observation alongside the existing MX, SPF, and DMARC booleans. The local
  lookalike mail-exposure review uses those bounded fields, source coverage,
  mutation provenance, registration state, and the active Brand Profile's
  configured mail posture. It makes no additional request and never connects
  to SMTP, sends a message, tests a mailbox or catch-all behavior, or retains
  message data. Its optional JSON export is generated locally, includes an
  integrity digest and stated limitations, and excludes raw DNS responses,
  contacts, scripts, and provider payloads.
  Website profile snapshots are retained only after an analyst explicitly
  saves a completed Deep Lookup. Each bounded record contains the canonical
  domain, observation and save times, collection completeness and truncation,
  curated technology identifiers, passive posture states, selected
  page-identity digests, and source-health states. It excludes raw RDAP,
  WHOIS, HTTP, HTML, contact, credential, and provider payloads. Snapshot
  comparison, deletion, import, and export happen locally and make no request.
  A changed or unavailable field is a review lead, not evidence of compromise,
  ownership, intent, safety, or maliciousness.
  Investigation templates retain only allowlisted guide-stage identities,
  bounded analyst-authored labels and instructions, expected evidence,
  completion criteria, and optional additional request gates. They cannot add
  arbitrary routes or operations, execute code, start requests, submit
  evidence, change a case, or remove mandatory gates. Saving, editing,
  importing, exporting, and deleting templates happen locally and make no
  network request.
  Bulk filters and group summaries are derived locally from the compact rows
  already in memory. Explicit batch selection is stored in the same bounded
  shortlist and does not make a request. A selected deep rescan sends only the
  selected domains; selected case, disposition, export, and watchlist actions
  operate only on that visible analyst-controlled set. Missing provider, ASN,
  hosting, registration, or mail fields remain unavailable rather than being
  converted into a negative conclusion.
  The appearance selector can also retain one bounded `dark`, `light`, or
  `system` preference under `whoisleuth:theme:v1`. It is never sent to the
  server. It is included only when you deliberately download a unified
  workspace archive so the receiving browser can restore the selected
  appearance; without a saved value the site follows the browser's
  operating-system preference.
  Campaigns retain a bounded label, optional description, and normalized case
  domain membership only. They do not copy case evidence, notes, status, or
  disposition, and deriving or editing them makes no network request.
  Cases can additionally retain bounded analyst-selected evidence pins,
  decision rationales, contact routes, reviewed response actions, follow-up
  dates, references, and outcomes. Lookup can derive a bounded local list of
  published registrar, registry, and security.txt response routes only from the
  completed response already in memory. It performs no contact discovery or
  reachability check and records a route only after an analyst selects it.
  Network or hosting coverage remains not collected unless an attributable
  route is actually available. These analyst-authored records remain
  separate from collected evidence snapshots and can contain sensitive
  investigation context. A deliberately imported, strictly validated external
  finding is stored as a separately attributed evidence pin with its stated
  source, observation time, completeness, and limitations. Import preview and
  application make no network request, do not fetch references, and do not
  change analyst status or disposition. Creating or editing these records makes
  no network request.
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
  A deliberate Risk calibration export includes only explicitly selected case
  IDs, domains, reviewed dispositions, and a bounded whitelist of normalized
  scoring inputs from the latest retained evidence. It excludes notes, tags,
  assertions, actions, contacts, raw source data, provider payloads, and stored
  Risk scores. The export is not anonymous, is not uploaded, and does not train,
  tune, or change the Risk model.
  Single-lookup
  evidence JSON includes the raw RDAP and WHOIS responses, so it may contain
  registry-published contact data. The separate Lookup Markdown reports are
  generated from bounded known-field projections in the browser. Domain
  reports include registry, registrar, WHOIS, Risk, and limitation context; IP
  reports include normalized network registration and bounded reverse-DNS
  context when collected; ASN reports include normalized routing registration
  evidence. All preserve source states and collection time while excluding raw
  RDAP and WHOIS responses, expanded contacts, provider payloads, scripts, and
  remote assets. A
  deliberate unified workspace archive can contain cases and their analyst
  notes, campaigns, Brand Profiles, watchlists, shortlist entries, custom
  detection rules, retained relationship observations, compact saved Bulk
  sessions, website profile snapshots, investigation templates, active-profile
  selection, and theme preference. It uses a versioned manifest with
  per-section SHA-256
  checksums, previews conflicts before a non-destructive merge, and excludes
  login sessions, passwords, API credentials, hosted-monitor encryption keys, raw
  upstream payloads, tab state, Certificate Transparency history, and unrelated
  browser storage. The recommended download uses browser-native
  PBKDF2-HMAC-SHA-256 and AES-256-GCM to encrypt that ordinary archive with a
  passphrase. The passphrase and derived key are not persisted, sent, logged,
  or recoverable. A separately labelled unencrypted download remains
  available. Encrypted import decrypts in browser memory, reports the same
  error for a wrong passphrase or corrupted authenticated ciphertext, and then
  applies the ordinary archive validation and reviewed merge. Archive
  encryption cannot protect an unlocked Console from same-origin code, a
  malicious extension, device malware, a keylogger, or a weak or reused
  passphrase. Nothing is uploaded or retained by the server when you export or
  import. From that point on, the file is yours to manage, so store it
  appropriately and delete it once you no longer need it.
- **Offline CLI verification and diagnostics**: `verify-artifact` reads one
  local supported archive, packet, or signed review artifact and reports only
  its contract, integrity state, and bounded size or count metadata by default.
  An encrypted archive passphrase is accepted only through a separate bounded
  local file and is not printed or retained. `source-report` reads bounded local
  CLI Lookup or Bulk documents and reports only fixed source identifiers with
  aggregate states, durations, truncation, and rate-limit counts. It does not
  retain or output targets, queries, endpoints, source limitations, raw
  evidence, or provider payloads. Neither command makes a network request or
  uploads its input.
- **In-tab undo**: the Console's 12-second undo notice is held only in the
  current tab's runtime memory. It can restore a prior Bulk review state,
  shortlist membership, case-tag set, or temporary evidence-cluster label by
  using the same browser-local write path as the original edit. The pending
  action is not serialized, exported, uploaded, or retained after reload. It
  cannot replay collection or reverse imports, exports, confirmed deletions,
  case disposition changes, or source evidence.
- **Retained-evidence timeline**: Monitor can project bounded metadata from
  deliberately retained case snapshots, evidence pins and checkpoint facts,
  website-profile snapshots, watchlist checks, and relationship observations.
  The projection stays in browser memory, links to the owning browser-local
  record, and keeps observation time separate from storage time. It does not
  duplicate raw payloads, pin values, relationship values, analyst notes, or
  page content, and does not start collection.
- **External intelligence import**: a selected local STIX 2.1 or MISP JSON file
  is decoded, hashed with SHA-256, normalized, previewed, and merged entirely in
  the browser. Only the bounded supported entity claim and provenance metadata
  are retained on an explicitly selected existing case. Unsupported attribute
  values, raw files, descriptions, MISP comments, and provider payloads are not
  stored. The importer makes no network request, does not create a case, and
  does not start collection, scoring, publication, correlation, or reporting.
- **Reviewed response and defensive-control exports**: a case response packet
  is built locally from analyst-entered incident facts, exact HTTP(S) URLs,
  UTC observation time, and separately attributed registrar, registry,
  network/hosting, or security.txt contacts. The analyst selects a bounded
  registrar, registry, network/hosting, security-contact, browser/blocklist, or
  internal-SOC profile that states included and excluded evidence, expected
  redactions and attachments, and follow-up fields. Its local preflight blocks export
  when required incident facts are incomplete and identifies review cautions
  for missing pins, decisions, recipient routes, disposition, stale evidence,
  contradictions, or action tracking. JSON, Markdown, and email-text outputs
  include the bounded preflight and action-outcome summary, state that review
  is required, and state that no submission occurred.
  Defensive domain exports require an explicit reviewed selection and eligible
  analyst disposition. They exclude configured official, allowlisted, and
  common-infrastructure domains, include an expiry and provenance manifest,
  and create paired rollback instructions. Wildcard RPZ entries require a
  separate opt-in. WHOISleuth does not send either export or modify a defensive
  system.
- **Field-level case checkpoints and readable reports**: an analyst can
  deliberately save up to 20 normalized facts from a completed domain Lookup
  into an open browser-local case. A fact retains its source, observation time,
  collection depth, source state, completeness, truncation, schema version, and
  limitations. Raw registration payloads, expanded contacts, HTML, scripts,
  provider payloads, and unselected fields are not copied by this action. A
  later Lookup compares the same fields while keeping changed, missing,
  unavailable, conflicting, and not-recorded states distinct. Domain, IP, and
  ASN readable Markdown reports are generated locally from bounded known fields
  and keep partial source states explicit. A checkpoint can additionally retain
  one analyst-declared transition expectation per selected fact: preserve,
  change, or manual review. Post-transition comparison remains local and treats
  unavailable, conflicting, missing, or uncollected evidence as indeterminate.
  It does not establish ownership, acquisition completion, or service health.
- **Official-domain posture audits**: handled per request and discarded. The
  server queries public DNS, the domain registry's RDAP service for status,
  nameserver, DS, and DNSSEC delegation evidence, and (only when advertised)
  the official domain's own `mta-sts` HTTPS policy host. The bounded audit can
  follow literal SPF include and redirect TXT targets and query external DMARC
  reporting-authorization names. Active and retired DKIM selector names saved
  in a Brand Profile, plus its fixed mail-profile choice, are included in the
  request so those exact public DNS records and expectations can be checked.
  DKIM public keys are parsed transiently for supported algorithm and size
  evidence and are not retained by the server. Registry and resolver failures,
  exhausted traversal bounds, and unsupported policy targets remain explicit
  incomplete states.
- **External response actions**: WHOISleuth records only analyst-authored
  planned or completed actions in browser-local cases. It does not open a
  pre-addressed mail client, send a report, contact a provider, change DNS, or
  apply a block automatically.
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
(reviewed case-response preparation, watchlist monitoring) is generally supported by
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
  search), a deep-scanned domain's homepage, favicon, TLS endpoint, optional
  security.txt endpoint, and an audited domain's own MTA-STS policy host are
  queried live, on demand - they're the data sources, not sub-processors this
  tool shares stored data with.
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
