<script lang="ts">
  import { onMount } from 'svelte';
  import { parseBoundedJson } from '$lib/bounded-json';
  import {
    compareWebsiteSnapshots,
    deleteWebsiteSnapshot,
    exportWebsiteSnapshots,
    importWebsiteSnapshots,
    loadWebsiteSnapshots,
    MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES,
    retainWebsiteSnapshot,
    type WebsiteProfileSnapshot,
  } from '$lib/website-snapshots';

  let { domain, canSave, buildSnapshot }: {
    domain: string;
    canSave: boolean;
    buildSnapshot: () => unknown;
  } = $props();
  let snapshots = $state<WebsiteProfileSnapshot[]>([]);
  let beforeId = $state('');
  let afterId = $state('');
  let message = $state('');
  let operation = $state<'loading' | 'ready' | 'busy'>('loading');
  let operationGeneration = 0;
  let mounted = false;
  let loadedDomain = $state('');
  const domainSnapshots = $derived(snapshots.filter((item) => item.domain === domain));
  const certificateSnapshots = $derived(
    snapshots
      .filter((item) => item.certificate)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt)),
  );
  const certificateDomains = $derived(new Set(certificateSnapshots.map((item) => item.domain)).size);
  const certificateInventory = $derived.by(() => {
    const seen = new Set<string>();
    return certificateSnapshots.filter((item) => {
      if (seen.has(item.domain) || seen.size >= 20) return false;
      seen.add(item.domain);
      return true;
    });
  });
  const before = $derived(domainSnapshots.find((item) => item.id === beforeId) || null);
  const after = $derived(domainSnapshots.find((item) => item.id === afterId) || null);
  const comparison = $derived(before && after ? compareWebsiteSnapshots(before, after) : null);

  onMount(() => {
    mounted = true;
    loadedDomain = domain;
    void refresh(domain);
    return () => { mounted = false; operationGeneration += 1; };
  });
  $effect(() => {
    const nextDomain = domain;
    if (!mounted || nextDomain === loadedDomain) return;
    loadedDomain = nextDomain;
    snapshots = [];
    beforeId = '';
    afterId = '';
    message = '';
    void refresh(nextDomain);
  });
  function owns(generation: number, expectedDomain: string): boolean {
    return mounted && generation === operationGeneration && domain === expectedDomain;
  }
  async function refresh(expectedDomain: string) {
    const generation = ++operationGeneration;
    operation = 'loading';
    try {
      const next = await loadWebsiteSnapshots();
      if (!owns(generation, expectedDomain)) return;
      snapshots = next;
      const scoped = next.filter((item) => item.domain === expectedDomain);
      if (!afterId && scoped[0]) afterId = scoped[0].id;
      if (!beforeId && scoped[1]) beforeId = scoped[1].id;
    } catch (cause) {
      if (!owns(generation, expectedDomain)) return;
      message = cause instanceof Error ? cause.message : 'Could not load website snapshots.';
    } finally {
      if (owns(generation, expectedDomain)) operation = 'ready';
    }
  }
  async function save() {
    if (operation !== 'ready') return;
    const expectedDomain = domain;
    const generation = ++operationGeneration;
    operation = 'busy';
    message = '';
    try {
      const next = await retainWebsiteSnapshot(buildSnapshot());
      if (!owns(generation, expectedDomain)) return;
      snapshots = next;
      afterId = next.find((item) => item.domain === expectedDomain)?.id || '';
      const prior = next.filter((item) => item.domain === expectedDomain && item.id !== afterId)[0];
      if (prior) beforeId = prior.id;
      const retained = next.find((item) => item.id === afterId);
      message = `Saved a compact website-profile snapshot for ${expectedDomain}${retained?.certificate ? ' with one observed leaf-certificate record' : ''}.`;
    } catch (cause) {
      if (!owns(generation, expectedDomain)) return;
      message = cause instanceof Error ? cause.message : 'Could not save the website snapshot.';
    } finally {
      if (owns(generation, expectedDomain)) operation = 'ready';
    }
  }
  async function remove(id: string) {
    if (operation !== 'ready' || !confirm('Delete this compact website-profile snapshot?')) return;
    const expectedDomain = domain;
    const generation = ++operationGeneration;
    operation = 'busy';
    message = '';
    try {
      const next = await deleteWebsiteSnapshot(id);
      if (!owns(generation, expectedDomain)) return;
      snapshots = next;
      if (beforeId === id) beforeId = '';
      if (afterId === id) afterId = '';
      message = 'Deleted the selected website-profile snapshot.';
    } catch (cause) {
      if (!owns(generation, expectedDomain)) return;
      message = cause instanceof Error ? cause.message : 'Could not delete the website snapshot.';
    } finally {
      if (owns(generation, expectedDomain)) operation = 'ready';
    }
  }
  async function download() {
    if (operation !== 'ready') return;
    const expectedDomain = domain;
    const generation = ++operationGeneration;
    operation = 'busy';
    message = '';
    try {
      await exportWebsiteSnapshots();
      if (!owns(generation, expectedDomain)) return;
      message = 'Exported the website-profile snapshot collection.';
    } catch (cause) {
      if (!owns(generation, expectedDomain)) return;
      message = cause instanceof Error ? cause.message : 'Could not export website snapshots.';
    } finally {
      if (owns(generation, expectedDomain)) operation = 'ready';
    }
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || operation !== 'ready') return;
    const expectedDomain = domain;
    const generation = ++operationGeneration;
    operation = 'busy';
    message = '';
    try {
      if (file.size > MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES) throw new Error('Website-snapshot imports are limited to 768 KiB.');
      const result = await importWebsiteSnapshots(parseBoundedJson(await file.text(), {
        label: 'Website-snapshot import',
        maximumBytes: MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES,
      }));
      if (!owns(generation, expectedDomain)) return;
      snapshots = result.snapshots;
      message = `Imported ${result.added} new and ${result.updated} matching snapshot${result.added + result.updated === 1 ? '' : 's'}.`;
    } catch (cause) {
      if (!owns(generation, expectedDomain)) return;
      message = cause instanceof Error ? cause.message : 'Website-snapshot import failed.';
    } finally {
      input.value = '';
      if (owns(generation, expectedDomain)) operation = 'ready';
    }
  }
  function when(value: string) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unknown time' : parsed.toLocaleString();
  }
  function sharedCertificateDomains(fingerprint: string): number {
    return new Set(
      certificateSnapshots
        .filter((item) => item.certificate?.fingerprintSha256 === fingerprint)
        .map((item) => item.domain),
    ).size;
  }
</script>

<section id="website-profile-snapshots" class="snapshot-manager card" aria-labelledby="website-snapshot-title">
  <header>
    <div><p class="eyebrow">Analyst-selected history</p><h3 id="website-snapshot-title">Website profile snapshots</h3></div>
    <div class="toolbar">
      <button class="btn" type="button" onclick={save} disabled={!canSave || operation !== 'ready'}>Save current snapshot</button>
      <button class="btn" type="button" onclick={download} disabled={!snapshots.length || operation !== 'ready'}>Export</button>
      <label class="btn file-btn" class:disabled={operation !== 'ready'}>Import<input type="file" accept="application/json,.json" onchange={importFile} disabled={operation !== 'ready'}></label>
    </div>
  </header>
  <p>Save after reviewing a completed Deep Lookup. Snapshots retain curated technology identifiers, posture states, identity digests, source health, completeness and timestamps. Differences are review cues.</p>
  {#if domainSnapshots.length}
    <div class="comparison-controls">
      <label class="field">Earlier snapshot<select bind:value={beforeId} disabled={operation !== 'ready'}><option value="">Choose snapshot</option>{#each domainSnapshots as item}<option value={item.id}>{when(item.observedAt)}</option>{/each}</select></label>
      <label class="field">Later snapshot<select bind:value={afterId} disabled={operation !== 'ready'}><option value="">Choose snapshot</option>{#each domainSnapshots as item}<option value={item.id}>{when(item.observedAt)}</option>{/each}</select></label>
    </div>
    {#if comparison}
      <div class="comparison" class:incomparable={!comparison.compatible}>
        <strong>{comparison.compatible ? `${comparison.changes.length} material field change${comparison.changes.length === 1 ? '' : 's'}` : 'Snapshots are not comparable'}</strong>
        {#if comparison.changes.length}
          <ul>{#each comparison.changes as change}<li><span>{change.state}</span><code>{change.field}</code><small>{change.before || 'Unavailable'} → {change.after || 'Unavailable'}</small></li>{/each}</ul>
        {:else}<p>No curated field changed between these compatible snapshots.</p>{/if}
      </div>
      {#if comparison.dependencyTransitions.length}
        <section class="dependency-transitions" aria-labelledby="dependency-transition-title">
          <h4 id="dependency-transition-title">Dependency transitions to review</h4>
          <ul>
            {#each comparison.dependencyTransitions as transition}
              <li class:attention={transition.state === 'active_to_unresolved' || transition.state === 'active_to_deprovision_cue'}>
                <strong>{transition.recordType} · {transition.state.replaceAll('_', ' ')}</strong>
                <code>{transition.target}</code>
                <p>{transition.detail}</p>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
    <details>
      <summary>Manage {domainSnapshots.length} saved snapshot{domainSnapshots.length === 1 ? '' : 's'}</summary>
      <ul class="saved-list">{#each domainSnapshots as item}<li><span>{when(item.observedAt)} · {item.complete ? 'Complete' : 'Partial'}{item.truncated ? ' · Truncated' : ''}</span><button class="btn small danger" type="button" onclick={() => remove(item.id)} disabled={operation !== 'ready'}>Delete</button></li>{/each}</ul>
    </details>
  {:else}
    <p>No website-profile snapshot is retained for this domain.</p>
  {/if}
  <section class="certificate-inventory" aria-labelledby="certificate-inventory-title">
    <header>
      <div>
        <p class="eyebrow">Deployment-observed history</p>
        <h4 id="certificate-inventory-title">Observed certificate inventory</h4>
      </div>
      <span>{certificateSnapshots.length} observation{certificateSnapshots.length === 1 ? '' : 's'} · {certificateDomains} domain{certificateDomains === 1 ? '' : 's'}</span>
    </header>
    <p>Built from leaf certificates in analyst-saved Deep Lookups on this browser. Records are point-in-time observations.</p>
    {#if certificateInventory.length}
      <ul>
        {#each certificateInventory as item}
          {@const certificate = item.certificate}
          {#if certificate}
            <li>
              <details>
                <summary>
                  <span><strong>{item.domain}</strong><small>{when(item.observedAt)} · {certificate.issuer || 'Issuer unavailable'}</small></span>
                  <code>{certificate.fingerprintSha256.slice(0, 16)}…</code>
                </summary>
                <dl>
                  <dt>Leaf SHA-256</dt><dd><code>{certificate.fingerprintSha256}</code></dd>
                  <dt>SPKI SHA-256</dt><dd><code>{certificate.spkiFingerprintSha256 || 'Unavailable'}</code></dd>
                  <dt>Subject</dt><dd>{certificate.subject || 'Unavailable'}</dd>
                  <dt>Issuer</dt><dd>{certificate.issuer || 'Unavailable'}</dd>
                  <dt>Validity</dt><dd>{certificate.validFrom && certificate.validTo ? `${when(certificate.validFrom)} to ${when(certificate.validTo)}` : 'Unavailable'}</dd>
                  <dt>Observation</dt><dd>{certificate.complete ? 'Complete TLS profile' : 'Partial TLS profile'}{certificate.truncated ? ' · Truncated' : ''}</dd>
                </dl>
                {#if sharedCertificateDomains(certificate.fingerprintSha256) > 1}
                  <p class="callout info">The same exact leaf fingerprint appears across {sharedCertificateDomains(certificate.fingerprintSha256)} saved domains. Verify shared certificates independently.</p>
                {/if}
              </details>
            </li>
          {/if}
        {/each}
      </ul>
      {#if certificateDomains > certificateInventory.length}
        <p>Showing the latest observation for {certificateInventory.length} of {certificateDomains} domains. The exported collection retains the bounded underlying observations.</p>
      {/if}
    {:else}
      <p>No observed certificate has been retained. Review a completed Deep domain Lookup, then save the current snapshot.</p>
    {/if}
  </section>
  <p class="message" role="status">{message}</p>
</section>

<style>
  .snapshot-manager{margin:16px 0;padding:var(--card-pad)}
  header{display:flex;align-items:start;justify-content:space-between;gap:12px}
  h3,.eyebrow{margin:0}
  .snapshot-manager>p{color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .comparison-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}
  .comparison{margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  .comparison.incomparable{border-color:var(--amber)}
  .comparison ul,.saved-list{display:grid;gap:6px;margin:9px 0 0;padding:0;list-style:none}
  .comparison li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 8px}
  .comparison li span{color:var(--accent);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .comparison li small{grid-column:2;overflow-wrap:anywhere;color:var(--muted)}
  .dependency-transitions{margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  .dependency-transitions h4{margin:0;font:700 var(--text-xs) var(--mono)}
  .dependency-transitions ul{display:grid;gap:7px;margin:9px 0 0;padding:0;list-style:none}
  .dependency-transitions li{display:grid;gap:3px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .dependency-transitions li.attention{border-color:color-mix(in srgb,var(--amber) 48%,var(--border))}
  .dependency-transitions strong{font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  .dependency-transitions code{overflow-wrap:anywhere}
  .dependency-transitions p{margin:2px 0 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  details{margin-top:10px}
  summary{font:700 var(--text-xs) var(--mono)}
  .saved-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--border);font-size:var(--text-xs)}
  .certificate-inventory{margin-top:14px;padding-top:14px;border-top:1px solid var(--border)}
  .certificate-inventory header{align-items:center}
  .certificate-inventory h4{margin:2px 0 0;font:700 var(--text-sm) var(--mono)}
  .certificate-inventory header>span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}
  .certificate-inventory>p{margin:7px 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .certificate-inventory>ul{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}
  .certificate-inventory li{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  .certificate-inventory summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px;cursor:pointer}
  .certificate-inventory summary span{min-width:0}
  .certificate-inventory summary strong,.certificate-inventory summary small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .certificate-inventory summary small{margin-top:2px;color:var(--muted);font-size:var(--text-2xs)}
  .certificate-inventory summary>code{flex:none;color:var(--muted);font-size:var(--text-2xs)}
  .certificate-inventory dl{display:grid;grid-template-columns:minmax(100px,140px) minmax(0,1fr);gap:6px 10px;margin:0;padding:10px;border-top:1px solid var(--border);font-size:var(--text-xs)}
  .certificate-inventory dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .certificate-inventory dd code{overflow-wrap:anywhere}
  .certificate-inventory .callout{margin:0 10px 10px}
  .message:empty{display:none}
  @media(max-width:700px){
    header{flex-direction:column}.comparison-controls{grid-template-columns:1fr}.toolbar{width:100%}.toolbar>*{flex:1}
    .certificate-inventory summary{align-items:start;flex-direction:column}.certificate-inventory dl{grid-template-columns:1fr;gap:3px}.certificate-inventory dt{margin-top:6px}
  }
</style>
