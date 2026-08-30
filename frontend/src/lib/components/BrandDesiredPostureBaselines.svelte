<script lang="ts">
  import { tick } from 'svelte';
  import type {
    DesiredPostureBaseline,
    DesiredPostureChangeWindow,
    DesiredPostureSuppression,
  } from '$lib/analysis/brand-profile-model.ts';
  import {
    DESIRED_POSTURE_SUPPRESSION_FIELDS,
    MAX_DESIRED_POSTURE_CHANGE_WINDOWS,
    MAX_DESIRED_POSTURE_SUPPRESSIONS,
  } from '$lib/analysis/brand-profile-model.ts';
  import type { BrandProfile } from '$lib/brand-profiles';

  type PersistenceResult = { committed: true } | { committed: false; message: string };

  let { active, saveBaselines, requestedDomain = '' }: {
    active: BrandProfile;
    saveBaselines: (baselines: DesiredPostureBaseline[]) => Promise<PersistenceResult>;
    requestedDomain?: string;
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
  let zoneIntent = $state<DesiredPostureBaseline['zoneIntent']>('unconfigured');
  let lifecycle = $state<DesiredPostureBaseline['lifecycle']>('active');
  let recoveryDependency = $state('');
  let approvedChangeWindows = $state<DesiredPostureChangeWindow[]>([]);
  let suppressions = $state<DesiredPostureSuppression[]>([]);
  let note = $state('');
  let message = $state('');
  let busy = $state(false);
  let appliedRequestedDomain = $state('');
  let changeWindowSequence = 0;

  function changeWindowId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') return `cw-${globalThis.crypto.randomUUID()}`;
    changeWindowSequence += 1;
    return `cw-${Date.now().toString(36)}-${changeWindowSequence.toString(36)}`;
  }

  function list(value: string): string[] {
    return [...new Set(value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean))].slice(0, 32);
  }

  function timezoneTimestamp(value: string, label: string): string {
    const candidate = value.trim();
    if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(candidate) || !Number.isFinite(Date.parse(candidate))) {
      throw new TypeError(`${label} must be an ISO timestamp with Z or an explicit UTC offset.`);
    }
    return new Date(candidate).toISOString();
  }

  function validatedChangeWindows(): DesiredPostureChangeWindow[] {
    if (approvedChangeWindows.length > MAX_DESIRED_POSTURE_CHANGE_WINDOWS) {
      throw new RangeError(`Approved change windows are limited to ${MAX_DESIRED_POSTURE_CHANGE_WINDOWS}.`);
    }
    return approvedChangeWindows.map((window, index) => {
      const startsAt = timezoneTimestamp(window.startsAt, `Change window ${index + 1} start`);
      const endsAt = timezoneTimestamp(window.endsAt, `Change window ${index + 1} end`);
      const summary = window.summary.trim();
      if (!summary) throw new TypeError(`Change window ${index + 1} needs a reviewed summary.`);
      if (Date.parse(endsAt) <= Date.parse(startsAt)) {
        throw new TypeError(`Change window ${index + 1} must end after it starts.`);
      }
      return { id: window.id, startsAt, endsAt, summary };
    });
  }

  function validatedSuppressions(): DesiredPostureSuppression[] {
    if (suppressions.length > MAX_DESIRED_POSTURE_SUPPRESSIONS) {
      throw new RangeError(`Suppressions are limited to ${MAX_DESIRED_POSTURE_SUPPRESSIONS}.`);
    }
    const seen = new Set<string>();
    return suppressions.map((suppression, index) => {
      if (!DESIRED_POSTURE_SUPPRESSION_FIELDS.includes(suppression.field as typeof DESIRED_POSTURE_SUPPRESSION_FIELDS[number])) {
        throw new TypeError(`Suppression ${index + 1} must use a supported field.`);
      }
      if (seen.has(suppression.field)) throw new TypeError(`Only one suppression may be retained for ${suppression.field.replaceAll('_', ' ')}.`);
      seen.add(suppression.field);
      const reason = suppression.reason.trim();
      if (!reason) throw new TypeError(`Suppression ${index + 1} needs a reviewed rationale.`);
      const expiresAt = suppression.expiresAt
        ? timezoneTimestamp(suppression.expiresAt, `Suppression ${index + 1} expiry`)
        : null;
      return { field: suppression.field, reason, expiresAt };
    });
  }

  function updateChangeWindow(index: number, field: keyof DesiredPostureChangeWindow, value: string) {
    approvedChangeWindows = approvedChangeWindows.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item);
  }

  function updateSuppression(index: number, field: keyof DesiredPostureSuppression, value: string | null) {
    suppressions = suppressions.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } as DesiredPostureSuppression : item);
  }

  function addChangeWindow() {
    if (approvedChangeWindows.length >= MAX_DESIRED_POSTURE_CHANGE_WINDOWS) return;
    approvedChangeWindows = [...approvedChangeWindows, { id: changeWindowId(), startsAt: '', endsAt: '', summary: '' }];
  }

  async function removeChangeWindow(index: number) {
    approvedChangeWindows = approvedChangeWindows.filter((_, itemIndex) => itemIndex !== index);
    await tick();
    const nextIndex = Math.min(index, approvedChangeWindows.length - 1);
    (nextIndex >= 0
      ? document.getElementById(`change-window-summary-${nextIndex}`)
      : document.getElementById('add-change-window'))?.focus();
  }

  function addSuppression() {
    if (suppressions.length >= MAX_DESIRED_POSTURE_SUPPRESSIONS) return;
    const used = new Set(suppressions.map((item) => item.field));
    const field = DESIRED_POSTURE_SUPPRESSION_FIELDS.find((candidate) => !used.has(candidate));
    if (!field) return;
    suppressions = [...suppressions, { field, expiresAt: '', reason: '' }];
  }

  async function removeSuppression(index: number) {
    suppressions = suppressions.filter((_, itemIndex) => itemIndex !== index);
    await tick();
    const nextIndex = Math.min(index, suppressions.length - 1);
    (nextIndex >= 0
      ? document.getElementById(`suppression-reason-${nextIndex}`)
      : document.getElementById('add-suppression'))?.focus();
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
    zoneIntent = baseline?.zoneIntent || 'unconfigured';
    lifecycle = baseline?.lifecycle || 'active';
    recoveryDependency = baseline?.recoveryDependency || '';
    approvedChangeWindows = (baseline?.approvedChangeWindows || []).map((item) => ({ ...item }));
    suppressions = (baseline?.suppressions || []).map((item) => ({ ...item }));
    note = baseline?.note || '';
    message = '';
  }

  async function save(): Promise<void> {
    if (!selectedDomain || busy) return;
    message = '';
    let nextChangeWindows: DesiredPostureChangeWindow[];
    let nextSuppressions: DesiredPostureSuppression[];
    try {
      nextChangeWindows = validatedChangeWindows();
      nextSuppressions = validatedSuppressions();
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Review the structured change-window and suppression rows.';
      return;
    }
    busy = true;
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
      zoneIntent,
      lifecycle,
      recoveryDependency: recoveryDependency.trim(),
      approvedChangeWindows: nextChangeWindows,
      suppressions: nextSuppressions,
      note: note.trim(),
      previousObservation: existing?.previousObservation || null,
      observationHistory: existing?.observationHistory || (existing?.previousObservation ? [existing.previousObservation] : []),
      updatedAt: new Date().toISOString(),
    };
    try {
      const result = await saveBaselines([
        ...active.desiredPostureBaselines.filter((item) => item.domain !== selectedDomain),
        baseline,
      ]);
      message = result.committed
        ? `Saved expected settings for ${selectedDomain}.`
        : result.message;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not save the expected domain settings.';
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    if (!selectedDomain || busy || !confirm(`Remove the expected settings for ${selectedDomain}?`)) return;
    busy = true;
    message = '';
    try {
      const result = await saveBaselines(active.desiredPostureBaselines.filter((item) => item.domain !== selectedDomain));
      if (!result.committed) {
        message = result.message;
        return;
      }
      load(selectedDomain);
      message = `Removed the expected settings for ${selectedDomain}.`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not remove the expected domain settings.';
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (requestedDomain && requestedDomain !== appliedRequestedDomain && active.officialDomains.includes(requestedDomain)) {
      appliedRequestedDomain = requestedDomain;
      load(requestedDomain);
      return;
    }
    const fallback = active.officialDomains.includes(selectedDomain)
      ? selectedDomain
      : active.officialDomains[0] || '';
    if (fallback !== selectedDomain) load(fallback);
  });
</script>

<section id="desired-posture-baseline" class="baselines card" tabindex="-1">
  <header class="section-head">
    <div>
      <p class="eyebrow">Expected settings</p>
      <h2>Expected domain settings</h2>
      <p>Record reviewed expectations for an official domain. Later reviews compare observed settings without changing provider or DNS configuration.</p>
    </div>
    <label>
      <span>Official domain</span>
      <select value={selectedDomain} onchange={(event) => load(event.currentTarget.value)} disabled={busy}>
        {#each active.officialDomains as domain}<option value={domain}>{domain}</option>{/each}
      </select>
    </label>
  </header>

  <aside class="consumer-guide" aria-labelledby="desired-posture-consumers">
    <h3 id="desired-posture-consumers">Where these expectations are reviewed</h3>
    <ul>
      <li><strong>DS records:</strong> portable domain-control and change reviews. The owned-domain posture matrix currently marks DS comparison unsupported.</li>
      <li><strong>Certificate issuer:</strong> certificate-policy review, the certificate review inbox and retained certificate-event replay. The posture matrix currently marks issuer comparison unsupported.</li>
      <li><strong>SAN patterns:</strong> certificate-policy review, the certificate review inbox and retained certificate-event replay. SAN patterns are not a posture-matrix column.</li>
      <li><strong>SPKI SHA-256:</strong> certificate-policy review, the certificate review inbox and DNS change rehearsal. The posture matrix currently marks public-key comparison unsupported.</li>
    </ul>
  </aside>

  {#if selectedDomain}
    <fieldset class="baseline-editor" disabled={busy}>
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
      <label>
        <span>Zone intent</span>
        <select bind:value={zoneIntent}>
          <option value="unconfigured">Not configured</option>
          <option value="active_service">Active service</option>
          <option value="redirect_only">Redirect only</option>
          <option value="defensive_registration">Defensive registration</option>
          <option value="parked">Parked</option>
          <option value="no_service">No service expected</option>
        </select>
      </label>
      <label>
        <span>Lifecycle</span>
        <select bind:value={lifecycle}>
          <option value="active">Active</option>
          <option value="change_planned">Change planned</option>
          <option value="retiring">Retiring</option>
          <option value="retired">Retired</option>
        </select>
      </label>
      <label><span>Recovery dependency</span><input maxlength="200" bind:value={recoveryDependency} placeholder="Reviewed account or service dependency"></label>
    </div>
    <fieldset class="structured-rows wide">
      <legend>Approved change windows</legend>
      <p>Times require Z or an explicit UTC offset. Expected changes remain in evidence and are labelled, not removed.</p>
      {#each approvedChangeWindows as window, index}
        <div class="structured-row change-window-row">
          <label><span>Start timestamp with timezone</span><input value={window.startsAt} maxlength="64" placeholder="2026-09-01T00:00:00+10:00" oninput={(event) => updateChangeWindow(index, 'startsAt', event.currentTarget.value)}></label>
          <label><span>End timestamp with timezone</span><input value={window.endsAt} maxlength="64" placeholder="2026-09-01T02:00:00+10:00" oninput={(event) => updateChangeWindow(index, 'endsAt', event.currentTarget.value)}></label>
          <label class="row-summary"><span>Reviewed summary</span><input id={`change-window-summary-${index}`} value={window.summary} maxlength="300" oninput={(event) => updateChangeWindow(index, 'summary', event.currentTarget.value)}></label>
          <button class="btn small" type="button" onclick={() => void removeChangeWindow(index)} aria-label={`Remove change window ${index + 1}`}>Remove</button>
        </div>
      {/each}
      <button id="add-change-window" class="btn small add-row" type="button" onclick={addChangeWindow} disabled={approvedChangeWindows.length >= MAX_DESIRED_POSTURE_CHANGE_WINDOWS}>Add change window</button>
      <small>{approvedChangeWindows.length} of {MAX_DESIRED_POSTURE_CHANGE_WINDOWS} windows.</small>
    </fieldset>
    <fieldset class="structured-rows wide">
      <legend>Suppressions</legend>
      <p>Each field is unique. An open-ended retained exception remains visible to the Review Item lifecycle instead of being treated as current indefinitely.</p>
      {#each suppressions as suppression, index}
        <div class="structured-row suppression-row">
          <label><span>Supported field</span><select value={suppression.field} onchange={(event) => updateSuppression(index, 'field', event.currentTarget.value)}>{#each DESIRED_POSTURE_SUPPRESSION_FIELDS as field}<option value={field}>{field.replaceAll('_', ' ')}</option>{/each}</select></label>
          <label><span>Expiry with timezone</span><input value={suppression.expiresAt ?? ''} maxlength="64" placeholder="2026-10-01T00:00:00Z" oninput={(event) => updateSuppression(index, 'expiresAt', event.currentTarget.value || null)}></label>
          <label class="row-summary"><span>Reviewed rationale</span><input id={`suppression-reason-${index}`} value={suppression.reason} maxlength="2000" oninput={(event) => updateSuppression(index, 'reason', event.currentTarget.value)}></label>
          <button class="btn small" type="button" onclick={() => void removeSuppression(index)} aria-label={`Remove suppression ${index + 1}`}>Remove</button>
          {#if !suppression.expiresAt}<small class="row-warning">No expiry is retained. This exception remains a review concern and does not silently resolve a difference.</small>{/if}
        </div>
      {/each}
      <button id="add-suppression" class="btn small add-row" type="button" onclick={addSuppression} disabled={suppressions.length >= MAX_DESIRED_POSTURE_SUPPRESSIONS || suppressions.length >= DESIRED_POSTURE_SUPPRESSION_FIELDS.length}>Add suppression</button>
      <small>{suppressions.length} of {MAX_DESIRED_POSTURE_SUPPRESSIONS} suppressions.</small>
    </fieldset>
    <label class="wide"><span>Analyst note</span><textarea rows="3" maxlength="2000" bind:value={note}></textarea></label>
    <div class="actions">
      <button class="primary" onclick={save} disabled={busy}>Save expected settings</button>
      <button class="btn danger-action" onclick={remove} disabled={busy || !active.desiredPostureBaselines.some((item) => item.domain === selectedDomain)}>Remove</button>
    </div>
    </fieldset>
    {#if message}<p class="message" role="status">{message}</p>{/if}
    <p class="limitation">Each reviewer keeps unavailable or incomplete evidence explicit. No retained expectation establishes current ownership, control, legitimacy or safety.</p>
  {:else}
    <p class="empty">Add an official domain to this Brand Profile before configuring expected settings.</p>
  {/if}
</section>

<style>
  .baselines{margin-top:16px;padding:var(--card-pad)}
  .baselines h2{margin:0}
  .section-head>div>p:not(.eyebrow),.limitation,.empty{color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .consumer-guide{margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .consumer-guide h3{margin:0;font-size:var(--text-sm)}
  .consumer-guide ul{display:grid;gap:6px;margin:9px 0 0;padding-left:20px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .consumer-guide strong{color:var(--text)}
  label{display:grid;gap:6px;min-width:0}
  label>span{color:var(--muted);font-size:var(--text-2xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
  input,select,textarea{width:100%;min-width:0}
  textarea{resize:vertical}
  .baseline-editor{min-width:0;margin:0;padding:0;border:0}
  .section-head>label{align-self:start;min-width:min(260px,100%)}
  .baseline-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}
  .wide{margin-top:12px}
  .wide small{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}
  .structured-rows{display:grid;gap:9px;min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}.structured-rows legend{padding:0 5px;font:700 var(--text-xs) var(--mono)}.structured-rows>p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45}.structured-row{display:grid;grid-template-columns:minmax(170px,.7fr) minmax(170px,.7fr) minmax(220px,1.3fr) auto;gap:8px;align-items:end;min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.structured-row button{margin-bottom:1px}.row-warning{grid-column:1/-1;color:var(--amber)!important}.add-row{justify-self:start}
  .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  .message{color:var(--accent);font-size:var(--text-sm)}
  .limitation{margin-bottom:0}
  .danger-action{color:var(--danger)}
  @media(max-width:900px){.structured-row{grid-template-columns:repeat(2,minmax(0,1fr))}.structured-row .row-summary{grid-column:1/-1}.structured-row button{justify-self:start}}
  @media(max-width:750px){.section-head{display:grid;gap:12px}.baseline-grid,.structured-row{grid-template-columns:1fr}.structured-row .row-summary{grid-column:auto}.structured-row button{width:100%}}
</style>
