<script lang="ts">
  import type { Capability } from '$lib/capabilities';

  let {
    query = $bindable(),
    lookupMode = $bindable(),
    loading,
    entryCount,
    duplicateCount,
    lookupDisabled,
    lookupLimitations,
    externalIntelligenceSupported,
    malwareHostIntelligenceSupported,
    malwareIocIntelligenceSupported,
    securityTxtSupported,
    securityTxtEligible,
    includeExternalIntelligence = $bindable(),
    includeMalwareHostIntelligence = $bindable(),
    includeMalwareIocIntelligence = $bindable(),
    includeSecurityTxt = $bindable(),
    error,
    onsubmit,
  }: {
    query: string;
    lookupMode: 'fast' | 'deep';
    loading: boolean;
    entryCount: number;
    duplicateCount: number;
    lookupDisabled: Capability | null;
    lookupLimitations: Capability[];
    externalIntelligenceSupported: boolean;
    malwareHostIntelligenceSupported: boolean;
    malwareIocIntelligenceSupported: boolean;
    securityTxtSupported: boolean;
    securityTxtEligible: boolean;
    includeExternalIntelligence: boolean;
    includeMalwareHostIntelligence: boolean;
    includeMalwareIocIntelligence: boolean;
    includeSecurityTxt: boolean;
    error: string;
    onsubmit: (event: SubmitEvent) => void | Promise<void>;
  } = $props();

  const intelligenceOptionCount = $derived(
    Number(externalIntelligenceSupported)
      + Number(malwareHostIntelligenceSupported)
      + Number(malwareIocIntelligenceSupported),
  );
  const entryLimit = 2_000;
  const deepMode = $derived(lookupMode === 'deep');
  const loadingDetail = $derived(lookupMode === 'fast'
    ? 'Fast lookup is checking authoritative registration evidence and omitting slower web, WHOIS, and enrichment sources.'
    : 'Deep lookup is collecting registry, WHOIS, DNS, web, TLS, and separately attributed enrichment sources. Some registries can take several seconds to answer.');
</script>

<form class="search card" {onsubmit}>
  {#if lookupDisabled}
    <p class="feature-disabled" role="note">{lookupDisabled.reason || 'Lookup is disabled by deployment policy.'}</p>
  {/if}
  {#if !lookupDisabled && lookupLimitations.length}
    <p class="feature-disabled" role="note">Some lookup sources are disabled by deployment policy: {lookupLimitations.map((item) => item.id.replaceAll('_', ' ')).join(', ')}. Results will identify unevaluated evidence.</p>
  {/if}

  <label class="search-label" for="query">Domain, IP address, ASN, or domain list</label>
  <div class="input-row">
    <div class="query-field">
      <textarea id="query" bind:value={query} placeholder="example.com" autocomplete="off" spellcheck="false" rows="2"></textarea>
      {#if query}<button type="button" class="clear" aria-label="Clear query" onclick={() => query = ''}>×</button>{/if}
    </div>
    <button class="primary" disabled={loading || !entryCount || Boolean(lookupDisabled)}>
      {loading ? 'Looking up…' : entryCount > 1 ? `Open ${Math.min(entryCount, entryLimit)} in Bulk` : 'Run lookup'}
    </button>
  </div>
  <p class="input-help">
    {entryCount > 1
      ? `${entryCount} unique entries detected. Multiple entries continue in Bulk${duplicateCount ? `; ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} removed` : ''}.`
      : 'Separate multiple domains with commas, semicolons, tabs, or new lines.'}
  </p>

  <fieldset class="lookup-mode" disabled={loading}>
    <legend>Lookup depth</legend>
    <div class="mode-options" role="radiogroup" aria-label="Lookup depth">
      <label class:active={lookupMode === 'deep'}>
        <input type="radio" name="lookup-depth" value="deep" bind:group={lookupMode}>
        <span><strong>Deep</strong><small>Full evidence</small></span>
      </label>
      <label class:active={lookupMode === 'fast'}>
        <input type="radio" name="lookup-depth" value="fast" bind:group={lookupMode}>
        <span><strong>Fast</strong><small>Registration first</small></span>
      </label>
    </div>
    <p>{lookupMode === 'deep'
      ? 'Deep is the default and may take longer while WHOIS, web, DNS, TLS, and registrar RDAP sources settle.'
      : 'Fast returns lower-request registration evidence and skips slower deep-only sources.'}</p>
  </fieldset>

  {#if loading}
    <p class="loading-note" role="status">{loadingDetail}</p>
  {/if}

  {#if securityTxtSupported}
    <fieldset class="intelligence-options">
      <legend>Optional disclosure contact</legend>
      <p class="intelligence-hint">This starts one bounded HTTPS collection at the standardized security.txt location on the exact hostname entered.</p>
      <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeSecurityTxt} disabled={!deepMode || !securityTxtEligible}> <span><strong>Retrieve security.txt contacts</strong> Collects published contact, policy, expiry, language, and encryption references. Publication does not authorize security testing.</span></label>
    </fieldset>
  {/if}

  {#if intelligenceOptionCount}
    <fieldset class="intelligence-options">
      <legend>Optional third-party intelligence</legend>
      <p class="intelligence-hint">Each selected source receives only the registrable domain for a deep single-domain lookup. Nothing is submitted for scanning or reporting, and provider verdicts never affect availability.</p>
      {#if externalIntelligenceSupported}
        <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeExternalIntelligence} disabled={!deepMode || entryCount > 1}> <span><strong>Search archived URLscan verdicts</strong> Sends only the registrable domain to the optional third-party search API. It does not submit the domain for scanning.</span></label>
      {/if}
      {#if malwareHostIntelligenceSupported}
        <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeMalwareHostIntelligence} disabled={!deepMode || entryCount > 1}> <span><strong>Search malware-distribution records</strong> Sends only the registrable domain to the optional URLhaus host API. It searches existing records and does not submit a URL or sample.</span></label>
      {/if}
      {#if malwareIocIntelligenceSupported}
        <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeMalwareIocIntelligence} disabled={!deepMode || entryCount > 1}> <span><strong>Search malware infrastructure records</strong> Sends only the registrable domain to the optional ThreatFox search API. It searches retained indicators and does not submit an IOC, URL, or sample.</span></label>
      {/if}
    </fieldset>
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

<style>
  .search{padding:var(--card-pad)}
  .search-label{display:block;margin-bottom:9px;font:700 var(--text-sm) var(--mono)}
  .input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px}
  .query-field{position:relative;min-width:0}
  .query-field textarea{display:block;width:100%;min-height:54px;padding:14px 48px 10px 12px;background:rgb(var(--bg-rgb) / .78);font-family:var(--mono);font-size:var(--text-sm)}
  .clear{position:absolute;right:7px;top:9px;width:34px;height:34px;border:0;background:none;font-size:1.25rem}
  .input-help{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .lookup-mode{margin:14px 0 0;padding:0;border:0}
  .lookup-mode legend{margin-bottom:8px;color:var(--text);font:700 var(--text-xs) var(--mono)}
  .mode-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-width:520px}
  .mode-options label{display:flex;gap:9px;align-items:center;min-width:0;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:rgb(var(--bg-rgb) / .54);cursor:pointer}
  .mode-options label.active{border-color:rgb(var(--accent-rgb) / .72);background:rgb(var(--accent-rgb) / .12)}
  .mode-options input{flex:0 0 auto}
  .mode-options span{display:grid;gap:2px;min-width:0}
  .mode-options strong{font:700 var(--text-sm) var(--mono)}
  .mode-options small{color:var(--muted);font-size:var(--text-2xs)}
  .lookup-mode p,.loading-note{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .loading-note{padding:10px 12px;border:1px solid rgb(var(--accent-rgb) / .32);border-radius:var(--radius-md);background:rgb(var(--accent-rgb) / .08)}
  .intelligence-options{margin:14px 0 0;padding:12px 14px 14px;border:1px solid var(--border);border-radius:var(--radius-md)}
  .intelligence-options legend{padding:0 6px;color:var(--text);font:700 var(--text-xs) var(--mono)}
  .intelligence-hint{margin:0 0 10px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .intelligence-option{margin:8px 0 0}
  .intelligence-option span{color:var(--muted)}
  @media(max-width:600px){.input-row{grid-template-columns:1fr}.input-row .primary{width:100%;min-height:44px}.mode-options{grid-template-columns:1fr}}
</style>
