<script lang="ts">
  import PageHeading from '$lib/components/PageHeading.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../../../../../lib/project-metadata.mts';
</script>

<PublicSeo
  title="Privacy policy | WHOISleuth"
  description="How WHOISleuth processes public-source evidence, browser-local investigation state, optional hosted monitoring and local files."
  path="/privacy"
/>

<PageHeading eyebrow="Policy" title="Privacy policy" description="What leaves your device, what stays local, and how retained data can be removed." />

<div class="policy-layout">
  <nav class="policy-index card" aria-label="Privacy policy sections">
    <p class="eyebrow">On this page</p>
    <a href="#privacy-introduction">Introduction</a>
    <a href="#privacy-information">Information processed</a>
    <a href="#privacy-browser">Browser-local data</a>
    <a href="#privacy-network">Network processing</a>
    <a href="#privacy-files">Files and exports</a>
    <a href="#privacy-retention">Retention</a>
    <a href="#privacy-security">Security</a>
    <a href="#privacy-contact">Contact</a>
  </nav>

  <article class="policy card" aria-labelledby="privacy-title">
    <h2 id="privacy-introduction">1. Introduction</h2>
    <p id="privacy-title"><strong>Last updated: 2 September 2026.</strong></p>
    <p>WHOISleuth is local-first. Ordinary investigation state stays in this browser profile, and the service has no general user, Case, or workspace database. Network collection, local retention, export, and active review are separate deliberate actions.</p>
    <p>Only a deliberately started network-capable operation sends its declared bounded target or evidence fields. WHOISleuth does not automatically submit reports, contact recipients, acquire domains, apply defensive controls, or change external infrastructure. Missing, blocked, stale, malformed, partial, unavailable, or unsupported evidence never becomes absence, safety, ownership, control, intent, or remediation.</p>
    <p>This policy describes the public deployment. A self-hosted operator must adapt it when hosting, authentication, enabled providers, retention, or contact routes differ.</p>

    <p>The generated <a href={`${WHOISLEUTH_SOURCE_REPOSITORY_URL}/blob/main/docs/privacy-data-flow-catalogue.md`} target="_blank" rel="noopener">data-flow catalogue<span class="sr-only"> (opens in a new tab)</span></a> lists the exact recipients, retention classes and export boundaries for each capability.</p>

    <h2 id="privacy-information">2. Information processed</h2>
    <p>Depending on the selected operation, WHOISleuth can process a domain, hostname, IP address, ASN, nameserver, certificate-search term, or other explicit technical target; public registry, registrar, WHOIS, DNS, routing, HTTP, TLS, certificate, security.txt, and provider evidence; analyst-supplied workspace records; imported evidence files; authentication and operation-control metadata; and local output selected by the operator.</p>
    <p>Public registration sources can expose contact names, organisations, addresses, email addresses, and telephone numbers. WHOISleuth relays or normalises what the selected source publishes rather than building a separate registrant database. Many sources redact those fields.</p>
    <p>The public synthetic demo uses fixed fictional evidence on reserved domains. It performs no live investigation request and writes no protected workspace data. The deployment has no individual user-account database and no advertising or behavioural audience measurement.</p>

    <h2 id="privacy-browser">3. Browser-local data</h2>
    <p>The Console stores bounded workspace collections in IndexedDB as plaintext JSON. They include Cases, Brand Profiles, watchlists, shortlist entries, campaigns, certificate-search history, custom rules, retained relationships, saved Bulk sessions, website snapshots, investigation templates, Bulk review state, and Analyst Review Item state. Anyone able to use this browser profile may be able to read them.</p>
    <p>Tab-scoped dictionaries, candidate handoffs, guide progress and similar transient state use bounded memory or <code>sessionStorage</code>. A one-use candidate handoff uses a random token and is removed when accepted. Appearance preference can use <code>localStorage</code>.</p>
    <p>Browser-only filters, searches, timelines, relationship views, posture comparisons, evidence-gap queues, and response preflight derive from retained records without another request. They do not create evidence or silently mark work reviewed.</p>
    <p><strong>Compatibility.</strong> Current Case schema 14 can retain the exact normalised submitted hostname on a new evidence snapshot and the observation time of a reviewed response route. Published v2 Case schema 13 and exact public v1 Case schema 12 remain readable and migrate directly; migrated fields can remain null because WHOISleuth does not reconstruct them from weaker evidence. Case report v10 JSON and Markdown do not add the snapshot hostname. Public CLI case packs clear identifiers, actions, observed-effect reviews, and closure records; ordinary Case, workspace, trusted, and internal files can contain exact investigated hostnames and analyst context.</p>
    <p>Failed reads, quota errors, partial evidence, and unsupported versions remain explicit. They do not become empty collections or evidence of absence. Clearing site data removes the browser workspace, including retained Case hostname history.</p>

    <h2 id="privacy-network">4. Hosted and third-party processing</h2>
    <p>Single and Bulk lookups send the selected target and requested mode to this deployment. The server performs only the declared bounded requests and returns one bounded response. It does not write ordinary investigation results to a server-side workspace. Selected registration bootstrap and public registration responses can remain briefly in memory to reduce duplicate upstream requests; hosting, edge, and function providers can retain ordinary request or function-log metadata under their own policies.</p>
    <p>Deep collection can disclose the target or a related bounded query to the applicable registry or registrar, public DNS resolver, nameserver, HTTP origin, TLS endpoint, certificate-search service, security.txt endpoint, or public-address registration service. Each recipient can observe the source network address and apply its own logging, rate limits, and retention. Deep domain collection can query A, AAAA, CAA, and MX once through one selected public address per nameserver, retaining at most sixteen normalised values for each record type. Direct-authority results stay separately attributed; only authoritative registry evidence decides registration.</p>
    <p><strong>Optional providers.</strong> Search-only URLscan, URLhaus, and ThreatFox adapters are disabled unless configured and explicitly selected. They receive the canonical registrable domain and ordinary request metadata; they do not receive a scan, sample, report, browser workspace, or Case. A miss, failure, or quota response is not evidence of safety. The checked-in SSLBL certificate projection is local; Lookup does not send its target or certificate to SSLBL. Registrar standing is matched locally using only the numeric IANA ID already present in registration evidence. Lookup makes no additional IANA or ICANN request for it.</p>
    <p><strong>Optional monitoring.</strong> Scheduled monitoring is disabled by default. Scheduled runs use Fast compact collection: registration-led RDAP and the bounded authoritative DNS fallback where required, without WHOIS, HTTP, TLS, page, or optional intelligence collection. The Blob store receives only the bounded application-encrypted compact projection and ordinary object metadata, not the browser workspace or a key embedded in the object. The worker runtime receives the encryption key through its deployment environment, so an operator or hosting runtime with environment access can decrypt the state while configured. Deleting a scheduled watchlist rewrites the encrypted logical state; it does not delete the Blob object. Disabling collection also leaves the object in place. Physical object deletion is a separate deployment-operator action through the hosting platform, as documented in the operations guide.</p>
    <p><strong>Operation controls.</strong> Optional distributed limits send only operation class, opaque lease, expiry, one-way opaque-session fingerprint, fixed usage bucket, and count metadata to the configured counter service. They do not include targets, evidence, Cases, notes, browser records, or session tokens.</p>
    <p><strong>Authentication and Contact.</strong> The Console uses one signed <code>HttpOnly</code>, <code>SameSite=Lax</code> cookie. Its lifetime defaults to 7 days and cannot exceed 30 days. The Contact page keeps its subject and message in page memory. It sends only a fixed contact category and short-lived Turnstile token for verification, then prepares a local email draft. WHOISleuth does not send or retain the draft and accepts no attachment.</p>

    <h2 id="privacy-files">5. CLI, imports, and exports</h2>
    <p>The CLI runs on the operator's machine. Offline plans, comparisons, verification, reports, and imports make no network request. Networked commands disclose their target and source boundary. Local input is bounded before parsing, existing output is refused unless replacement is explicit, and files are not uploaded to WHOISleuth.</p>
    <p>The isolated <code>dnssec-validate</code> and <code>mail-transport</code> commands require a selected literal public resolver, a local trust anchor, and explicit owned-or-authorised acknowledgement. Mail transport also requires active-probe acknowledgement. It handles at most three selected MX hosts, sends <code>EHLO</code>, and uses <code>STARTTLS</code> only when advertised. It sends no message, authenticates no account, and tests no relay, recipient, mailbox, or catch-all behaviour.</p>
    <p>Imports are validated before preview or merge. Omission does not delete destination data, and imported evidence is not treated as freshly collected or true merely because it parsed.</p>
    <p>The current writer emits workspace archive version 7. Exact versions 5 and 6 remain readable. Version 5 gains an explicitly empty migrated Analyst Review Item section without inventing decisions; version 6 migrates its existing sections directly. Versions 1 through 4 and future versions fail without empty import, reset, deletion, or rewrite. Release 1.47.4 can export the exact version-5 and Case-schema-12 public baseline before moving to v2.</p>
    <p>The optional encrypted workspace envelope remains version 1. Encryption happens in browser memory; the passphrase and derived key are not persisted or sent. It protects the downloaded file while locked, not an open Console, active IndexedDB, compromised device, malicious extension, or weak passphrase.</p>
    <p><strong>Sensitive files.</strong> A full saved Lookup can contain targets, bounded source endpoints and timings, raw RDAP publications, WHOIS response bodies, and publicly published contacts. Current Lookup evidence schema 28 excludes raw registration payloads, expanded contacts, credentials, and complete query-bearing URLs; published v2 schema 27 and exact v1 schema 26 remain readable, and schema 26 may contain public contact fields. Case, workspace, graph, campaign, response, and defensive files can identify investigated targets or contain analyst material. Review every file before sharing.</p>
    <p>Checksums and signatures can detect content change or prove a mathematical key relationship under their named contract. They do not prove evidence accuracy, authorship, signer identity, recipient authorisation, or safety.</p>
    <p><strong>Authorised local capture.</strong> The separate repo-local package executes remote page JavaScript in a disposable network-bounded browser. Each admitted resource operator receives the exact requested URL, including its path and query. Structured output has no dedicated path or query fields, but the page-controlled title can reproduce them. A local fixed-size screenshot necessarily preserves visible rendered content and may include page text or a reflected path or query. Captures are not uploaded to WHOISleuth and persist until the operator deletes them.</p>

    <h2 id="privacy-retention">6. Retention and deletion</h2>
    <ul>
      <li><strong>Transient hosted results:</strong> end with the bounded operation or cache lifetime; platform logs follow the operator's hosting configuration.</li>
      <li><strong>Session cookie:</strong> remains until expiry, sign-out, or browser removal; rotating the signing secret invalidates outstanding sessions.</li>
      <li><strong>Browser workspace:</strong> remains until removed through the relevant control or browser site data is cleared.</li>
      <li><strong>Optional monitoring:</strong> deleting a scheduled watchlist rewrites the encrypted logical state. The Blob object remains until the deployment operator deletes that object through the hosting platform.</li>
      <li><strong>Downloaded and CLI files:</strong> remain on the operator's filesystem until the operator deletes them.</li>
      <li><strong>Contact draft:</strong> remains only in page or email-client memory; WHOISleuth does not retain it.</li>
    </ul>
    <p>Deleting browser data does not delete separately downloaded files. Disabling a feature does not delete data already retained by its operator.</p>

    <h2 id="privacy-security">7. Security and limitations</h2>
    <p>Controls include signed sessions, request-rate and operation limits, restrictive browser policies, bounded parsing, public-address validation, redirect revalidation, DNS-rebinding resistance, and pinned-address connections. Browser future versions are preserved without write where promised; portable future versions are rejected before merge.</p>
    <p>IndexedDB is plaintext, hosting providers can retain ordinary logs, public sources can publish inaccurate or personal data, and local files can be copied outside WHOISleuth. Missing, blocked, stale, malformed, partial, unavailable, or unsupported evidence remains explicitly qualified.</p>

    <h2 id="privacy-contact">8. Operators, rights, and contact</h2>
    <p>Operators are responsible for an appropriate lawful basis, authorisation, provider terms, retention, and response process. This policy is not legal advice. Requests concerning source-published registration data may need to go to the responsible registry or registrar. Browser records and local files remain under the user's or operator's control; operators who enable monitoring must also manage its encrypted object.</p>
    <p>The public deployment uses Netlify for hosting and functions and Cloudflare Turnstile for protected Contact verification. Upstash is used only when distributed operation controls are configured. Public registries, registrars, DNS infrastructure, target services, certificate-search services, and selected providers receive only their applicable bounded request and can operate in other countries under their own terms.</p>
    <p>Use the <a href="/contact">protected Contact page</a> for a privacy request, outbound-request concern, or security report. It reveals the relevant project role address only after verification and prepares an email in your own client; it does not send or retain the draft. The repository contains the complete <a href={`${WHOISLEUTH_SOURCE_REPOSITORY_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noopener">privacy notice<span class="sr-only"> (opens in a new tab)</span></a>.</p>
  </article>
</div>

<style>
  .policy-layout{display:grid;grid-template-columns:190px minmax(0,860px);align-items:start;gap:14px}
  .policy-index{position:sticky;top:18px;display:grid;gap:3px;padding:12px}
  .policy-index p{margin:3px 8px 8px}
  .policy-index a{padding:7px 8px;border-radius:var(--radius-sm);color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .policy-index a:hover,.policy-index a:focus-visible{background:rgb(var(--accent-rgb) / .07);color:var(--accent)}
  .policy{min-width:0;padding:clamp(22px,4vw,42px)}
  .policy>p:first-child{margin-top:0;color:var(--muted)}
  .policy h2{margin:2rem 0 .65rem;font:700 1.05rem var(--mono);color:var(--interface-accent);scroll-margin-top:24px}
  .policy p,.policy li{color:var(--muted);line-height:1.7}
  .policy strong{color:var(--text)}
  .policy a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
  .policy code{padding:2px 5px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)}
  .policy li+li{margin-top:.35rem}
  @media(max-width:820px){
    .policy-layout{display:block}
    .policy-index{position:relative;top:auto;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px;margin-bottom:12px;overflow:visible}
    .policy-index p{grid-column:1/-1;margin:3px 8px 8px}
    .policy-index a{min-width:0;overflow-wrap:anywhere}
    .policy h2{scroll-margin-top:18px}
  }
</style>
