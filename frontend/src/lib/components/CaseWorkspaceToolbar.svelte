<script lang="ts">
  let {
    domain,
    setDomain,
    trackDomain,
    caseCount,
    calibrationSelectedCount,
    downloadCases,
    reviewCalibrationDataset,
    importCaseFile,
    message,
  }: {
    domain: string;
    setDomain: (value: string) => void;
    trackDomain: () => void;
    caseCount: number;
    calibrationSelectedCount: number;
    downloadCases: () => void;
    reviewCalibrationDataset: () => void | Promise<void>;
    importCaseFile: (event: Event) => void | Promise<void>;
    message: string;
  } = $props();
</script>

<section class="case-toolbar card">
  <form class="track" onsubmit={(event) => { event.preventDefault(); trackDomain(); }}>
    <label for="new-case">Track a domain</label>
    <div><input id="new-case" value={domain} oninput={(event) => setDomain(event.currentTarget.value)} placeholder="suspicious.example" autocomplete="off" spellcheck="false"><button class="primary" type="submit" disabled={!domain.trim()}>Open or create case</button></div>
  </form>
  <div class="top-actions toolbar">
    <button class="btn" onclick={downloadCases} disabled={!caseCount}>Export JSON</button>
    <button class="btn" onclick={() => void reviewCalibrationDataset()} disabled={!calibrationSelectedCount}>Review calibration export ({calibrationSelectedCount})</button>
    <label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importCaseFile}></label>
  </div>
</section>
<p class="calibration-note">Calibration export includes only explicitly selected reviewed cases and a bounded subset of their latest normalized evidence. It excludes notes and does not change Risk.</p>
{#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

<style>
  .case-toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:14px;align-items:end;padding:16px}
  .track>label{display:block;margin-bottom:6px;color:var(--text);font:600 var(--text-xs) var(--mono)}
  .track>div{display:flex;gap:8px}
  .track input{min-width:230px;min-height:42px}
  .message{color:var(--accent);font-size:var(--text-sm)}
  .calibration-note{margin:8px 2px 0;color:var(--muted);font-size:var(--text-2xs);line-height:1.5}
  @media(max-width:800px){
    .case-toolbar{flex-direction:column;align-items:stretch}
    .track>div{flex-direction:column}
    .track input{min-width:0}
  }
</style>
