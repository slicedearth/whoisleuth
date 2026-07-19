<script lang="ts">
  import PageHeading from '$lib/components/PageHeading.svelte';
  import {
    filterRegistrySupportRows,
    inspectRegistrySupport,
    registryAccessLabel,
    registryCoverageLabel,
    registrySupportCatalogue,
    registrySupportLabel,
  } from '$lib/analysis/registry-support.js';

  const catalogue = registrySupportCatalogue();
  const standards = catalogue.standardsCoverage;
  let query = $state('');
  let coverage = $state('all');
  let inspectionInput = $state('');
  let inspectedValue = $state('');
  let inspectionActive = $state(false);
  const visibleRows = $derived(filterRegistrySupportRows(catalogue.rows, query, coverage));
  const inspection = $derived(inspectRegistrySupport(inspectedValue));

  function inspectSupport(event: SubmitEvent) {
    event.preventDefault();
    inspectedValue = inspectionInput;
    inspectionActive = true;
  }

  function clearInspection() {
    inspectionInput = '';
    inspectedValue = '';
    inspectionActive = false;
  }
</script>

<svelte:head>
  <title>Registry support · WHOISleuth</title>
  <meta name="description" content="Review WHOISleuth's fixture-backed and access-documented registry compatibility coverage.">
</svelte:head>

<PageHeading eyebrow="Reference" title="Registry support" description="Inspect the versioned compatibility catalogue behind exceptional WHOIS query, parser, fallback, and access behavior.">
  <span class="version">Catalogue v{catalogue.version}</span>
</PageHeading>

<section class="summary-grid" aria-label="Registry capability summary">
  <article class="card"><span>Explicit suffixes</span><strong>{catalogue.summary.profiles}</strong><p>Versioned profiles in this catalogue</p></article>
  <article class="card"><span>Fixture verified</span><strong>{catalogue.summary.fixtureVerified}</strong><p>Profiles exercised by bounded local fixtures</p></article>
  <article class="card"><span>Access documented</span><strong>{catalogue.summary.accessDocumented}</strong><p>Profiles with a documented collection constraint</p></article>
  <article class="card"><span>Fallbacks</span><strong>{catalogue.summary.fallbacks}</strong><p>Bounded non-port-43 collection profiles</p></article>
</section>

<section class="standards-section" aria-labelledby="standards-title">
  <header class="section-intro">
    <p class="eyebrow">Standards coverage</p>
    <h2 id="standards-title">Generic TLD RDAP snapshot</h2>
    <p>Current generic services are handled through live IANA bootstrap discovery and shared bounded RDAP parsing, not duplicated suffix profiles. This embedded snapshot records published coverage at the stated verification date; it is not a live endpoint check.</p>
  </header>

  <div class="standards-grid">
    <article class="card">
      <span>Generic + restricted</span>
      <strong>{standards.counts.genericAndRestrictedRdapCovered} / {standards.counts.generic + standards.counts.genericRestricted}</strong>
      <p>Current delegations present in the IANA RDAP bootstrap</p>
    </article>
    <article class="card">
      <span>Sponsored</span>
      <strong>{standards.counts.sponsoredRdapCovered} / {standards.counts.sponsored}</strong>
      <p>Published RDAP coverage, with exceptions kept explicit</p>
    </article>
    <article class="card">
      <span>Bootstrap groups</span>
      <strong>{standards.counts.rdapBootstrapServiceGroups}</strong>
      <p>Bounded IANA service groups in the source snapshot</p>
    </article>
    <article class="card">
      <span>Verified</span>
      <strong>{standards.verifiedAt}</strong>
      <p>Root-zone version {standards.sources.rootZoneVersion}</p>
    </article>
  </div>

  <div class="standards-notes card">
    <div>
      <h3>Explicit exceptions</h3>
      <p><code>.edu</code> remains fixture-backed WHOIS-only, <code>.mil</code> has no IANA-published public domain service, and <code>.arpa</code> is infrastructure rather than ordinary public registration space.</p>
    </div>
    <p>{standards.interpretation}</p>
  </div>
</section>

<section class="inspector-section" aria-labelledby="inspector-title">
  <header class="section-intro">
    <p class="eyebrow">Local inspector</p>
    <h2 id="inspector-title">Inspect a domain or suffix</h2>
    <p id="inspector-help">Resolve one value against the embedded catalogue. This does not contact a registry or test current reachability.</p>
  </header>

  <form class="inspector-form card" onsubmit={inspectSupport}>
    <label for="support-inspection">Domain or suffix
      <input id="support-inspection" type="search" maxlength="253" placeholder="For example: example.invalid or .uk" aria-describedby="inspector-help" autocapitalize="none" spellcheck="false" bind:value={inspectionInput}>
    </label>
    <div class="inspector-actions">
      <button class="btn primary" type="submit">Inspect support</button>
      <button class="btn" type="button" onclick={clearInspection} disabled={!inspectionInput && !inspectionActive}>Clear</button>
    </div>
  </form>

  {#if inspectionActive}
    <div class="inspection-output" aria-live="polite">
      {#if inspection.state === 'empty'}
        <section class="empty-state card"><h3>Enter a domain or suffix</h3><p>The inspector accepts one DNS hostname or suffix at a time.</p></section>
      {:else if inspection.state === 'invalid' || !inspection.profile}
        <section class="empty-state card"><h3>Unsupported input format</h3><p>Enter one bounded DNS hostname or suffix without a URL, path, port, or control character.</p></section>
      {:else}
        {@const profile = inspection.profile}
        <article class="inspection-card card">
          <header>
            <div><p class="eyebrow">{profile.explicitSuffixProfile ? 'Explicit suffix profile' : 'Generic fallback'}</p><h3>.{profile.suffixes[0]}</h3></div>
            <span class="coverage-badge" class:documented={profile.coverageState === 'access_documented'}>{registryCoverageLabel(profile.coverageState)}</span>
          </header>
          <dl>
            <div><dt>Catalogue</dt><dd>Version {catalogue.version}</dd></div>
            <div><dt>Registry class</dt><dd>{registrySupportLabel(profile.registryClass)}</dd></div>
            <div><dt>RDAP discovery</dt><dd>{registryAccessLabel(profile.rdapDiscovery)}</dd></div>
            <div><dt>WHOIS discovery</dt><dd>{registryAccessLabel(profile.whoisDiscovery)}</dd></div>
            <div><dt>RDAP access</dt><dd>{registryAccessLabel(profile.rdapAccessProfile)}</dd></div>
            <div><dt>WHOIS access</dt><dd>{registryAccessLabel(profile.whoisAccessProfile)}</dd></div>
            <div><dt>WHOIS query</dt><dd>{registrySupportLabel(profile.whoisQueryProfile)}</dd></div>
            <div><dt>Parser</dt><dd>{registrySupportLabel(profile.whoisParserProfile)}</dd></div>
            {#if profile.fallbackProfile}<div><dt>Fallback</dt><dd>{registrySupportLabel(profile.fallbackProfile)}</dd></div>{/if}
          </dl>
          <p class="limitation"><strong>Limitation:</strong> {profile.limitation}</p>
          <p class="no-inference">This catalogue result does not decide registration, availability, ownership, safety, or maliciousness.</p>
        </article>
      {/if}
    </div>
  {/if}
</section>

<section class="catalogue-section" aria-labelledby="catalogue-title">
  <header class="section-intro">
    <p class="eyebrow">Compatibility catalogue</p>
    <h2 id="catalogue-title">Implemented registry profiles</h2>
    <p>Filter the explicit suffix profiles below. A suffix not listed here still uses normal IANA bootstrap and referral discovery, but has no suffix-specific fixture-backed behavior.</p>
  </header>

  <fieldset class="filters card">
    <legend>Filter registry profiles</legend>
    <label class="search" for="registry-filter">Suffix or capability
      <input id="registry-filter" type="search" maxlength="100" placeholder="For example: uk, access, bracketed" bind:value={query}>
    </label>
    <label for="coverage-filter">Coverage
      <select id="coverage-filter" bind:value={coverage}>
        <option value="all">All coverage states</option>
        <option value="fixture_verified">Fixture verified</option>
        <option value="access_documented">Access documented</option>
      </select>
    </label>
  </fieldset>

  <p class="result-count" role="status" aria-live="polite">
    Showing {visibleRows.length} of {catalogue.rows.length} explicit suffix profile{catalogue.rows.length === 1 ? '' : 's'}.
  </p>

  {#if visibleRows.length}
    <div class="table-wrap">
      <table>
        <caption>Registry compatibility profiles</caption>
        <thead><tr><th>Suffix</th><th>Coverage</th><th>Registry access</th><th>WHOIS behavior</th><th>Profile details</th></tr></thead>
        <tbody>
          {#each visibleRows as row}
            <tr>
              <td data-label="Suffix"><code>.{row.suffixes[0]}</code><small>{registrySupportLabel(row.registryClass)}</small></td>
              <td data-label="Coverage"><span class:documented={row.coverageState === 'access_documented'} class="coverage-badge">{registryCoverageLabel(row.coverageState)}</span></td>
              <td data-label="Registry access"><strong>RDAP</strong><span>{registryAccessLabel(row.rdapAccessProfile)}</span><strong>WHOIS</strong><span>{registryAccessLabel(row.whoisAccessProfile)}</span></td>
              <td data-label="WHOIS behavior"><strong>{registrySupportLabel(row.whoisQueryProfile)}</strong><span>{registrySupportLabel(row.whoisParserProfile)}</span>{#if row.fallbackProfile}<small>Fallback: {registrySupportLabel(row.fallbackProfile)}</small>{/if}</td>
              <td data-label="Profile details">
                <details>
                  <summary>Review {row.suffixes[0].toUpperCase()} profile</summary>
                  <div class="profile-detail">
                    <dl>
                      <div><dt>Profile ID</dt><dd><code>{row.id}</code></dd></div>
                      <div><dt>Discovery</dt><dd>RDAP: {registryAccessLabel(row.rdapDiscovery)} · WHOIS: {registryAccessLabel(row.whoisDiscovery)}</dd></div>
                      <div><dt>Query scope</dt><dd>{registrySupportLabel(row.whoisQueryScope)} · {registrySupportLabel(row.whoisEncodingProfile)}</dd></div>
                      <div><dt>Fixture states</dt><dd>{row.fixtureScenarios.length ? row.fixtureScenarios.map(registrySupportLabel).join(', ') : 'None documented'}</dd></div>
                    </dl>
                    {#if row.verificationFiles.length}<div><h3>Verified by</h3>{#each row.verificationFiles as file}<code class="reference">{file}</code>{/each}</div>{/if}
                    {#if row.documentationUrls.length}<div><h3>Documentation</h3><ul>{#each row.documentationUrls as url}<li><a href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname}<span class="sr-only"> (opens in a new tab)</span></a></li>{/each}</ul></div>{/if}
                    <p class="limitation"><strong>Limitation:</strong> {row.limitation}</p>
                  </div>
                </details>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <section class="empty-state card"><h3>No matching profiles</h3><p>Try a shorter suffix, parser term, or a different coverage state.</p></section>
  {/if}
</section>

<aside class="interpretation card" aria-labelledby="interpretation-title">
  <div><p class="eyebrow">Interpretation</p><h2 id="interpretation-title">Coverage is not live registry status.</h2></div>
  <p>Fixture verification describes implemented parsing behavior. Access documentation describes collection constraints. Neither tests current reachability nor decides registration, availability, ownership, safety, or maliciousness.</p>
  <p>For one suffix or domain in a local checkout, run <code>whoisleuth registry-support &lt;domain-or-suffix&gt;</code>.</p>
</aside>

<style>
  .version{align-self:center;border:1px solid var(--border);border-radius:999px;padding:7px 10px;color:var(--accent2);font:700 var(--text-2xs) var(--mono);white-space:nowrap}
  .summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .summary-grid article{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px;padding:16px}
  .summary-grid span{color:var(--muted);font:700 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}
  .summary-grid strong{grid-row:1 / span 2;grid-column:2;color:var(--accent2);font:750 1.55rem var(--mono)}
  .summary-grid p{margin:0;color:var(--text);font-size:var(--text-xs);line-height:1.45}
  .standards-section{margin-top:34px}.standards-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.standards-grid article{display:grid;gap:6px;padding:16px}.standards-grid span{color:var(--muted);font:700 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}.standards-grid strong{color:var(--accent2);font:750 1.2rem var(--mono);overflow-wrap:anywhere}.standards-grid p{margin:0;color:var(--text);font-size:var(--text-xs);line-height:1.45}.standards-notes{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;margin-top:8px;padding:16px}.standards-notes h3{margin:0 0 6px;font:700 var(--text-sm) var(--mono)}.standards-notes p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.standards-notes code{color:var(--accent)}
  .catalogue-section{margin-top:34px}
  .inspector-section{margin-top:34px}
  .section-intro{max-width:840px;margin-bottom:14px}.section-intro h2{margin:3px 0 0;font:700 1.15rem var(--mono)}.section-intro>p:not(.eyebrow){margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .inspector-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;padding:15px}.inspector-form label{display:grid;gap:6px;color:var(--muted);font:600 var(--text-xs) var(--mono)}.inspector-form input{width:100%;min-height:var(--control-h)}.inspector-actions{display:flex;flex-wrap:wrap;gap:8px}.inspection-output{margin-top:10px}.inspection-card{display:grid;gap:14px;padding:18px}.inspection-card>header{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:start;justify-content:space-between}.inspection-card h3{margin:3px 0 0;color:var(--accent);font:750 1.25rem var(--mono)}.inspection-card dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0}.inspection-card dl>div{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}.inspection-card dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase}.inspection-card dd{margin:5px 0 0;overflow-wrap:anywhere}.no-inference{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .filters{display:flex;min-width:0;flex-wrap:wrap;gap:12px;align-items:end;padding:15px}
  .filters legend{padding:0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}
  .filters label{display:grid;gap:6px;color:var(--muted);font:600 var(--text-xs) var(--mono)}
  .filters .search{flex:1;min-width:240px}.filters input,.filters select{min-height:var(--control-h)}
  .result-count{margin:12px 2px;color:var(--muted);font-size:var(--text-xs)}
  .table-wrap{overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}
  table{width:100%;border-collapse:collapse;font-size:var(--text-xs)}caption{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
  th,td{padding:12px 11px;border-top:1px solid var(--border);text-align:left;vertical-align:top}thead th{border-top:0;color:var(--muted);font:600 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}
  td{min-width:130px}td:first-child{min-width:95px}td:last-child{min-width:180px}td>code,td>small,td>strong,td>span{display:block}td>code{color:var(--accent);font:750 var(--text-md) var(--mono)}td>small,td>span{margin-top:4px;color:var(--muted);line-height:1.45}td>strong{margin-top:8px;font-size:var(--text-2xs)}td>strong:first-child{margin-top:0}
  .coverage-badge{display:inline-block!important;width:max-content;margin:0!important;border:1px solid color-mix(in srgb,var(--accent2) 42%,var(--border));border-radius:999px;padding:4px 7px;color:var(--accent2)!important;font:700 var(--text-2xs) var(--mono)}.coverage-badge.documented{border-color:color-mix(in srgb,var(--amber) 48%,var(--border));color:var(--amber)!important}
  summary{color:var(--accent);font:700 var(--text-xs) var(--mono);cursor:pointer}.profile-detail{display:grid;gap:13px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
  .profile-detail dl{display:grid;gap:7px;margin:0}.profile-detail dl>div{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px}.profile-detail dt{color:var(--muted);font:600 var(--text-2xs) var(--mono)}.profile-detail dd{min-width:0;margin:0;overflow-wrap:anywhere}.profile-detail h3{margin:0 0 5px;font:700 var(--text-2xs) var(--mono);text-transform:uppercase}.profile-detail ul{display:grid;gap:4px;margin:0;padding-left:18px}.profile-detail a{color:var(--accent);overflow-wrap:anywhere}.reference{display:block;max-width:100%;color:var(--text);font-size:var(--text-2xs);overflow-wrap:anywhere}.limitation{margin:0;color:var(--muted);line-height:1.5}.limitation strong{color:var(--text)}
  .interpretation{display:grid;grid-template-columns:minmax(190px,.7fr) minmax(0,1.3fr);gap:14px 28px;margin-top:24px;padding:18px}.interpretation h2{margin:3px 0 0;font:700 var(--text-md) var(--mono)}.interpretation p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.interpretation p:last-child{grid-column:2}.interpretation code{color:var(--accent)}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
  @media(max-width:900px){.summary-grid,.standards-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.standards-notes{grid-template-columns:1fr}.inspection-card dl{grid-template-columns:repeat(2,minmax(0,1fr))}.table-wrap{overflow:visible;border:0;background:none}table,tbody,tr,td{display:block;width:100%}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}tbody{display:grid;gap:10px}tr{overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}td{display:grid;grid-template-columns:minmax(95px,115px) minmax(0,1fr);gap:8px;min-width:0;border-top:1px solid var(--border)}td:first-child{border-top:0}td::before{content:attr(data-label);color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase}td>*{grid-column:2;min-width:0}td>strong{margin-top:0}.profile-detail{grid-column:1 / -1}.interpretation{grid-template-columns:1fr}.interpretation p:last-child{grid-column:1}}
  @media(max-width:560px){.summary-grid,.standards-grid{grid-template-columns:1fr}.inspector-form{grid-template-columns:1fr}.inspection-card dl{grid-template-columns:1fr}.filters{display:grid}.filters .search{min-width:0}.filters input,.filters select{width:100%}.version{justify-self:start}.profile-detail dl>div{grid-template-columns:1fr}.profile-detail dd{margin-top:2px}}
</style>
