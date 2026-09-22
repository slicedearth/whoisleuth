<script lang="ts">
  import { tick } from 'svelte';
  import { parseBoundedJson } from '$lib/bounded-json';
  import { createDraftRevision, restoreSubmittedFocus } from '$lib/controllers/submitted-draft';
  import { failedLocalMutationOutcome, LocalRecordConflictError } from '$lib/local-mutation-outcome';
  import { INVESTIGATION_RECIPES, type InvestigationRecipeId } from '$lib/analysis/investigation-guide.ts';
  import { prepareTemplateLessonRevision } from '../../../../packages/workspace/template-lesson-revision.mts';
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

  let { templates, loadState, onchange, lessonSource }: {
    templates: InvestigationTemplate[];
    loadState: 'loading' | 'ready' | 'unavailable';
    onchange: (templates: InvestigationTemplate[]) => void | Promise<void>;
    lessonSource?: { identity: string; body: string };
  } = $props();
  let editing = $state(false);
  let editingId = $state('');
  let draftId = $state('');
  let editingBase = $state.raw<InvestigationTemplate | null>(null);
  let sourceBase = $state.raw<InvestigationTemplate | null>(null);
  let applicability = $state('');
  let rationale = $state('');
  let prepared = $state.raw<Awaited<ReturnType<typeof prepareTemplateLessonRevision>> | null>(null);
  let preparedSignature = $state('');
  let committedLesson = $state<{ id: string; signature: string } | null>(null);
  let recipeId = $state<InvestigationRecipeId>('new_domain_triage');
  let label = $state('');
  let summary = $state('');
  let stages = $state<StageDraft[]>([]);
  let message = $state('');
  let saving = $state(false);
  let refreshRequired = $state(false);
  let componentRoot = $state<HTMLElement>();
  const draft = createDraftRevision(() => `${draftId}:${lessonSource?.identity ?? ''}:${lessonSource?.body ?? ''}`);
  const recipe = $derived(INVESTIGATION_RECIPES.find((candidate) => candidate.id === recipeId) || INVESTIGATION_RECIPES[0]);
  const orphanedDraft = $derived(loadState === 'ready' && editingBase !== null && !templates.some((template) => template.id === editingBase?.id));
  const sourceChanged = $derived(sourceBase !== null && JSON.stringify(templates.find(item => item.id === sourceBase?.id)) !== JSON.stringify(sourceBase));
  const previewCurrent = $derived(prepared !== null && preparedSignature === signature());

  function changed() { draft.changed(); prepared = null; }
  function proposedTemplate() {
    return { id: draftId, recipeId, label: label.trim(), summary: summary.trim(),
      stages: stages.map(stage => ({ id: stage.id, enabled: stage.enabled, label: stage.label.trim(), detail: stage.detail.trim(),
        expectedEvidence: stage.expectedEvidence.trim(), completionCriteria: stage.completionCriteria.trim(),
        instructions: stage.instructions.split('\n').map(item => item.trim()).filter(Boolean), requiresApproval: stage.requiresApproval })) };
  }
  function signature() { return JSON.stringify([proposedTemplate(), applicability, rationale, lessonSource]); }

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
    committedLesson = null;
    draft.changed();
    editing = true;
    editingId = '';
    draftId = crypto.randomUUID();
    editingBase = null;
    sourceBase = null;
    prepared = null;
    recipeId = 'new_domain_triage';
    label = '';
    summary = '';
    stages = stageDrafts(recipeId);
    message = '';
  }

  function beginEdit(template: InvestigationTemplate) {
    committedLesson = null;
    draft.changed();
    editing = true;
    editingId = template.id;
    draftId = lessonSource ? crypto.randomUUID() : template.id;
    editingBase = lessonSource ? null : $state.snapshot(template);
    sourceBase = lessonSource ? $state.snapshot(template) : null;
    prepared = null;
    applicability = '';
    rationale = '';
    recipeId = template.recipeId;
    label = lessonSource ? `${template.label.slice(0, 65)} — revised` : template.label;
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
      if (committedLesson) {
        if (draftId === committedLesson.id && signature() === committedLesson.signature) editing = false;
        else if (draftId === committedLesson.id) {
          draftId = crypto.randomUUID();
          message += ' Newer edits remain in a separate unsaved revision.';
        }
        prepared = null;
        committedLesson = null;
      }
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
    if (saving || refreshRequired || (lessonSource && (!previewCurrent || sourceChanged))) return;
    saving = true;
    const unchanged = draft.capture();
    const submittedLabel = label.trim();
    const submittedId = draftId;
    const submittedBase = editingBase;
    const submittedSignature = signature();
    const origin = document.activeElement;
    message = '';
    try {
      const next = await saveInvestigationTemplate(lessonSource ? prepared!.candidate : proposedTemplate(), undefined, submittedBase, sourceBase ?? undefined);
      if (lessonSource) committedLesson = { id: submittedId, signature: submittedSignature };
      prepared = null;
      const saved = next.find((template) => template.id === submittedId);
      await reconcile(next, `Saved the ${submittedLabel} template.`);
      if (!lessonSource && saved && draftId === submittedId && editingBase === submittedBase) {
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

  async function prepareRevision() {
    const form = document.getElementById('investigation-template-editor');
    if (!lessonSource || !sourceBase || sourceChanged || saving || refreshRequired || !(form instanceof HTMLFormElement) || !form.reportValidity()) return;
    const submittedSignature = signature();
    const unchanged = draft.capture();
    const origin = document.activeElement;
    prepared = null;
    saving = true;
    message = '';
    try {
      const next = await prepareTemplateLessonRevision(sourceBase, proposedTemplate(), lessonSource.body, { applicability, rationale });
      if (unchanged() && signature() === submittedSignature) { prepared = next; preparedSignature = submittedSignature; }
    } catch (cause) { message = cause instanceof Error ? cause.message : 'Could not prepare the template revision.'; }
    finally {
      saving = false;
      await tick();
      if (prepared) restoreSubmittedFocus(origin, document.getElementById('template-revision-preview'), componentRoot);
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
      const skipped = result.skipped ? ` Skipped ${result.skipped} older, same-time, invalid or over-limit template${result.skipped === 1 ? '' : 's'}; local templates were retained.` : '';
      await reconcile(result.templates, `Imported ${result.added} new and ${result.updated} newer template${result.added + result.updated === 1 ? '' : 's'}.${skipped}`);
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
      {#if lessonSource}<h3 id="template-manager-title">Revise a template using this lesson</h3>{:else}<h2 id="template-manager-title">Investigation templates</h2>{/if}
      <p>{lessonSource ? 'Choose a template, edit its guidance, then review the changes. The original is kept. Only what you write here and content hashes enter the revision; the selected note is not copied automatically.' : 'Adapt an existing guide and its completion criteria. Required request approvals remain in place. JSON and CACAO exports contain manual guidance, not executable actions.'}</p>
    </div>
    {#if !lessonSource}
    <div class="toolbar">
      <button id="new-investigation-template" class="btn" type="button" onclick={beginNew} disabled={loadState !== 'ready'}>New template</button>
      <button class="btn" type="button" onclick={download} disabled={loadState !== 'ready' || !templates.length}>Export</button>
      <label class="btn file-btn" class:disabled={loadState !== 'ready' || saving || refreshRequired} aria-disabled={loadState !== 'ready' || saving || refreshRequired}>Import<input type="file" accept="application/json,.json" onchange={importFile} disabled={loadState !== 'ready' || saving || refreshRequired}></label>
    </div>
    {/if}
  </header>
  {#if refreshRequired}<button id="refresh-investigation-templates" class="btn" type="button" onclick={retryRefresh} disabled={saving}>Refresh saved templates</button>{/if}

  {#if loadState === 'unavailable'}
    <p class="empty warn" role="status">Saved investigation templates are unavailable. The standard guides remain available.</p>
  {:else if loadState === 'loading'}
    <p class="empty" role="status">Loading saved investigation templates.</p>
  {:else if templates.length}
    <ul class="template-list">
      {#each templates as template}
        <li>
          <div><strong>{template.label}</strong><span>{INVESTIGATION_RECIPES.find((item) => item.id === template.recipeId)?.label} · {template.stages.length} step{template.stages.length === 1 ? '' : 's'}</span>
            {#if template.lessonRevision}
              <details class="revision-provenance"><summary>Revision origin</summary>
                <p>{template.lessonRevision.applicability}</p><p>{template.lessonRevision.rationale}</p>
                <dl><dt>Source template</dt><dd>{template.lessonRevision.parentTemplateId}</dd><dt>Source content SHA-256</dt><dd>{template.lessonRevision.parentContentSha256}</dd><dt>Lesson content SHA-256</dt><dd>{template.lessonRevision.lessonContentSha256}</dd></dl>
                <p>Origin recorded when this revision was created. Later edits do not re-review the lesson.</p>
              </details>
            {/if}
          </div>
          <div class="row-actions">
            <button id={`edit-investigation-template-${template.id}`} class="btn small" type="button" onclick={() => beginEdit(template)} disabled={saving || refreshRequired}>{lessonSource ? 'Revise using lesson' : 'Edit'}</button>
            {#if !lessonSource}
            <button class="btn small" type="button" onclick={() => downloadPlaybook(template)}>CACAO</button>
            <button class="btn small danger" type="button" onclick={() => remove(template)} disabled={saving || refreshRequired}>Delete</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {:else if !editing}
    <p class="empty">No custom templates are saved. {#if lessonSource}<a href="/dashboard">Create a template on the Dashboard</a> first.{:else}The standard guides remain available.{/if}</p>
  {/if}

  {#if editing}
    <form id="investigation-template-editor" oninput={changed} onchange={changed} onsubmit={save}>
      <div class="form-heading">
        <div><p class="eyebrow">{lessonSource ? 'New revision' : editingId ? 'Edit template' : 'New template'}</p><h3>{editingId ? label || 'Template' : 'Create from a standard guide'}</h3></div>
        <button class="btn small" type="button" disabled={saving} onclick={() => { changed(); editing = false; }}>Cancel</button>
      </div>
      <div class="template-fields">
        <label>Base guide<select value={recipeId} onchange={changeRecipe} disabled={Boolean(editingId)}>{#each INVESTIGATION_RECIPES as item}<option value={item.id}>{item.label}</option>{/each}</select></label>
        <label>Template name<input id="investigation-template-name" bind:value={label} maxlength="80" required placeholder="Focused supplier review"></label>
        <label class="wide">Summary<textarea bind:value={summary} maxlength="400" rows="2" placeholder={recipe?.summary}></textarea></label>
        {#if lessonSource}
          <label class="wide">When this guidance applies<textarea bind:value={applicability} maxlength="400" rows="2" required></textarea></label>
          <label class="wide">Why this revision is useful<textarea bind:value={rationale} maxlength="400" rows="2" required></textarea></label>
        {/if}
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
      {#if lessonSource}
        {#if sourceChanged}<p role="alert">The source template changed or was deleted. Your draft is kept; select the source again before preparing another revision.</p>{/if}
        <button class="btn" type="button" onclick={prepareRevision} disabled={saving || refreshRequired || sourceChanged}>Preview revision</button>
        {#if previewCurrent && prepared}
          <section class="revision-preview" id="template-revision-preview" tabindex="-1" aria-label="Template revision preview">
            <h4>Review the changes</h4>
            <p><strong>Applies to:</strong> {prepared.candidate.lessonRevision?.applicability}</p>
            <p><strong>Reason:</strong> {prepared.candidate.lessonRevision?.rationale}</p>
            <ul>{#each prepared.changes as change}<li><strong>{change.label}</strong><div class="revision-change"><p><span>Before</span>{change.before}</p><p><span>After</span>{change.after}</p></div></li>{/each}</ul>
            <p>The source template is unchanged. The saved revision and exports include this guidance and two content hashes, not the Case identity or selected note.</p>
          </section>
        {/if}
        <button class="primary" type="submit" disabled={saving || refreshRequired || !previewCurrent || sourceChanged}>Save new revision</button>
      {:else if orphanedDraft}
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
  .revision-provenance,.revision-preview{min-width:0;overflow-wrap:anywhere}
  .revision-provenance{font-size:var(--text-xs)}.revision-provenance dd{margin:0 0 8px}
  .revision-preview{margin:16px 0;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm)}
  .revision-preview ul{padding-left:18px}.revision-preview li+li{margin-top:14px}
  .revision-change{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .revision-change p{white-space:pre-wrap;margin:6px 0}.revision-change span{display:block;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:700px){.revision-change{grid-template-columns:1fr}}
  @media(max-width:700px){header,.template-list li{align-items:stretch;flex-direction:column}header>div:first-child{flex-basis:auto}.toolbar,.row-actions{width:100%}.toolbar>*,.row-actions>*{flex:1 0 auto}.template-fields{grid-template-columns:1fr}.template-fields .wide{grid-column:auto}}
</style>
