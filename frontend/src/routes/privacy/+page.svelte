<svelte:head><title>Privacy policy · WHOISleuth</title></svelte:head>

<section class="heading">
  <div><p class="eyebrow">Policy</p><h1>Privacy policy</h1><p>How this deployment processes registry data, local investigation state, and session information.</p></div><a class="back" href="/">← Back to app</a>
</section>

<article class="policy card">
  <p><em>Last updated: 14 July 2026</em></p>

  <h2>1. Introduction</h2>
  <p>This policy explains what WHOISleuth processes when you use it, why, and what choices you have. It applies to this deployment. By using the service, you agree to the practices described here.</p>

  <h2>2. Information processed</h2>
  <p><strong>Registry data.</strong> Looking up a domain returns whatever registrant contact data its registry publishes through RDAP or WHOIS. The service relays this already-public registry data at your request; most registries redact it by default.</p>
  <p><strong>Technical data.</strong> Standard request metadata, including IP address and timestamps, is processed transiently for login and rate limiting. When the operator enables optional distributed operation limits, the configured counter service stores only operation classes, opaque lease identifiers, expiry timestamps, and a one-way hash of the already-opaque session fingerprint. If durable usage accounting is also enabled, it stores bounded operation-feature identifiers, fixed 24-hour/30-day bucket identifiers, and integer counts. It receives no lookup targets, evidence, responses, browser-local records, or session tokens; leases expire after five minutes and usage counters expire shortly after their fixed window ends.</p>
  <p><strong>Deep lookup evidence.</strong> A requested deep lookup can display bounded HTTP metadata and static page-identity fields derived from the homepage response already fetched for analysis. Page identity can include language, canonical and meta-refresh targets, selected Open Graph fields, generator metadata, forms, normalized resource counts, external resource and embedded origins, mail-contact domains, download context, recognized public tracking identifiers, and versioned page fingerprints. Fingerprints cover the exact captured body, noise-reduced normalized HTML, visible text, static tag structure, form structure, external resource hosts, and public tracking identifiers. Intermediate normalized markup and visible text are discarded after hashing. URL credentials, queries, fragments, resource and download paths, form-action paths, and complete email addresses are not retained. When the active Brand Profile has a compatible official-site baseline, Lookup compares these bounded components locally and independently. It creates no combined page-similarity score, does not change the Risk score, and does not persist or export the derived comparison. Bulk can also compare bounded nameserver, IP-address, favicon, public-tracking-identifier, and configured official-asset-host observations within its current result set. Those scan-local relationships make no additional requests and are not saved or exported. Fingerprints and shared observations support comparison but do not prove authorship, ownership, coordination, intent, or maliciousness. The complete rich page-identity record is not copied into Bulk, watchlists, or analyst cases.</p>
  <p>The service does not use analytics, advertising, or third-party tracking scripts.</p>

  <h2>3. How information is used</h2>
  <ul><li>To perform a lookup, scan, posture audit, or search you request.</li><li>To keep you signed in.</li><li>To enforce limits that protect the service and upstream registries.</li></ul>
  <p>Published registrant data is not used to build profiles, sold, or shared with advertisers.</p>

  <h2>4. Legal basis</h2>
  <p>Where GDPR or similar law applies, operation of requested lookups and anti-abuse controls relies on legitimate interest. Exporting, saving, or acting on displayed data is your decision. Any registrant outreach should remain low-volume, human-reviewed, compliant with applicable law, and stop when requested.</p>

  <h2>5. Third parties</h2>
  <p>Requests may reach the relevant registry or registrar, public DNS, a domain's MTA-STS policy host, <a href="https://crt.sh/" target="_blank" rel="noopener">crt.sh</a>, and the infrastructure hosting this deployment. If distributed operation limits are enabled, their configured REST service processes the minimal lease and optional fixed-window counter metadata described above. No analytics, advertising, or CRM processors are used.</p>

  <h2>6. Cookies and browser storage</h2>
  <p>The service sets one signed session cookie, <code>wrt_session</code>, for up to 30 days. It is HttpOnly, SameSite=Lax, and Secure over HTTPS. It is required for authentication and is not used for tracking.</p>
  <p>Brand profiles, shortlist entries, watchlists, analyst cases, campaigns, and bounded Certificate Transparency search baselines stay in your browser's local storage. Campaigns contain a bounded label, optional description, and normalised case-domain membership only; they do not copy case evidence, notes, status, or disposition. Watchlists and cases may retain compact HTTP facts from deep checks: the final origin without its path or query, response status, transport, redirect count and flags, MIME type, and which selected security headers were present—not their values. CT baselines retain normalised search keywords, observed public domains, timestamps, and result counts so later searches can identify new observations; they can be deleted individually or cleared from Discover. A posture audit sends only the selected official domain and configured DKIM selectors to this deployment. Clearing site data removes all saved browser-local state.</p>
  <p>CSV and JSON exports are generated in your browser. Campaign exports contain their labels, descriptions, domain membership, and timestamps, so review them before sharing. Evidence exports may contain contact data published in raw RDAP or WHOIS responses and the bounded page-identity evidence displayed by Lookup.</p>

  <h2>7. Retention</h2>
  <p>Lookup and posture results are discarded after each server request. Browser-local investigation data persists until you remove it or clear site data. You are responsible for securing and deleting downloaded exports.</p>

  <h2>8. Security</h2>
  <p>Controls include a shared-password gate, signed HttpOnly cookies, per-IP rate limiting, a restrictive Content Security Policy, and SSRF/DNS-rebinding protections for outbound checks. No system is perfectly secure, and the service is provided as is.</p>

  <h2>9. Your rights</h2>
  <p>Depending on your jurisdiction, you may have rights to access, correct, delete, restrict, or object to processing. The service has no server-side user database. Requests concerning registry-published data should generally go to the responsible registry or registrar; saved lists and exports remain under your control.</p>

  <h2>10. International transfers</h2>
  <p>Registries and hosting infrastructure may operate in other countries, so requested lookups can involve international processing inherent to RDAP, WHOIS, DNS, and web hosting.</p>

  <h2>11. Children's privacy</h2>
  <p>The service is not directed at children and is not knowingly used to collect personal data from children.</p>

  <h2>12. Changes</h2>
  <p>This policy may change over time. Material changes will update the date shown above.</p>

  <h2>13. Contact</h2>
  <p>Questions are best directed to the project's <a href="https://github.com/slicedearth/whoisleuth/issues" target="_blank" rel="noopener">GitHub issue tracker</a>. The repository also contains the complete <a href="https://github.com/slicedearth/whoisleuth/blob/main/PRIVACY.md" target="_blank" rel="noopener">privacy documentation</a>.</p>
</article>

<style>
  .policy{max-width:860px;padding:clamp(22px,4vw,42px)}
  .policy>p:first-child{margin-top:0;color:var(--muted)}
  .policy h2{margin:2rem 0 .65rem;font:700 1.05rem var(--mono);color:var(--accent2)}
  .policy p,.policy li{color:var(--muted);line-height:1.7}
  .policy strong{color:var(--text)}
  .policy a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
  .policy code{padding:2px 5px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)}
  .policy li+li{margin-top:.35rem}
  .back{align-self:start;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--panel);font:700 .72rem var(--mono)}
</style>
