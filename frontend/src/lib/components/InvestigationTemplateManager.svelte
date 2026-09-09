<script lang="ts">
  import { tick } from 'svelte';
  import { parseBoundedJson } from '$lib/bounded-json';
  import { createDraftRevision, restoreSubmittedFocus } from '$lib/controllers/submitted-draft';
  import { failedLocalMutationOutcome, LocalRecordConflictError } from '$lib/local-mutation-outcome';
  import { INVESTIGATION_RECIPES, type InvestigationRecipeId } from '$lib/analysis/investigation-guide.ts';
  import {
    deleteInvestigationTemplate,
    exportCacaoInvestigationTemplate,
    exportInvestigationTemplates,
    importInvestigationTemplates,
    loadInvestigationTemplates,
    MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES,
    saveInvestigationTemplate,
    type InvestigationTemplate,
  } from '$lib/investigation-templates';

  type StageDraft = {
    id: string;
    enabled: boolean;
    label: string;
    detail: string;
    expectedEvidence: string;
    completionCriteria: string;
    instructions: string;
    requiresApproval: boolean;
    approvalRequired: boolean;
  };

  let { templates, loadState, onchange }: {
    templates: InvestigationTemplate[];
    loadState: 'loading' | 'ready' | 'unavailable';
    onchange: (templates: InvestigationTemplate[]) => void | Promise<void>;
  } = $props();
  let editing = $state(false);
  let editingId = $state('');
  let draftId = $state('');
  let editingBase = $state.raw<InvestigationTemplate | null>(null);
  let recipeId = $state<InvestigationRecipeId>('new_domain_triage');
  let label = $state('');
  let summary = $state('');
  let stages = $state<StageDraft[]>([]);
  let message = $state('');
  let saving = $state(false);
  let refreshRequired = $state(false);
  let componentRoot = $state<HTMLElement>();
  const draft = createDraftRevision(() => draftId);
  const recipe = $derived(INVESTIGATION_RECIPES.find((candidate) => candidate.id === recipeId) || INVESTIGATION_RECIPES[0]);
  const orphanedDraft = $derived(loadState === 'ready' && editingBase !== null && !templates.some((template) => template.id === editingBase?.id));

  function stageDrafts(selectedRecipeId: InvestigationRecipeId): StageDraft[] {
    const selected = INVESTIGATION_RECIPES.find((candidate) => candidate.id === selectedRecipeId) || INVESTIGATION_RECIPES[0];
    return (selected?.stages || []).map((stage) => ({
      id: stage.id,
      enabled: true,
      label: stage.label,
      detail: stage.detail,
      expectedEvidence: stage.expectedEvidence,
      completionCriteria: stage.completionCriteria,
      instructions: stage.instructions.join('\n'),
      requiresApproval: stage.requiresApproval,
      approvalRequired: stage.requiresApproval,
    }));
  }

  function beginNew() {
    draft.changed();
    editing = true;
    editingId = '';
    draftId = crypto.randomUUID();
    editingBase = null;
    recipeId = 'new_domain_triage';
    label = '';
    summary = '';
    stages = stageDrafts(recipeId);
    message = '';
  }

  function beginEdit(template: InvestigationTemplate) {
    draft.changed();
    editing = true;
    editingId = template.id;
    draftId = template.id;
    editingBase = $state.snapshot(template);
    recipeId = template.recipeId;
    label = template.label;
    summary = template.summary;
    const byId = new Map(template.stages.map((stage) => [stage.id, stage]));
    stages = stageDrafts(template.recipeId).map((draft) => {
      const stored = byId.get(draft.id);
      return stored ? {
        ...draft,
        enabled: true,
        label: stored.label,
        detail: stored.detail,
        expectedEvidence: stored.expectedEvidence,
        completionCriteria: stored.completionCriteria,
        instructions: stored.instructions.join('\n'),
        requiresApproval: stored.requiresApproval,
      } : { ...draft, enabled: false };
    });
    message = '';
  }

  function changeRecipe(event: Event) {
    recipeId = (event.currentTarget as HTMLSelectElement).value as InvestigationRecipeId;
    stages = stageDrafts(recipeId);
  }

  async function reconcile(next: InvestigationTemplate[], success: string) {
    try {
      await onchange(next);
      refreshRequired = false;
      message = success;
    } catch {
      refreshRequired = true;
      message = `${success} The view could not be refreshed. Retry the refresh; do not repeat the write.`;
    }
  }

  function mutationFailure(cause: unknown, fallback: string) {
    if (cause instanceof LocalRecordConflictError || failedLocalMutationOutcome(cause) === 'unknown') refreshRequired = true;
    message = cause instanceof Error ? cause.message : fallback;
  }

  async function retryRefresh() {
    if (saving) return;
    const origin = document.activeElement;
    saving = true;
    try { await reconcile(await loadInvestigationTemplates(), 'Refreshed saved templates. Unsaved edits are unchanged.'); }
    catch (cause) { message = cause instanceof Error ? cause.message : 'Could not refresh saved templates.'; }
    finally {
      saving = false;
      await tick();
      restoreSubmittedFocus(origin, refreshRequired ? document.getElementById('refresh-investigation-templates') : editing ? document.getElementById('investigation-template-name') : document.getElementById('new-investigation-template'), componentRoot);
    }
  }

  async function save(event?: SubmitEvent) {
    event?.preventDefault();
    if (saving || refreshRequired) return;
    saving = true;
    const unchanged = draft.capture();
    const submittedLabel = label.trim();
    const submittedId = draftId;
    const submittedBase = editingBase;
    const origin = document.activeElement;
    message = '';
    try {
      const next = await saveInvestigationTemplate({
        id: submittedId,
        recipeId,
        label,
        summary,
        stages: stages.map((stage) => ({
          id: stage.id,
          enabled: stage.enabled,
          label: stage.label,
          detail: stage.detail,
          expectedEvidence: stage.expectedEvidence,
          completionCriteria: stage.completionCriteria,
          instructions: stage.instructions.split('\n').map((item) => item.trim()).filter(Boolean),
          requiresApproval: stage.requiresApproval,
        })),
      }, undefined, submittedBase);
      const saved = next.find((template) => template.id === submittedId);
      await reconcile(next, `Saved the ${submittedLabel} template.`);
      if (saved && draftId === submittedId && editingBase === submittedBase) {
        editingId = saved.id;
        editingBase = saved;
      }
      if (unchanged() && !refreshRequired) editing = false;
    } catch (cause) {
      mutationFailure(cause, 'Could not save the investigation template.');
    } finally {
      saving = false;
      await tick();
      restoreSubmittedFocus(origin, refreshRequired ? document.getElementById('refresh-investigation-templates') : editing ? origin as HTMLElement | null : document.getElementById(`edit-investigation-template-${submittedId}`), componentRoot);
    }
  }

  async function saveAsNew() {
    const form = document.getElementById('investigation-template-editor');
    if (!orphanedDraft || saving || refreshRequired || !(form instanceof HTMLFormElement) || !form.reportValidity()) return;
    draft.changed();
    draftId = crypto.randomUUID();
    editingId = '';
    editingBase = null;
    await save();
  }

  async function remove(template: InvestigationTemplate) {
    if (saving || refreshRequired) return;
    if (!confirm(`Delete the ${template.label} investigation template?`)) return;
    const origin = document.activeElement;
    const submitted = $state.snapshot(template);
    const unchanged = draft.capture();
    saving = true;
    try {
      const next = await deleteInvestigationTemplate(template.id, submitted);
      await reconcile(next, `Deleted the ${template.label} template.`);
      if (editingId === template.id && unchanged()) editing = false;
    } catch (cause) {
      mutationFailure(cause, 'Could not delete the investigation template.');
    } finally {
      saving = false;
      await tick();
      restoreSubmittedFocus(origin, refreshRequired ? document.getElementById('refresh-investigation-templates') : origin?.isConnected ? origin as HTMLElement : componentRoot?.querySelector<HTMLButtonElement>('.template-list button') ?? document.getElementById('new-investigation-template'), componentRoot);
    }
  }

  async function download() {
    try {
      await exportInvestigationTemplates();
      message = 'Exported the investigation-template collection.';
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not export investigation templates.';
    }
  }

  function downloadPlaybook(template: InvestigationTemplate) {
    try {
      exportCacaoInvestigationTemplate(template);
      message = `Exported ${template.label} as a restricted manual CACAO playbook.`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'Could not export the investigation playbook.';
    }
  }

  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || saving || refreshRequired) return;
    saving = true;
    try {
      if (file.size > MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES) {
        throw new Error('Investigation-template imports are limited to 384 KiB.');
      }
      const result = await importInvestigationTemplates(parseBoundedJson(await file.text(), {
        label: 'Investigation-template import',
        maximumBytes: MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES,
      }));
      await reconcile(result.templates, `Imported ${result.added} new and ${result.updated} matching template${result.added + result.updated === 1 ? '' : 's'}.`);
    } catch (cause) {
      mutationFailure(cause, 'Investigation-template import failed.');
    } finally {
      input.value = '';
      saving = false;
    }
  }
</script>

<section class="template-manager card" bind:this={componentRoot} aria-labelledby="template-manager-title" aria-busy={loadState === 'loading' || saving}>
  <header>
    <div>
      <p class="eyebrow">Saved templates</p>
      <h2 id="template-manager-title">Investigation templates</h2>
      <p>Adapt an existing bounded guide. Templates can change guidance, omit steps, or add approval gates, but cannot run code, start requests, submit evidence, or remove a required gate. A restricted CACAO export contains manual steps only.</p>
    </div>
    <div class="toolbar">
      <button id="new-investigation-template" class="btn" type="button" onclick={beginNew} disabled={loadState !== 'ready'}>New template</button>
      <button class="btn" type="button" onclick={download} disabled={loadState !== 'ready' || !templates.length}>Export</button>
      <label class="btn file-btn" class:disabled={loadState !== 'ready' || saving || refreshRequired} aria-disabled={loadState !== 'ready' || saving || refreshRequired}>Import<input type="file" accept="application/json,.json" onchange={importFile} disabled={loadState !== 'ready' || saving || refreshRequired}></label>
    </div>
  </header>
  {#if refreshRequired}<button id="refresh-investigation-templates" class="btn" type="button" onclick={retryRefresh} disabled={saving}>Refresh saved templates</button>{/if}

  {#if loadState === 'unavailable'}
    <p class="empty warn" role="status">Saved investigation templates are unavailable. The standard guides remain available; reload the Dashboard to retry browser-local storage.</p>
  {:else if loadState === 'loading'}
    <p class="empty" role="status">Loading saved investigation templates.</p>
  {:else if templates.length}
    <ul class="template-list">
      {#each templates as template}
        <li>
          <div><strong>{template.label}</strong><span>{INVESTIGATION_RECIPES.find((item) => item.id === template.recipeId)?.label} · {template.stages.length} step{template.stages.length === 1 ? '' : 's'}</span></div>
          <div class="row-actions">
            <button id={`edit-investigation-template-${template.id}`} class="btn small" type="button" onclick={() => beginEdit(template)}>Edit</button>
            <button class="btn small" type="button" onclick={() => downloadPlaybook(template)}>CACAO</button>
            <button class="btn small danger" type="button" onclick={() => remove(template)} disabled={saving || refreshRequired}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {:else if !editing}
    <p class="empty">No custom templates are saved. The six fixed standard guides remain available.</p>
  {/if}

  {#if editing}
    <form id="investigation-template-editor" oninput={draft.changed} onchange={draft.changed} onsubmit={save}>
      <div class="form-heading">
        <div><p class="eyebrow">{editingId ? 'Edit template' : 'New template'}</p><h3>{editingId ? label || 'Template' : 'Create from a standard guide'}</h3></div>
        <button class="btn small" type="button" onclick={() => { draft.changed(); editing = false; }}>Cancel</button>
      </div>
      <div class="template-fields">
        <label>Base guide<select value={recipeId} onchange={changeRecipe} disabled={Boolean(editingId)}>{#each INVESTIGATION_RECIPES as item}<option value={item.id}>{item.label}</option>{/each}</select></label>
        <label>Template name<input id="investigation-template-name" bind:value={label} maxlength="80" required placeholder="Focused supplier review"></label>
        <label class="wide">Summary<textarea bind:value={summary} maxlength="400" rows="2" placeholder={recipe?.summary}></textarea></label>
      </div>
      <div class="stage-editor">
        {#each stages as stage,index}
          <details open={index === 0}>
            <summary>Step {index + 1}: {stage.label}</summary>
            <label class="include-step"><input type="checkbox" bind:checked={stage.enabled}> Include this allowlisted step</label>
            <fieldset disabled={!stage.enabled}>
              <label>Step label<input bind:value={stage.label} maxlength="100" required={stage.enabled}></label>
              <label>Purpose<textarea bind:value={stage.detail} maxlength="400" rows="2"></textarea></label>
              <label>Expected evidence<textarea bind:value={stage.expectedEvidence} maxlength="500" rows="2"></textarea></label>
              <label>Completion criteria<textarea bind:value={stage.completionCriteria} maxlength="500" rows="2"></textarea></label>
              <label>Instructions, one per line<textarea bind:value={stage.instructions} maxlength="1440" rows="4"></textarea></label>
              <label class="approval"><input type="checkbox" bind:checked={stage.requiresApproval} disabled={stage.approvalRequired}> Require approval before opening this request step{stage.approvalRequired ? ' (mandatory)' : ''}</label>
            </fieldset>
          </details>
        {/each}
      </div>
      {#if orphanedDraft}
        <p>The saved template was deleted. Your draft is still available and can be saved with a new identity.</p>
        <button class="primary" type="button" onclick={saveAsNew} disabled={saving || refreshRequired}>Save as new template</button>
      {:else}
        <button class="primary" type="submit" disabled={saving || refreshRequired}>Save template</button>
      {/if}
    </form>
  {/if}
  <p class="message" role="status">{message}</p>
</section>

<style>
  .template-manager{margin-top:28px;padding:21px}
  header,.form-heading,.template-list li,.row-actions{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .form-heading>div{min-width:0}.form-heading>button,.toolbar>*,.row-actions>*{flex-shrink:0}.row-actions{flex-wrap:wrap}
  header{flex-wrap:wrap}header>div:first-child{flex:1 1 24rem;min-width:0;max-width:720px}header>.toolbar{flex:none;max-width:100%}
  h2,h3,.eyebrow{margin:0}
  header p:not(.eyebrow),.empty{margin:7px 0 0;color:var(--muted);font-size:var(--text-sm);line-height:1.55}
  .template-list{display:grid;gap:7px;margin:18px 0 0;padding:0;list-style:none}
  .template-list li{align-items:center;padding:11px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  .template-list li>div:first-child{display:grid;gap:3px;min-width:0}
  .template-list strong{font:700 var(--text-sm) var(--mono);overflow-wrap:anywhere}
  .template-list span{color:var(--muted);font-size:var(--text-2xs)}
  form{margin-top:18px;padding-top:18px;border-top:1px solid var(--border)}
  .template-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}
  .template-fields label,.stage-editor fieldset>label{display:grid;gap:5px;font:700 var(--text-xs) var(--mono)}
  .template-fields .wide{grid-column:1/-1}
  .stage-editor{display:grid;gap:8px;margin:14px 0}
  .stage-editor details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)}
  .stage-editor summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px;font:700 var(--text-xs) var(--mono)}
  .include-step,.approval{display:flex;align-items:center;gap:7px}
  .include-step{padding:0 11px 9px;font:700 var(--text-2xs) var(--mono)}
  .stage-editor fieldset{display:grid;gap:9px;margin:0;padding:0 11px 12px;border:0}
  .stage-editor fieldset:disabled{opacity:.58}
  .approval{color:var(--muted);font-size:var(--text-2xs)}
  textarea{resize:vertical}
  .file-btn.disabled{cursor:not-allowed;opacity:.48}
  .file-btn.disabled input[type='file']{cursor:not-allowed}
  .message:empty{display:none}
  @media(max-width:700px){header,.template-list li{align-items:stretch;flex-direction:column}header>div:first-child{flex-basis:auto}.toolbar,.row-actions{width:100%}.toolbar>*,.row-actions>*{flex:1 0 auto}.template-fields{grid-template-columns:1fr}.template-fields .wide{grid-column:auto}}
</style>
