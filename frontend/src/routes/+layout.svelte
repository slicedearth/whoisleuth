<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { workspaces } from '$lib/workspaces';
  import '../app.css';
  let { children } = $props();
  let session = $state<'checking'|'authenticated'|'anonymous'|'unavailable'>('checking');
  let password = $state(''); let error = $state(''); let busy = $state(false); let navOpen = $state(false);
  onMount(() => void checkSession());
  async function checkSession(){ session='checking'; try{const r=await fetch('/api/session'); if(!r.ok) throw new Error(); session=(await r.json()).authenticated?'authenticated':'anonymous';}catch{session='unavailable';}}
  async function login(e:SubmitEvent){e.preventDefault();busy=true;error='';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const b=await r.json().catch(()=>({}));if(!r.ok)throw new Error(b.error||'Sign-in failed');session='authenticated';password='';}catch(e){error=e instanceof Error?e.message:'Sign-in failed';}finally{busy=false;}}
  async function logout(){try{await fetch('/api/logout',{method:'POST'});}finally{session='anonymous';}}
</script>
{#if session==='checking'}<div class="center"><div class="mark">W</div><p>Opening workspace…</p></div>
{:else if session==='anonymous'}<div class="center"><form class="login card" onsubmit={login}><div class="mark">W</div><p class="eyebrow">Protected workspace</p><h1>Sign in to WHOISleuth</h1><p class="muted">Enter the deployment password to access investigation tools.</p><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" bind:value={password}>{#if error}<p class="error">{error}</p>{/if}<button class="primary" disabled={busy||!password}>{busy?'Signing in…':'Sign in'}</button></form></div>
{:else if session==='unavailable'}<div class="center"><section class="login card"><h1>Session service unavailable</h1><button class="primary" onclick={checkSession}>Retry</button></section></div>
{:else}<div class="shell" class:open={navOpen}><header><a href="/"><span class="mark small">W</span><strong>WHOISleuth</strong></a><button aria-label="Toggle navigation" aria-expanded={navOpen} onclick={()=>navOpen=!navOpen}>☰</button></header><aside><a class="brand" href="/"><span class="mark">W</span><span><strong>WHOISleuth</strong><small>Domain intelligence</small></span></a><nav><p class="eyebrow">Workspaces</p>{#each workspaces as item}<a class:active={page.url.pathname===item.href} href={item.href} onclick={()=>navOpen=false}><strong>{item.label}</strong><small>{item.detail}</small></a>{/each}</nav><div class="session">Session active <button onclick={logout}>Sign out</button></div></aside>{#if navOpen}<button class="scrim" aria-label="Close navigation" onclick={()=>navOpen=false}></button>{/if}<main>{@render children()}</main></div>{/if}
