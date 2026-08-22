<script lang="ts">
  import LookupAcquisitionDueDiligence from '$lib/components/LookupAcquisitionDueDiligence.svelte';
  import { buildAcquisitionDueDiligence } from '$lib/analysis/acquisition-due-diligence.ts';

  let {
    target,
    availability,
    registryInsights,
    httpStatus,
  }: {
    target: string;
    availability: string;
    registryInsights: unknown;
    httpStatus: string;
  } = $props();

  const review = $derived(buildAcquisitionDueDiligence({
    availability: {
      state: availability.toLowerCase().replaceAll(' ', '_'),
      confidence: availability === 'Unknown' ? 'low' : 'high',
      source: availability === 'Unknown' ? null : 'rdap',
    },
    registryInsights,
    activationContext: {
      web: {
        state: httpStatus === 'success' ? 'response_observed' : 'inconclusive',
        label: httpStatus === 'success' ? 'Web response observed' : 'Web state inconclusive',
      },
      mail: { state: 'inconclusive', label: 'Mail state inconclusive' },
    },
  }));
</script>

<LookupAcquisitionDueDiligence {review} {target} observedAt={null} synthetic />
