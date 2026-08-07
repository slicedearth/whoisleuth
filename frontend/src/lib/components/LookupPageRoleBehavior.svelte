<script lang="ts">
  import { evidenceStatusTone } from '$lib/analysis/evidence-status-tone.ts';
  type RoleFinding = {
    role: string;
    label: string;
    confidence: string;
    evidence: string[];
  };
  type BehaviorIndicator = {
    id: string;
    label: string;
    evidenceClass: string;
    occurrences: number;
    explanation: string;
  };
  type ScriptSummary = {
    elementsObserved: number;
    referencedScripts: number;
    inlineScripts: number;
    moduleScripts: number;
  };

  let {
    roleStatus,
    roleComplete,
    primaryRole,
    roles,
    roleLimitations,
    behaviorStatus,
    behaviorComplete,
    scripts,
    indicators,
    behaviorLimitations,
  }: {
    roleStatus: string;
    roleComplete: boolean;
    primaryRole: string;
    roles: RoleFinding[];
    roleLimitations: string[];
    behaviorStatus: string;
    behaviorComplete: boolean;
    scripts: ScriptSummary;
    indicators: BehaviorIndicator[];
    behaviorLimitations: string[];
  } = $props();
</script>

<details class="role-behavior-card evidence-card card" aria-labelledby="page-role-behavior-title">
  <summary class="evidence-summary">
    <span class="evidence-summary-row">
      <span class="evidence-summary-copy">
        <span class="eyebrow">Deep-scan evidence</span>
        <span class="evidence-summary-title" id="page-role-behavior-title" role="heading" aria-level="4">Page role and client behaviour</span>
        <span class="evidence-summary-detail">{primaryRole} · {indicators.length} static behaviour indicator{indicators.length === 1 ? '' : 's'}</span>
      </span>
      <span class="evidence-status {evidenceStatusTone(roleStatus === behaviorStatus ? roleStatus : 'partial', { complete: roleComplete && behaviorComplete })}">{roleStatus === behaviorStatus ? roleStatus : `${roleStatus} / ${behaviorStatus}`}</span>
    </span>
  </summary>

  <div class="evidence-body">
    <section aria-labelledby="role-profile-title">
      <div class="section-heading">
        <div><span class="eyebrow">Heuristic classification</span><h5 id="role-profile-title">Observed page roles</h5></div>
        <span class="profile-count">{roles.length}</span>
      </div>
      <div class="role-grid">
        {#each roles as role}
          <article>
            <span class="role-label">{role.label}</span>
            <strong>{role.confidence}</strong>
            <ul>{#each role.evidence as item}<li>{item}</li>{/each}</ul>
          </article>
        {/each}
      </div>
      {#if roleLimitations.length}<p class="callout info">{roleLimitations.join(' ')}</p>{/if}
    </section>

    <section aria-labelledby="client-behavior-title">
      <div class="section-heading">
        <div><span class="eyebrow">Static script review</span><h5 id="client-behavior-title">Client-side behaviour</h5></div>
        <span class="profile-count">{indicators.length}</span>
      </div>
      <div class="script-grid stat-grid">
        <article><small>Script elements</small><strong>{scripts.elementsObserved}</strong></article>
        <article><small>Referenced</small><strong>{scripts.referencedScripts}</strong></article>
        <article><small>Inline</small><strong>{scripts.inlineScripts}</strong></article>
        <article><small>Modules</small><strong>{scripts.moduleScripts}</strong></article>
      </div>
      {#if indicators.length}
        <ul class="indicator-list">
          {#each indicators as indicator}
            <li>
              <span><strong>{indicator.label}</strong><small>{indicator.evidenceClass} · {indicator.occurrences} observed</small></span>
              <p>{indicator.explanation}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-state">No fixed behaviour indicator matched the retained static evidence. Referenced scripts were not inspected.</p>
      {/if}
      {#if behaviorLimitations.length}<p class="callout info">{behaviorLimitations.join(' ')}</p>{/if}
    </section>
  </div>
</details>

<style>
  .evidence-body{display:grid;gap:18px}
  .evidence-body section+section{padding-top:18px;border-top:1px solid var(--border)}
  .section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
  .section-heading h5{margin:2px 0 0;font-size:var(--text-sm)}
  .profile-count{display:grid;min-width:28px;height:28px;place-items:center;border:1px solid var(--border);border-radius:999px;color:var(--accent);font:700 var(--text-xs)/1 var(--mono)}
  .role-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
  .role-grid article{padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel-raised)}
  .role-grid .role-label{display:block;color:var(--text);font-weight:700}
  .role-grid strong{display:block;margin-top:3px;color:var(--accent);font:600 var(--text-2xs)/1.4 var(--mono);text-transform:uppercase;letter-spacing:.06em}
  .role-grid ul{margin:8px 0 0;padding-left:17px;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .script-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
  .indicator-list{display:grid;gap:8px;margin:12px 0 0;padding:0;list-style:none}
  .indicator-list li{display:grid;grid-template-columns:minmax(160px,.55fr) minmax(0,1fr);gap:12px;padding:10px 12px;border-left:2px solid var(--accent);background:var(--panel-raised)}
  .indicator-list strong,.indicator-list small{display:block}
  .indicator-list small{margin-top:3px;color:var(--muted);font:var(--text-2xs)/1.4 var(--mono);text-transform:uppercase}
  .indicator-list p{margin:0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}
  .empty-state{margin:12px 0 0;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:650px){
    .script-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .indicator-list li{grid-template-columns:1fr;gap:6px}
  }
</style>
