<script lang="ts">
  import type { BrandProfile } from '$lib/brand-profiles';

  type Field = 'name'|'official'|'products'|'tlds'|'partners'|'allowDomains'|'allowRegistrars'|'selectors'|'trademarkOwner'|'trademarkRegistration'|'faviconHash';
  type Values = Record<Field, string>;

  let { editing, values, setValue, pageBaseline, capturingIdentity, disabledReason, captureSiteIdentity, save, close, formatDate }: {
    editing: boolean;
    values: Values;
    setValue: (field: Field, value: string) => void;
    pageBaseline: BrandProfile['pageBaseline'];
    capturingIdentity: boolean;
    disabledReason: string;
    captureSiteIdentity: () => void | Promise<void>;
    save: () => void;
    close: () => void;
    formatDate: (value: string) => string;
  } = $props();
</script>

<section class="form card"><header class="section-head"><h2>{editing ? 'Edit profile' : 'New profile'}</h2><button class="btn" onclick={close}>Close</button></header>{#if disabledReason}<p class="feature-disabled" role="note">{disabledReason}</p>{/if}<div class="form-grid"><label class="field">Brand name<input value={values.name} oninput={(event) => setValue('name', event.currentTarget.value)}></label><label class="field">Preferred TLDs<input value={values.tlds} oninput={(event) => setValue('tlds', event.currentTarget.value)}></label><label class="field wide">Official domains<textarea value={values.official} oninput={(event) => setValue('official', event.currentTarget.value)}></textarea></label><label class="field">Product names<input value={values.products} oninput={(event) => setValue('products', event.currentTarget.value)}></label><label class="field">DKIM selectors<input value={values.selectors} oninput={(event) => setValue('selectors', event.currentTarget.value)}></label><label class="field wide">Approved partner domains<textarea value={values.partners} oninput={(event) => setValue('partners', event.currentTarget.value)}></textarea></label><label class="field wide">Allowlisted domains<textarea value={values.allowDomains} oninput={(event) => setValue('allowDomains', event.currentTarget.value)}></textarea></label><label class="field">Allowlisted registrars<input value={values.allowRegistrars} oninput={(event) => setValue('allowRegistrars', event.currentTarget.value)}></label><label class="field">Trademark owner<input value={values.trademarkOwner} oninput={(event) => setValue('trademarkOwner', event.currentTarget.value)}></label><label class="field">Trademark registration<input value={values.trademarkRegistration} oninput={(event) => setValue('trademarkRegistration', event.currentTarget.value)}></label><fieldset class="wide identity-capture"><legend>Official-site identity</legend><p>Capture a versioned comparison baseline from the first official domain. Only bounded fingerprints and metadata are saved; page HTML is never stored in the profile.</p><div class="identity-actions"><button class="btn" type="button" onclick={captureSiteIdentity} disabled={capturingIdentity || Boolean(disabledReason)}>{capturingIdentity ? 'Capturing…' : pageBaseline ? 'Update official-site baseline' : 'Capture official-site baseline'}</button>{#if pageBaseline}<span>{pageBaseline.domain} · {pageBaseline.complete ? 'Complete' : 'Partial'} · {formatDate(pageBaseline.observedAt)}</span>{:else}<span>Not captured</span>{/if}</div><label class="field">Official favicon hash<input value={values.faviconHash} readonly placeholder="Not captured"></label>{#if pageBaseline}<dl class="baseline-summary stat-grid"><div><dt>Page title</dt><dd>{pageBaseline.pageTitle || 'Not observed'}</dd></div><div><dt>Canonical host</dt><dd>{pageBaseline.canonicalHost || 'Not observed'}</dd></div><div><dt>Page fingerprints</dt><dd>{2 + (pageBaseline.visibleText ? 1 : 0) + (pageBaseline.formStructure ? 1 : 0)} components</dd></div><div><dt>External hosts / tracking IDs</dt><dd>{pageBaseline.resourceHosts.values.length} / {pageBaseline.trackingIdentifiers.values.length}</dd></div></dl>{/if}</fieldset></div><footer class="toolbar"><button class="primary" onclick={save}>Save profile</button><button class="btn" onclick={close}>Cancel</button></footer></section>

<style>
  .form{margin-top:16px;padding:var(--card-pad)}
  .form h2{margin:0}
  .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:18px 0}
  .form-grid textarea{min-height:82px;background:rgba(15,17,21,.78)}
  .wide{grid-column:span 2}
  .identity-capture{min-width:0;margin:4px 0 0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-md)}
  .identity-capture legend{padding:0 5px;font:700 var(--text-xs) var(--mono)}
  .identity-capture>p{margin:0 0 12px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .identity-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px}
  .identity-actions span{min-width:0;color:var(--muted);font-size:var(--text-xs);overflow-wrap:anywhere}
  .baseline-summary{margin:12px 0 0}
  .baseline-summary dt{color:var(--muted);font:600 var(--text-2xs) var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .baseline-summary dd{margin:5px 0 0;font-size:var(--text-xs);overflow-wrap:anywhere}
  @media(max-width:750px){.form-grid{grid-template-columns:1fr}.wide{grid-column:auto}.identity-actions{align-items:stretch;flex-direction:column}.identity-actions button{width:100%}}
</style>
