<script lang="ts">
  // Decorative placeholder only. Collection state, source progress and errors
  // stay with the Lookup form's announced status; nothing here claims a result.
  const families = [0, 1, 2];
</script>

<div class="result-skeleton" aria-hidden="true" data-testid="lookup-result-skeleton">
  <div class="skeleton-header">
    <span class="bone eyebrow"></span>
    <span class="bone title"></span>
    <span class="bone line short"></span>
  </div>
  <div class="skeleton-brief card">
    <span class="bone eyebrow"></span>
    <span class="bone line"></span>
    <div class="skeleton-metrics">
      {#each [0, 1, 2, 3] as metric (metric)}<span class="bone metric"></span>{/each}
    </div>
  </div>
  <div class="skeleton-families">
    {#each families as family (family)}
      <div class="skeleton-family card">
        <span class="bone eyebrow"></span>
        <span class="bone line"></span>
        <span class="bone line short"></span>
      </div>
    {/each}
  </div>
</div>

<style>
  .result-skeleton{display:grid;gap:14px;margin-top:18px;min-width:0}
  .skeleton-header{display:grid;gap:9px;padding-block:6px}
  .skeleton-brief,.skeleton-family{display:grid;gap:10px;padding:var(--card-pad)}
  .skeleton-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .skeleton-families{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .bone{position:relative;display:block;height:12px;overflow:hidden;border-radius:6px;background:color-mix(in srgb,var(--border) 70%,var(--panel-raised))}
  .bone::after{position:absolute;inset:0;content:"";background:linear-gradient(90deg,transparent,rgb(var(--overlay-rgb) / .07),transparent);transform:translateX(-100%);animation:skeleton-shimmer 1.6s ease-in-out infinite}
  .bone.eyebrow{width:110px;height:9px}
  .bone.title{width:min(340px,70%);height:24px}
  .bone.line{width:78%}
  .bone.short{width:46%}
  .bone.metric{height:44px;border-radius:var(--radius-sm)}
  @keyframes skeleton-shimmer{to{transform:translateX(100%)}}
  @media (prefers-reduced-motion: reduce){.bone::after{display:none}}
  :global(:root[data-effects='minimal']) .bone::after{display:none}
  @media(max-width:720px){
    .skeleton-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
    .skeleton-families{grid-template-columns:1fr}
    .skeleton-family:nth-child(n+2){display:none}
  }
</style>
