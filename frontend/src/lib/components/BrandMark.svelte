<script lang="ts">
  import { BRAND_MARK_VIEWBOX, BRAND_MARK_LENS, BRAND_MARK_LINKS, BRAND_MARK_NODES } from '#lib/brand-identity.ts';
</script>

<svg class="brand-mark" viewBox={BRAND_MARK_VIEWBOX} aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
  <path data-brand-tone="primary" class="primary" d={BRAND_MARK_LENS} />
  <path class="links" fill="none" stroke-width="2.4" stroke-linejoin="round" d={BRAND_MARK_LINKS} />
  <path data-brand-tone="secondary" class="secondary" d={BRAND_MARK_NODES} />
</svg>

<style>
  .brand-mark{display:block;width:100%;height:100%;overflow:visible}
  .primary{fill:var(--brand-mark-primary)}
  .secondary{fill:var(--brand-mark-secondary)}
  .links{stroke:var(--brand-mark-secondary)}
</style>
