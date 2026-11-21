<script lang="ts">
  // The circled plus and minus shared by console panel disclosures.
  let { expanded }: { expanded: boolean } = $props();
</script>

<span class="toggle-icon" class:expanded aria-hidden="true"></span>

<style>
  .toggle-icon{display:block;position:relative;flex:none;width:17px;height:17px;border:1px solid currentColor;border-radius:50%}
  .toggle-icon::before,.toggle-icon::after{content:"";position:absolute;top:50%;left:50%;width:7px;height:1.5px;border-radius:999px;background:currentColor;transform:translate(-50%,-50%)}
  .toggle-icon::after{width:1.5px;height:7px}
  .toggle-icon.expanded::after{display:none}
</style>
