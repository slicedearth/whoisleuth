<script lang="ts">
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  import type { CredentialFormAttribution } from '../../../../packages/evidence/credential-form-attribution.mts';
  type CategoryCounts = {
    password: number;
    email: number;
    username: number;
    oneTimeCode: number;
    payment: number;
  };
  type MethodCounts = {
    missing: number;
    get: number;
    post: number;
    dialog: number;
    other: number;
  };
  type ActionCounts = {
    sameOrigin: number;
    external: number;
    missing: number;
    cleartext: number;
    unclassified: number;
  };

  let {
    status,
    complete,
    formCount,
    inputCount,
    classifiedCount,
    categories,
    methods,
    actions,
    formAttribution = null,
    limitations,
    initiallyExpanded = false,
  }: {
    status: string;
    complete: boolean;
    formCount: number;
    inputCount: number;
    classifiedCount: number;
    categories: CategoryCounts;
    methods: MethodCounts;
    actions: ActionCounts;
    formAttribution?: CredentialFormAttribution | null;
    limitations: string[];
    initiallyExpanded?: boolean;
  } = $props();

  const noMatches = $derived(status.toLowerCase() === 'success' && complete && classifiedCount === 0);
  const categoryRows = $derived([
    { label: 'Password', value: categories.password },
    { label: 'Email', value: categories.email },
    { label: 'Username', value: categories.username },
    { label: 'One-time code', value: categories.oneTimeCode },
    { label: 'Payment related', value: categories.payment },
  ]);
  const methodRows = $derived([
    { label: 'POST', value: methods.post },
    { label: 'GET', value: methods.get },
    { label: 'Dialog', value: methods.dialog },
    { label: 'Method omitted', value: methods.missing },
    { label: 'Other', value: methods.other },
  ]);
  const actionRows = $derived([
    { label: 'Same origin', value: actions.sameOrigin },
    { label: 'External origin', value: actions.external },
    { label: 'Action omitted', value: actions.missing },
    { label: 'Cleartext HTTP', value: actions.cleartext, review: actions.cleartext > 0 },
    { label: 'Unclassified', value: actions.unclassified },
  ]);
  const purposeLabels = { password: 'Password', email: 'Email', username: 'Username', one_time_code: 'One-time code', payment: 'Payment related' } as const;
  const destinationLabels = { same_origin: 'Same origin', external: 'External origin', unknown: 'Unresolved', no_submission: 'Dialog only' } as const;
</script>

<details class="credential-card evidence-card card" aria-labelledby="credential-surface-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy">
        <span class="eyebrow">Static deep-scan evidence</span>
        <span class="evidence-summary-title" id="credential-surface-title" role="heading" aria-level="4">Credential collection surface</span>
        <span class="evidence-summary-detail">
          {classifiedCount
            ? `${classifiedCount} recognised input${classifiedCount === 1 ? '' : 's'} · ${formCount} form${formCount === 1 ? '' : 's'}`
            : noMatches
              ? 'Analysis complete; no recognised credential input was declared'
              : 'No conclusive input profile'}
        </span>
      </span>
      <span class="evidence-status {evidenceStatusTone(status, { complete, neutral: noMatches })}">
        {noMatches ? 'No recognised inputs' : status}
      </span>
    </span>
  </summary>

  <div class="evidence-body">
    <div class="headline-grid">
      <article><small>Forms observed</small><strong>{formCount}</strong></article>
      <article><small>Inputs observed</small><strong>{inputCount}</strong></article>
      <article><small>Classified inputs</small><strong>{classifiedCount}</strong></article>
    </div>

    <div class="profile-grid">
      <section>
        <h5>Input purposes</h5>
        <dl>{#each categoryRows as row}<div><dt>{row.label}</dt><dd>{row.value}</dd></div>{/each}</dl>
      </section>
      <section>
        <h5>Form methods</h5>
        <dl>{#each methodRows as row}<div><dt>{row.label}</dt><dd>{row.value}</dd></div>{/each}</dl>
      </section>
      <section>
        <h5>Action relationships</h5>
        <dl>{#each actionRows as row}<div><dt>{row.label}</dt><dd class:review={row.review}>{row.value}</dd></div>{/each}</dl>
      </section>
    </div>

    <section class="form-attribution" aria-labelledby="credential-form-destinations">
      <h5 id="credential-form-destinations">Inputs and declared destinations</h5>
      {#if formAttribution}
        {#if formAttribution.forms.length}
          <ol class="form-list">
            {#each formAttribution.forms as form (form.index)}
              <li>
                <strong>Form {form.index}</strong>
                <p class="form-purposes">{Object.entries(form.categories).filter(([, count]) => count > 0).map(([category, count]) => `${purposeLabels[category as keyof typeof purposeLabels]}: ${count}`).join(' · ') || 'No recognised credential inputs'}</p>
                <ul class="destination-list">
                  {#each form.destinations as destination}
                    <li><span>{destinationLabels[destination.relationship]}</span>{#if destination.origin}<code>{destination.origin}</code>{/if}</li>
                  {/each}
                </ul>
              </li>
            {/each}
          </ol>
        {:else}<p class="card-note">No forms retained in this observation.</p>{/if}
        {#if formAttribution.unassociatedInputs > 0}
          <p class="card-note">{formAttribution.unassociatedInputs} recognised input{formAttribution.unassociatedInputs === 1 ? '' : 's'} could not be associated with a form.</p>
        {/if}
        {#if !formAttribution.complete}<p class="card-note">Form attribution is incomplete.</p>{/if}
      {:else}
        <p class="card-note">This observation does not include per-form attribution. Page-wide input and action counts do not establish which form handles a password.</p>
      {/if}
      <p class="card-note">Destinations come from captured HTML, including submit-button overrides—not observed submissions.</p>
    </section>
    <details class="profile-notes">
      <summary>Collection scope and interpretation</summary>
      <p class="card-note">External destinations can be legitimate identity, payment or form providers. An external password-form destination contributes to the Risk heuristic; it is not a phishing verdict. Cleartext HTTP overlaps origin counts.</p>
      {#if limitations.length}<ul>{#each limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
    </details>
  </div>
</details>

<style>
  .headline-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .headline-grid article{padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  .headline-grid small{display:block;color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.06em}
  .headline-grid strong{display:block;margin-top:4px;color:var(--text);font-size:var(--text-lg)}
  .profile-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}
  section{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  h5{margin:0;color:var(--text);font-size:var(--text-sm)}
  dl{display:grid;gap:6px;margin:10px 0 0}
  dl div{display:flex;justify-content:space-between;gap:10px;font-size:var(--text-xs)}
  dt{min-width:0;color:var(--muted)}
  dd{flex:0 0 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums}
  dd.review{color:var(--amber)}
  .form-attribution,.profile-notes{margin-top:12px}
  .form-list{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:12px}
  .form-list>li{min-width:0;padding-top:10px;border-top:1px solid var(--border)}
  .form-purposes{margin:6px 0;color:var(--muted);font-size:var(--text-xs)}
  .destination-list{list-style:none;padding:0;display:grid;gap:6px}
  .destination-list li{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:var(--text-xs)}
  .destination-list code{min-width:0;overflow-wrap:anywhere}
  .profile-notes summary{cursor:pointer}
  .profile-notes ul{color:var(--muted);font-size:var(--text-xs);line-height:1.55;padding-left:20px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  @media(max-width:780px){.profile-grid{grid-template-columns:1fr}}
  @media(max-width:520px){.headline-grid{grid-template-columns:1fr}}
</style>
