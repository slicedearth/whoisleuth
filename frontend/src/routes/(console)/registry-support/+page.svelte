<script lang="ts">
  import PageHeading from '$lib/components/PageHeading.svelte';
  import {
    filterRegistrySupportRows,
    registryAccessLabel,
    registryCoverageLabel,
    registrySupportCatalogue,
    registrySupportLabel,
  } from '$lib/analysis/registry-support.js';

  const catalogue = registrySupportCatalogue();
  let query = $state('');
  let coverage = $state('all');
  const visibleRows = $derived(filterRegistrySupportRows(catalogue.rows, query, coverage));
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
  .catalogue-section{margin-top:34px}
  .section-intro{max-width:840px;margin-bottom:14px}.section-intro h2{margin:3px 0 0;font:700 1.15rem var(--mono)}.section-intro>p:not(.eyebrow){margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
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
  @media(max-width:900px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.table-wrap{overflow:visible;border:0;background:none}table,tbody,tr,td{display:block;width:100%}thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}tbody{display:grid;gap:10px}tr{overflow:hidden;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}td{display:grid;grid-template-columns:minmax(95px,115px) minmax(0,1fr);gap:8px;min-width:0;border-top:1px solid var(--border)}td:first-child{border-top:0}td::before{content:attr(data-label);color:var(--muted);font:600 var(--text-2xs) var(--mono);text-transform:uppercase}td>*{grid-column:2;min-width:0}td>strong{margin-top:0}.profile-detail{grid-column:1 / -1}.interpretation{grid-template-columns:1fr}.interpretation p:last-child{grid-column:1}}
  @media(max-width:560px){.summary-grid{grid-template-columns:1fr}.filters{display:grid}.filters .search{min-width:0}.filters input,.filters select{width:100%}.version{justify-self:start}.profile-detail dl>div{grid-template-columns:1fr}.profile-detail dd{margin-top:2px}}
</style>
