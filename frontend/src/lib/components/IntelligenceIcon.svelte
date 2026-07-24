<script lang="ts">
  export type IntelligenceIconName =
    | 'registry'
    | 'registrar'
    | 'whois'
    | 'network'
    | 'dns'
    | 'http'
    | 'tls'
    | 'page'
    | 'security'
    | 'technology'
    | 'analysis'
    | 'case'
    | 'nameserver'
    | 'origin'
    | 'ip'
    | 'tracker'
    | 'favicon'
    | 'asset'
    | 'lookup'
    | 'discover'
    | 'bulk'
    | 'watchlist'
    | 'brand'
    | 'command'
    | 'search';

  let {
    name,
    size = 20,
    x = undefined,
    y = undefined,
    className = '',
  }: {
    name: IntelligenceIconName;
    size?: number;
    x?: number;
    y?: number;
    className?: string;
  } = $props();
</script>

<svg
  class={className}
  viewBox="0 0 24 24"
  width={size}
  height={size}
  {x}
  {y}
  data-icon={name}
  aria-hidden="true"
  focusable="false"
>
  {#if name === 'registry'}
    <ellipse class="icon-wash" cx="12" cy="5.5" rx="7.5" ry="3"/>
    <path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>
    <path class="icon-detail" d="M16.7 8.2v1.7M16.7 14.2v1.7"/>
  {:else if name === 'registrar'}
    <path class="icon-wash" d="M4 20V8l8-4 8 4v12"/>
    <path d="M4 20V8l8-4 8 4v12M8 20v-8h8v8M3 20h18"/>
    <path class="icon-detail" d="M10.5 8h3M12 6.5v3"/>
  {:else if name === 'whois'}
    <path class="icon-wash" d="M6 3.5h8l4 4V20.5H6z"/>
    <path d="M6 3.5h8l4 4V20.5H6zM14 3.5v4h4"/>
    <circle cx="10" cy="10.5" r="2"/>
    <path class="icon-detail" d="M7.8 16c.8-2.1 3.6-2.1 4.4 0M14.5 12h1.5M14.5 15.5h1.5"/>
  {:else if name === 'network'}
    <path class="icon-detail" d="m7.8 11 7.8-3.6M7.8 13l7.8 3.6"/>
    <circle class="icon-wash" cx="6" cy="12" r="2"/>
    <circle class="icon-wash" cx="17.5" cy="6.5" r="2"/>
    <circle class="icon-wash" cx="17.5" cy="17.5" r="2"/>
  {:else if name === 'dns'}
    <circle class="icon-wash" cx="12" cy="12" r="8.5"/>
    <path d="M3.8 12h16.4M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5S14.3 18.1 12 20.5M12 3.5C9.7 5.9 8.5 8.7 8.5 12s1.2 6.1 3.5 8.5"/>
  {:else if name === 'http'}
    <rect class="icon-wash" x="3.5" y="5" width="17" height="14" rx="2"/>
    <path d="M3.5 9h17M7 7h.1M10 7h.1M7 12.5l2 2-2 2M11.5 16.5H16"/>
  {:else if name === 'tls'}
    <path class="icon-wash" d="M12 3.5 19 6v5.5c0 4.4-2.8 7.4-7 9-4.2-1.6-7-4.6-7-9V6z"/>
    <rect x="8.5" y="10.5" width="7" height="5.5" rx="1.2"/>
    <path d="M10 10.5V9a2 2 0 0 1 4 0v1.5M12 13v1"/>
  {:else if name === 'page'}
    <path class="icon-wash" d="M6 3.5h9l3 3V20.5H6z"/>
    <path d="M6 3.5h9l3 3V20.5H6zM15 3.5v3h3"/>
    <path class="icon-detail" d="M9 11c1.8-2 4.2-2 6 0M9 14c1.8-2 4.2-2 6 0M10.5 17c1-1 2-1 3 0"/>
  {:else if name === 'security'}
    <path class="icon-wash" d="M12 3.5 19 6v5.5c0 4.4-2.8 7.4-7 9-4.2-1.6-7-4.6-7-9V6z"/>
    <path d="M12 3.5 19 6v5.5c0 4.4-2.8 7.4-7 9-4.2-1.6-7-4.6-7-9V6zM12 8v7M8.5 11.5h7"/>
  {:else if name === 'technology'}
    <path class="icon-wash" d="m12 3.5 8 4-8 4-8-4z"/>
    <path d="m12 3.5 8 4-8 4-8-4zM4 12l8 4 8-4M4 16.5l8 4 8-4"/>
  {:else if name === 'analysis'}
    <circle class="icon-wash" cx="12" cy="12" r="8.5"/>
    <circle cx="12" cy="12" r="4.5"/>
    <path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5m-11.4.2 2 2 4-4.4"/>
  {:else if name === 'case'}
    <path class="icon-wash" d="M3.5 7.5h6l2-2h9v13H3.5z"/>
    <path d="M3.5 7.5h6l2-2h9v13H3.5zM8 12h8M8 15.5h5"/>
  {:else if name === 'nameserver'}
    <rect class="icon-wash" x="4" y="4" width="16" height="6" rx="1.5"/>
    <rect class="icon-wash" x="4" y="14" width="16" height="6" rx="1.5"/>
    <path d="M4 4h16v6H4zM4 14h16v6H4zM7 7h.1M7 17h.1M10 7h6M10 17h6"/>
  {:else if name === 'origin'}
    <circle class="icon-wash" cx="12" cy="12" r="8.5"/>
    <circle cx="12" cy="12" r="8.5"/>
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 3.5v3M20.5 12h-3M12 20.5v-3M3.5 12h3"/>
  {:else if name === 'ip'}
    <path class="icon-detail" d="M7.7 9.2 10.2 11M16.3 9.2 13.8 11M8 16l2.3-2M16 16l-2.3-2"/>
    <circle class="icon-wash" cx="12" cy="12" r="3"/>
    <circle cx="6" cy="7.5" r="2"/>
    <circle cx="18" cy="7.5" r="2"/>
    <circle cx="6" cy="17" r="2"/>
    <circle cx="18" cy="17" r="2"/>
  {:else if name === 'tracker'}
    <circle class="icon-wash" cx="12" cy="12" r="8.5"/>
    <circle cx="12" cy="12" r="5"/>
    <circle cx="12" cy="12" r="1.5"/>
    <path d="M12 3.5V7M20.5 12H17M12 20.5V17M3.5 12H7"/>
  {:else if name === 'favicon'}
    <rect class="icon-wash" x="4" y="4" width="16" height="16" rx="3"/>
    <path d="M4 4h16v16H4zM8 15l2.5-3 2.2 2 1.8-2 2.5 3M8 8.5h.1"/>
  {:else if name === 'asset'}
    <path class="icon-wash" d="M8.5 4.5h7l4 4v7l-4 4h-7l-4-4v-7z"/>
    <path d="M8.5 4.5h7l4 4v7l-4 4h-7l-4-4v-7zM8.5 12l2.2 2.2 4.8-5"/>
  {:else if name === 'lookup' || name === 'search' || name === 'command'}
    <circle class="icon-wash" cx="10.5" cy="10.5" r="6.5"/>
    <circle cx="10.5" cy="10.5" r="6.5"/>
    <path d="m15.5 15.5 5 5"/>
    {#if name === 'command'}<path class="icon-detail" d="M8 9.2 10 11l-2 1.8M11.5 13h3"/>{/if}
  {:else if name === 'discover'}
    <circle class="icon-wash" cx="12" cy="12" r="8.5"/>
    <circle cx="12" cy="12" r="8.5"/>
    <path d="m14.5 9.5-1.8 4.1-4.2 1.9 1.8-4.2zM12 3.5v2M20.5 12h-2M12 20.5v-2M3.5 12h2"/>
  {:else if name === 'bulk'}
    <path class="icon-wash" d="M4 5h7v5H4zM13 14h7v5h-7z"/>
    <path d="M4 5h7v5H4zM13 14h7v5h-7zM13 7.5h6M16.5 5l2.5 2.5-2.5 2.5M11 16.5H5M7.5 14 5 16.5 7.5 19"/>
  {:else if name === 'watchlist'}
    <path class="icon-wash" d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6z"/>
    <path d="M3.5 12s3.2-6 8.5-6 8.5 6 8.5 6-3.2 6-8.5 6-8.5-6-8.5-6z"/>
    <circle cx="12" cy="12" r="2.5"/>
  {:else if name === 'brand'}
    <path class="icon-wash" d="M12 3.5 19 6v5.5c0 4.4-2.8 7.4-7 9-4.2-1.6-7-4.6-7-9V6z"/>
    <path d="M12 3.5 19 6v5.5c0 4.4-2.8 7.4-7 9-4.2-1.6-7-4.6-7-9V6zM12 8l3 4-3 4-3-4z"/>
  {/if}
</svg>

<style>
  svg{display:block;flex:none;overflow:visible;color:inherit;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
  .icon-wash{fill:currentColor;fill-opacity:.1}
  .icon-detail{opacity:.72}
</style>
