<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import { consoleDestinations } from '$lib/workspaces';

  let password=$state('');
  let error=$state('');
  let busy=$state(false);
  let checking=$state(true);
  const allowedTargets=new Set(consoleDestinations.map((item)=>item.href));

  function returnTarget(){
    const requested=page.url.searchParams.get('next');
    return requested&&allowedTargets.has(requested)?requested:'/dashboard';
  }

  onMount(()=>{void checkSession();});

  async function checkSession(){
    checking=true;
    try{
      const response=await fetch('/api/session',{cache:'no-store'});
      if(response.ok&&(await response.json()).authenticated===true){await goto(returnTarget(),{replaceState:true});return;}
    }catch{
      error='The session service could not be reached. You can still try to sign in.';
    }finally{checking=false;}
  }

  async function login(event:SubmitEvent){
    event.preventDefault();busy=true;error='';
    try{
      const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Sign-in failed');
      password='';
      await goto(returnTarget(),{replaceState:true});
    }catch(cause){error=cause instanceof Error?cause.message:'Sign-in failed';}
    finally{busy=false;}
  }
</script>

<PublicSeo
  title="Sign in | WHOISleuth"
  description="Sign in to the protected WHOISleuth investigation console."
  path="/login"
  indexable={false}
/>

<section class="login-view" aria-labelledby="login-title">
  <div class="login-copy"><p class="eyebrow">Protected console</p><h1 id="login-title">Continue to WHOISleuth.</h1><p>The public overview and synthetic demo make no live investigation request. Sign in to use registry, DNS, certificate, website, monitoring, and brand-analysis tools.</p><a href="/demo">Explore the synthetic demo first <span aria-hidden="true">→</span></a></div>
  <form class="login card" onsubmit={login}>
    <div class="mark"><img src="/favicon.svg" alt=""></div>
    <h2>Console sign-in</h2>
    <p class="muted">Enter the deployment password.</p>
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" bind:value={password} disabled={checking||busy}>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary" disabled={checking||busy||!password}>{checking?'Checking session…':busy?'Signing in…':'Sign in'}</button>
    <p class="form-links"><a href="/">Public overview</a><span aria-hidden="true">·</span><a href="/privacy">Privacy</a></p>
  </form>
</section>

<style>
  .login-view{display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,430px);gap:clamp(40px,8vw,100px);align-items:center;min-height:calc(100vh - 300px);padding:30px 0}
  .login-copy{max-width:620px}.login-copy h1{margin:.35rem 0 1rem;font:750 clamp(2.3rem,5vw,4.3rem)/1 var(--mono);letter-spacing:-.065em}.login-copy>p:not(.eyebrow){color:var(--muted);font-size:var(--text-md);line-height:1.7}.login-copy>a{display:inline-block;margin-top:12px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  .login{width:100%}.login h2{margin:16px 0 3px;font:700 1.35rem var(--mono)}.form-links{display:flex;justify-content:center;gap:8px;margin:18px 0 0;color:var(--muted);font-size:var(--text-xs)}.form-links a{color:var(--accent)}
  @media(max-width:780px){.login-view{grid-template-columns:1fr;min-height:0}.login-copy{max-width:680px}.login{justify-self:center}}
</style>
