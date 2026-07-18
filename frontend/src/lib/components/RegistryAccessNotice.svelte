<script lang="ts">
  let { access }: { access: Record<string, unknown> } = $props();

  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const suffix = $derived(text(access.suffix).toUpperCase());
  const whoisLabel = $derived(access.whoisAccessProfile === 'source-ip-authorization-required'
    ? 'Source-IP authorization required'
    : access.whoisAccessProfile === 'registry-policy-restricted'
      ? 'Registry policy restricted'
      : access.whoisAccessProfile === 'no-iana-service'
        ? 'No service published by IANA'
        : 'IANA referral discovery');
  const rdapLabel = $derived(access.rdapAccessProfile === 'no-iana-service'
    ? 'No service published by IANA'
    : 'IANA bootstrap discovery');
  const stateLabel = $derived(['source-ip-authorization-required', 'registry-policy-restricted'].includes(String(access.whoisAccessProfile))
    ? 'Restricted access'
    : 'Service not published');
</script>

<section class="registry-access card" aria-labelledby="registry-access-title">
  <header>
    <div>
      <p class="eyebrow">Registry access</p>
      <h4 id="registry-access-title">.{suffix} collection constraints</h4>
    </div>
    <span class="badge">{stateLabel}</span>
  </header>
  <p>{text(access.limitation)}</p>
  <dl>
    <div><dt>WHOIS</dt><dd>{whoisLabel}</dd></div>
    <div><dt>RDAP</dt><dd>{rdapLabel}</dd></div>
  </dl>
  <p class="note">This is access-policy context only. It does not decide registration, availability, safety, or maliciousness.</p>
</section>

<style>
  .registry-access{padding:var(--card-pad);border-color:color-mix(in srgb,var(--amber) 38%,var(--border));background:color-mix(in srgb,var(--panel) 94%,var(--amber))}
  header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
  h4{margin:2px 0 0;font-size:var(--text-sm);overflow-wrap:anywhere}
  p{margin:12px 0 0;color:var(--text-secondary);font-size:var(--text-xs);line-height:1.55}
  .badge{flex:0 0 auto;border:1px solid color-mix(in srgb,var(--amber) 45%,var(--border));border-radius:999px;padding:4px 8px;color:var(--amber);font:700 var(--text-2xs) var(--mono);letter-spacing:.04em;text-transform:uppercase}
  dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0 0}
  dl div{min-width:0;border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 10px;background:var(--panel-raised)}
  dt{color:var(--muted);font:700 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}
  dd{margin:4px 0 0;color:var(--text);font-size:var(--text-xs);line-height:1.4;overflow-wrap:anywhere}
  .note{color:var(--muted)}
  @media(max-width:520px){header{display:block}.badge{display:inline-block;margin-top:9px}dl{grid-template-columns:1fr}}
</style>
