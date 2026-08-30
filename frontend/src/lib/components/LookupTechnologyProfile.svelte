<script lang="ts">
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  type EvidenceRole = 'observed_edge' | 'application_platform' | 'framework_runtime' | 'embedded_dependency';
  type Evidence = { source: string; role: string; description: string };
  type Finding = { id: string; name: string; category: string; confidence: string; roles: string[]; evidence: Evidence[] };
  type LibraryFinding = {
    id: string;
    name: string;
    version: string;
    detection: string;
    advisoryCount: number;
    severity: string;
    identifiers: string;
    knownExploitedCount: number;
    knownExploitedIdentifiers: string;
    weaknesses: string;
  };

  let {
    status,
    complete,
    findings,
    authoritativeNameservers,
    limitations,
    libraryAvailable,
    libraryStatus,
    libraryComplete,
    libraryCatalog,
    libraries,
    libraryLimitations,
    initiallyExpanded = false,
  }: {
    status: string;
    complete: boolean;
    findings: Finding[];
    authoritativeNameservers: string[];
    limitations: string[];
    libraryAvailable: boolean;
    libraryStatus: string;
    libraryComplete: boolean;
    libraryCatalog: string;
    libraries: LibraryFinding[];
    libraryLimitations: string[];
    initiallyExpanded?: boolean;
  } = $props();

  const advisoryMatches = $derived(libraries.filter((library) => library.advisoryCount > 0).length);
  const noTechnologyMatches = $derived(status === 'success' && complete && findings.length === 0);
  const noLibraryMatches = $derived(libraryStatus === 'success' && libraryComplete && libraries.length === 0);
  const roleOrder: readonly EvidenceRole[] = ['observed_edge', 'application_platform', 'framework_runtime', 'embedded_dependency'];
  const roleLabels: Record<EvidenceRole, string> = {
    observed_edge: 'Observed edge, CDN, reverse proxy or WAF',
    application_platform: 'Application-platform indicator',
    framework_runtime: 'Framework or runtime indicator',
    embedded_dependency: 'Embedded or third-party dependency',
  };
  const findingsByRole = $derived(Object.fromEntries(roleOrder.map((role) => [
    role,
    findings.filter((finding) => finding.roles.includes(role)).map((finding) => finding.name),
  ])) as Record<EvidenceRole, string[]>);
</script>

<details class="technology-card evidence-card card" aria-labelledby="technology-profile-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
    <span class="evidence-summary-copy">
      <span class="eyebrow">Derived deep-scan analysis</span>
      <span class="evidence-summary-title" id="technology-profile-title" role="heading" aria-level="4">Technology indicators</span>
      <span class="evidence-summary-detail">{findings.length ? `${findings.length} matched indicator${findings.length === 1 ? '' : 's'}` : noTechnologyMatches ? 'Analysis complete; no curated signatures matched' : 'No conclusive match'} · Expand for evidence and limitations</span>
    </span>
    <span class="evidence-status {evidenceStatusTone(status, { complete, neutral: noTechnologyMatches })}">{noTechnologyMatches ? 'No recognised matches' : status}</span>
    </span>
  </summary>

  <div class="evidence-body">
    <section class="infrastructure-roles" aria-labelledby="infrastructure-role-title">
      <h5 id="infrastructure-role-title">Web infrastructure evidence roles</h5>
      <dl>
        <div><dt>Authoritative DNS operator</dt><dd>{authoritativeNameservers.join(' · ') || 'Unavailable'}<small>Nameserver identities are retained as DNS evidence; operator ownership is not inferred.</small></dd></div>
        {#each roleOrder as role}
          <div><dt>{roleLabels[role]}</dt><dd>{findingsByRole[role].join(' · ') || 'No retained indicator'}</dd></div>
        {/each}
        <div><dt>Origin host</dt><dd>Not established<small>Edge and application-platform indicators do not reveal a concealed origin.</small></dd></div>
      </dl>
    </section>

    {#if findings.length}
      <div class="technology-grid">
        {#each findings as finding}
          <article>
            <div class="finding-head">
              <h5>{finding.name}</h5>
              <span class="confidence">{finding.confidence} signature strength</span>
            </div>
            <p class="category">{finding.category}</p>
            <ul aria-label={`${finding.name} evidence`}>
              {#each finding.evidence as evidence}
                <li><strong>{evidence.source}{evidence.role && roleLabels[evidence.role as EvidenceRole] ? ` · ${roleLabels[evidence.role as EvidenceRole]}` : ''}</strong><span>{evidence.description}</span></li>
              {/each}
            </ul>
          </article>
        {/each}
      </div>
    {:else}
      <p class="callout info">No curated technology signature matched the captured response. This does not mean that no framework, service, or delivery platform is present.</p>
    {/if}

    {#if limitations.length}<p class="callout warn">{limitations.join(' ')}</p>{/if}
    <p class="card-note">Signature strength describes how distinctive the matched retained clue is; it is not an empirical accuracy rate or confirmation of a provider, origin, owner, or technology. These indicators make no additional request and do not affect availability or Risk scoring.</p>

    {#if libraryAvailable}
      <section class="library-profile" aria-labelledby="browser-library-title">
        <div class="library-heading">
          <div>
            <p class="eyebrow">Passive component catalogue</p>
            <h5 id="browser-library-title">Observed browser libraries</h5>
            <p>{libraries.length ? `${libraries.length} apparent librar${libraries.length === 1 ? 'y' : 'ies'}; ${advisoryMatches} with catalogue advisory matches` : 'No bounded library signature matched'}</p>
          </div>
          <span class="evidence-status {evidenceStatusTone(libraryStatus, { complete: libraryComplete, neutral: noLibraryMatches })}">{noLibraryMatches ? 'No catalogue matches' : libraryStatus}</span>
        </div>

        {#if libraries.length}
          <div class="library-grid">
            {#each libraries as library}
              <article>
                <div class="finding-head">
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
          <p class="callout info">No versioned browser-library signature matched the capped static script evidence. This does not establish that the page uses no JavaScript library.</p>
        {/if}

        {#if libraryLimitations.length}<p class="callout warn">{libraryLimitations.join(' ')}</p>{/if}
        <p class="card-note">WHOISleuth uses pinned Retire.js and CISA KEV catalogue projections against script references and bounded inline content already present in the captured homepage. It does not download or execute referenced scripts. Advisory and known-exploited matches are review leads, not proof that affected code is present, reachable, or exploitable.</p>
      </section>
    {/if}
  </div>
</details>

<style>
  .technology-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:10px}
  .infrastructure-roles{min-width:0;margin-bottom:14px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)}
  .infrastructure-roles h5{margin:0 0 10px;color:var(--text);font-size:var(--text-sm)}
  .infrastructure-roles dl{display:grid;gap:8px;margin:0}
  .infrastructure-roles dl div{display:grid;grid-template-columns:minmax(180px,.42fr) minmax(0,1fr);gap:10px}
  .infrastructure-roles dt{color:var(--muted);font-size:var(--text-xs)}
  .infrastructure-roles dd{min-width:0;margin:0;color:var(--text);font-size:var(--text-xs);overflow-wrap:anywhere}
  .infrastructure-roles small{display:block;margin-top:2px;color:var(--muted);line-height:1.45}
  .technology-grid article{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .finding-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .finding-head h5{min-width:0;margin:0;color:var(--text);font-size:var(--text-sm);overflow-wrap:anywhere}
  .confidence{flex:0 0 auto;color:var(--accent);font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.05em}
  .category{margin:3px 0 0;color:var(--muted);font-size:var(--text-xs);text-transform:capitalize}
  ul{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}
  li{display:grid;gap:2px;min-width:0;font-size:var(--text-xs);line-height:1.45}
  li strong{color:var(--muted);font-size:var(--text-2xs);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  li span{overflow-wrap:anywhere}
  .callout{margin-top:12px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .library-profile{margin-top:18px;padding-top:16px;border-top:1px solid var(--border)}
  .library-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
  .library-heading .eyebrow{margin:0 0 3px}
  .library-heading h5{margin:0;color:var(--text);font-size:var(--text-sm)}
  .library-heading p:not(.eyebrow){margin:4px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .library-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:10px;margin-top:12px}
  .library-grid article{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .library-grid h6{min-width:0;margin:0;color:var(--text);font-size:var(--text-sm);overflow-wrap:anywhere}
  .library-grid h6 span{color:var(--muted);font-family:var(--mono);font-size:var(--text-xs);font-weight:500}
  .advisory,.catalog-neutral{flex:0 0 auto;border:1px solid rgb(var(--amber-rgb) / .4);border-radius:999px;padding:2px 7px;color:var(--amber);background:rgb(var(--amber-rgb) / .05);font-size:var(--text-2xs);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  .advisory.high,.advisory.critical{border-color:rgb(var(--danger-rgb) / .4);color:var(--danger);background:rgb(var(--danger-rgb) / .05)}
  .catalog-neutral{border-color:var(--border);color:var(--muted);background:var(--surface)}
  dl{display:grid;gap:6px;margin:10px 0 0}
  dl div{display:grid;grid-template-columns:minmax(86px,.35fr) minmax(0,1fr);gap:8px;font-size:var(--text-xs);line-height:1.45}
  dt{color:var(--muted)}
  dd{min-width:0;margin:0;overflow-wrap:anywhere;text-transform:none}
  @media(max-width:650px){
    .finding-head{display:grid;gap:4px}
    .confidence,.advisory,.catalog-neutral{justify-self:start}
    .library-heading{display:grid;gap:8px}
    .library-heading .evidence-status{justify-self:start}
    dl div{grid-template-columns:1fr}
    .infrastructure-roles dl div{grid-template-columns:1fr;gap:2px}
  }
</style>
