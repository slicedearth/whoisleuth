<script lang="ts">
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  import { formatDate } from '$lib/analysis/lookup-display-shared.ts';
  import type { LookupTechnologyFinding, LookupBrowserLibraryFinding } from '$lib/analysis/lookup-page-profile-display.ts';
  import { readObservationTime } from '../../../../packages/evidence/observation.mts';
  import { TECHNOLOGY_EVIDENCE_ROLE_ORDER, type TechnologyEvidenceRole } from '../../../../lib/technology-evidence-role.mts';

  let {
    status,
    complete,
    observedAt,
    findings,
    authoritativeNameservers,
    limitations,
    libraryAvailable,
    libraryStatus,
    libraryComplete,
    libraryObservedAt,
    libraryCatalog,
    libraries,
    libraryLimitations,
    initiallyExpanded = false,
  }: {
    status: string;
    complete: boolean;
    observedAt: unknown;
    findings: LookupTechnologyFinding[];
    authoritativeNameservers: string[];
    limitations: string[];
    libraryAvailable: boolean;
    libraryStatus: string;
    libraryComplete: boolean;
    libraryObservedAt: unknown;
    libraryCatalog: string;
    libraries: LookupBrowserLibraryFinding[];
    libraryLimitations: string[];
    initiallyExpanded?: boolean;
  } = $props();

  const advisoryMatches = $derived(libraries.filter((library) => library.advisoryCount > 0).length);
  const noTechnologyMatches = $derived(status === 'success' && complete && findings.length === 0);
  const noLibraryMatches = $derived(libraryStatus === 'success' && libraryComplete && libraries.length === 0);
  const roleLabels: Record<TechnologyEvidenceRole, string> = {
    observed_edge: 'Observed edge, CDN, reverse proxy or WAF',
    application_platform: 'Application-platform indicator',
    framework_runtime: 'Framework or runtime indicator',
    embedded_dependency: 'Embedded or third-party dependency',
  };
  const findingsByRole = $derived(Object.fromEntries(TECHNOLOGY_EVIDENCE_ROLE_ORDER.map((role) => [
    role,
    findings.filter((finding) => finding.roles.includes(role)).map((finding) => finding.name),
  ])) as Record<TechnologyEvidenceRole, string[]>);
  const observationTimes = $derived.by(() => {
    const now = new Date().toISOString();
    return {
      technology: readObservationTime(observedAt, now),
      library: readObservationTime(libraryObservedAt, now),
    };
  });
</script>

{#snippet observationTime(value: ReturnType<typeof readObservationTime>)}
  <p class="observation-time">
    {#if value.observedAt}
      Observed <time datetime={value.observedAt}>{formatDate(value.observedAt)}</time>
      <span> · {value.ageDays === null ? 'Age unavailable' : value.ageDays === 0 ? 'Less than a day old at review' : `${value.ageDays} day${value.ageDays === 1 ? '' : 's'} old at review`}</span>
    {:else}
      Observed time unavailable
    {/if}
  </p>
{/snippet}

<details class="technology-card evidence-card card" aria-labelledby="technology-profile-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
    <span class="evidence-summary-copy">
      <span class="eyebrow">Derived deep-scan analysis</span>
      <span class="evidence-summary-title" id="technology-profile-title" role="heading" aria-level="4">Technology indicators</span>
      <span class="evidence-summary-detail">{findings.length ? `${findings.length} matched indicator${findings.length === 1 ? '' : 's'}` : noTechnologyMatches ? 'Analysis complete; no curated signatures matched' : 'No conclusive match'}</span>
    </span>
    <span class="evidence-status {evidenceStatusTone(status, { complete, neutral: noTechnologyMatches })}">{noTechnologyMatches ? 'No recognised matches' : status}</span>
    </span>
  </summary>

  <div class="evidence-body">
    {@render observationTime(observationTimes.technology)}
    <section class="infrastructure-roles" aria-labelledby="infrastructure-role-title">
      <h5 id="infrastructure-role-title">Web infrastructure evidence roles</h5>
      <dl>
        <div><dt>Authoritative nameservers</dt><dd>{authoritativeNameservers.join(' · ') || 'Unavailable'}</dd></div>
        {#each TECHNOLOGY_EVIDENCE_ROLE_ORDER as role}
          <div><dt>{roleLabels[role]}</dt><dd>{findingsByRole[role].join(' · ') || 'No retained indicator'}</dd></div>
        {/each}
        <div><dt>Origin host</dt><dd>Not established</dd></div>
      </dl>
      <p class="role-note">Nameservers describe DNS infrastructure. A delivery edge or application clue does not identify a concealed origin host.</p>
    </section>

    {#if findings.length}
      <div class="technology-list">
        {#each findings as finding}
          <article>
            <div class="finding-heading">
              <h5>{finding.name}</h5>
              <p class="category">{finding.category}</p>
              <span class="confidence">{finding.confidence} signature strength</span>
            </div>
            <ul aria-label={`${finding.name} evidence`}>
              {#each finding.evidence as evidence}
                <li><strong>{evidence.source}{evidence.role && roleLabels[evidence.role as TechnologyEvidenceRole] ? ` · ${roleLabels[evidence.role as TechnologyEvidenceRole]}` : ''}</strong><span>{evidence.description}</span></li>
              {:else}
                <li>No detailed signal was retained.</li>
              {/each}
            </ul>
          </article>
        {/each}
      </div>
    {:else}
      <p class="empty-result">{noTechnologyMatches ? 'No curated technology signature matched the captured response.' : 'The retained analysis does not establish a technology match.'} This does not mean that no framework, service, or delivery platform is present.</p>
    {/if}

    <details class="source-details">
      <summary>Technology sources and limits{!complete ? ' · incomplete analysis' : ''}</summary>
      <p>Signature strength describes the distinctiveness of a retained clue, not measured accuracy. Matching uses the captured response without additional requests or changes to availability or Risk scoring.</p>
      {#if limitations.length}<ul>{#each limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
    </details>

    {#if libraryAvailable}
      <section class="library-profile" aria-labelledby="browser-library-title">
        <div class="library-heading">
          <div>
            <h5 id="browser-library-title">Observed browser libraries</h5>
            <p>{libraries.length ? `${libraries.length} apparent librar${libraries.length === 1 ? 'y' : 'ies'}; ${advisoryMatches} with catalogue advisory matches` : noLibraryMatches ? 'Analysis complete; no library signature matched' : 'No conclusive library match'}</p>
          </div>
          <span class="evidence-status {evidenceStatusTone(libraryStatus, { complete: libraryComplete, neutral: noLibraryMatches })}">{noLibraryMatches ? 'No catalogue matches' : libraryStatus}</span>
        </div>
        {@render observationTime(observationTimes.library)}

        {#if libraries.length}
          <div class="library-list">
            {#each libraries as library}
              <article>
                <div class="finding-heading">
                  <h6>{library.name} <span>{library.version}</span></h6>
                  {#if library.advisoryCount}
                    <span class:critical={library.severity === 'critical'} class:high={library.severity === 'high'} class="advisory">{library.advisoryCount} advisory match{library.advisoryCount === 1 ? '' : 'es'}</span>
                  {:else}
                    <span class="catalog-neutral">No catalogue advisory match</span>
                  {/if}
                </div>
                <dl>
                  <div><dt>Detected by</dt><dd>{library.detection || 'Static signature'}</dd></div>
                  {#if library.severity}<div><dt>Highest severity</dt><dd>{library.severity}</dd></div>{/if}
                  {#if library.identifiers}<div><dt>Identifiers</dt><dd>{library.identifiers}</dd></div>{/if}
                  {#if library.knownExploitedCount}<div><dt>Known exploited catalogue</dt><dd>{library.knownExploitedIdentifiers}</dd></div>{/if}
                  {#if library.weaknesses}<div><dt>Weakness classes</dt><dd>{library.weaknesses}</dd></div>{/if}
                </dl>
              </article>
            {/each}
          </div>
        {:else}
          <p class="empty-result">{noLibraryMatches ? 'No versioned browser-library signature matched the captured script evidence.' : 'The retained script analysis does not establish a library match.'} Unmatched scripts may still use libraries.</p>
        {/if}

        <p class="card-note">Catalogue matches are review leads, not confirmation that affected code is reachable or exploitable.</p>
        <details class="source-details">
          <summary>Library sources and limits{!libraryComplete ? ' · incomplete analysis' : ''}</summary>
          <p>Component catalogue: Retire.js{libraryCatalog ? ` · ${libraryCatalog}` : ' · version unavailable'}. Known-exploited identifiers use the retained CISA KEV catalogue. Referenced scripts are not downloaded or executed.</p>
          {#if libraryLimitations.length}<ul>{#each libraryLimitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
        </details>
      </section>
    {/if}
  </div>
</details>

<style>
  .infrastructure-roles{min-width:0;margin-bottom:20px}
  .infrastructure-roles h5{margin:0 0 10px;color:var(--text);font-size:var(--text-sm)}
  .infrastructure-roles dl{display:grid;gap:8px;margin:0}
  .infrastructure-roles dl div{display:grid;grid-template-columns:minmax(180px,.42fr) minmax(0,1fr);gap:10px}
  .infrastructure-roles dt{color:var(--muted)}
  .infrastructure-roles dd{min-width:0;margin:0;color:var(--text);overflow-wrap:anywhere}
  .role-note,.observation-time,.card-note,.empty-result{margin:12px 0;color:var(--muted);font-size:var(--text-sm);line-height:1.6;overflow-wrap:anywhere}
  .observation-time{margin:0 0 18px}
  .technology-list,.library-list{display:grid;min-width:0}
  article{display:grid;grid-template-columns:minmax(160px,.34fr) minmax(0,1fr);align-items:start;gap:20px;min-width:0;padding:16px 0;border-top:1px solid var(--border)}
  .finding-heading{display:grid;align-content:start;gap:5px;min-width:0}
  .finding-heading h5,.finding-heading h6{min-width:0;margin:0;color:var(--text);font-size:var(--text-sm);overflow-wrap:anywhere}
  .confidence{color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .category{margin:0;color:var(--muted);font-size:var(--text-sm);text-transform:capitalize}
  ul{display:grid;gap:10px;margin:0;padding:0;list-style:none;min-width:0}
  li{display:grid;gap:3px;min-width:0;font-size:var(--text-sm);line-height:1.55;overflow-wrap:anywhere}
  li strong{color:var(--muted);font-size:var(--text-xs);font-weight:600}
  .library-profile{margin-top:18px;padding-top:16px;border-top:1px solid var(--border)}
  .library-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:12px}
  .library-heading h5{margin:0;color:var(--text);font-size:var(--text-sm)}
  .library-heading p{margin:4px 0 8px;color:var(--muted);font-size:var(--text-sm)}
  .library-list h6 span{color:var(--muted);font-family:var(--mono);font-weight:500}
  .advisory,.catalog-neutral{justify-self:start;max-width:100%;box-sizing:border-box;border:1px solid rgb(var(--amber-rgb) / .4);border-radius:var(--radius-sm);padding:3px 7px;color:var(--amber);background:rgb(var(--amber-rgb) / .05);font-size:var(--text-xs);font-weight:600;overflow-wrap:anywhere}
  .advisory.high,.advisory.critical{border-color:rgb(var(--danger-rgb) / .4);color:var(--danger);background:rgb(var(--danger-rgb) / .05)}
  .catalog-neutral{border-color:var(--border);color:var(--muted);background:var(--surface)}
  dl{display:grid;gap:8px;margin:0;min-width:0}
  dl div{display:grid;grid-template-columns:minmax(96px,.35fr) minmax(0,1fr);gap:8px;font-size:var(--text-sm);line-height:1.55}
  dt{color:var(--muted)}
  dd{min-width:0;margin:0;overflow-wrap:anywhere;text-transform:none}
  .source-details{margin-top:8px;border-top:1px solid var(--border);font-size:var(--text-sm);line-height:1.6}
  .source-details summary{min-height:44px;box-sizing:border-box;padding:10px 0;cursor:pointer;overflow-wrap:anywhere;color:var(--muted)}
  .source-details summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
  .source-details p{margin:0 0 12px;color:var(--muted);overflow-wrap:anywhere}
  .source-details ul{padding:0 0 14px;color:var(--muted)}
  @media(max-width:700px){
    article{grid-template-columns:1fr;gap:12px}
    .library-heading{display:grid;gap:8px}
    .library-heading .evidence-status{justify-self:start}
    dl div{grid-template-columns:1fr}
    .infrastructure-roles dl div{grid-template-columns:1fr;gap:2px}
  }
</style>
