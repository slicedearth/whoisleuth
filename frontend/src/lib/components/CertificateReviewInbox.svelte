<script lang="ts">
  import Pagination from './Pagination.svelte';
  import ReviewLifecycleControls from './ReviewLifecycleControls.svelte';
  import { buildCertificateReviewInbox, type CertificateEvidenceClass, type CertificateReviewFindingState } from '../analysis/certificate-review-inbox.ts';
  import { analystReviewLifecycle, type AnalystReviewDisposition, type AnalystReviewItem, type AnalystReviewStateStore } from '../analysis/analyst-review-state.ts';
  import type { BrandProfile } from '../analysis/brand-profile-model.ts';
  import type { CaseRecord } from '../analysis/case-model.ts';

  const PAGE_SIZE = 25;
  let {
    profiles,
    cases,
    reviewState,
    profileId = '',
    now = new Date().toISOString(),
    onreview,
    oncount,
  }: {
    profiles: BrandProfile[];
    cases: CaseRecord[];
    reviewState: AnalystReviewStateStore;
    profileId?: string;
    now?: string;
    onreview: (item: AnalystReviewItem, input: { disposition: AnalystReviewDisposition; rationale: string; expiresAt: string | null; reviewDueAt: string | null }) => void | Promise<void>;
    oncount?: (count: number) => void;
  } = $props();

  let evidenceFilter = $state<CertificateEvidenceClass | ''>('');
  let stateFilter = $state<CertificateReviewFindingState | ''>('');
  let selectedProfile = $state('');
  let page = $state(1);
  const inbox = $derived(buildCertificateReviewInbox(profiles, cases, { now, ...(selectedProfile ? { profileId: selectedProfile } : {}) }));
  const filtered = $derived(inbox.findings.filter((finding) =>
    (!evidenceFilter || finding.evidenceClass === evidenceFilter)
    && (!stateFilter || finding.state === stateFilter)
  ));
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const currentPage = $derived(Math.min(page, pageCount));
  const visible = $derived(filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));

  $effect(() => {
    if (profileId && profiles.some((profile) => profile.id === profileId)) selectedProfile = profileId;
  });
  $effect(() => { oncount?.(inbox.findings.length); });

  function formatDate(value: string | null): string {
    if (!value) return 'Unavailable';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-AU');
  }
</script>

<section class="certificate-inbox card" aria-labelledby="certificate-inbox-title">
  <div class="heading">
    <div>
      <p class="eyebrow">Retained evidence only</p>
      <h2 id="certificate-inbox-title">Certificate review inbox</h2>
      <p>Review Certificate Transparency publication, retained live TLS, CAA, certificate digest, and SPKI context without starting a request.</p>
    </div>
    <strong>{inbox.findings.length}</strong>
  </div>

  <div class="filters" role="group" aria-label="Certificate inbox filters">
    <label>Brand Profile
      <select bind:value={selectedProfile} onchange={() => { page = 1; }}>
        <option value="">All profiles</option>
        {#each profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}
      </select>
    </label>
    <label>Evidence class
      <select bind:value={evidenceFilter} onchange={() => { page = 1; }}>
        <option value="">All classes</option>
        <option value="certificate_transparency">Certificate Transparency</option>
        <option value="live_tls">Live TLS</option>
        <option value="caa">CAA</option>
        <option value="certificate_digest">Certificate digest</option>
        <option value="spki">SPKI digest</option>
      </select>
    </label>
    <label>Evidence review state
      <select bind:value={stateFilter} onchange={() => { page = 1; }}>
        <option value="">All states</option>
        <option value="review">Review</option>
        <option value="expired">Expired</option>
        <option value="partial">Partial</option>
        <option value="unavailable">Unavailable</option>
        <option value="expected">Expected observation</option>
      </select>
    </label>
  </div>

  <p class="scope">{inbox.profileCount} profile{inbox.profileCount === 1 ? '' : 's'} · {inbox.domainCount} official domain{inbox.domainCount === 1 ? '' : 's'} · {filtered.length} matching finding{filtered.length === 1 ? '' : 's'}</p>

  {#if visible.length}
    <ol class="findings">
      {#each visible as finding (finding.id)}
        <li class:review={finding.state === 'review' || finding.state === 'expired'}>
          <div class="meta">
            <span>{finding.profileName}</span>
            <span>{finding.evidenceClass.replaceAll('_', ' ')}</span>
            <span>{finding.kind.replaceAll('_', ' ')}</span>
            <span>{finding.state}</span>
          </div>
          <h3>{finding.label}</h3>
          <p>{finding.detail}</p>
          <dl>
            <div><dt>Domain</dt><dd>{finding.domain}</dd></div>
            <div><dt>Observed</dt><dd>{formatDate(finding.observedAt)}</dd></div>
            <div><dt>Not after</dt><dd>{formatDate(finding.notAfter)}</dd></div>
            <div><dt>Certificate SHA-256</dt><dd>{finding.certificateSha256 ?? 'Unavailable'}</dd></div>
            <div><dt>SPKI SHA-256</dt><dd>{finding.spkiSha256 ?? 'Unavailable'}</dd></div>
            <div><dt>Sources</dt><dd>{finding.sources.join(', ') || 'Unavailable'}</dd></div>
          </dl>
          <ReviewLifecycleControls item={finding.item} lifecycle={analystReviewLifecycle(finding.item, reviewState, now)} {onreview} />
          <details class="limitations"><summary>Evidence limits</summary><ul>{#each finding.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
        </li>
      {/each}
    </ol>
    <Pagination {currentPage} {pageCount} setPage={(value) => { page = value; }} ariaLabel="Certificate review inbox pages" />
  {:else}
    <p class="empty">No retained certificate finding matches these filters. This is not a certificate-absence conclusion.</p>
  {/if}

  {#if inbox.truncated}<p class="warning">The retained projection reached its display bound. Narrow the profile scope before treating this view as complete.</p>{/if}
  <details class="global-limits"><summary>Interpretation and request limits</summary><ul>{#each inbox.limitations as limitation}<li>{limitation}</li>{/each}</ul></details>
</section>

<style>
  .certificate-inbox{min-width:0;padding:var(--card-pad)}
  .heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.heading>div{min-width:0}.heading h2,.heading p{margin:0;overflow-wrap:anywhere}.heading h2{margin-top:3px;font:700 var(--text-lg) var(--mono)}.heading>div>p:last-child{margin-top:7px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}.heading>strong{color:var(--accent2);font:750 2rem var(--mono)}
  .filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:18px 0 0}.filters label{display:grid;gap:5px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}.filters select{min-width:0;width:100%;min-height:38px;padding:0 8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel);color:var(--text);font:600 var(--text-xs) var(--mono)}
  .scope,.empty,.warning,.global-limits,.limitations{color:var(--muted);font-size:var(--text-sm)}
  .findings{display:grid;gap:9px;margin:14px 0 0;padding:0;list-style:none}.findings>li{min-width:0;padding:14px;border-left:3px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.findings>li.review{border-left-color:var(--amber)}
  .meta{display:flex;flex-wrap:wrap;gap:6px}.meta span{min-width:0;padding:2px 6px;border:1px solid var(--border);border-radius:99px;color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase;overflow-wrap:anywhere}
  h3{margin:8px 0 3px;font:700 var(--text-sm) var(--mono);overflow-wrap:anywhere}.findings p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.45;overflow-wrap:anywhere}
  dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:10px 0 0}dl div{min-width:0;padding:7px;border-radius:var(--radius-sm);background:var(--panel)}dt{color:var(--muted);font:650 var(--text-2xs) var(--mono);text-transform:uppercase}dd{margin:3px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  details summary{cursor:pointer;color:var(--text);font-weight:650}.limitations{margin-top:9px}.limitations ul,.global-limits ul{padding-left:20px}.warning{color:var(--amber)}
  select:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
  @media(max-width:800px){.filters,dl{grid-template-columns:minmax(0,1fr)}}
</style>
