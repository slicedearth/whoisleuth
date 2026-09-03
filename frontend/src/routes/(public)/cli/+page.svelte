<script lang="ts">
  import CopyableCommand from '$lib/components/CopyableCommand.svelte';
  import PublicCliExplorer from '$lib/components/PublicCliExplorer.svelte';
  import PublicReferenceDocument from '$lib/components/PublicReferenceDocument.svelte';
  import PublicSeo from '$lib/components/PublicSeo.svelte';
  import { PUBLIC_CLI_GUIDANCE } from '$lib/generated/public-cli-guidance';
  import { PUBLIC_CLI_INDEX } from '$lib/generated/public-cli-index';
  import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../../../../../lib/project-metadata.mts';

  const pageSections = [
    { href: '#start', label: 'Get started' },
    { href: '#tasks', label: 'Common tasks' },
    { href: '#commands', label: 'Command reference' },
    { href: '#browser-handoff', label: 'Continue in the browser' },
    { href: '#behaviour', label: 'CLI behaviour' },
    { href: '#more', label: 'More documentation' },
  ] as const;

  const jobDefinitions = [
    {
      id: 'investigate',
      label: 'Investigate',
      description: 'Collect or review evidence for a known target.',
    },
    {
      id: 'respond',
      label: 'Respond',
      description: 'Prepare reviewed local material for a deliberate handoff.',
    },
    {
      id: 'assure',
      label: 'Assure',
      description: 'Compare retained evidence or inspect a repeatable recipe.',
    },
  ] as const;

  function commandId(command: string): string {
    return command.match(/^whoisleuth\s+([^\s]+)/u)?.[1] ?? '';
  }

  const commonTaskGroups = jobDefinitions.map((job) => ({
    ...job,
    tasks: PUBLIC_CLI_GUIDANCE.commonWorkflows.filter((workflow) => {
      const metadata = PUBLIC_CLI_INDEX.commands.find((command) => command.id === commandId(workflow.command));
      return metadata?.group === job.id;
    }),
  }));
</script>

<PublicSeo
  title="WHOISleuth CLI commands | WHOISleuth"
  description="Install WHOISleuth CLI, start with common investigation tasks and browse the generated command reference."
  path="/cli"
/>

<PublicReferenceDocument
  currentHref="/cli"
  eyebrow="Command line"
  title="WHOISleuth CLI"
  summary={['Install the command, start with a common task, or browse the current command reference.']}
  sections={pageSections}
  sectionNavigation="inline"
>
  {#snippet actions()}
    <a class="primary" href="#start">Get started</a>
    <a class="btn" href="#commands">Browse all commands</a>
  {/snippet}

<section class="cli-section" id="start" aria-labelledby="start-title">
  <div class="section-intro"><p class="eyebrow">Get started</p><h2 id="start-title">Run the CLI locally</h2><p>WHOISleuth requires Node.js 24 or later. You can run it once or install the command globally.</p></div>
  <ol class="start-steps">
    <li>
      <span>1</span><div><h3>Run help without installing</h3><p>Load the package for this command only.</p><CopyableCommand command={PUBLIC_CLI_GUIDANCE.runOnce[0]} label="run-once help command" /></div>
    </li>
    <li>
      <span>2</span><div><h3>Install and check the CLI</h3><p>Install globally, then check the local runtime and configuration.</p><CopyableCommand command={PUBLIC_CLI_GUIDANCE.install[0]} label="installation command" /><CopyableCommand command={PUBLIC_CLI_GUIDANCE.install[1]} label="runtime check command" compact /></div>
    </li>
    <li>
      <span>3</span><div><h3>Inspect a request before running it</h3><p>Show planned sources and limits without starting collection.</p><CopyableCommand command={PUBLIC_CLI_GUIDANCE.runOnce[1]} label="lookup plan command" /></div>
    </li>
  </ol>
  <div class="start-notes independent-grid">
    <p>Use <code>whoisleuth &lt;command&gt; --help</code> for the exact options installed on your machine.</p>
    <details class="update-instructions"><summary>Update an installed package</summary><div>{#each PUBLIC_CLI_GUIDANCE.update as command}<CopyableCommand {command} label="update command" compact />{/each}</div></details>
  </div>
</section>

<section class="cli-section" id="tasks" aria-labelledby="tasks-title">
  <div class="section-intro"><p class="eyebrow">Common tasks</p><h2 id="tasks-title">Start with what you need to do</h2><p>Examples use reserved domains or local files chosen by the user.</p></div>
  <div class="task-groups">
    {#each commonTaskGroups as group}
      <section aria-labelledby={`task-group-${group.id}`}>
        <header><h3 id={`task-group-${group.id}`}>{group.label}</h3><p>{group.description}</p></header>
        <ul>{#each group.tasks as task}<li><strong>{task.label}</strong><CopyableCommand command={task.command} label={`${task.label} command`} compact /></li>{/each}</ul>
      </section>
    {/each}
  </div>
</section>

<section class="cli-section" id="commands" aria-label="Command reference">
  <PublicCliExplorer />
</section>

<section class="cli-section browser-handoff" id="browser-handoff" aria-labelledby="browser-handoff-title">
  <div class="section-intro"><p class="eyebrow">CLI to browser</p><h2 id="browser-handoff-title">Continue a saved Lookup in a Case</h2><p>Keep the collected document local, replay its bounded evidence in the browser, then decide what belongs in the Case.</p></div>
  <CopyableCommand command="whoisleuth lookup example.test --deep --browse --save-lookup lookup.json" label="save a completed Lookup for browser replay" />
  <ol>
    <li><span>1</span><div><strong>Save after review</strong><p>The file is written only after the interactive Lookup completes and closes normally. Treat it as private investigation material.</p></div></li>
    <li><span>2</span><div><strong>Replay in Lookup</strong><p>Open Console Lookup, expand <em>Replay exported evidence</em>, choose the file, and review its digest, source health and bounded facts before saving it to a Case.</p></div></li>
    <li><span>3</span><div><strong>Classify and respond</strong><p>Add Case types and exact incident links, record an evidence-linked conclusion, then prepare a reviewed packet or later recheck. Import does not submit or upload the file.</p></div></li>
  </ol>
</section>

<section class="cli-section" id="behaviour" aria-labelledby="behaviour-title">
  <div class="section-intro"><p class="eyebrow">CLI behaviour</p><h2 id="behaviour-title">Requests, files and exit codes</h2><p>Each command declares whether it is offline or networked and which output formats it supports.</p></div>
  <div class="boundary-list">{#each PUBLIC_CLI_GUIDANCE.boundaries as boundary}<p>{boundary}</p>{/each}</div>

  <section class="exit-codes" aria-labelledby="exit-codes-title">
    <h3 id="exit-codes-title">Exit codes</h3>
    <table><tbody>{#each PUBLIC_CLI_GUIDANCE.exitCodes as item}<tr><th scope="row">{item.code}</th><td>{item.meaning}</td></tr>{/each}</tbody></table>
    <p><code>--strict-exit</code> and <code>--fail-on</code> are available only on commands that declare them.</p>
  </section>

  <div class="additional-behaviour independent-grid">
    <details><summary>Configuration profiles</summary><ul>{#each PUBLIC_CLI_GUIDANCE.configuration as item}<li>{item}</li>{/each}</ul></details>
    <details><summary>Browser and evidence handoffs</summary><ul>{#each PUBLIC_CLI_GUIDANCE.handoffs as item}<li>{item}</li>{/each}</ul></details>
  </div>
</section>

<section class="cli-section" id="more" aria-labelledby="more-title">
  <div class="section-intro"><p class="eyebrow">More documentation</p><h2 id="more-title">Examples, evidence rules and request policy</h2></div>
  <nav class="more-links" aria-label="CLI documentation links">
    <a href="/examples"><strong>Example output</strong><span>Inspect fictional command and export output.</span></a>
    <a href="/methodology"><strong>Evidence methodology</strong><span>Review provenance and interpretation rules.</span></a>
    <a href="/request-policy"><strong>Request policy</strong><span>Understand network and automation boundaries.</span></a>
    <a href="/privacy"><strong>Privacy</strong><span>See recipients, storage, export and deletion behaviour.</span></a>
  </nav>
  <aside class="package-verification">
    <div><h3>Verify the release you intended to install</h3><p>{PUBLIC_CLI_GUIDANCE.verification[0]}</p></div>
    <a href={`${WHOISLEUTH_SOURCE_REPOSITORY_URL}/blob/main/packages/cli/README.md`} target="_blank" rel="noopener">Open the package guide<span class="sr-only"> (opens in a new tab)</span></a>
  </aside>
</section>
</PublicReferenceDocument>

<style>
  .cli-section{padding:58px 0;border-top:1px solid var(--border);scroll-margin-top:74px}.section-intro{max-width:790px;margin-bottom:24px}.section-intro h2{margin:.3rem 0 .65rem;font:700 clamp(1.5rem,3vw,2.25rem) var(--mono);letter-spacing:-.04em}.section-intro>p:not(.eyebrow){margin:0;color:var(--muted);line-height:1.65}
  .start-steps{display:grid;gap:0;margin:0;padding:0;list-style:none}.start-steps>li{display:grid;grid-template-columns:34px minmax(0,1fr);gap:14px;padding:22px 0;border-top:1px solid var(--border)}.start-steps>li:last-child{border-bottom:1px solid var(--border)}.start-steps>li>span{display:grid;width:27px;height:27px;place-items:center;border:1px solid var(--border);border-radius:50%;color:var(--interface-accent);font:750 var(--text-xs) var(--mono)}.start-steps h3{margin:2px 0 6px;font:700 var(--text-md) var(--mono)}.start-steps p{margin:0 0 13px;color:var(--muted);font-size:var(--text-sm);line-height:1.55}.start-steps :global(.copyable-command)+:global(.copyable-command){margin-top:7px}.update-instructions{margin-top:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.update-instructions summary{padding:14px 16px;font:700 var(--text-xs) var(--mono)}.update-instructions>div{display:grid;gap:7px;padding:0 14px 14px}
  .start-notes{grid-template-columns:minmax(0,1fr) minmax(260px,.6fr);gap:10px;margin-top:14px}.start-notes>p{margin:0;padding:14px 16px;border-left:3px solid var(--interface-accent);background:var(--panel);color:var(--muted);font-size:var(--text-xs);line-height:1.55}.start-notes>p code{color:var(--accent)}.update-instructions{margin:0}
  .task-groups{display:grid;gap:10px}.task-groups>section{display:grid;grid-template-columns:minmax(160px,.35fr) minmax(0,.65fr);gap:22px;padding:20px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--panel)}.task-groups header h3{margin:0;color:var(--accent);font:750 var(--text-md) var(--mono)}.task-groups header p{margin:8px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}.task-groups ul{display:grid;gap:12px;margin:0;padding:0;list-style:none}.task-groups li{display:grid;gap:7px}.task-groups li strong{font:700 var(--text-xs) var(--mono)}
  .browser-handoff>ol{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0 0;padding:0;list-style:none}.browser-handoff>ol li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;padding:14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.browser-handoff>ol li>span{display:grid;width:25px;height:25px;place-items:center;border:1px solid var(--border);border-radius:50%;color:var(--interface-accent);font:700 var(--text-xs) var(--mono)}.browser-handoff strong{font:700 var(--text-xs) var(--mono)}.browser-handoff p{margin:6px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}
  .boundary-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;padding:1px;background:var(--border)}.boundary-list p{margin:0;padding:15px;background:var(--panel);color:var(--muted);font-size:var(--text-xs);line-height:1.55}.exit-codes{margin-top:34px}.exit-codes h3{margin:0 0 12px;font:700 var(--text-md) var(--mono)}.exit-codes table{width:100%;border:1px solid var(--border);border-spacing:0;border-radius:var(--radius-sm);overflow:hidden}.exit-codes tr:first-child>*{border-top:0}.exit-codes th,.exit-codes td{padding:11px 13px;border-top:1px solid var(--border);text-align:left}.exit-codes th{width:64px;color:var(--interface-accent);background:var(--panel-raised);font:750 var(--text-sm) var(--mono)}.exit-codes td{color:var(--muted);font-size:var(--text-xs);line-height:1.5}.exit-codes>p{margin:11px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.additional-behaviour{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:28px}.additional-behaviour details{border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.additional-behaviour summary{padding:14px;font:700 var(--text-xs) var(--mono)}.additional-behaviour ul{margin:0;padding:0 18px 16px 34px}.additional-behaviour li{color:var(--muted);font-size:var(--text-xs);line-height:1.55}.additional-behaviour li+li{margin-top:7px}
  .more-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.more-links a{display:grid;gap:6px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.more-links a:hover,.more-links a:focus-visible{border-color:var(--accent);background:rgb(var(--accent-rgb) / .06)}.more-links strong{color:var(--accent);font:700 var(--text-sm) var(--mono)}.more-links span{color:var(--muted);font-size:var(--text-xs);line-height:1.45}.package-verification{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:20px;padding:20px;border-left:3px solid var(--interface-accent);background:var(--panel)}.package-verification h3{margin:0;font:700 var(--text-sm) var(--mono)}.package-verification p{max-width:65ch;margin:7px 0 0;color:var(--muted);font-size:var(--text-xs);line-height:1.55}.package-verification>a{flex:0 0 auto;color:var(--accent);font:700 var(--text-xs) var(--mono)}
  @media(max-width:900px){.task-groups>section{grid-template-columns:1fr}.boundary-list{grid-template-columns:1fr}.start-notes{grid-template-columns:1fr}.browser-handoff>ol{grid-template-columns:1fr}}
  @media(max-width:720px){.cli-section{padding:45px 0;scroll-margin-top:20px}.additional-behaviour,.more-links{grid-template-columns:1fr}.package-verification{align-items:flex-start;flex-direction:column;gap:12px}}
  @media(max-width:440px){.start-steps>li{grid-template-columns:28px minmax(0,1fr);gap:10px}.task-groups>section{padding:15px}.exit-codes th{width:48px}.exit-codes th,.exit-codes td{padding:10px}}
</style>
