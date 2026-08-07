<script lang="ts">
  import {
    applyDomainControlPassport,
    buildBrandProfilePassportInput,
    buildDomainControlPassport,
    DOMAIN_CONTROL_PASSPORT_FIELDS,
    MAX_DOMAIN_CONTROL_PASSPORT_BYTES,
    passportConfiguredFields,
    verifyDomainControlPassport,
    type DomainControlPassportField,
  } from '$lib/analysis/domain-control-passport.ts';
  import type { DomainControlPassport } from '$lib/analysis/domain-control-manifest-core.ts';
  import type { BrandProfile } from '$lib/brand-profiles';

  let { active, saveProfile }: {
    active: BrandProfile;
    saveProfile: (profile: BrandProfile) => void | Promise<void>;
  } = $props();

  const fieldLabels: Record<DomainControlPassportField, string> = {
    nameservers: 'Nameservers',
    ds: 'DS records',
    mx: 'Mail exchangers',
    caa: 'CAA policy',
    tlsIssuer: 'TLS issuer',
    tlsSpkiSha256: 'TLS public key',
    registrarLock: 'Transfer lock',
    renewalReviewAt: 'Renewal review',
  };

  const exportable = $derived(active.desiredPostureBaselines.filter((item) => active.officialDomains.includes(item.domain)));
  let selectedExports = $state<string[]>([]);
  let expiryDays = $state('90');
  let imported = $state<DomainControlPassport | null>(null);
  let selectedImports = $state<string[]>([]);
  let addDomains = $state<string[]>([]);
  let importFields = $state<Record<string, DomainControlPassportField[]>>({});
  let busy = $state(false);
  let message = $state('');

  function toggle(values: readonly string[], value: string, checked: boolean): string[] {
    return checked ? [...new Set([...values, value])] : values.filter((item) => item !== value);
  }

  function toggleExport(domain: string, checked: boolean): void {
    selectedExports = toggle(selectedExports, domain, checked);
  }

  function toggleImport(domain: string, checked: boolean): void {
    selectedImports = toggle(selectedImports, domain, checked);
  }

  function toggleAdd(domain: string, checked: boolean): void {
    addDomains = toggle(addDomains, domain, checked);
  }

  function toggleField(domain: string, field: DomainControlPassportField, checked: boolean): void {
    importFields = {
      ...importFields,
      [domain]: toggle(importFields[domain] ?? [], field, checked) as DomainControlPassportField[],
    };
  }

  async function downloadPassport(): Promise<void> {
    busy = true;
    message = '';
    try {
      const generatedAt = new Date();
      const expiresAt = new Date(generatedAt.getTime() + Number(expiryDays) * 86_400_000).toISOString();
      const input = buildBrandProfilePassportInput(active, selectedExports, expiresAt);
      const passport = await buildDomainControlPassport(input, generatedAt.toISOString());
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(passport, null, 2)}\n`], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `whoisleuth-domain-control-passport-${generatedAt.toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      message = `Exported ${passport.entries.length} verified domain-control entr${passport.entries.length === 1 ? 'y' : 'ies'}.`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not export the domain-control passport.';
    } finally {
      busy = false;
    }
  }

  async function choosePassport(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = true;
    message = '';
    try {
      if (file.size > MAX_DOMAIN_CONTROL_PASSPORT_BYTES) throw new Error('Domain-control passports are limited to 256 KB.');
      const verified = await verifyDomainControlPassport(JSON.parse(await file.text()));
      imported = verified;
      selectedImports = verified.entries
        .filter((entry) => active.officialDomains.includes(entry.domain))
        .map((entry) => entry.domain);
      addDomains = [];
      importFields = Object.fromEntries(verified.entries.map((entry) => [entry.domain, passportConfiguredFields(entry)]));
      message = `Verified ${verified.entries.length} passport entr${verified.entries.length === 1 ? 'y' : 'ies'}. Review each field before importing.`;
    } catch (cause) {
      imported = null;
      selectedImports = [];
      addDomains = [];
      importFields = {};
      message = cause instanceof Error ? cause.message : 'Could not verify the domain-control passport.';
    } finally {
      input.value = '';
      busy = false;
    }
  }

  async function applyImport(): Promise<void> {
    if (!imported) return;
    busy = true;
    message = '';
    try {
      const choices = imported.entries
        .filter((entry) => selectedImports.includes(entry.domain)
          && (active.officialDomains.includes(entry.domain) || addDomains.includes(entry.domain)))
        .map((entry) => ({
          domain: entry.domain,
          addOfficialDomain: addDomains.includes(entry.domain),
          fields: importFields[entry.domain] ?? [],
        }));
      if (!choices.length || choices.every((choice) => !choice.fields.length)) {
        throw new Error('Select at least one configured field to import.');
      }
      await saveProfile(applyDomainControlPassport(active, imported, choices));
      message = `Imported reviewed fields for ${choices.length} domain${choices.length === 1 ? '' : 's'}. Unselected and unconfigured fields were left unchanged.`;
      imported = null;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not import the domain-control passport.';
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    const available = new Set(exportable.map((item) => item.domain));
    const retained = selectedExports.filter((domain) => available.has(domain));
    const next = retained.length ? retained : exportable.map((item) => item.domain);
    if (next.length !== selectedExports.length || next.some((domain, index) => domain !== selectedExports[index])) {
      selectedExports = next;
    }
  });
</script>

<section class="passport card" aria-labelledby="domain-passport-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Portable control state</p>
      <h2 id="domain-passport-title">Domain-control passport</h2>
      <p>Move a deliberately selected subset of official-domain expectations between the browser Console and CLI. Integrity is verified locally before import.</p>
    </div>
    <label class="btn file-btn" class:disabled={busy}>Review passport<input type="file" accept="application/json,.json" onchange={choosePassport} disabled={busy}></label>
  </header>

  <div class="passport-grid">
    <div>
      <h3>Export configured domains</h3>
      {#if exportable.length}
        <div class="check-list">
          {#each exportable as baseline}
            <label><input type="checkbox" checked={selectedExports.includes(baseline.domain)} onchange={(event) => toggleExport(baseline.domain, event.currentTarget.checked)}> <span>{baseline.domain}</span></label>
          {/each}
        </div>
        <label class="expiry"><span>Expires after</span><select bind:value={expiryDays}><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option></select></label>
        <button class="btn" type="button" onclick={downloadPassport} disabled={busy || !selectedExports.length}>Export passport</button>
      {:else}
        <p class="empty">Configure an owned-domain baseline before exporting a passport.</p>
      {/if}
    </div>

    <div class="scope">
      <h3>Included scope</h3>
      <p>Nameservers, DS, MX, CAA, TLS issuer and public-key expectations, transfer-lock intent and renewal-review dates.</p>
      <p>Profile identity, brands, contacts, notes, observations, change windows, suppressions and other browser-only planning stay out of this file.</p>
    </div>
  </div>

  {#if imported}
    <div class="preview" aria-live="polite">
      <header><div><p class="eyebrow">Verified locally</p><h3>Import preview</h3></div><p>Expires {new Date(imported.expiresAt).toLocaleDateString('en-AU')}</p></header>
      {#each imported.entries as entry}
        {@const isOfficial = active.officialDomains.includes(entry.domain)}
        {@const configuredFields = passportConfiguredFields(entry)}
        <fieldset>
          <legend><label><input type="checkbox" checked={selectedImports.includes(entry.domain)} onchange={(event) => toggleImport(entry.domain, event.currentTarget.checked)}> <span>{entry.domain}</span></label></legend>
          {#if !isOfficial}
            <label class="add-domain"><input type="checkbox" checked={addDomains.includes(entry.domain)} onchange={(event) => toggleAdd(entry.domain, event.currentTarget.checked)}> Add as an official domain</label>
          {/if}
          <div class="field-grid">
            {#each DOMAIN_CONTROL_PASSPORT_FIELDS as field}
              <label class:unavailable={!configuredFields.includes(field)}>
                <input type="checkbox" disabled={!configuredFields.includes(field) || !selectedImports.includes(entry.domain)} checked={(importFields[entry.domain] ?? []).includes(field)} onchange={(event) => toggleField(entry.domain, field, event.currentTarget.checked)}>
                <span>{fieldLabels[field]}</span>
                <small>{configuredFields.includes(field) ? 'Configured in passport' : 'Not configured; destination remains unchanged'}</small>
              </label>
            {/each}
          </div>
        </fieldset>
      {/each}
      <button class="primary" type="button" onclick={applyImport} disabled={busy}>Import selected fields</button>
    </div>
  {/if}

  {#if message}<p class="message" role="status">{message}</p>{/if}
  <p class="limitation">A valid digest confirms that the file has not changed since export. It does not prove that the desired state is correct or currently deployed. Imports never delete values merely because a field is absent.</p>
</section>

<style>
  .passport{margin-top:16px;padding:var(--card-pad)}
  .passport h2,.passport h3{margin:0}
  .section-head>div>p:not(.eyebrow),.scope p,.empty,.limitation{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .section-head>.file-btn{align-self:start}
  .passport-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.7fr);gap:18px;margin-top:18px}
  .check-list{display:grid;gap:8px;margin:12px 0}
  .check-list label,.add-domain,legend label{display:flex;align-items:center;gap:8px;min-width:0}
  .check-list span,legend span{overflow-wrap:anywhere}
  .expiry{display:flex;align-items:center;gap:10px;margin:12px 0}
  .expiry span{color:var(--muted);font-size:var(--text-xs);font-weight:700}
  .expiry select{width:auto}
  .preview{border-top:1px solid var(--border);margin-top:20px;padding-top:18px}
  .preview>header{display:flex;align-items:start;justify-content:space-between;gap:12px}
  .preview>header>p{color:var(--muted);font-size:var(--text-xs)}
  fieldset{border:1px solid var(--border);border-radius:var(--radius-md);margin:14px 0;padding:14px;min-width:0}
  legend{padding:0 6px;font-weight:800}
  .add-domain{color:var(--amber);font-size:var(--text-xs);margin-bottom:12px}
  .field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .field-grid label{border:1px solid var(--border);border-radius:var(--radius-sm);display:grid;grid-template-columns:auto 1fr;gap:2px 8px;padding:10px;min-width:0}
  .field-grid input{grid-row:1 / span 2}
  .field-grid span{font-size:var(--text-xs);font-weight:700}
  .field-grid small{color:var(--muted);font-size:var(--text-2xs);line-height:1.35}
  .field-grid .unavailable{opacity:.62}
  .message{color:var(--accent);font-size:var(--text-sm)}
  .limitation{margin-bottom:0}
  @media(max-width:750px){.passport-grid,.field-grid{grid-template-columns:1fr}.preview>header{display:grid}.section-head{display:grid;gap:12px}}
</style>
