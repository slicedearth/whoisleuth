<script lang="ts">
  import type {
    DesiredPostureBaseline,
    DesiredPostureSuppression,
  } from '$lib/analysis/brand-profile-model.ts';
  import type { BrandProfile } from '$lib/brand-profiles';

  let { active, saveBaselines }: {
    active: BrandProfile;
    saveBaselines: (baselines: DesiredPostureBaseline[]) => void | Promise<void>;
  } = $props();

  let selectedDomain = $state('');
  let nameservers = $state('');
  let ds = $state('');
  let mx = $state('');
  let caa = $state('');
  let tlsIssuer = $state('');
  let tlsSanPatterns = $state('');
  let tlsSpkiSha256 = $state('');
  let registrarLock = $state<DesiredPostureBaseline['registrarLock']>('unconfigured');
  let renewalReviewAt = $state('');
  let suppressions = $state('');
  let note = $state('');
  let message = $state('');

  function list(value: string): string[] {
    return [...new Set(value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean))].slice(0, 32);
  }

  function parseSuppressions(value: string): DesiredPostureSuppression[] {
    const output: DesiredPostureSuppression[] = [];
    const seen = new Set<string>();
    for (const line of value.split('\n').slice(0, 48)) {
      const [fieldValue = '', expiryValue = '', ...reasonParts] = line.split('|');
      const field = fieldValue.trim();
      const reason = reasonParts.join('|').trim();
      if (!field || !reason || seen.has(field)) continue;
      seen.add(field);
      const expiry = expiryValue.trim();
      output.push({
        field,
        reason,
        expiresAt: expiry && Number.isFinite(Date.parse(expiry))
          ? new Date(expiry).toISOString()
          : null,
      });
      if (output.length >= 12) break;
    }
    return output;
  }

  function renderSuppressions(value: readonly DesiredPostureSuppression[]): string {
    return value.map((item) => `${item.field} | ${item.expiresAt?.slice(0, 10) || ''} | ${item.reason}`).join('\n');
  }

  function load(domain: string): void {
    selectedDomain = domain;
    const baseline = active.desiredPostureBaselines.find((item) => item.domain === domain);
    nameservers = baseline?.nameservers.join('\n') || '';
    ds = baseline?.ds.join('\n') || '';
    mx = baseline?.mx.join('\n') || '';
    caa = baseline?.caa.join('\n') || '';
    tlsIssuer = baseline?.tlsIssuer || '';
    tlsSanPatterns = baseline?.tlsSanPatterns.join('\n') || '';
    tlsSpkiSha256 = baseline?.tlsSpkiSha256 || '';
    registrarLock = baseline?.registrarLock || 'unconfigured';
    renewalReviewAt = baseline?.renewalReviewAt?.slice(0, 10) || '';
    suppressions = renderSuppressions(baseline?.suppressions || []);
    note = baseline?.note || '';
    message = '';
  }

  async function save(): Promise<void> {
    if (!selectedDomain) return;
    const existing = active.desiredPostureBaselines.find((item) => item.domain === selectedDomain);
    const baseline: DesiredPostureBaseline = {
      version: 1,
      domain: selectedDomain,
      nameservers: list(nameservers),
      ds: list(ds),
      mx: list(mx),
      caa: list(caa),
      tlsIssuer: tlsIssuer.trim(),
      tlsSanPatterns: list(tlsSanPatterns),
      tlsSpkiSha256: tlsSpkiSha256.trim().toLowerCase(),
      registrarLock,
      renewalReviewAt: renewalReviewAt
        ? new Date(`${renewalReviewAt}T00:00:00.000Z`).toISOString()
        : null,
      suppressions: parseSuppressions(suppressions),
      note: note.trim(),
      previousObservation: existing?.previousObservation || null,
      updatedAt: new Date().toISOString(),
    };
    await saveBaselines([
      ...active.desiredPostureBaselines.filter((item) => item.domain !== selectedDomain),
      baseline,
    ]);
    message = `Saved the analyst-authored desired posture for ${selectedDomain}.`;
  }

  async function remove(): Promise<void> {
    if (!selectedDomain || !confirm(`Remove the desired posture baseline for ${selectedDomain}?`)) return;
    await saveBaselines(active.desiredPostureBaselines.filter((item) => item.domain !== selectedDomain));
    load(selectedDomain);
    message = `Removed the desired posture baseline for ${selectedDomain}.`;
  }

  function exportBaseline(): void {
    const baseline = active.desiredPostureBaselines.find((item) => item.domain === selectedDomain);
    if (!baseline) return;
    const document = {
      schema: 'whoisleuth.desired-posture-baseline',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profile: { id: active.id, name: active.name },
      baseline,
      limitation: 'This file contains analyst-authored desired state and an optional retained observation. It is not a live audit result.',
    };
    const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = globalThis.document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedDomain}-desired-posture.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  $effect(() => {
    const fallback = active.officialDomains.includes(selectedDomain)
      ? selectedDomain
      : active.officialDomains[0] || '';
    if (fallback !== selectedDomain) load(fallback);
  });
</script>

<section class="baselines card">
  <header class="section-head">
    <div>
      <p class="eyebrow">Desired state</p>
      <h2>Owned-domain baseline</h2>
      <p>Record reviewed expectations for an official domain. WHOISleuth compares later audits without changing provider or DNS configuration.</p>
    </div>
    <label>
      <span>Official domain</span>
      <select value={selectedDomain} onchange={(event) => load(event.currentTarget.value)}>
        {#each active.officialDomains as domain}<option value={domain}>{domain}</option>{/each}
      </select>
    </label>
  </header>

  {#if selectedDomain}
    <div class="baseline-grid">
      <label><span>Nameservers</span><textarea rows="3" maxlength="6000" bind:value={nameservers} placeholder="ns1.example.test"></textarea></label>
      <label><span>DS records</span><textarea rows="3" maxlength="6000" bind:value={ds} placeholder="key-tag algorithm digest-type digest"></textarea></label>
      <label><span>Mail exchangers</span><textarea rows="3" maxlength="6000" bind:value={mx} placeholder="10 mail.example.test"></textarea></label>
      <label><span>CAA policy</span><textarea rows="3" maxlength="6000" bind:value={caa} placeholder='0 issue "ca.example"'></textarea></label>
      <label><span>TLS issuer</span><input maxlength="2000" bind:value={tlsIssuer} placeholder="Reviewed issuer name"></label>
      <label><span>TLS SAN patterns</span><textarea rows="3" maxlength="6000" bind:value={tlsSanPatterns} placeholder="example.test&#10;*.example.test"></textarea></label>
      <label><span>TLS SPKI SHA-256</span><input maxlength="64" bind:value={tlsSpkiSha256} placeholder="64 hexadecimal characters"></label>
      <label>
        <span>Transfer-lock expectation</span>
        <select bind:value={registrarLock}>
          <option value="unconfigured">Not configured</option>
          <option value="required">Required</option>
          <option value="not_required">Not required</option>
        </select>
      </label>
      <label><span>Renewal review date</span><input type="date" bind:value={renewalReviewAt}></label>
    </div>
    <label class="wide"><span>Suppressions</span><textarea rows="3" maxlength="8000" bind:value={suppressions} placeholder="field | YYYY-MM-DD | reviewed reason"></textarea><small>One reviewed exception per line. Supported fields: nameservers, ds, mx, caa, tls_issuer, tls_san_patterns, tls_spki, registrar_lock, renewal_review.</small></label>
    <label class="wide"><span>Analyst note</span><textarea rows="3" maxlength="2000" bind:value={note}></textarea></label>
    <div class="actions">
      <button class="primary" onclick={save}>Save baseline</button>
      <button class="btn" onclick={exportBaseline} disabled={!active.desiredPostureBaselines.some((item) => item.domain === selectedDomain)}>Export baseline</button>
      <button class="btn danger-action" onclick={remove} disabled={!active.desiredPostureBaselines.some((item) => item.domain === selectedDomain)}>Remove</button>
    </div>
    {#if message}<p class="message" role="status">{message}</p>{/if}
    <p class="limitation">DS and TLS values are retained for review, but this posture audit cannot yet compare complete DS, issuer, or public-key evidence. Those fields remain explicitly unsupported rather than appearing aligned.</p>
  {:else}
    <p class="empty">Add an official domain to this Brand Profile before configuring desired posture.</p>
  {/if}
</section>

<style>
  .baselines{margin-top:16px;padding:var(--card-pad)}
  .baselines h2{margin:0}
  .section-head>div>p:not(.eyebrow),.limitation,.empty{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  label{display:grid;gap:6px;min-width:0}
  label>span{color:var(--muted);font-size:var(--text-2xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  input,select,textarea{width:100%;min-width:0}
  textarea{resize:vertical}
  .section-head>label{align-self:start;min-width:min(260px,100%)}
  .baseline-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}
  .wide{margin-top:12px}
  .wide small{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  .message{color:var(--accent);font-size:var(--text-sm)}
  .limitation{margin-bottom:0}
  .danger-action{color:var(--danger)}
  @media(max-width:750px){.section-head{display:grid;gap:12px}.baseline-grid{grid-template-columns:1fr}}
</style>
