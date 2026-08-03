<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeading from '$lib/components/PageHeading.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import { normalizeContactAddress } from '../../../../../lib/contact-address.mts';

  type ContactCategory = 'privacy' | 'outbound' | 'security';
  type TurnstileApi = {
    render: (container: HTMLElement, options: {
      sitekey: string;
      action: string;
      theme: 'auto';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    }) => string;
    reset: (widgetId: string) => void;
    remove: (widgetId: string) => void;
  };
  type WindowWithTurnstile = Window & { turnstile?: TurnstileApi };

  const CATEGORY_LABELS: Readonly<Record<ContactCategory, string>> = {
    privacy: 'Privacy request',
    outbound: 'Outbound request concern',
    security: 'Security report',
  };
  const TURNSTILE_SCRIPT_ID = 'whoisleuth-turnstile-script';
  const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  let category = $state<ContactCategory>('privacy');
  let categories = $state<ContactCategory[]>([]);
  let subject = $state('');
  let message = $state('');
  let siteKey = $state('');
  let challengeToken = $state('');
  let widgetElement: HTMLDivElement;
  let widgetId = $state<string | null>(null);
  let loading = $state(true);
  let submitting = $state(false);
  let error = $state('');
  let resolvedRoute = $state('');
  let mailtoHref = $state('');

  function turnstileApi(): TurnstileApi | null {
    return (window as WindowWithTurnstile).turnstile ?? null;
  }

  async function loadTurnstile(): Promise<TurnstileApi> {
    const ready = turnstileApi();
    if (ready) return ready;
    let script = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    const created = !script;
    if (!script) {
      script = document.createElement('script');
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('Challenge loading timed out'));
      }, 15_000);
      const cleanup = () => {
        window.clearTimeout(timer);
        script?.removeEventListener('load', loaded);
        script?.removeEventListener('error', failed);
      };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('Challenge failed to load')); };
      script?.addEventListener('load', loaded, { once: true });
      script?.addEventListener('error', failed, { once: true });
      if (created && script) document.head.append(script);
    });
    const api = turnstileApi();
    if (!api) throw new Error('Challenge is unavailable');
    return api;
  }

  function renderChallenge(api: TurnstileApi) {
    if (widgetId) api.remove(widgetId);
    challengeToken = '';
    widgetId = api.render(widgetElement, {
      sitekey: siteKey,
      action: 'contact_route',
      theme: 'auto',
      callback: (token) => { challengeToken = token.slice(0, 2_048); error = ''; },
      'expired-callback': () => { challengeToken = ''; },
      'error-callback': () => {
        challengeToken = '';
        error = 'The verification challenge could not complete. Try again.';
      },
    });
  }

  function resetResolvedContact() {
    challengeToken = '';
    resolvedRoute = '';
    mailtoHref = '';
    error = '';
    const api = turnstileApi();
    if (api && widgetId) api.reset(widgetId);
  }

  async function initialize() {
    loading = true;
    error = '';
    try {
      const response = await fetch('/api/contact-route', { cache: 'no-store' });
      const payload: unknown = await response.json();
      const record = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};
      const configuredCategories = Array.isArray(record.categories)
        ? record.categories.filter((value): value is ContactCategory => (
            typeof value === 'string' && Object.hasOwn(CATEGORY_LABELS, value)
          )).slice(0, 3)
        : [];
      if (
        !response.ok
        || record.available !== true
        || typeof record.siteKey !== 'string'
        || !record.siteKey
        || record.siteKey.length > 128
        || !configuredCategories.length
      ) throw new Error('Contact route unavailable');
      siteKey = record.siteKey;
      categories = configuredCategories;
      category = configuredCategories[0] ?? 'privacy';
      renderChallenge(await loadTurnstile());
    } catch {
      categories = [];
      siteKey = '';
      error = 'The protected contact route is not available on this deployment.';
    } finally {
      loading = false;
    }
  }

  function buildMailto(route: string): string {
    const boundedSubject = subject.trim().slice(0, 120);
    const boundedMessage = message.trim().slice(0, 3_000);
    const body = [
      `Contact category: ${CATEGORY_LABELS[category]}`,
      '',
      boundedMessage,
    ].join('\n');
    return `mailto:${route}?subject=${encodeURIComponent(boundedSubject)}&body=${encodeURIComponent(body)}`;
  }

  async function prepareEmail(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!challengeToken) {
      error = 'Complete the verification challenge first.';
      return;
    }
    submitting = true;
    error = '';
    resolvedRoute = '';
    mailtoHref = '';
    try {
      const response = await fetch('/api/contact-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, token: challengeToken }),
      });
      const payload: unknown = await response.json();
      const record = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};
      const route = normalizeContactAddress(record.route);
      if (!response.ok || !route) {
        throw new Error('Contact verification failed');
      }
      resolvedRoute = route;
      mailtoHref = buildMailto(route);
    } catch {
      error = 'The contact route could not be prepared. Complete a fresh challenge and try again.';
    } finally {
      challengeToken = '';
      const api = turnstileApi();
      if (api && widgetId) api.reset(widgetId);
      submitting = false;
    }
  }

  onMount(() => {
    void initialize();
    return () => {
      const api = turnstileApi();
      if (api && widgetId) api.remove(widgetId);
    };
  });
</script>

<PublicSeo
  title="Contact | WHOISleuth"
  description="Prepare a privacy, outbound-request, or security email through a protected local-first handoff."
  path="/contact"
  indexable={false}
/>

<PageHeading
  eyebrow="Contact"
  title="Prepare a contact email"
  description="Verify once to reveal the relevant role address, then review and send the draft from your own email client."
/>

<div class="contact-layout">
  <form class="contact-form card" onsubmit={prepareEmail}>
    <div class="privacy-boundary">
      <strong>Your draft stays in this browser.</strong>
      <p>WHOISleuth sends only the selected category and a short-lived verification token to its server. Subject and message text are used only to prepare the local email link.</p>
    </div>

    <label>
      Contact category
      <select bind:value={category} onchange={resetResolvedContact} disabled={loading || !categories.length}>
        {#each categories as option}
          <option value={option}>{CATEGORY_LABELS[option]}</option>
        {/each}
      </select>
    </label>
    <label>
      Subject
      <input bind:value={subject} maxlength="120" autocomplete="off" placeholder="Briefly describe the request">
    </label>
    <label>
      Message
      <textarea bind:value={message} maxlength="3000" rows="9" placeholder="Include only the information needed for the recipient to respond."></textarea>
      <small>{message.length} / 3000 characters · retained only in this page</small>
    </label>

    <div class="challenge-shell" class:loading aria-busy={loading}>
      {#if loading}<p>Loading verification…</p>{/if}
      <div bind:this={widgetElement}></div>
    </div>

    <button class="primary" type="submit" disabled={loading || submitting || !categories.length}>
      {submitting ? 'Verifying…' : 'Verify and prepare email'}
    </button>

    <div class="form-feedback" aria-live="polite" aria-atomic="true">
      {#if error}<p class="form-error">{error}</p>{/if}
      {#if resolvedRoute && mailtoHref}
        <section class="prepared">
          <p class="eyebrow">Email ready</p>
          <p>The selected role address is <code>{resolvedRoute}</code>. Nothing has been sent.</p>
          <a class="primary" href={mailtoHref}>Open email draft</a>
        </section>
      {/if}
    </div>
  </form>

  <aside class="contact-notes card">
    <p class="eyebrow">Choose the right route</p>
    <dl>
      <div><dt>Privacy request</dt><dd>Access, correction, deletion, complaints, or questions about this deployment's processing.</dd></div>
      <div><dt>Outbound request concern</dt><dd>Unexpected or problematic requests that appear to originate from WHOISleuth.</dd></div>
      <div><dt>Security report</dt><dd>A vulnerability or security concern involving WHOISleuth itself.</dd></div>
    </dl>
    <p>This form does not submit an abuse report about a third-party domain, host, registrar, or registry. Use the evidence and response workflow in the Console to identify and review an appropriate recipient.</p>
    <p>The verification widget is provided by Cloudflare and receives ordinary browser request data under its <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener">privacy policy</a>.</p>
  </aside>
</div>

<style>
  .contact-layout{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(260px,.8fr);align-items:start;gap:18px}
  .contact-form,.contact-notes{padding:clamp(18px,3vw,28px)}
  .contact-form{display:grid;gap:16px}
  label{display:grid;gap:7px;color:var(--text);font:700 var(--text-xs) var(--mono)}
  input,select,textarea{width:100%;font-family:var(--sans)}
  textarea{resize:vertical;line-height:1.55}
  label small{color:var(--muted);font:var(--text-2xs) var(--mono);text-align:right}
  .privacy-boundary{padding:13px 14px;border:1px solid color-mix(in srgb,var(--accent) 34%,var(--border));border-radius:var(--radius-sm);background:rgb(var(--accent-rgb) / .055)}
  .privacy-boundary strong{color:var(--accent);font:750 var(--text-sm) var(--mono)}
  .privacy-boundary p,.challenge-shell p,.prepared p{margin:5px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .challenge-shell{min-height:66px;display:flex;align-items:center;overflow:hidden}
  .challenge-shell.loading{padding:12px;border:1px dashed var(--border);border-radius:var(--radius-sm)}
  button.primary{justify-self:start}
  .form-feedback:empty{display:none}
  .form-error{margin:0;color:var(--danger);font-size:var(--text-xs)}
  .prepared{display:grid;justify-items:start;gap:9px;padding:14px;border:1px solid color-mix(in srgb,var(--accent) 38%,var(--border));border-radius:var(--radius-sm)}
  .prepared p{margin:0;overflow-wrap:anywhere}
  .prepared code{color:var(--text)}
  .prepared a{margin-top:2px}
  .contact-notes{display:grid;gap:15px}
  .contact-notes dl{display:grid;gap:14px;margin:0}
  .contact-notes dl div{display:grid;gap:4px;padding-bottom:13px;border-bottom:1px solid var(--border)}
  .contact-notes dt{font:750 var(--text-xs) var(--mono);color:var(--text)}
  .contact-notes dd,.contact-notes>p:not(.eyebrow){margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.6}
  .contact-notes a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
  @media(max-width:780px){.contact-layout{grid-template-columns:1fr}.contact-notes{order:-1}.contact-notes dl{grid-template-columns:1fr}.contact-form,.contact-notes{padding:16px}.challenge-shell{max-width:100%}}
</style>
