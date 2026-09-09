<script lang="ts">
  import { tick } from 'svelte';
  import type { BrandProfile, BrandProfileSaveResult } from '$lib/brand-profiles';
  import { restoreSubmittedFocus } from '$lib/controllers/submitted-draft';
  import {
    PROTECTION_ATTESTATION_CONTROLS,
    reviewProtectionAttestations,
    type ProtectionAttestation,
    type ProtectionAttestationControl,
    type ProtectionAttestationState,
  } from '$lib/analysis/brand-profile-model.ts';

  type Draft = {
    state: ProtectionAttestationState;
    expiresAt: string;
    note: string;
  };

  const labels: Record<ProtectionAttestationControl, string> = {
    registrar_mfa: 'Registrar MFA',
    recovery_email_separation: 'Recovery email separation',
    registry_lock: 'Registry lock',
    emergency_contacts: 'Emergency contacts',
    account_audit_logging: 'Account audit logging',
    zone_backups: 'Zone backups',
  };
  const emptyDraft = (): Draft => ({ state: 'needs_confirmation', expiresAt: '', note: '' });
  let { active, saveAttestations, writeDisabled = false }: {
    active: BrandProfile;
    saveAttestations: (expected: BrandProfile, attestations: ProtectionAttestation[]) => Promise<BrandProfileSaveResult>;
    writeDisabled?: boolean;
  } = $props();
  let drafts = $state<Record<ProtectionAttestationControl, Draft>>({
    registrar_mfa: emptyDraft(),
    recovery_email_separation: emptyDraft(),
    registry_lock: emptyDraft(),
    emergency_contacts: emptyDraft(),
    account_audit_logging: emptyDraft(),
    zone_backups: emptyDraft(),
  });
  let loadedSignature = $state('');
  let saving = $state(false);
  let base = $state.raw<BrandProfile | null>(null);
  let reconfirmed = $state<ProtectionAttestationControl[]>([]);
  let message = $state('');
  let componentRoot = $state<HTMLElement>();

  function dateValue(value: string | null): string {
    return value && Number.isFinite(Date.parse(value)) ? value.slice(0, 10) : '';
  }

  function storedDraft(profile: BrandProfile | null, control: ProtectionAttestationControl): Draft {
    const current = profile?.protectionAttestations.find((attestation) => attestation.control === control);
    return current ? { state: current.state, expiresAt: dateValue(current.expiresAt), note: current.note } : emptyDraft();
  }

  const reviews = $derived(PROTECTION_ATTESTATION_CONTROLS.filter((control) => (
    reconfirmed.includes(control) || JSON.stringify(drafts[control]) !== JSON.stringify(storedDraft(base, control))
  )).map((control) => ({
    control, state: drafts[control].state, note: drafts[control].note,
    expiresAt: drafts[control].expiresAt ? `${drafts[control].expiresAt}T23:59:59.999Z` : null,
  })));

  $effect(() => {
    const signature = JSON.stringify([active.id, active.protectionAttestations]);
    if (saving || writeDisabled || reviews.length || signature === loadedSignature) return;
    base = $state.snapshot(active);
    drafts = Object.fromEntries(PROTECTION_ATTESTATION_CONTROLS.map((control) => [control, storedDraft(base, control)])) as Record<ProtectionAttestationControl, Draft>;
    loadedSignature = signature;
  });

  function update(control: ProtectionAttestationControl, field: keyof Draft, value: string) {
    const current = drafts[control];
    drafts[control] = {
      ...current,
      [field]: value,
    } as Draft;
  }

  function expiryLabel(value: string): string {
    if (!value) return 'No review expiry set';
    const expiry = Date.parse(`${value}T23:59:59.999Z`);
    if (!Number.isFinite(expiry)) return 'Invalid review expiry';
    return expiry < Date.now() ? `Review expired ${value}` : `Review expires ${value}`;
  }

  async function save() {
    if (saving || writeDisabled || !base || !reviews.length) return;
    const origin = document.activeElement;
    const submittedDrafts = $state.snapshot(drafts);
    saving = true;
    message = '';
    try {
      const next = reviewProtectionAttestations(base.protectionAttestations, $state.snapshot(reviews), new Date().toISOString());
      const result = await saveAttestations(base, next);
      if (!result.committed) { message = result.message; return; }
      base = result.profile;
      for (const control of PROTECTION_ATTESTATION_CONTROLS) {
        if (JSON.stringify(drafts[control]) === JSON.stringify(submittedDrafts[control])) drafts[control] = storedDraft(base, control);
      }
      reconfirmed = [];
      loadedSignature = JSON.stringify([base.id, base.protectionAttestations]);
      message = 'Saved the submitted reviews. Untouched controls keep their recorded dates.';
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'The reviews could not be saved. The draft is unchanged.';
    } finally {
      saving = false;
      await tick();
      restoreSubmittedFocus(origin, componentRoot?.querySelector<HTMLSelectElement>('select'), componentRoot);
    }
  }

  function discard() {
    base = $state.snapshot(active);
    drafts = Object.fromEntries(PROTECTION_ATTESTATION_CONTROLS.map((control) => [control, storedDraft(base, control)])) as Record<ProtectionAttestationControl, Draft>;
    reconfirmed = [];
    loadedSignature = JSON.stringify([base.id, base.protectionAttestations]);
    message = 'Reopened the saved account-control reviews.';
  }
</script>

<section class="attestations card" bind:this={componentRoot} aria-labelledby="brand-account-controls-title" aria-busy={saving}>
  <header class="section-head">
    <div>
      <p class="eyebrow">Account controls</p>
      <h2 id="brand-account-controls-title">Reviewed account controls</h2>
      <p>Record controls that public DNS and registry evidence cannot establish. These are analyst-supplied statements with optional expiry dates.</p>
    </div>
    <div class="toolbar"><button class="btn" type="button" onclick={discard} disabled={saving || writeDisabled || !reviews.length}>Discard changes</button><button class="primary" onclick={save} disabled={saving || writeDisabled || !reviews.length}>{saving ? 'Saving…' : 'Save controls'}</button></div>
  </header>
  <div class="attestation-grid">
    {#each PROTECTION_ATTESTATION_CONTROLS as control}
      {@const retained = base?.protectionAttestations.find((item) => item.control === control)}
      <fieldset>
        <legend>{labels[control]}</legend>
        <p>{retained ? `Last reviewed ${new Date(retained.assertedAt).toLocaleString('en-AU')}` : 'No recorded review'}</p>
        <p class:expired={drafts[control].expiresAt !== '' && Date.parse(`${drafts[control].expiresAt}T23:59:59.999Z`) < Date.now()}>{expiryLabel(drafts[control].expiresAt)}</p>
        <label>
          Review state
          <select value={drafts[control].state} onchange={(event) => update(control, 'state', event.currentTarget.value)}>
            <option value="needs_confirmation">Needs confirmation</option>
            <option value="observed">Observed</option>
            <option value="not_observed">Not observed</option>
            <option value="unavailable">Unavailable</option>
            <option value="not_applicable">Not applicable</option>
          </select>
        </label>
        <label>
          Review expiry
          <input type="date" value={drafts[control].expiresAt} oninput={(event) => update(control, 'expiresAt', event.currentTarget.value)}>
        </label>
        <label>
          Review note
          <input maxlength="200" value={drafts[control].note} oninput={(event) => update(control, 'note', event.currentTarget.value)}>
        </label>
        <label class="reconfirm"><input type="checkbox" checked={reconfirmed.includes(control)} disabled={saving} onchange={(event) => { reconfirmed = event.currentTarget.checked ? [...reconfirmed, control] : reconfirmed.filter((item) => item !== control); }}> Reconfirmed this control</label>
      </fieldset>
    {/each}
  </div>
  {#if message}<p class="review-status" role="status">{message}</p>{/if}
</section>

<style>
  .attestations{margin-top:16px;padding:var(--card-pad)}
  .attestations h2{margin:0}
  .attestations .section-head p:not(.eyebrow){max-width:760px;color:var(--muted);font-size:var(--text-sm);line-height:1.5}
  .attestation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:18px}
  fieldset{display:grid;min-width:0;gap:9px;margin:0;padding:13px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel-raised)}
  legend{padding:0 5px;font:700 var(--text-xs) var(--mono)}
  fieldset>p{margin:0;color:var(--muted);font-size:var(--text-2xs)}
  fieldset>p.expired{color:var(--amber)}
  label{min-width:0;color:var(--muted);font-size:var(--text-2xs)}
  label :is(input,select){display:block;width:100%;margin-top:5px}
  .reconfirm{display:flex;align-items:center;gap:8px}.reconfirm input{flex:none;width:16px;height:16px;margin:0}.review-status{color:var(--accent);font-size:var(--text-sm);line-height:1.5}
  @media(max-width:750px){.attestation-grid{grid-template-columns:1fr}.attestations .section-head{display:block}.attestations .section-head button{width:100%;margin-top:12px}}
</style>
