<script lang="ts">
  let {
    state,
    title,
    detail,
  }: {
    state: 'loading' | 'unavailable';
    title: string;
    detail: string;
  } = $props();
</script>

<section class="local-collection-state card {state}" aria-live="polite" aria-busy={state === 'loading'}>
  <p class="eyebrow">Browser-local evidence</p>
  <h2>{title}</h2>
  <p>{detail}</p>
</section>

<style>
  .local-collection-state{margin:0 0 16px;padding:16px;border-style:dotted;color:var(--muted)}
  .local-collection-state.loading{border-style:solid}
  h2{margin:4px 0 0;color:var(--text);font:700 var(--text-md) var(--mono)}
  p:last-child{margin:6px 0 0;line-height:1.55;font-size:var(--text-sm)}
</style>
