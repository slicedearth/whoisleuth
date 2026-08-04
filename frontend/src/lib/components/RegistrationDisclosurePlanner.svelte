<script lang="ts">
  import {
    DISCLOSURE_FIELD_IDS,
    DISCLOSURE_PURPOSES,
    MAX_DISCLOSURE_JUSTIFICATION_LENGTH,
    buildRegistrationDisclosurePlan,
    registrationDisclosureFilename,
    type DisclosureFieldId,
    type DisclosurePurpose,
  } from '$lib/analysis/registration-disclosure-plan.ts';

  type JsonRecord = Record<string, unknown>;
  const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
  const bounded = (value: unknown, maximum = 240): string => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
  const entityName = (value: unknown): string => {
    const source = asRecord(value);
    return bounded(source.name) || bounded(source.org) || bounded(source.handle);
  };
  const PURPOSE_LABELS: Readonly<Record<DisclosurePurpose, string>> = Object.freeze({
    'cybersecurity-investigation': 'Cybersecurity investigation',
    'brand-protection': 'Brand protection',
    'legal-claim': 'Legal claim',
    'consumer-protection': 'Consumer protection',
    other: 'Other reviewed purpose',
  });
  const FIELD_LABELS: Readonly<Record<DisclosureFieldId, string>> = Object.freeze({
    'registrant-name': 'Registrant name',
    'registrant-organization': 'Registrant organization',
    'registrant-email': 'Registrant email',
    'registrant-phone': 'Registrant phone',
    'administrative-contact': 'Administrative contact',
    'technical-contact': 'Technical contact',
  });

  let {
    domain,
    observedAt,
    registryRdapEndpoint,
    rdapParsed,
    registrar,
    caseReference = '',
  }: {
    domain: string;
    observedAt: string | null;
    registryRdapEndpoint: string;
    rdapParsed: JsonRecord;
    registrar: { endpoint: string; parsed: JsonRecord };
    caseReference?: string;
  } = $props();

  let purpose = $state<DisclosurePurpose | ''>('');
  let justification = $state('');
  let requestedFields = $state<DisclosureFieldId[]>([]);
  let publicDataReviewed = $state(false);
  let dataMinimised = $state(false);
  let rightsImpactConsidered = $state(false);
  let currentProcessReviewed = $state(false);
  let gtldScopeReviewed = $state(false);
  let registrarParticipationReviewed = $state(false);
  let requesterMaterialsReady = $state(false);
  let message = $state('');

  const redactions = $derived(Array.isArray(rdapParsed.redactions) ? rdapParsed.redactions : []);
  const registrarName = $derived(entityName(registrar.parsed.registrar) || entityName(rdapParsed.registrar));
  const preview = $derived(buildRegistrationDisclosurePlan({
    domain,
    observedAt,
    registryRdapEndpoint,
    registrarName,
    registrarRdapEndpoint: registrar.endpoint,
    redactions,
    redactionsTruncated: rdapParsed.redactionsTruncated,
  }, {
    purpose,
    justification,
    requestedFields,
    publicDataReviewed,
    dataMinimised,
    rightsImpactConsidered,
    currentProcessReviewed,
    gtldScopeReviewed,
    registrarParticipationReviewed,
    requesterMaterialsReady,
    caseReference,
  }, observedAt || new Date().toISOString()));

  function toggleField(field: DisclosureFieldId, checked: boolean): void {
    requestedFields = checked
      ? [...new Set([...requestedFields, field])]
      : requestedFields.filter((item) => item !== field);
  }

  function downloadPlan(): void {
    if (preview.readiness === 'needs_input') return;
    const plan = buildRegistrationDisclosurePlan({
      domain,
      observedAt,
      registryRdapEndpoint,
      registrarName,
      registrarRdapEndpoint: registrar.endpoint,
      redactions,
      redactionsTruncated: rdapParsed.redactionsTruncated,
    }, {
      purpose,
      justification,
      requestedFields,
      publicDataReviewed,
      dataMinimised,
      rightsImpactConsidered,
      currentProcessReviewed,
      gtldScopeReviewed,
      registrarParticipationReviewed,
      requesterMaterialsReady,
      caseReference,
    });
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(plan, null, 2)}\n`], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = registrationDisclosureFilename(plan);
    anchor.click();
    URL.revokeObjectURL(url);
    message = 'Downloaded a local review packet. Nothing was submitted.';
  }
</script>

<details class="card disclosure-planner">
  <summary>Prepare a registration disclosure request</summary>
  <div class="planner-body">
    <p class="muted">Build a minimized local packet from observed RDAP redactions and analyst-authored justification. WHOISleuth does not decide eligibility or entitlement and does not submit the request.</p>

    <div class="observed-summary">
      <strong>Observed public-data gap</strong>
      {#if redactions.length}
        <p>{redactions.length} structured redaction declaration{redactions.length === 1 ? '' : 's'} observed{rdapParsed.redactionsTruncated ? ' (source list capped)' : ''}.</p>
      {:else}
        <p>No structured RDAP redaction declaration was observed. Confirm that nonpublic data is actually needed.</p>
      {/if}
    </div>

    <div class="form-grid">
      <label class="field">Request purpose
        <select bind:value={purpose}>
          <option value="">Select a reviewed purpose</option>
          {#each DISCLOSURE_PURPOSES as item}<option value={item}>{PURPOSE_LABELS[item]}</option>{/each}
        </select>
      </label>
      <label class="field">Case reference
        <input value={caseReference} readonly placeholder="Create or link a case when needed">
      </label>
      <label class="field wide">Analyst justification
        <textarea bind:value={justification} maxlength={MAX_DISCLOSURE_JUSTIFICATION_LENGTH} rows="4" placeholder="Explain why the selected nonpublic fields are necessary for this specific reviewed purpose."></textarea>
        <small>{justification.trim().length}/{MAX_DISCLOSURE_JUSTIFICATION_LENGTH} characters · at least 40 required</small>
      </label>
    </div>

    <fieldset class="field-options">
      <legend>Requested field categories</legend>
      {#each DISCLOSURE_FIELD_IDS as field}
        <label><input type="checkbox" checked={requestedFields.includes(field)} onchange={(event) => toggleField(field, event.currentTarget.checked)}> {FIELD_LABELS[field]}</label>
      {/each}
    </fieldset>

    <fieldset class="review-confirmations">
      <legend>Manual review confirmations</legend>
      <label><input type="checkbox" bind:checked={publicDataReviewed}> Available public registration evidence was reviewed first.</label>
      <label><input type="checkbox" bind:checked={dataMinimised}> Every requested field is necessary for the stated purpose.</label>
      <label><input type="checkbox" bind:checked={rightsImpactConsidered}> Privacy and rights impacts were considered.</label>
      <label><input type="checkbox" bind:checked={currentProcessReviewed}> Current service instructions, terms, and submission process were checked manually.</label>
      <label><input type="checkbox" bind:checked={gtldScopeReviewed}> The target and request were checked against the current nonpublic gTLD service scope.</label>
      <label><input type="checkbox" bind:checked={registrarParticipationReviewed}> Current registrar participation was reviewed manually.</label>
      <label><input type="checkbox" bind:checked={requesterMaterialsReady}> Requester identity, authority, supporting material, and ICANN account requirements were reviewed.</label>
    </fieldset>

    <section class="preflight" aria-labelledby="disclosure-preflight-title">
      <div><strong id="disclosure-preflight-title">Request preflight</strong><span class={`state-${preview.readiness}`}>{preview.readiness.replaceAll('_', ' ')}</span></div>
      <p>{preview.counts.pass} pass · {preview.counts.caution} caution · {preview.counts.block} block</p>
      <ul>{#each preview.checks as check}<li data-state={check.state}><strong>{check.label}</strong><span>{check.detail}</span></li>{/each}</ul>
    </section>

    <div class="actions">
      <button class="btn" type="button" onclick={downloadPlan} disabled={preview.readiness === 'needs_input'}>Export review packet</button>
      <a class="btn" href={preview.serviceHandoff.informationUrl} target="_blank" rel="noopener noreferrer">Review current service information</a>
      {#if preview.readiness !== 'needs_input'}<a class="btn" href={preview.serviceHandoff.portalUrl} target="_blank" rel="noopener noreferrer">Open the reviewed request portal</a>{/if}
    </div>
    {#if message}<p class="success" role="status">{message}</p>{/if}
    <p class="fine-print">The exported file excludes raw RDAP, raw WHOIS, and discovered personal contact data. Review current requirements and the packet before any manual submission.</p>
  </div>
</details>

<style>
  .disclosure-planner{margin-top:12px}
  .planner-body{padding-top:12px}
  .muted,.fine-print{color:var(--muted);line-height:1.55}
  .fine-print{font-size:var(--text-xs)}
  .observed-summary,.preflight{margin:12px 0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:rgb(var(--panel-rgb) / .45)}
  .observed-summary p,.preflight p{margin:5px 0 0}
  .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .field{display:grid;gap:6px;min-width:0}
  .wide{grid-column:1/-1}
  .field small{color:var(--muted)}
  .field-options,.review-confirmations{display:grid;gap:8px;margin:12px 0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .field-options{grid-template-columns:repeat(2,minmax(0,1fr))}
  .field-options legend,.review-confirmations legend{padding:0 5px;font-weight:700}
  .field-options label,.review-confirmations label{display:flex;align-items:flex-start;gap:7px;line-height:1.45}
  .preflight>div{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .preflight>div span{text-transform:capitalize;color:var(--muted);font-size:var(--text-xs)}
  .preflight ul{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}
  .preflight li{display:grid;grid-template-columns:minmax(145px,.45fr) minmax(0,1fr);gap:10px;padding-top:7px;border-top:1px solid var(--border);line-height:1.45}
  .preflight li span{color:var(--muted)}
  .preflight li[data-state='block'] strong{color:var(--red)}
  .preflight li[data-state='caution'] strong{color:var(--amber)}
  .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .success{color:var(--green)}
  @media(max-width:680px){.form-grid,.field-options{grid-template-columns:1fr}.wide{grid-column:auto}.preflight li{grid-template-columns:1fr;gap:3px}.actions>*{width:100%;justify-content:center}}
</style>
