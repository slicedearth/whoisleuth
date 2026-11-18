<script lang="ts">
  import type { AuthorisationLinkReview } from '../../../../packages/contracts/message-intake.mts';
  let { review }: { review: AuthorisationLinkReview } = $props();
</script>

<div class="authorisation-facts">
  <dl>
    <div><dt>Request kind</dt><dd>{review.kind === 'device_code_reference' ? 'Device-code reference' : 'Authorisation parameters'}</dd></div>
    <div><dt>Client ID</dt><dd>{review.clientId ?? 'Not retained or ambiguous'}</dd></div>
    <div><dt>Requested scopes</dt><dd>{review.scopes.join(', ') || 'Not declared'}</dd></div>
    <div><dt>Declared return origin</dt><dd>{review.redirectOrigin ?? 'Not retained or ambiguous'}</dd></div>
    <div><dt>Requested response type</dt><dd>{review.responseTypes.join(', ') || 'Not declared'}</dd></div>
    <div><dt>Requested prompt</dt><dd>{review.prompt.join(', ') || 'Not declared'}</dd></div>
  </dl>
  {#if review.prompt.includes('none')}<p>No interactive sign-in prompt is requested. A provider may still return an error to the declared return origin.</p>{/if}
  <p class="meta">Supplied parameters, not an observed redirect, verified application or permission grant.</p>
  {#if review.duplicateParameters.length}<p class="notice">Repeated parameters: {review.duplicateParameters.join(', ')}. Ambiguous values remain unrecorded.</p>{/if}
  {#if review.omittedParameters}<p class="meta">Unsupported, ambiguous or overlong parameter values were omitted.</p>{/if}
</div>

<style>
  .authorisation-facts{display:grid;gap:8px;min-width:0;overflow-wrap:anywhere}dl{display:grid;gap:8px;margin:0}dl>div{display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,3fr);gap:12px}dt{color:var(--muted)}dd,p{margin:0}dt,dd,p{font-size:var(--text-xs);line-height:1.6}.meta{color:var(--muted)}.notice{color:var(--amber)}@media(max-width:600px){dl>div{grid-template-columns:1fr;gap:2px}}
</style>
