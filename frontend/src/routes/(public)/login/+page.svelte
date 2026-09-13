<script lang="ts">
  import { onMount } from 'svelte';
  import { afterNavigate, goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import { requestJsonCapped, SMALL_JSON_RESPONSE_BYTES } from '$lib/bounded-json-response';
  import { protectedReturnTarget } from '$lib/workspaces';
  import { isLocalApplication } from '$lib/local-application-context.ts';

  let password=$state('');
  let error=$state('');
  let busy=$state(false);
  let checking=$state(true);
  let localApplication=$state(false);

  function returnTarget(){
    return protectedReturnTarget(page.url.searchParams.get('next'),page.url.origin);
  }

  let initialised = false;
  let openingLocal = false;
  onMount(() => {
    // A launch link pasted into this already-open page can be a native
    // fragment navigation, which does not run the router's lifecycle.
    const launchChanged = () => {
      if (initialised && localApplication && window.location.hash && !openingLocal) void openLocalSession();
    };
    window.addEventListener('hashchange', launchChanged);
    return () => window.removeEventListener('hashchange', launchChanged);
  });
  afterNavigate(()=>{
    localApplication=isLocalApplication();
    if (localApplication && window.location.hash && !openingLocal) {
      initialised = true;
      void openLocalSession();
      return;
    }
    if (initialised) return;
    initialised = true;
    void (localApplication ? openLocalSession() : checkSession());
  });

  async function openLocalSession() {
    if (openingLocal) return;
    openingLocal = true;
    let token=window.location.hash.slice(1);
    checking=true;
    try {
      replaceState('/login', page.state);
      if (!token) { await checkSession(); return; }
      if (!/^[a-f0-9]{64}$/u.test(token)) throw new Error('Invalid launch link.');
      const { response }=await requestJsonCapped('/api/local-session', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}) }, {maximumBytes:SMALL_JSON_RESPONSE_BYTES,timeoutMs:15_000});
      token='';
      if (!response.ok) throw new Error('Invalid launch link.');
      window.location.replace('/dashboard');
    } catch { error='This launch link is no longer valid. Use the link shown by the running local application.'; }
    finally { token=''; checking=false; openingLocal=false; }
  }

  async function checkSession(){
    checking=true;
    try{
      const { response, body }=await requestJsonCapped('/api/session',{cache:'no-store'},{maximumBytes:SMALL_JSON_RESPONSE_BYTES,timeoutMs:10_000});
      const record=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
      if(response.ok&&record.authenticated===true){await goto(returnTarget(),{replaceState:true});return;}
    }catch{
      error=localApplication ? 'The local application could not be reached. Check that it is still running.' : 'The session service could not be reached. You can still try to sign in.';
    }finally{checking=false;}
  }

  async function login(event:SubmitEvent){
    event.preventDefault();busy=true;error='';
    try{
      const { response, body }=await requestJsonCapped('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})},{maximumBytes:SMALL_JSON_RESPONSE_BYTES,timeoutMs:15_000});
      const record=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:{};
      if(!response.ok)throw new Error(typeof record.error==='string'?record.error:'Sign-in failed');
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
  <div class="login-copy"><p class="eyebrow">{localApplication ? 'Local application' : 'Protected console'}</p><h1 id="login-title">Continue to WHOISleuth</h1><p>{localApplication ? 'Open the filesystem workspace selected in your terminal.' : 'Sign in to investigate domains and manage browser-local work.'}</p><a href="/demo">Explore the synthetic demo first <span aria-hidden="true">→</span></a></div>
  {#if localApplication}
    <section class="login card" aria-labelledby="local-session-title"><div class="mark"><BrandMark /></div><h2 id="local-session-title">Open local workspace</h2><p class="muted">Use the private launch link shown in the terminal. It works only while that application instance is running; a hosting password is not needed.</p>{#if checking}<p role="status">Opening local session…</p>{/if}{#if error}<p class="error" role="alert">{error}</p>{/if}</section>
  {:else}
  <form class="login card" onsubmit={login}>
    <div class="mark"><BrandMark /></div>
    <h2>Console sign-in</h2>
    <p class="muted">Enter the deployment password.</p>
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" bind:value={password} disabled={checking||busy}>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary" disabled={checking||busy||!password}>{checking?'Checking session…':busy?'Signing in…':'Sign in'}</button>
  </form>
  {/if}
</section>

<style>
  .login-view{display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,430px);gap:clamp(40px,8vw,100px);align-items:center;min-height:calc(100vh - 300px);padding:30px 0}
  .login-copy{max-width:620px}.login-copy h1{margin:.35rem 0 1rem;font:750 clamp(2.3rem,5vw,4.3rem)/1 var(--mono);letter-spacing:-.065em}.login-copy>p:not(.eyebrow){color:var(--muted);font-size:var(--text-md);line-height:1.7}.login-copy>a{display:inline-block;margin-top:12px;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  .login{width:100%}.login h2{margin:16px 0 3px;font:700 1.35rem var(--mono)}
  @media(max-width:780px){.login-view{grid-template-columns:1fr;min-height:0}.login-copy{max-width:680px}.login{justify-self:center}}
</style>
