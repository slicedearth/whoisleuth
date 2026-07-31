<script lang="ts">
  import { buildDisclosurePolicyHealth } from '$lib/analysis/disclosure-policy-health.ts';
  let {
    state = 'unavailable',
    detail = '',
    endpoint = '',
    httpStatus = '',
    observedAt = '',
    expiresAt = '',
    contacts = [],
    policies = [],
    encryption = [],
    languages = [],
    limitations = [],
  }: {
    state?: string;
    detail?: string;
    endpoint?: string;
    httpStatus?: string;
    observedAt?: string;
    expiresAt?: string;
    contacts?: string[];
    policies?: string[];
    encryption?: string[];
    languages?: string[];
    limitations?: string[];
  } = $props();

  const stateLabel = $derived(state.replaceAll('_', ' ').replace(/^./u, (value) => value.toUpperCase()));
  const health = $derived(buildDisclosurePolicyHealth({
    state,
    expiresAt,
    contacts,
    policies,
    encryption,
    languages,
  }));
</script>

<details class="security-txt evidence-card card">
  <summary>
    <span><small>Disclosure contact</small><strong>security.txt</strong></span>
    <span class="state {state}">{stateLabel}</span>
  </summary>
  <div class="body">
    <p class="detail">{detail}</p>
    <dl class="source-grid">
      <div><dt>Endpoint</dt><dd>{endpoint || '—'}</dd></div>
      <div><dt>HTTP status</dt><dd>{httpStatus || '—'}</dd></div>
      <div><dt>Observed</dt><dd>{observedAt ? new Date(observedAt).toLocaleString() : '—'}</dd></div>
      <div><dt>Expires</dt><dd>{expiresAt ? new Date(expiresAt).toLocaleString() : '—'}</dd></div>
    </dl>
    <section class="health" aria-label="Disclosure policy health">
      <div><strong>{health.state}</strong><span>{health.expiryDays === null ? 'Expiry unavailable' : `${health.expiryDays} days to expiry`}</span></div>
      <p>{health.coverage.contacts} contact · {health.coverage.policies} policy · {health.coverage.encryption} encryption reference · {health.coverage.languages} language</p>
      {#if health.review.length}<ul>{#each health.review as item}<li>{item}</li>{/each}</ul>{/if}
    </section>

    {#if contacts.length}
      <section aria-labelledby="security-txt-contacts"><h5 id="security-txt-contacts">Published contacts</h5><ul>{#each contacts as value}<li><code>{value}</code></li>{/each}</ul></section>
    {/if}
    {#if policies.length}
      <section aria-labelledby="security-txt-policies"><h5 id="security-txt-policies">Policies</h5><ul>{#each policies as value}<li><code>{value}</code></li>{/each}</ul></section>
    {/if}
    {#if encryption.length}
      <section aria-labelledby="security-txt-encryption"><h5 id="security-txt-encryption">Encryption references</h5><ul>{#each encryption as value}<li><code>{value}</code></li>{/each}</ul></section>
    {/if}
    {#if languages.length}<p class="meta"><strong>Preferred languages:</strong> {languages.join(', ')}</p>{/if}
    {#each limitations as limitation}<p class="callout warn">{limitation}</p>{/each}
    <p class="card-note">This file publishes a way to report security concerns. It does not authorize testing, prove that the contact is monitored, or affect the domain assessment.</p>
  </div>
</details>

<style>
  .security-txt{padding:0;overflow:hidden}
  summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:var(--card-pad);cursor:pointer;list-style:none}
  summary::-webkit-details-marker{display:none}
  summary>span:first-child{display:grid;gap:3px;min-width:0}
  summary small{color:var(--muted);font:700 var(--text-2xs) var(--mono);letter-spacing:.08em;text-transform:uppercase}
  summary strong{font:700 var(--text-sm) var(--mono)}
  .state{flex:0 0 auto;padding:4px 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font:700 var(--text-2xs) var(--mono)}
  .state.present{border-color:rgb(var(--accent2-rgb) / .45);color:var(--accent2)}
  .state.stale,.state.partial,.state.malformed{border-color:rgb(var(--amber-rgb) / .45);color:var(--amber)}
  .body{padding:0 var(--card-pad) var(--card-pad);border-top:1px solid var(--border)}
  .detail{margin:14px 0;color:var(--muted)}
  .source-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}
  .source-grid div{min-width:0;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  dt{color:var(--muted);font:700 var(--text-2xs) var(--mono);text-transform:uppercase}
  dd{margin:4px 0 0;overflow-wrap:anywhere;font:var(--text-xs) var(--mono)}
  section{margin-top:16px}
  .health{padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .health>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}.health>div strong{color:var(--accent2);text-transform:capitalize}.health>div span,.health p,.health li{color:var(--muted);font-size:var(--text-2xs)}
  .health p{margin:7px 0 0}.health ul{margin-top:8px}
  h5{margin:0 0 7px;font:700 var(--text-xs) var(--mono)}
  ul{display:grid;gap:6px;margin:0;padding-left:20px}
  li,code{min-width:0;overflow-wrap:anywhere;word-break:break-word}
  code{font-size:var(--text-xs)}
  .meta{margin:14px 0 0;color:var(--muted);font-size:var(--text-xs)}
  .callout{margin:12px 0 0}
  .card-note{margin:16px 0 0}
  @media(max-width:600px){summary{align-items:flex-start}.source-grid{grid-template-columns:1fr}}
</style>
