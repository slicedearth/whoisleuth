<script lang="ts">
  import type { Capability } from '$lib/capabilities';

  let {
    query = $bindable(),
    loading,
    entryCount,
    duplicateCount,
    lookupDisabled,
    lookupLimitations,
    externalIntelligenceSupported,
    malwareHostIntelligenceSupported,
    malwareIocIntelligenceSupported,
    includeExternalIntelligence = $bindable(),
    includeMalwareHostIntelligence = $bindable(),
    includeMalwareIocIntelligence = $bindable(),
    error,
    onsubmit,
  }: {
    query: string;
    loading: boolean;
    entryCount: number;
    duplicateCount: number;
    lookupDisabled: Capability | null;
    lookupLimitations: Capability[];
    externalIntelligenceSupported: boolean;
    malwareHostIntelligenceSupported: boolean;
    malwareIocIntelligenceSupported: boolean;
    includeExternalIntelligence: boolean;
    includeMalwareHostIntelligence: boolean;
    includeMalwareIocIntelligence: boolean;
    error: string;
    onsubmit: (event: SubmitEvent) => void | Promise<void>;
  } = $props();

  const intelligenceOptionCount = $derived(
    Number(externalIntelligenceSupported)
      + Number(malwareHostIntelligenceSupported)
      + Number(malwareIocIntelligenceSupported),
  );
  const entryLimit = 2_000;
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

  {#if intelligenceOptionCount}
    <fieldset class="intelligence-options">
      <legend>Optional third-party intelligence</legend>
      <p class="intelligence-hint">Each selected source receives only the registrable domain for a deep single-domain lookup. Nothing is submitted for scanning or reporting, and provider verdicts never affect availability.</p>
      {#if externalIntelligenceSupported}
        <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeExternalIntelligence} disabled={entryCount > 1}> <span><strong>Search archived URLscan verdicts</strong> Sends only the registrable domain to the optional third-party search API. It does not submit the domain for scanning.</span></label>
      {/if}
      {#if malwareHostIntelligenceSupported}
        <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeMalwareHostIntelligence} disabled={entryCount > 1}> <span><strong>Search malware-distribution records</strong> Sends only the registrable domain to the optional URLhaus host API. It searches existing records and does not submit a URL or sample.</span></label>
      {/if}
      {#if malwareIocIntelligenceSupported}
        <label class="intelligence-option choice"><input type="checkbox" bind:checked={includeMalwareIocIntelligence} disabled={entryCount > 1}> <span><strong>Search malware infrastructure records</strong> Sends only the registrable domain to the optional ThreatFox search API. It searches retained indicators and does not submit an IOC, URL, or sample.</span></label>
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
  .query-field textarea{display:block;width:100%;min-height:54px;padding:14px 48px 10px 12px;background:rgba(15,17,21,.78);font-family:var(--mono);font-size:var(--text-sm)}
  .clear{position:absolute;right:7px;top:9px;width:34px;height:34px;border:0;background:none;font-size:1.25rem}
  .input-help{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .intelligence-options{margin:14px 0 0;padding:12px 14px 14px;border:1px solid var(--border);border-radius:var(--radius-md)}
  .intelligence-options legend{padding:0 6px;color:var(--text);font:700 var(--text-xs) var(--mono)}
  .intelligence-hint{margin:0 0 10px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .intelligence-option{margin:8px 0 0}
  .intelligence-option span{color:var(--muted)}
  @media(max-width:600px){.input-row{grid-template-columns:1fr}.input-row .primary{width:100%;min-height:44px}}
</style>
