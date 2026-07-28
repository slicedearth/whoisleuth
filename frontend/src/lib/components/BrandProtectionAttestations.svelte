<script lang="ts">
  import type { BrandProfile } from '$lib/brand-profiles';
  import {
    PROTECTION_ATTESTATION_CONTROLS,
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
  let { active, saveAttestations }: {
    active: BrandProfile;
    saveAttestations: (attestations: ProtectionAttestation[]) => void | Promise<void>;
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

  function dateValue(value: string | null): string {
    return value && Number.isFinite(Date.parse(value)) ? value.slice(0, 10) : '';
  }

  $effect(() => {
    const signature = `${active.id}:${active.updatedAt}`;
    if (signature === loadedSignature) return;
    const next = Object.fromEntries(PROTECTION_ATTESTATION_CONTROLS.map((control) => {
      const current = active.protectionAttestations.find((attestation) => attestation.control === control);
      return [control, current ? {
        state: current.state,
        expiresAt: dateValue(current.expiresAt),
        note: current.note,
      } : emptyDraft()];
    })) as Record<ProtectionAttestationControl, Draft>;
    drafts = next;
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
    saving = true;
    try {
      const assertedAt = new Date().toISOString();
      await saveAttestations(PROTECTION_ATTESTATION_CONTROLS.map((control) => ({
        control,
        state: drafts[control].state,
        assertedAt,
        expiresAt: drafts[control].expiresAt ? `${drafts[control].expiresAt}T23:59:59.999Z` : null,
        note: drafts[control].note,
      })));
    } finally {
      saving = false;
    }
  }
</script>

<section class="attestations card">
  <header class="section-head">
    <div>
      <p class="eyebrow">Account controls</p>
      <h2>Reviewed protection attestations</h2>
      <p>Record controls that public DNS and registry evidence cannot prove. These are analyst-owned statements with optional expiry dates, not collected findings or security guarantees.</p>
    </div>
    <button class="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save attestations'}</button>
  </header>
  <div class="attestation-grid">
    {#each PROTECTION_ATTESTATION_CONTROLS as control}
      <fieldset>
        <legend>{labels[control]}</legend>
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
          Bounded note
          <input maxlength="200" value={drafts[control].note} oninput={(event) => update(control, 'note', event.currentTarget.value)}>
        </label>
      </fieldset>
    {/each}
  </div>
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
  @media(max-width:750px){.attestation-grid{grid-template-columns:1fr}.attestations .section-head{display:block}.attestations .section-head button{width:100%;margin-top:12px}}
</style>
