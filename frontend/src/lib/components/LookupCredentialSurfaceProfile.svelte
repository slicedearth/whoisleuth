<script lang="ts">
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
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
</script>

<details class="credential-card evidence-card card" aria-labelledby="credential-surface-title" open={initiallyExpanded}>
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy">
        <span class="eyebrow">Static deep-scan evidence</span>
        <span class="evidence-summary-title" id="credential-surface-title" role="heading" aria-level="4">Credential collection surface</span>
        <span class="evidence-summary-detail">
          {classifiedCount
            ? `${classifiedCount} classified input${classifiedCount === 1 ? '' : 's'} across ${formCount} form${formCount === 1 ? '' : 's'}`
            : noMatches
              ? 'Analysis complete; no recognised credential input was declared'
              : 'No conclusive input profile'}
          · Expand for fixed counts and limitations
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

    {#if actions.external > 0}
      <p class="callout info">External form submission is common for legitimate identity, payment, support, and hosted-form providers. Treat it as a review pivot, not a finding of unsafe or deceptive behaviour.</p>
    {/if}
    {#if limitations.length}<p class="callout warn">{limitations.join(' ')}</p>{/if}
    <p class="card-note">Cleartext HTTP is a transport subset, so it can overlap the same-origin or external-origin count. WHOISleuth classifies capped live input and form elements already present in the captured static HTML. It does not retain field names or content, interact with forms, make another request, claim a vulnerability, or use this profile for availability or Risk scoring.</p>
  </div>
</details>

<style>
  .headline-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .headline-grid article{padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-soft)}
  .headline-grid small{display:block;color:var(--muted);font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:.06em}
  .headline-grid strong{display:block;margin-top:4px;color:var(--text);font-size:var(--text-lg)}
  .profile-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}
  section{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-soft)}
  h5{margin:0;color:var(--text);font-size:var(--text-sm)}
  dl{display:grid;gap:6px;margin:10px 0 0}
  dl div{display:flex;justify-content:space-between;gap:10px;font-size:var(--text-xs)}
  dt{min-width:0;color:var(--muted)}
  dd{flex:0 0 auto;margin:0;color:var(--text);font-variant-numeric:tabular-nums}
  dd.review{color:var(--warning)}
  .callout{margin-top:12px}
  .card-note{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  @media(max-width:780px){.profile-grid{grid-template-columns:1fr}}
  @media(max-width:520px){.headline-grid{grid-template-columns:1fr}}
</style>
