<script lang="ts">
  import { onMount } from 'svelte';
  import type { CaseRecord } from '$lib/cases';
  import {
    createDetectionRule,
    deleteDetectionRule,
    editDetectionRule,
    evaluateCasesAgainstRules,
    exportDetectionRules,
    importDetectionRules,
    loadDetectionRules,
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

  let { records, onselect, oncount }:{records:CaseRecord[];onselect?:(record:CaseRecord)=>void;oncount?:(count:number)=>void}=$props();
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

  function newCondition(){return{field:'availability',operator:'equals',value:'registered'};}
  function refresh(next=loadDetectionRules()){rules=next;oncount?.(rules.length);}
  function definition(field:string){return ruleFieldDefinition(field) as null|{value:string;label:string;kind:string;values?:string[]};}
  function operatorLabel(value:string){return({equals:'equals',at_least:'at least',at_most:'at most',contains:'contains',present:'is present'} as Record<string,string>)[value]??value;}
  function updateField(index:number,value:string){const operator=operatorsForRuleField(value)[0]??'equals';const item={field:value,operator,value:operator==='present'?'true':definition(value)?.kind==='boolean'?'true':definition(value)?.values?.[0]??''};conditions=conditions.map((condition,i)=>i===index?item:condition);}
  function updateOperator(index:number,value:string){conditions=conditions.map((condition,i)=>i===index?{...condition,operator:value,value:value==='present'?'true':condition.value}:condition);}
  function addCondition(){if(conditions.length<MAX_RULE_CONDITIONS)conditions=[...conditions,newCondition()];}
  function removeCondition(index:number){if(conditions.length>1)conditions=conditions.filter((_,i)=>i!==index);}
  function resetDraft(){name='';riskDelta=0;tag='';match='all';conditions=[newCondition()];}
  function create(){
    try{
      const normalizedConditions:DetectionRuleCondition[]=conditions.map((condition)=>({field:condition.field,operator:condition.operator,value:definition(condition.field)?.kind==='number'?Number(condition.value):condition.value}));
      refresh(createDetectionRule({name,enabled:true,match,conditions:normalizedConditions,riskDelta:Number(riskDelta),tag}));
      message=`Created custom rule “${name.trim()}”.`;resetDraft();
    }catch(cause){message=cause instanceof Error?cause.message:'Could not create the custom rule.';}
  }
  function toggle(rule:DetectionRule){try{refresh(editDetectionRule(rule.id,{enabled:!rule.enabled}));message=`${rule.enabled?'Disabled':'Enabled'} “${rule.name}”.`;}catch(cause){message=cause instanceof Error?cause.message:'Could not update the custom rule.';}}
  function remove(rule:DetectionRule){if(!confirm(`Delete custom rule “${rule.name}”?`))return;try{refresh(deleteDetectionRule(rule.id));message=`Deleted “${rule.name}”.`;}catch(cause){message=cause instanceof Error?cause.message:'Could not delete the custom rule.';}}
  function download(){try{exportDetectionRules();message='Exported the custom-rule collection.';}catch(cause){message=cause instanceof Error?cause.message:'Could not export custom rules.';}}
  async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement;const file=input.files?.[0];if(!file)return;try{if(file.size>MAX_RULE_IMPORT_BYTES)throw new Error('Custom-rule imports are limited to 2 MB.');const result=importDetectionRules(JSON.parse(await file.text()));refresh(result.rules);message=`Imported ${result.added} new and ${result.updated} updated custom rule${result.added+result.updated===1?'':'s'}${result.skipped?`; skipped ${result.skipped} invalid or over-limit record${result.skipped===1?'':'s'}`:''}.`;}catch(cause){message=cause instanceof Error?cause.message:'Custom-rule import failed.';}finally{input.value='';}}
  function countMatches(ruleId:string){return evaluations.filter((result)=>result.matchedRules.some((item)=>item.id===ruleId)).length;}
  function conditionLabel(condition:DetectionRuleCondition){const field=definition(condition.field)?.label??condition.field;return condition.operator==='present'?`${field} is present`:`${field} ${operatorLabel(condition.operator)} ${String(condition.value)}`;}
  function openCase(caseId:string){const record=caseById.get(caseId);if(record)onselect?.(record);}

  onMount(()=>refresh());
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
  </form>
</section>
{#if message}<p class="message" role="status" aria-live="polite">{message}</p>{/if}

<section class="rule-limits card">
  <strong>Interpretation boundary</strong>
  <p>Custom contributions are shown beside the stored built-in score; they never rewrite it. A match is an analyst-defined heuristic, not proof of maliciousness. Missing evidence does not satisfy a condition, and imported rules cannot run JavaScript.</p>
</section>

{#if rules.length}
  <section class="rule-list" aria-label="Custom detection rules">
    {#each rules as rule (rule.id)}
      <article class="rule card" class:disabled={!rule.enabled}>
        <header><div><strong>{rule.name}</strong><small>{rule.match==='all'?'All':'Any'} of {rule.conditions.length} condition{rule.conditions.length===1?'':'s'} · {countMatches(rule.id)} current match{countMatches(rule.id)===1?'':'es'}</small></div><div><button type="button" class="btn small" aria-pressed={rule.enabled} onclick={()=>toggle(rule)}>{rule.enabled?'Enabled':'Disabled'}</button><button type="button" class="btn small danger" onclick={()=>remove(rule)}>Delete</button></div></header>
        <ul>{#each rule.conditions as condition}<li>{conditionLabel(condition)}</li>{/each}</ul>
        <footer><span>Custom contribution <strong>+{rule.riskDelta}</strong></span>{#if rule.tag}<span>Suggested tag <strong>{rule.tag}</strong></span>{/if}</footer>
      </article>
    {/each}
  </section>
{:else}<section class="empty-state card"><h2>No custom rules yet</h2><p>Create a structured local rule to test existing case evidence without altering the built-in scoring model.</p></section>{/if}

<section class="test-results card">
  <header class="section-head"><div><p class="eyebrow">Current cases</p><h2>Rule test results</h2></div><span>{matchingEvaluations.length} of {records.length} matched</span></header>
  {#if matchingEvaluations.length}
    <ul>{#each matchingEvaluations as result}<li><div><strong>{result.domain}</strong><small>{result.matchedRules.map((item)=>item.name).join(' · ')}</small>{#if result.suggestedTags.length}<small>Suggested: {result.suggestedTags.join(', ')}</small>{/if}</div><div class="scores"><span>Built-in {result.builtInRiskScore??'—'}</span><span>Custom +{result.customRiskDelta}</span><span>Context {result.contextualRiskScore??'—'}</span><button type="button" class="btn small" onclick={()=>openCase(result.caseId)}>Open case</button></div></li>{/each}</ul>
  {:else}<p>No enabled custom rule matches the latest evidence in the current case collection.</p>{/if}
</section>

<style>
  .rule-builder{display:grid;gap:16px;padding:18px}.rule>header{display:flex;justify-content:space-between;gap:14px;align-items:start}.rule-builder h2,.test-results h2{margin:0}.rule-builder header p:not(.eyebrow),.rule-limits p,.test-results>p{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.rule>header>div:last-child{display:flex;flex-wrap:wrap;gap:8px}.rule-builder form{display:grid;gap:14px}.rule-fields{display:grid;grid-template-columns:minmax(180px,1.7fr) repeat(3,minmax(130px,1fr));gap:10px}.condition-row label{display:grid;gap:5px;color:var(--muted);font:600 var(--text-2xs) var(--mono)}.rule-fields input,.condition-row input{min-height:var(--control-h)}fieldset{display:grid;gap:10px;margin:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}legend{padding:0 6px;color:var(--text);font:700 var(--text-xs) var(--mono)}.condition-row{display:grid;grid-template-columns:1.4fr 1fr 1.2fr auto;gap:8px;align-items:end}.remove-condition{align-self:end}.create{justify-self:start}.message{color:var(--accent);font-size:var(--text-sm)}.rule-limits{margin:12px 0;padding:14px}.rule-limits strong{font-size:var(--text-sm)}.rule-limits p{margin:5px 0 0}.rule-list{display:grid;gap:10px}.rule{display:grid;gap:10px;padding:16px}.rule.disabled{opacity:.62}.rule header>div:first-child{display:grid;gap:3px;min-width:0}.rule header strong{font:700 var(--text-md) var(--mono);overflow-wrap:anywhere}.rule header small,.rule li,.rule footer{color:var(--muted);font-size:var(--text-xs)}.rule ul{display:grid;gap:5px;margin:0;padding-left:18px}.rule footer{display:flex;flex-wrap:wrap;gap:16px;padding-top:9px;border-top:1px solid var(--border)}.rule footer strong{color:var(--text)}.test-results{display:grid;gap:12px;margin-top:12px;padding:16px}.test-results ul{display:grid;gap:8px;margin:0;padding:0;list-style:none}.test-results li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 11px;border:1px solid var(--border);border-radius:var(--radius-sm)}.test-results li>div:first-child{display:grid;gap:3px;min-width:0}.test-results li strong{font-size:var(--text-sm);overflow-wrap:anywhere}.test-results small{color:var(--muted);font-size:var(--text-2xs);overflow-wrap:anywhere}.scores{display:flex;flex-wrap:wrap;justify-content:end;gap:7px;align-items:center}.scores span{color:var(--muted);font-size:var(--text-2xs);white-space:nowrap}
  @media(max-width:850px){.rule-fields{grid-template-columns:1fr 1fr}.condition-row{grid-template-columns:1fr 1fr}.remove-condition{width:100%}}
  @media(max-width:600px){.rule>header,.test-results li{align-items:stretch;flex-direction:column}.rule-fields,.condition-row{grid-template-columns:1fr}.rule>header>div:last-child button,.create,fieldset>.btn{width:100%}.scores{justify-content:start}.scores button{width:100%}}
</style>
