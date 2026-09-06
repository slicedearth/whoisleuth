<script lang="ts">
  import {
    MAX_OFFICIAL_CHANNELS,
    MAX_RIGHTS_REFERENCES,
    OFFICIAL_CHANNEL_PLATFORMS,
    RIGHTS_REFERENCE_KINDS,
    type OfficialChannel,
    type RightsReference,
  } from '$lib/analysis/brand-profile-model.ts';

  let {
    officialChannels,
    rightsReferences,
    disabled = false,
    onOfficialChannelsChange,
    onRightsReferencesChange,
  }: {
    officialChannels: OfficialChannel[];
    rightsReferences: RightsReference[];
    disabled?: boolean;
    onOfficialChannelsChange: (value: OfficialChannel[]) => void;
    onRightsReferencesChange: (value: RightsReference[]) => void;
  } = $props();

  function updateChannel(index: number, patch: Partial<OfficialChannel>) {
    onOfficialChannelsChange(officialChannels.map((item, candidate) => candidate === index ? { ...item, ...patch } : item));
  }
  function addChannel() {
    if (officialChannels.length >= MAX_OFFICIAL_CHANNELS) return;
    onOfficialChannelsChange([...officialChannels, { platform: 'other', url: '', handle: '', role: '', reviewedAt: null }]);
  }
  function removeChannel(index: number) {
    onOfficialChannelsChange(officialChannels.filter((_, candidate) => candidate !== index));
  }
  function updateRightsReference(index: number, patch: Partial<RightsReference>) {
    onRightsReferencesChange(rightsReferences.map((item, candidate) => candidate === index ? { ...item, ...patch } : item));
  }
  function addRightsReference() {
    if (rightsReferences.length >= MAX_RIGHTS_REFERENCES) return;
    onRightsReferencesChange([...rightsReferences, { kind: 'trademark', owner: '', identifier: '', jurisdiction: '', sourceUrl: '', reviewedAt: null, note: '' }]);
  }
  function removeRightsReference(index: number) {
    onRightsReferencesChange(rightsReferences.filter((_, candidate) => candidate !== index));
  }
  const dateValue = (value: string | null) => value?.slice(0, 10) ?? '';
  const dateTimestamp = (value: string) => value ? `${value}T00:00:00.000Z` : null;
</script>

<fieldset class="reference-editor wide" {disabled}>
  <legend>Official channels and rights references</legend>
  <p>These analyst-maintained records provide comparison and complaint-preparation context. They do not prove account control, ownership or infringement.</p>

  <section aria-labelledby="official-channels-title">
    <header><div><h3 id="official-channels-title">Official public channels</h3><span>{officialChannels.length}/{MAX_OFFICIAL_CHANNELS}</span></div><button class="btn small" type="button" onclick={addChannel} disabled={disabled || officialChannels.length >= MAX_OFFICIAL_CHANNELS}>Add channel</button></header>
    {#if officialChannels.length}
      <div class="records">
        {#each officialChannels as channel, index}
          <article aria-labelledby={`official-channel-${index + 1}`}>
            <h4 id={`official-channel-${index + 1}`}>Official channel {index + 1}</h4>
            <div class="channel-grid">
              <label class="field">Platform<select aria-label={`Official channel ${index + 1} platform`} value={channel.platform} onchange={(event) => updateChannel(index, { platform: event.currentTarget.value as OfficialChannel['platform'] })}>{#each OFFICIAL_CHANNEL_PLATFORMS as platform}<option value={platform}>{platform === 'x' ? 'X' : `${platform[0]?.toUpperCase()}${platform.slice(1)}`}</option>{/each}</select></label>
              <label class="field span-two">Exact public URL<input aria-label={`Official channel ${index + 1} exact public URL`} type="url" value={channel.url} maxlength="2048" placeholder="https://social.example/official-account" oninput={(event) => updateChannel(index, { url: event.currentTarget.value })}></label>
              <label class="field">Public handle<input aria-label={`Official channel ${index + 1} public handle`} value={channel.handle} maxlength="200" oninput={(event) => updateChannel(index, { handle: event.currentTarget.value })}></label>
              <label class="field">Role<input aria-label={`Official channel ${index + 1} role`} value={channel.role} maxlength="200" placeholder="Primary support account" oninput={(event) => updateChannel(index, { role: event.currentTarget.value })}></label>
              <label class="field">Last reviewed<input aria-label={`Official channel ${index + 1} last reviewed`} type="date" value={dateValue(channel.reviewedAt)} onchange={(event) => updateChannel(index, { reviewedAt: dateTimestamp(event.currentTarget.value) })}></label>
            </div>
            <button class="btn small danger" type="button" aria-label={`Remove official channel ${index + 1}`} onclick={() => removeChannel(index)}>Remove channel</button>
          </article>
        {/each}
      </div>
    {:else}<p class="empty">No official public channels recorded.</p>{/if}
  </section>

  <section aria-labelledby="rights-references-title">
    <header><div><h3 id="rights-references-title">Rights references</h3><span>{rightsReferences.length}/{MAX_RIGHTS_REFERENCES}</span></div><button class="btn small" type="button" onclick={addRightsReference} disabled={disabled || rightsReferences.length >= MAX_RIGHTS_REFERENCES}>Add reference</button></header>
    {#if rightsReferences.length}
      <div class="records">
        {#each rightsReferences as reference, index}
          <article aria-labelledby={`rights-reference-${index + 1}`}>
            <h4 id={`rights-reference-${index + 1}`}>Rights reference {index + 1}</h4>
            <div class="rights-grid">
              <label class="field">Kind<select aria-label={`Rights reference ${index + 1} kind`} value={reference.kind} onchange={(event) => updateRightsReference(index, { kind: event.currentTarget.value as RightsReference['kind'] })}>{#each RIGHTS_REFERENCE_KINDS as kind}<option value={kind}>{kind[0]?.toUpperCase()}{kind.slice(1)}</option>{/each}</select></label>
              <label class="field">Owner<input aria-label={`Rights reference ${index + 1} owner`} value={reference.owner} maxlength="200" oninput={(event) => updateRightsReference(index, { owner: event.currentTarget.value })}></label>
              <label class="field">Identifier<input aria-label={`Rights reference ${index + 1} identifier`} value={reference.identifier} maxlength="200" oninput={(event) => updateRightsReference(index, { identifier: event.currentTarget.value })}></label>
              <label class="field">Jurisdiction<input aria-label={`Rights reference ${index + 1} jurisdiction`} value={reference.jurisdiction} maxlength="200" oninput={(event) => updateRightsReference(index, { jurisdiction: event.currentTarget.value })}></label>
              <label class="field span-two">Official reference URL<input aria-label={`Rights reference ${index + 1} official reference URL`} type="url" value={reference.sourceUrl} maxlength="2048" oninput={(event) => updateRightsReference(index, { sourceUrl: event.currentTarget.value })}></label>
              <label class="field">Last reviewed<input aria-label={`Rights reference ${index + 1} last reviewed`} type="date" value={dateValue(reference.reviewedAt)} onchange={(event) => updateRightsReference(index, { reviewedAt: dateTimestamp(event.currentTarget.value) })}></label>
              <label class="field span-two">Note<input aria-label={`Rights reference ${index + 1} note`} value={reference.note} maxlength="200" oninput={(event) => updateRightsReference(index, { note: event.currentTarget.value })}></label>
            </div>
            <button class="btn small danger" type="button" aria-label={`Remove rights reference ${index + 1}`} onclick={() => removeRightsReference(index)}>Remove reference</button>
          </article>
        {/each}
      </div>
    {:else}<p class="empty">No structured rights references recorded.</p>{/if}
  </section>
</fieldset>

<style>
  .reference-editor{display:grid;grid-column:1/-1;gap:14px;min-width:0}.reference-editor>p,.empty{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.reference-editor section{display:grid;gap:8px;padding-top:10px;border-top:1px solid var(--border)}section>header,section>header>div{display:flex;align-items:center;justify-content:space-between;gap:8px}h3,h4{margin:0;font:700 var(--text-sm) var(--mono)}h4{font-size:var(--text-xs)}header span{color:var(--muted);font:650 var(--text-2xs) var(--mono)}.records{display:grid;gap:8px}.records article{display:grid;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.records article>.btn{justify-self:end}.channel-grid,.rights-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.span-two{grid-column:span 2}.field{min-width:0}.field input,.field select{width:100%;margin-top:4px}
  @media(max-width:800px){.channel-grid,.rights-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.span-two{grid-column:1/-1}}
  @media(max-width:520px){section>header{align-items:stretch;flex-direction:column}.channel-grid,.rights-grid{grid-template-columns:1fr}.span-two{grid-column:auto}.records article>.btn{width:100%}}
</style>
