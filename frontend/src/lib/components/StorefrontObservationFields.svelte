<script lang="ts">
  import type { StorefrontDraft } from '$lib/analysis/storefront-review-draft.ts';
  import { STOREFRONT_FIELDS } from '../../../../packages/investigation/storefront-review.mts';
  let { draft = $bindable(), label }: { draft: StorefrontDraft; label: string } = $props();
</script>
<fieldset><legend>{label}</legend>
  <label>{label} hostname<input required maxlength="253" bind:value={draft.hostname}></label>
  <label>{label} observation time<input required type="text" bind:value={draft.observedAt} placeholder="2026-09-22T10:00:00+10:00" maxlength="40"></label>
  <label>{label} source reference<input required maxlength="500" bind:value={draft.source}></label>
  {#each STOREFRONT_FIELDS as field}<div><label class="checkbox"><input type="checkbox" bind:checked={draft.fields[field.id].reviewed}>{field.label} reviewed</label>{#if draft.fields[field.id].reviewed}<label>{label}: {field.label}<textarea rows="2" maxlength="100000" bind:value={draft.fields[field.id].values} placeholder="One value per line; leave empty if none were recorded"></textarea></label>{/if}</div>{/each}
</fieldset>
