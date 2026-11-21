<script lang="ts">
  import { page } from '$app/state';
  import { publicFooterNavigation } from '#lib/workspaces.ts';
  import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../../../../packages/analysis/project-metadata.mts';

  let { console = false }: { console?: boolean } = $props();
  const revision = __WHOISLEUTH_BUILD_REVISION__;
  const sourceHref = /^[a-f0-9]{7,64}$/u.test(revision)
    ? `${WHOISLEUTH_SOURCE_REPOSITORY_URL}/tree/${revision}`
    : WHOISLEUTH_SOURCE_REPOSITORY_URL;
  const revisionLabel = /^[a-f0-9]{7,64}$/u.test(revision) ? revision.slice(0, 7) : 'local';
</script>

<footer class="site-footer public-footer">
  <div class="footer-meta">
    <p>WHOISleuth {__WHOISLEUTH_VERSION__} · build {revisionLabel} <span class="footer-credit">· © 2026 <a href="https://github.com/slicedearth" target="_blank" rel="noopener noreferrer">slicedearth<span class="sr-only"> (opens in a new tab)</span></a></span></p>
    <nav class="footer-links" aria-label="Footer">
      {#each publicFooterNavigation as item}
        <a class:active={!console && page.url.pathname === item.href} aria-current={!console && page.url.pathname === item.href ? 'page' : undefined} href={item.href} target={console ? '_blank' : undefined} rel={console ? 'noopener noreferrer' : undefined}>{item.label}{#if console}<span class="sr-only"> (opens in a new tab)</span>{/if}</a>
      {/each}
      <a href={sourceHref} target="_blank" rel="noopener noreferrer">Source<span class="sr-only"> and licence (opens in a new tab)</span></a>
    </nav>
  </div>
</footer>

<style>
  footer{margin-block-start:clamp(32px,4vw,54px);padding:16px 0 24px;border-top:1px solid var(--border);color:var(--muted);font:var(--text-xs)/1.5 var(--font-sans);overflow-wrap:anywhere}
  .footer-meta{display:grid;gap:4px}
  p{margin:0;font-size:clamp(.6875rem,3.4vw,var(--text-xs));letter-spacing:-.015em}
  .footer-credit{display:inline-block;max-inline-size:100%}
  .footer-links{display:flex;flex-wrap:wrap;column-gap:clamp(7px,2vw,14px);margin:0;font-size:var(--text-2xs)}
  .footer-links a{display:inline-flex;align-items:center;min-width:24px;max-width:100%;min-height:32px;padding-block:4px}
  .footer-links a.active{color:var(--text);text-decoration:underline;text-underline-offset:4px}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;border:0}
  a{color:var(--accent);font-weight:650;text-decoration:none}
  a:hover,a:focus-visible{color:var(--text)}
  @media(max-width:720px),(pointer:coarse){.footer-links a{min-height:44px}}
</style>
