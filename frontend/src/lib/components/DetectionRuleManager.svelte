<script lang="ts">
  import { parseBoundedJson } from '$lib/bounded-json';
  import { untrack } from 'svelte';
  import type { CaseRecord } from '$lib/cases';
  import {
    createDetectionRule,
    deleteDetectionRule,
    editDetectionRule,
    evaluateCasesAgainstRules,
    exportDetectionRules,
    importDetectionRules,
    loadDetectionRules,
    previewDetectionRule,
    MAX_RULE_CONDITIONS,
    MAX_RULE_IMPORT_BYTES,
    MAX_RULE_NAME_LENGTH,
    MAX_RULE_RISK_DELTA,
    MAX_RULE_TAG_LENGTH,
    operatorsForRuleField,
    ruleFieldDefinition,
    RULE_FIELD_DEFINITIONS,
    type DetectionRule,
    type DetectionRuleCondition,
  } from '$lib/detection-rules';
  import {
    MAX_STATIC_PAGE_PATTERN_PACK_BYTES,
    REVIEWED_STATIC_PAGE_PATTERN_PACKS,
    STATIC_PAGE_PATTERN_PACK_VERSION,
    reviewedStaticPagePatternPackExport,
    staticPagePatternPackRuleExport,
    validateStaticPagePatternPack,
    type StaticPagePatternPack,
  } from '$lib/analysis/static-page-pattern-packs.ts';

  let { records, initialRules = [], caseSourceState = 'ready', onselect, oncount, onchange }:{records:CaseRecord[];initialRules?:DetectionRule[];caseSourceState?:'loading'|'ready'|'unavailable';onselect?:(record:CaseRecord)=>void;oncount?:(count:number)=>void;onchange?:(rules:DetectionRule[])=>void}=$props();
  let rules=$state<DetectionRule[]>([]);
  let name=$state('');
  let riskDelta=$state(0);
  let tag=$state('');
  let match=$state<'all'|'any'>('all');
  let conditions=$state<Array<{field:string;operator:string;value:string}>>([newCondition()]);
  let message=$state('');

  const evaluations=$derived(evaluateCasesAgainstRules(records,rules));
  const matchingEvaluations=$derived(evaluations.filter((result)=>result.matchedRules.length));
  const caseById=$derived(new Map(records.map((record)=>[record.id,record])));
  const draftConditions=$derived(conditions.map((condition)=>({
    field:condition.field,
    operator:operatorsForRuleField(condition.field).find((operator)=>operator===condition.operator)??'equals',
    value:definition(condition.field)?.kind==='number'?Number(condition.value):condition.value,
  })));
  const draftPreview=$derived(previewDetectionRule(records,rules,{name,enabled:true,match,conditions:draftConditions,riskDelta:Number(riskDelta),tag}));

  function newCondition(){return{field:'availability',operator:'equals',value:'registered'};}
  async function refresh(next?:DetectionRule[]){rules=next??await loadDetectionRules();oncount?.(rules.length);onchange?.(rules);}
  function definition(field:string){return ruleFieldDefinition(field) as null|{value:string;label:string;kind:string;values?:string[]};}
  function operatorLabel(value:string){return({equals:'equals',at_least:'at least',at_most:'at most',contains:'contains',present:'is present'} as Record<string,string>)[value]??value;}
  function updateField(index:number,value:string){const operator=operatorsForRuleField(value)[0]??'equals';const item={field:value,operator,value:operator==='present'?'true':definition(value)?.kind==='boolean'?'true':definition(value)?.values?.[0]??''};conditions=conditions.map((condition,i)=>i===index?item:condition);}
  function updateOperator(index:number,value:string){conditions=conditions.map((condition,i)=>i===index?{...condition,operator:value,value:value==='present'?'true':condition.value}:condition);}
  function addCondition(){if(conditions.length<MAX_RULE_CONDITIONS)conditions=[...conditions,newCondition()];}
  function removeCondition(index:number){if(conditions.length>1)conditions=conditions.filter((_,i)=>i!==index);}
  function resetDraft(){name='';riskDelta=0;tag='';match='all';conditions=[newCondition()];}
  async function create(){
    try{
      const normalizedConditions:DetectionRuleCondition[]=conditions.map((condition)=>({
        field:condition.field,
        operator:operatorsForRuleField(condition.field).find((operator)=>operator===condition.operator)??'equals',
        value:definition(condition.field)?.kind==='number'?Number(condition.value):condition.value,
      }));
      await refresh(await createDetectionRule({name,enabled:true,match,conditions:normalizedConditions,riskDelta:Number(riskDelta),tag}));
      message=`Created custom rule “${name.trim()}”.`;resetDraft();
    }catch(cause){message=cause instanceof Error?cause.message:'Could not create the custom rule.';}
  }
  async function toggle(rule:DetectionRule){try{await refresh(await editDetectionRule(rule.id,{enabled:!rule.enabled}));message=`${rule.enabled?'Disabled':'Enabled'} “${rule.name}”.`;}catch(cause){message=cause instanceof Error?cause.message:'Could not update the custom rule.';}}
  async function remove(rule:DetectionRule){if(!confirm(`Delete custom rule “${rule.name}”?`))return;try{await refresh(await deleteDetectionRule(rule.id));message=`Deleted “${rule.name}”.`;}catch(cause){message=cause instanceof Error?cause.message:'Could not delete the custom rule.';}}
  async function download(){try{await exportDetectionRules();message='Exported the custom-rule collection.';}catch(cause){message=cause instanceof Error?cause.message:'Could not export custom rules.';}}
  async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_RULE_IMPORT_BYTES)throw new Error('Custom-rule imports are limited to 2 MB.');const result=await importDetectionRules(parseBoundedJson(await file.text(),{label:'Custom-rule import',maximumBytes:MAX_RULE_IMPORT_BYTES}));await refresh(result.rules);message=`Imported ${result.added} new and ${result.updated} updated custom rule${result.added+result.updated===1?'':'s'}${result.skipped?`; skipped ${result.skipped} invalid or over-limit record${result.skipped===1?'':'s'}`:''}.`;}catch(cause){message=cause instanceof Error?cause.message:'Custom-rule import failed.';}finally{input.value='';}}
  async function installPack(pack:StaticPagePatternPack){try{const result=await importDetectionRules(reviewedStaticPagePatternPackExport(pack.id));await refresh(result.rules);message=`Installed or restored ${pack.rules.length} reviewed rule${pack.rules.length===1?'':'s'} from “${pack.label}”. Existing built-in Risk scores were not changed.`;}catch(cause){message=cause instanceof Error?cause.message:'Could not install the reviewed pack.';}}
  async function importPackFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_STATIC_PAGE_PATTERN_PACK_BYTES)throw new Error('Page-pattern pack imports are limited to 256 KB.');const pack=validateStaticPagePatternPack(parseBoundedJson(await file.text(),{label:'Page-pattern pack import',maximumBytes:MAX_STATIC_PAGE_PATTERN_PACK_BYTES}));const result=await importDetectionRules(staticPagePatternPackRuleExport(pack));await refresh(result.rules);message=`Installed ${result.added} new and ${result.updated} updated rule${result.added+result.updated===1?'':'s'} from the validated local pack “${pack.label}”. Built-in Risk scores were not changed.`;}catch(cause){message=cause instanceof Error?cause.message:'Page-pattern pack import failed.';}finally{input.value='';}}
  function packInstalled(pack:StaticPagePatternPack){return pack.rules.every((candidate)=>rules.some((rule)=>rule.id===candidate.id));}
  function countMatches(ruleId:string){return evaluations.filter((result)=>result.matchedRules.some((item)=>item.id===ruleId)).length;}
  function conditionLabel(condition:DetectionRuleCondition){const field=definition(condition.field)?.label??condition.field;return condition.operator==='present'?`${field} is present`:`${field} ${operatorLabel(condition.operator)} ${String(condition.value)}`;}
  function openCase(caseId:string){const record=caseById.get(caseId);if(record)onselect?.(record);}

  $effect(()=>{
    const next=initialRules;
    const reportCount=oncount;
    untrack(()=>{
      rules=next;
      reportCount?.(next.length);
    });
  });
</script>

<section class="rule-builder card">
  <header class="section-head"><div><p class="eyebrow">Custom detection</p><h2>Browser-local rules</h2><p>Combine bounded case-evidence checks without changing the built-in risk model.</p></div><div class="top-actions toolbar"><button class="btn" type="button" onclick={download} disabled={!rules.length}>Export JSON</button><label class="btn file-btn">Import JSON<input type="file" accept="application/json,.json" onchange={importFile}></label></div></header>
  <form onsubmit={(event)=>{event.preventDefault();create();}}>
    <div class="rule-fields">
      <label class="field">Name<input bind:value={name} maxlength={MAX_RULE_NAME_LENGTH} placeholder="Login page with copied assets" required></label>
      <label class="field">Match<select bind:value={match}><option value="all">All conditions</option><option value="any">Any condition</option></select></label>
      <label class="field">Custom contribution<input type="number" bind:value={riskDelta} min="0" max={MAX_RULE_RISK_DELTA} step="1"></label>
      <label class="field">Suggested tag <small>optional</small><input bind:value={tag} maxlength={MAX_RULE_TAG_LENGTH} placeholder="manual-review"></label>
    </div>
    <fieldset><legend>Conditions</legend>
      {#each conditions as condition,index}
        {@const field=definition(condition.field)}
        <div class="condition-row">
          <label><span>Field</span><select value={condition.field} onchange={(event)=>updateField(index,(event.currentTarget as HTMLSelectElement).value)}>{#each RULE_FIELD_DEFINITIONS as option}<option value={option.value}>{option.label}</option>{/each}</select></label>
          <label><span>Comparison</span><select value={condition.operator} onchange={(event)=>updateOperator(index,(event.currentTarget as HTMLSelectElement).value)}>{#each operatorsForRuleField(condition.field) as operator}<option value={operator}>{operatorLabel(operator)}</option>{/each}</select></label>
          {#if condition.operator!=='present'}
            <label><span>Value</span>
              {#if field?.kind==='boolean'}<select bind:value={condition.value}><option value="true">Yes</option><option value="false">No</option></select>
              {:else if field?.kind==='enum'}<select bind:value={condition.value}>{#each field.values??[] as value}<option {value}>{value.replaceAll('_',' ')}</option>{/each}</select>
              {:else}<input bind:value={condition.value} type={field?.kind==='number'?'number':'text'} maxlength="200" required>{/if}
            </label>
          {/if}
          <button type="button" class="btn danger remove-condition" onclick={()=>removeCondition(index)} disabled={conditions.length===1}>Remove</button>
        </div>
      {/each}
      <button type="button" class="btn" onclick={addCondition} disabled={conditions.length>=MAX_RULE_CONDITIONS}>Add condition</button>
    </fieldset>
    <button class="primary create" type="submit" disabled={!name.trim()}>Create custom rule</button>
    {#if name.trim() && draftPreview}
      <aside class="draft-preview" aria-live="polite">
        <div><strong>Preview only</strong><span>{caseSourceState === 'ready' ? `${draftPreview.matchCount} current case match${draftPreview.matchCount===1?'':'es'}` : 'Current case matches unavailable'} · custom contribution +{draftPreview.candidate.riskDelta}</span></div>
        {#if draftPreview.collisionRuleIds.length}<p class="warning">This draft overlaps {draftPreview.collisionRuleIds.length} existing rule{draftPreview.collisionRuleIds.length===1?'':'s'} by name or conditions.</p>{/if}
        {#if draftPreview.matchCount}<p>{Object.entries(draftPreview.affectedDispositionCounts).map(([value,count])=>`${count} ${value.replaceAll('_',' ')}`).join(' · ')}</p>{/if}
        <small>{draftPreview.limitation}</small>
      </aside>
    {/if}
  </form>
</section>
{#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

<section class="rule-limits card">
  <strong>Interpretation boundary</strong>
  <p>Custom contributions are shown beside the stored built-in score; they never rewrite it. A match is an analyst-defined heuristic, not proof of maliciousness. Missing evidence does not satisfy a condition, and imported rules cannot run JavaScript.</p>
</section>

<section class="pattern-packs card" aria-labelledby="pattern-packs-title">
  <header><div><p class="eyebrow">Reviewed static patterns</p><h2 id="pattern-packs-title">Page-pattern packs</h2><p>Install fixed, inspectable rules that use only evidence already retained in cases.</p></div><label class="btn file-btn">Import validated pack<input type="file" accept="application/json,.json" onchange={importPackFile}></label></header>
  <div class="pack-grid">
    {#each REVIEWED_STATIC_PAGE_PATTERN_PACKS as pack}
      <article>
        <div><strong>{pack.label}</strong><span>v{STATIC_PAGE_PATTERN_PACK_VERSION} · {pack.relationship === 'brand_relative' ? 'brand-relative' : 'generic'} · review required · {pack.rules.length} rule{pack.rules.length === 1 ? '' : 's'}</span></div>
        <p>{pack.description}</p>
        <small>{pack.evidenceBoundary}</small>
        <button type="button" class="btn" onclick={() => void installPack(pack)}>{packInstalled(pack) ? 'Restore reviewed pack' : 'Install reviewed pack'}</button>
      </article>
    {/each}
  </div>
</section>

{#if rules.length}
  <section class="rule-list" aria-label="Custom detection rules">
    {#each rules as rule (rule.id)}
      <article class="rule card" class:disabled={!rule.enabled}>
        <header><div><strong>{rule.name}</strong><small>{rule.match==='all'?'All':'Any'} of {rule.conditions.length} condition{rule.conditions.length===1?'':'s'} · {caseSourceState === 'ready' ? `${countMatches(rule.id)} current match${countMatches(rule.id)===1?'':'es'}` : 'current matches unavailable'}</small></div><div><button type="button" class="btn small" aria-pressed={rule.enabled} onclick={()=>toggle(rule)}>{rule.enabled?'Enabled':'Disabled'}</button><button type="button" class="btn small danger" onclick={()=>remove(rule)}>Delete</button></div></header>
        <ul>{#each rule.conditions as condition}<li>{conditionLabel(condition)}</li>{/each}</ul>
        <footer><span>Custom contribution <strong>+{rule.riskDelta}</strong></span>{#if rule.tag}<span>Suggested tag <strong>{rule.tag}</strong></span>{/if}</footer>
      </article>
    {/each}
  </section>
{:else}<section class="empty-state card"><h2>No custom rules yet</h2><p>Create a structured local rule to test existing case evidence without altering the built-in scoring model.</p></section>{/if}

<section class="test-results card">
  <header class="section-head"><div><p class="eyebrow">Current cases</p><h2>Rule test results</h2></div><span>{caseSourceState === 'ready' ? `${matchingEvaluations.length} of ${records.length} matched` : 'Unavailable'}</span></header>
  {#if caseSourceState !== 'ready'}
    <p class="source-unavailable">Browser-local cases {caseSourceState === 'loading' ? 'are still loading' : 'could not be read'}. Saved rules remain available, but no current match count or absence is inferred.</p>
  {:else if matchingEvaluations.length}
    <ul>{#each matchingEvaluations as result}<li><div><strong>{result.domain}</strong><small>{result.matchedRules.map((item)=>item.name).join(' · ')}</small>{#if result.suggestedTags.length}<small>Suggested: {result.suggestedTags.join(', ')}</small>{/if}</div><div class="scores"><span>Built-in {result.builtInRiskScore??'—'}</span><span>Custom +{result.customRiskDelta}</span><span>Context {result.contextualRiskScore??'—'}</span><button type="button" class="btn small" onclick={()=>openCase(result.caseId)}>Open case</button></div></li>{/each}</ul>
  {:else}<p>No enabled custom rule matches the latest evidence in the current case collection.</p>{/if}
</section>

<style>
  .rule-builder{display:grid;gap:16px;padding:18px}.rule>header{display:flex;justify-content:space-between;gap:14px;align-items:start}.rule-builder h2,.test-results h2{margin:0}.rule-builder header p:not(.eyebrow),.rule-limits p,.test-results>p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.test-results>.source-unavailable{padding:10px 12px;border:1px dotted var(--muted);border-radius:var(--radius-sm)}.rule>header>div:last-child{display:flex;flex-wrap:wrap;gap:8px}.rule-builder form{display:grid;gap:14px}.rule-fields{display:grid;grid-template-columns:minmax(180px,1.7fr) repeat(3,minmax(130px,1fr));gap:10px}.condition-row label{display:grid;gap:5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}.rule-fields input,.condition-row input{min-height:var(--control-h)}fieldset{display:grid;gap:10px;margin:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}legend{padding:0 6px;color:var(--text);font:700 var(--text-xs) var(--mono)}.condition-row{display:grid;grid-template-columns:1.4fr 1fr 1.2fr auto;gap:8px;align-items:end}.remove-condition{align-self:end}.create{justify-self:start}.draft-preview{display:grid;gap:5px;padding:11px 12px;border:1px solid color-mix(in srgb,var(--accent) 36%,var(--border));border-radius:var(--radius-sm);background:color-mix(in srgb,var(--accent) 4%,var(--panel-raised))}.draft-preview>div{display:flex;justify-content:space-between;gap:10px}.draft-preview strong{font:700 var(--text-xs) var(--mono)}.draft-preview span,.draft-preview p,.draft-preview small{margin:0;color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.draft-preview .warning{color:var(--amber)}.message{color:var(--accent);font-size:var(--text-sm)}.rule-limits{margin:12px 0;padding:14px}.rule-limits strong{font-size:var(--text-sm)}.rule-limits p{margin:5px 0 0}.rule-list{display:grid;gap:10px}.rule{display:grid;gap:10px;padding:16px}.rule.disabled{opacity:.62}.rule header>div:first-child{display:grid;gap:3px;min-width:0}.rule header strong{font:700 var(--text-md) var(--mono);overflow-wrap:anywhere}.rule header small,.rule li,.rule footer{color:var(--muted);font-size:var(--text-xs)}.rule ul{display:grid;gap:5px;margin:0;padding-left:18px}.rule footer{display:flex;flex-wrap:wrap;gap:16px;padding-top:9px;border-top:1px solid var(--border)}.rule footer strong{color:var(--text)}.test-results{display:grid;gap:12px;margin-top:12px;padding:16px}.test-results ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}.test-results li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 11px;border:1px solid var(--border);border-radius:var(--radius-sm)}.test-results li>div:first-child{display:grid;gap:3px;min-width:0}.test-results li strong{font-size:var(--text-sm);overflow-wrap:anywhere}.test-results small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}.scores{display:flex;flex-wrap:wrap;justify-content:end;gap:7px;align-items:center}.scores span{color:var(--muted);font-size:var(--text-2xs);white-space:nowrap}
  .pattern-packs{display:grid;gap:12px;margin:12px 0;padding:16px}.pattern-packs>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.pattern-packs h2{margin:0;font:700 var(--text-md) var(--mono)}.pattern-packs header p:not(.eyebrow){margin:5px 0 0;color:var(--muted);font-size:var(--text-xs)}.pack-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.pack-grid article{display:grid;gap:7px;min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}.pack-grid article>div{display:flex;justify-content:space-between;gap:8px}.pack-grid strong{font-size:var(--text-sm);overflow-wrap:anywhere}.pack-grid span,.pack-grid p,.pack-grid small{color:var(--muted);font-size:var(--text-2xs);line-height:1.45}.pack-grid p{margin:0}.pack-grid button{justify-self:start;margin-top:auto}
  @media(max-width:850px){.rule-fields{grid-template-columns:1fr 1fr}.condition-row{grid-template-columns:1fr 1fr}.remove-condition{width:100%}}
  @media(max-width:850px){.pack-grid{grid-template-columns:1fr}}
  @media(max-width:600px){.rule>header,.test-results li,.pattern-packs>header{align-items:stretch;flex-direction:column}.rule-fields,.condition-row{grid-template-columns:1fr}.rule>header>div:last-child button,.create,fieldset>.btn,.pattern-packs>header>.btn{width:100%}.scores{justify-content:start}.scores button{width:100%}.pack-grid button{width:100%}}
</style>
