<script lang="ts">
  import { buildBrandCertificateEventReplay, type CertificateEventReplayState } from '$lib/analysis/brand-certificate-event-replay.ts';
  import type { BrandProfile } from '$lib/brand-profiles';
  import type { CaseRecord } from '$lib/cases';

  let { active, cases, unavailable = false }: { active: BrandProfile; cases: CaseRecord[]; unavailable?: boolean } = $props();
  const replay = $derived(buildBrandCertificateEventReplay(active, cases));

  function stateLabel(state: CertificateEventReplayState): string {
    if (state === 'not_configured') return 'Not configured';
    if (state === 'indeterminate') return 'Indeterminate';
    if (state === 'review') return 'Review';
    return 'Aligned';
  }

  function date(value: string): string {
    return new Date(value).toLocaleString();
  }
</script>

<section class="card certificate-replay" aria-labelledby="certificate-event-replay-title">
  <header class="section-head">
    <div>
      <p class="eyebrow">Retained evidence</p>
      <h2 id="certificate-event-replay-title">Certificate expectation replay</h2>
      <p>Compare deliberately imported certificate events with the reviewed issuer and certificate-name expectations for official domains.</p>
    </div>
    <span class="count">{replay.retainedEventCount} retained event{replay.retainedEventCount === 1 ? '' : 's'}</span>
  </header>

  {#if unavailable}<p class="notice">Browser-local cases could not be read, so retained certificate-event comparisons are unavailable. No missing event is treated as alignment.</p>{/if}
  {#if replay.truncated}<p class="notice">Only the newest {replay.retainedEventCount} bounded event groups are shown.</p>{/if}
  <div class="domain-list">
    {#each replay.domains as domainReview}
      <article class="domain-review">
        <header>
          <div><h3>{domainReview.domain}</h3><p>{domainReview.baselineConfigured ? 'Reviewed certificate expectations configured.' : 'No issuer or certificate-name expectation configured.'}</p></div>
          <span class="count">{domainReview.events.length} event{domainReview.events.length === 1 ? '' : 's'}</span>
        </header>
        {#if domainReview.events.length}
          <div class="event-list">
            {#each domainReview.events as event}
              <details>
                <summary>
                  <span class="event-summary"><strong>{date(event.observedAt)}</strong><small>Certificate …{event.certificateSha256.slice(-12)} · {event.names.length}/{event.dnsNameCount} retained names</small></span>
                  <span class:review={event.state === 'review'} class:indeterminate={event.state === 'indeterminate'} class:aligned={event.state === 'aligned'} class="state">{stateLabel(event.state)}</span>
                </summary>
                <div class="event-detail">
                  <dl>
                    <div><dt>Issuer</dt><dd>{event.issuer || 'Not retained'}</dd></div>
                    <div><dt>Expiry</dt><dd>{event.notAfter ? date(event.notAfter) : 'Not retained'}</dd></div>
                    <div><dt>Source</dt><dd>{event.sources.join(', ')}</dd></div>
                    <div><dt>Coverage</dt><dd>{event.namesComplete ? 'All supplied names retained' : 'Partial name set'} · {event.completeness}</dd></div>
                  </dl>
                  <div class="clauses">
                    {#each event.clauses as clause}
                      <div class="clause">
                        <strong>{clause.label}</strong>
                        <span>{stateLabel(clause.state)}</span>
                        <p>{clause.detail}</p>
                      </div>
                    {/each}
                  </div>
                  <div class="names"><strong>Retained names</strong><p>{event.names.join(', ')}</p></div>
                  <div class="case-links"><strong>Cases</strong>{#each event.caseReferences as reference}<a href={`/monitor?view=cases&case=${encodeURIComponent(reference.id)}`}>{reference.domain}</a>{/each}</div>
                  {#if event.limitations.length}<ul>{#each event.limitations as limitation}<li>{limitation}</li>{/each}</ul>{/if}
                </div>
              </details>
            {/each}
          </div>
        {:else}
          <p class="empty">No source-qualified certificate event has been retained for this official domain. Missing events are not treated as alignment.</p>
        {/if}
      </article>
    {/each}
  </div>
  <ul class="limitations">{#each replay.limitations as limitation}<li>{limitation}</li>{/each}</ul>
</section>

<style>
  .certificate-replay{display:grid;gap:18px}.section-head,.domain-review>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.section-head p,.domain-review p{margin:4px 0 0;color:var(--muted);max-width:72ch}.count,.state{white-space:nowrap;border:1px solid var(--border);border-radius:999px;padding:4px 8px;font-size:var(--text-xs);color:var(--muted)}.domain-list,.event-list{display:grid;gap:12px}.domain-review{min-width:0;border:1px solid var(--border);border-radius:var(--radius);padding:14px}.domain-review h3{margin:0;font-size:var(--text-md)}details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;padding:12px;list-style:none}summary::-webkit-details-marker{display:none}summary::before{content:'›';color:var(--accent);font-size:1.2rem;line-height:1;transition:transform .15s ease}details[open] summary::before{transform:rotate(90deg)}.event-summary{display:grid;gap:3px;min-width:0;margin-right:auto}.event-summary small{color:var(--muted);overflow-wrap:anywhere}.state.aligned{color:var(--success)}.state.review{color:var(--danger)}.state.indeterminate{color:var(--warning)}.event-detail{display:grid;gap:12px;padding:0 12px 12px}dl,.clauses{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}dl div,.clause,.names{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px}dt,.names strong,.case-links strong{font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}dd{margin:4px 0 0;overflow-wrap:anywhere}.clause{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px}.clause p{grid-column:1/-1;font-size:var(--text-sm)}.names p{overflow-wrap:anywhere}.case-links{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.case-links a{font-size:var(--text-sm)}ul{margin:0;padding-left:20px;color:var(--muted);font-size:var(--text-sm)}.notice{color:var(--warning)}.empty{font-size:var(--text-sm)}
  @media(max-width:700px){.section-head,.domain-review>header{align-items:stretch;flex-direction:column}.count{align-self:flex-start}summary{align-items:flex-start;flex-wrap:wrap}.state{margin-left:22px}dl,.clauses{grid-template-columns:1fr}.domain-review{padding:10px}.event-detail{padding:0 10px 10px}}
  @media(prefers-reduced-motion:reduce){summary::before{transition:none}}
</style>
