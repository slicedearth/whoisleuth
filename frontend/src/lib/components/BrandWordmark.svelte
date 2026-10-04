<script lang="ts">
  import { BRAND_WORDMARK_VIEWBOX, BRAND_WORDMARK_PRIMARY, BRAND_WORDMARK_SECONDARY } from '$lib/brand-identity';
</script>

<span class="wordmark"><span class="sr-only">WHOISleuth</span><svg viewBox={BRAND_WORDMARK_VIEWBOX} aria-hidden="true" focusable="false" fill="none" stroke-width="5.5" stroke-linecap="square" stroke-linejoin="round"><path class="primary" d={BRAND_WORDMARK_PRIMARY}/><path class="secondary" d={BRAND_WORDMARK_SECONDARY}/></svg></span>

<style>
  .wordmark{display:inline-block;width:6.35em;max-width:100%;line-height:1;vertical-align:middle}
  svg{display:block;width:100%;height:auto;overflow:visible}
  .primary{stroke:var(--brand-mark-primary)}
  .secondary{stroke:var(--brand-mark-secondary)}
</style>
