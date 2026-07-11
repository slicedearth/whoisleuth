<script lang="ts">
  import { goto } from '$app/navigation';
  import { activeProfile, profileDomainKind, type BrandProfile } from '$lib/brand-profiles';
  import { saveCandidateHandoff } from '$lib/candidate-handoff';
  import { buildLookupEvidence, evidenceFilename } from '../../../../public/js/evidence-export.js';
  import { compareRegistrySources } from '../../../../public/js/registry-comparison.js';
  import {
    explainOpportunityScore,
    explainRiskScore,
    fmtAge,
    fmtExpiresIn,
    formatActivityCell,
    formatPrivacyCell,
    riskTone,
    scoreTone
  } from '../../../../public/js/scoring.js';
  import { hammingDistanceHex, isInformativeFaviconHash } from '../../../../public/js/utils.js';

  type JsonRecord = Record<string, any>;
  type SourceStatus = { status?: string; errorCode?: string|null; endpoint?: string|null; httpStatus?: number|null; fetchedAt?: string|null; queriedAt?: string|null; authoritativeHop?: string|null; failedHop?: string|null; conflictingHop?: string|null; resultState?: string|null };
  type ScoreExplanation = { score:number; factors:Array<{label:string;delta:number}> }|null;
  type ComparisonField = { label:string; status:string; rdapDisplay:string; whoisDisplay:string };

  let query=$state('');
  let loading=$state(false);
  let error=$state('');
  let result=$state<JsonRecord|null>(null);
  let profile=$state<BrandProfile|null>(null);

  const rec=(value:any):JsonRecord=>value&&typeof value==='object'?value:{};
  const show=(value:any):string=>value==null||value===''?'—':Array.isArray(value)?(value.join(', ')||'—'):typeof value==='object'?show(value.name||value.org||value.handle||value.domain):String(value);
  const entries=$derived([...new Set(query.split(/[\n,;\t]+/).map(value=>value.trim()).filter(Boolean))]);
  const availability=$derived(rec(result?.availability));
  const rdap=$derived(rec(result?.rdap));
  const whois=$derived(rec(result?.whois));
  const rdapParsed=$derived(rec(rdap.parsed));
  const whoisParsed=$derived(rec(whois.parsed));
  const diagnostics=$derived(rec(result?.diagnostics));
  const comparison=$derived(result?.type==='domain'?compareRegistrySources(rdapParsed,whoisParsed):{fields:[],counts:{equivalent:0,conflict:0,rdap_only:0,whois_only:0,rdap_redacted:0,whois_redacted:0}});
  const profileSignals=$derived.by(()=>{
    const trusted=profileDomainKind(String(availability.domain||result?.registrableDomain||''),profile);
    if(!profile||trusted)return{trusted,faviconMatch:false,faviconNearMatch:false,reusesOfficialAssets:false};
    const exact=Boolean(availability.faviconHash&&profile.officialFaviconHash&&availability.faviconHash===profile.officialFaviconHash);
    const left=availability.faviconPHash,right=profile.officialFaviconPHash;
    const distance=isInformativeFaviconHash(left)&&isInformativeFaviconHash(right)?hammingDistanceHex(left,right):null;
    const official=new Set(profile.officialDomains.map(value=>value.toLowerCase().replace(/\.$/,'')));
    const reused=Array.isArray(availability.externalAssetHosts)&&availability.externalAssetHosts.some((host:string)=>official.has(String(host).toLowerCase().replace(/\.$/,'')));
    return{trusted:null,faviconMatch:exact,faviconNearMatch:!exact&&distance!==null&&distance<=8,reusesOfficialAssets:reused};
  });
  const scoredAvailability=$derived({...availability,...profileSignals});
  const opportunity=$derived(explainOpportunityScore(scoredAvailability) as ScoreExplanation);
  const risk=$derived(explainRiskScore(scoredAvailability) as ScoreExplanation);
  const sourceOnlyCount=$derived(comparison.counts.rdap_only+comparison.counts.whois_only+comparison.counts.rdap_redacted+comparison.counts.whois_redacted);

  function eventDate(action:string){return rdapParsed.events?.find((item:JsonRecord)=>item.action===action)?.date||null;}
  function created(){return availability.createdDate||eventDate('registration')||whoisParsed.createdDate;}
  function expires(){return availability.expiryDate||eventDate('expiration')||whoisParsed.expiryDate;}
  function updated(){return eventDate('last changed')||whoisParsed.updatedDate;}
  function formatDate(value:any){if(!value)return'—';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?String(value):parsed.toLocaleString();}
  function statusLabel(value:string){return value.replaceAll('_',' ');}
  function assessment(status:string){return({equivalent:'Equivalent',conflict:'Conflict',rdap_only:'RDAP only',whois_only:'WHOIS only',rdap_redacted:'RDAP redacted',whois_redacted:'WHOIS redacted'} as Record<string,string>)[status]||status;}
  function diagnosticLabel(source:SourceStatus){return source.status?source.status.replaceAll('_',' '):'unknown';}
  function diagnosticDetail(source:SourceStatus){return[source.endpoint,source.httpStatus?`HTTP ${source.httpStatus}`:null,source.resultState?`result: ${source.resultState}`:null,source.errorCode,source.authoritativeHop?`authoritative: ${show(source.authoritativeHop)}`:null,source.failedHop?`failed: ${show(source.failedHop)}`:null,source.fetchedAt?`fetched ${formatDate(source.fetchedAt)}`:null,source.queriedAt?`queried ${formatDate(source.queriedAt)}`:null].filter(Boolean).join(' · ')||'No additional source detail';}
  function signals(){const values:Array<{label:string;tone:string;detail?:string}>=[];if(profileSignals.trusted)values.push({label:`Trusted ${profileSignals.trusted}`,tone:'good'});if(profileSignals.faviconMatch)values.push({label:'Favicon match',tone:'danger'});else if(profileSignals.faviconNearMatch)values.push({label:'Favicon near-match',tone:'warn'});if(profileSignals.reusesOfficialAssets)values.push({label:'Reuses official assets',tone:'danger'});if(availability.hasPasswordField)values.push({label:'Password field',tone:'warn'});if(availability.phishingLanguageMatch)values.push({label:'Phishing language',tone:'danger',detail:availability.phishingLanguageMatch});const age=fmtAge(availability.domainAgeDays);if(age)values.push({label:age,tone:'neutral'});const expiry=fmtExpiresIn(availability.expiresInDays);if(expiry)values.push({label:expiry,tone:availability.expiresInDays<=60?'warn':'neutral'});if(availability.privacyProtected!==null&&availability.privacyProtected!==undefined)values.push({label:formatPrivacyCell(availability.privacyProtected),tone:availability.privacyProtected?'warn':'good'});if(availability.activityStatus)values.push({label:formatActivityCell(availability.activityStatus,availability.hasMx,availability.hasSpf,availability.hasDmarc),tone:availability.activityStatus==='active'?'good':availability.activityStatus==='parked'?'warn':'neutral',detail:availability.websiteProbeDetail});return values;}
  function downloadEvidence(){if(!result)return;const body=JSON.stringify(buildLookupEvidence(result),null,2);const url=URL.createObjectURL(new Blob([body],{type:'application/json'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=evidenceFilename(result);anchor.click();URL.revokeObjectURL(url);}
  async function submit(event:SubmitEvent){event.preventDefault();if(!entries.length||loading)return;if(entries.length>1){saveCandidateHandoff('manual',entries.slice(0,2000).map(domain=>({domain:domain.toLowerCase(),source:'manual input',mutationTypes:[]})));await goto('/bulk?source=lookup');return;}loading=true;error='';result=null;profile=activeProfile();try{const response=await fetch(`/api/lookup?q=${encodeURIComponent(entries[0])}`);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`Lookup failed (${response.status})`);result=body;requestAnimationFrame(()=>document.querySelector('#result')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));}catch(cause){error=cause instanceof Error?cause.message:'Lookup failed';}finally{loading=false;}}
</script>

<svelte:head><title>Lookup · WHOISleuth</title></svelte:head>
<section class="heading"><div><p class="eyebrow">Investigate</p><h1>Lookup</h1><p>Resolve a domain, IP address, or ASN through the unified RDAP and WHOIS API.</p></div></section>
<form class="search card" onsubmit={submit}>
  <label for="query">Domain, IP address, ASN, or domain list</label>
  <div class="input-row"><textarea id="query" bind:value={query} placeholder="example.com" autocomplete="off" spellcheck="false" rows="2"></textarea>{#if query}<button type="button" class="clear" aria-label="Clear query" onclick={()=>query=''}>×</button>{/if}<button class="primary" disabled={loading||!entries.length}>{loading?'Looking up…':entries.length>1?`Open ${Math.min(entries.length,2000)} in Bulk`:'Run lookup'}</button></div>
  <p class="input-help">{entries.length>1?`${entries.length} unique entries detected. Multiple entries continue in Bulk.`:'Separate multiple domains with commas, semicolons, tabs, or new lines.'}</p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

{#if result}
  <section id="result">
    <div class="result-head"><div><p class="eyebrow">Result</p><h2>{show(result.registrableDomain||result.query)}</h2>{#if result.isSubdomain}<p>Showing registry data for {result.registrableDomain}; submitted hostname: {result.inputHostname}.</p>{/if}</div><div class="result-actions"><span>{show(availability.state)}</span><button onclick={downloadEvidence}>Export evidence JSON</button></div></div>

    <div class="diagnostics" aria-label="Source diagnostics">
      {#each ['rdap','whois','availability'] as source}{@const item=rec(diagnostics[source]) as SourceStatus}<article class="card"><small>{source}</small><strong class:error-state={item.status==='error'}>{diagnosticLabel(item)}</strong><p>{diagnosticDetail(item)}</p></article>{/each}
    </div>

    {#if availability.applicable!==false}
      <section class="availability card">
        <header><div><p class="eyebrow">Assessment</p><h3>{show(availability.detail||availability.state)}</h3><p>{show(availability.confidence)} confidence</p></div><div class="scores">{#if risk}<div class="score {riskTone(risk.score)}" title={risk.factors.map(f=>`${f.label} ${f.delta>=0?'+':''}${Math.round(f.delta)}`).join('\n')}><span>Risk</span><strong>{risk.score}</strong><i><b style:width={`${risk.score}%`}></b></i></div>{/if}{#if opportunity}<div class="score {scoreTone(opportunity.score)}" title={opportunity.factors.map(f=>`${f.label} ${f.delta>=0?'+':''}${Math.round(f.delta)}`).join('\n')}><span>Opportunity</span><strong>{opportunity.score}</strong><i><b style:width={`${opportunity.score}%`}></b></i></div>{/if}</div></header>
        {#if signals().length}<div class="signals">{#each signals() as signal}<span class={signal.tone} title={signal.detail||''}>{signal.label}</span>{/each}</div>{/if}
        {#if profileSignals.trusted}<p class="trust-note">This domain is {profileSignals.trusted} in the active Brand Profile. Scores remain visible as evidence context but are not treated as an untrusted finding.</p>{/if}
        <div class="score-details">{#if risk}<details><summary>Why Risk is {risk.score}</summary><ul>{#each risk.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta>=0?'+':''}{Math.round(factor.delta)}</strong></li>{/each}</ul></details>{/if}{#if opportunity}<details><summary>Why Opportunity is {opportunity.score}</summary><ul>{#each opportunity.factors as factor}<li><span>{factor.label}</span><strong>{factor.delta>=0?'+':''}{Math.round(factor.delta)}</strong></li>{/each}</ul></details>{/if}</div>
      </section>
    {/if}

    <div class="summaries">
      <article><small>Registration</small><strong>{show(availability.state||whoisParsed.registrationStatus)}</strong><p>{show(availability.confidence)} confidence</p></article>
      <article><small>Registrar</small><strong>{show(availability.registrar||rdapParsed.registrar||whoisParsed.registrar)}</strong><p>{show(whoisParsed.registrarUrl)}</p></article>
      <article><small>Created</small><strong>{formatDate(created())}</strong><p>{fmtAge(availability.domainAgeDays)||'Registry lifecycle date'}</p></article>
      <article><small>Expires</small><strong>{formatDate(expires())}</strong><p>{fmtExpiresIn(availability.expiresInDays)||'Registry lifecycle date'}</p></article>
      <article><small>Updated</small><strong>{formatDate(updated())}</strong><p>Most recent registry change</p></article>
      <article><small>Website</small><strong>{show(availability.activityStatus)}</strong><p>{show(availability.websiteProbeDetail)}</p></article>
    </div>

    {#if comparison.fields.length}
      <details class="comparison card" open={comparison.counts.conflict>0}>
        <summary>RDAP / WHOIS comparison · {comparison.counts.conflict} conflicts · {sourceOnlyCount} source-only · {comparison.counts.equivalent} equivalent</summary>
        <div class="table-wrap"><table><thead><tr><th>Field</th><th>RDAP</th><th>WHOIS</th><th>Assessment</th></tr></thead><tbody>{#each comparison.fields as field}<tr class:conflict={field.status==='conflict'}><th scope="row">{field.label}</th><td>{field.rdapDisplay}</td><td>{field.whoisDisplay}</td><td><span class={field.status}>{assessment(field.status)}</span></td></tr>{/each}</tbody></table></div>
      </details>
    {/if}

    <div class="sources">
      <details class="card" open><summary>RDAP structured data</summary>{#if rdap.error}<p class="error source-error">{rdap.error}</p>{:else}<dl><dt>Domain</dt><dd>{show(rdapParsed.domain)}</dd><dt>Registrar</dt><dd>{show(rdapParsed.registrar)}</dd><dt>DNSSEC</dt><dd>{show(rdapParsed.dnssec)}</dd><dt>Status</dt><dd>{show(rdapParsed.statuses)}</dd><dt>Nameservers</dt><dd>{show(rdapParsed.nameservers)}</dd><dt>Registrant</dt><dd>{show(rdapParsed.registrant)}</dd><dt>Technical</dt><dd>{show(rdapParsed.technical)}</dd><dt>Abuse</dt><dd>{show(rdapParsed.abuse)}</dd></dl>{/if}</details>
      <details class="card" open><summary>WHOIS structured data</summary>{#if whois.error}<p class="error source-error">{whois.error}</p>{:else}<dl><dt>Domain</dt><dd>{show(whoisParsed.domainName)}</dd><dt>Registrar</dt><dd>{show(whoisParsed.registrar)}</dd><dt>DNSSEC</dt><dd>{show(whoisParsed.dnssec)}</dd><dt>Status</dt><dd>{show(whoisParsed.statuses)}</dd><dt>Nameservers</dt><dd>{show(whoisParsed.nameservers)}</dd><dt>Registrant</dt><dd>{show(whoisParsed.registrantName||whoisParsed.registrantOrg)}</dd><dt>Abuse</dt><dd>{show(whoisParsed.abuseEmail||whoisParsed.abusePhone)}</dd><dt>Chain</dt><dd>{show(whoisParsed.chainStatus)}</dd></dl>{/if}</details>
    </div>
    <details class="raw card"><summary>Raw unified response</summary><pre>{JSON.stringify(result,null,2)}</pre></details>
  </section>
{/if}

<style>
  .search{padding:22px}.search>label{display:block;margin-bottom:9px;font-weight:700}.input-row{position:relative;display:grid;grid-template-columns:1fr auto;gap:10px}.input-row textarea{width:100%;min-height:54px;padding:14px 48px 10px 12px;border:1px solid var(--border);border-radius:11px;background:#050e19bf;resize:vertical}.clear{position:absolute;right:137px;top:9px;width:34px;height:34px;border:0;background:none;font-size:1.25rem}.input-help{margin:8px 0 0;color:var(--muted);font-size:.68rem}.result-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:34px 0 18px}.result-head h2{margin:0;font-size:clamp(1.8rem,5vw,2.4rem);overflow-wrap:anywhere}.result-head p{margin:6px 0 0;color:var(--muted);font-size:.72rem}.result-actions{display:flex;align-items:center;gap:8px}.result-actions span,.result-actions button{padding:8px 11px;border:1px solid var(--border);border-radius:999px;background:#0c1827;text-transform:capitalize}.diagnostics,.summaries{display:grid;gap:10px}.diagnostics{grid-template-columns:repeat(3,1fr);margin-bottom:12px}.diagnostics article,.summaries article{padding:15px;border:1px solid var(--border);border-radius:14px;background:#0c1827}.diagnostics small,.diagnostics strong,.summaries small,.summaries strong{display:block}.diagnostics small,.summaries small{color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.diagnostics strong{margin-top:7px;color:var(--accent);text-transform:capitalize}.diagnostics .error-state{color:var(--danger)}.diagnostics p,.summaries p{margin-bottom:0;color:var(--muted);font-size:.66rem;overflow-wrap:anywhere}.availability{margin-bottom:12px;padding:20px}.availability header{display:flex;justify-content:space-between;gap:18px}.availability h3{margin:0}.availability header p{margin:5px 0;color:var(--muted);font-size:.7rem}.scores{display:flex;gap:9px}.score{display:grid;grid-template-columns:1fr auto;gap:3px;width:145px;padding:9px;border:1px solid var(--border);border-radius:10px}.score span{font-size:.65rem}.score strong{font-size:1rem}.score i{grid-column:1/-1;height:5px;overflow:hidden;border-radius:99px;background:#1b2d42}.score b{display:block;height:100%;background:var(--accent)}.score.danger b{background:var(--danger)}.score.warn b{background:#f2c46d}.signals{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.signals span,.comparison td span{padding:5px 7px;border:1px solid var(--border);border-radius:99px;font-size:.64rem}.signals .danger,.comparison .conflict{color:var(--danger);border-color:#ff8d9255}.signals .warn{color:#f2c46d}.signals .good,.comparison .equivalent{color:var(--accent)}.trust-note{margin:12px 0 0;padding:9px 11px;border-left:3px solid var(--accent);background:#63d6c50a;color:var(--muted);font-size:.68rem}.score-details{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.score-details details{padding:10px;border:1px solid var(--border);border-radius:9px}.score-details summary{cursor:pointer;font-size:.7rem;font-weight:700}.score-details ul{display:grid;gap:5px;margin:10px 0 0;padding:0;list-style:none}.score-details li{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:.66rem}.summaries{grid-template-columns:repeat(3,1fr)}.summaries strong{margin-top:10px;overflow-wrap:anywhere}.comparison,.sources details,.raw{padding:0;overflow:hidden}.comparison{margin-top:12px}.comparison>summary,.sources summary,.raw summary{padding:16px;cursor:pointer;font-weight:700}.table-wrap{overflow:auto;border-top:1px solid var(--border)}table{width:100%;border-collapse:collapse;font-size:.69rem}th,td{padding:10px;border-top:1px solid var(--border);text-align:left;vertical-align:top}thead th{color:var(--muted);font-size:.62rem;text-transform:uppercase}.comparison tr.conflict{background:#ff8d9208}.sources{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}dl{display:grid;grid-template-columns:95px 1fr;gap:9px;margin:0;padding:0 16px 16px;font-size:.7rem}dd{margin:0;overflow-wrap:anywhere}.source-error{padding:0 16px}.raw{margin-top:12px}pre{max-height:520px;overflow:auto;margin:0;padding:18px;border-top:1px solid var(--border);font-size:.65rem}
  @media(max-width:900px){.summaries{grid-template-columns:repeat(2,1fr)}.diagnostics{grid-template-columns:1fr}.availability header{display:block}.scores{margin-top:12px}}
  @media(max-width:650px){.input-row,.summaries,.sources,.score-details{grid-template-columns:1fr}.clear{right:7px}.input-row .primary{min-height:44px}.result-head{align-items:flex-start;flex-direction:column}.result-actions{width:100%;flex-wrap:wrap}.scores{display:grid;grid-template-columns:1fr 1fr}.score{width:auto}}
</style>
