<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { PUBLIC_CLI_GRAMMAR } from '$lib/generated/public-cli-grammar';
  import { loadDeferredModule, reloadDeferredModulePage } from '$lib/deferred-module';
  import { buildCliCommand, type CommandShell } from '../../../../packages/analysis/cli-command-builder.mts';
  import { MAX_CLI_ARGUMENTS, MAX_CLI_ARGUMENT_LENGTH, type CliCommandGrammar } from '../../../../packages/contracts/cli-grammar.mts';
  import CopyableCommand from './CopyableCommand.svelte';
  let { command, initialPositionals = [], initialOptions = {} }: {
    command: string; initialPositionals?: readonly string[]; initialOptions?: Readonly<Record<string, readonly string[]>>;
  } = $props();
  // The caller keys a new editor by command. Drafts never enter location or storage.
  const selected = untrack(() => command);
  const grammar: CliCommandGrammar | undefined = PUBLIC_CLI_GRAMMAR[selected as keyof typeof PUBLIC_CLI_GRAMMAR];
  type Catalogue = typeof import('$lib/generated/public-cli-catalogue')['PUBLIC_CLI_CATALOGUE'];
  let definition = $state.raw<Catalogue['commands'][number] | null>(null);
  let loadError = $state(false);
  onMount(() => {
    const controller = new AbortController();
    void loadDeferredModule(() => import('$lib/generated/public-cli-catalogue'), { signal: controller.signal })
      .then(module => { definition = module.PUBLIC_CLI_CATALOGUE.commands.find(item => item.id === selected) ?? null; })
      .catch(() => { if (!controller.signal.aborted) loadError = true; });
    return () => controller.abort();
  });
  const specifications = grammar?.options.filter(option => !option.metaAction && !['--config', '--profile'].includes(option.option)) ?? [];
  const id = $props.id();
  let shell = $state<CommandShell>('posix');
  let positionalFields = $state(untrack(() => {
    let offset = 0;
    return (grammar?.positionals ?? []).map(specification => {
      const values = initialPositionals.slice(offset, offset + specification.maximum);
      offset += values.length;
      return values.join('\n');
    });
  }));
  let optionFields = $state(untrack(() => Object.fromEntries(specifications.map(specification => [specification.option, {
    enabled: Object.hasOwn(initialOptions, specification.option), value: initialOptions[specification.option]?.join('\n') ?? '',
  }]))));
  const result = $derived.by(() => {
    if (!grammar) return { error: 'This command is not available in this build.', command: '' };
    try {
      const positionals = positionalFields.flatMap((value, index) => grammar.positionals[index]!.maximum > 1 ? value.split('\n').filter(Boolean) : value ? [value] : []);
      const options = Object.fromEntries(specifications.filter(option => optionFields[option.option]!.enabled).map(option => [option.option,
        option.arity === 0 ? [''] : option.occurrence === 'repeatable' ? optionFields[option.option]!.value.split('\n').filter(Boolean) : [optionFields[option.option]!.value],
      ]));
      return { error: '', command: buildCliCommand(selected, grammar, { positionals, options, shell }).command };
    } catch (cause) { return { error: cause instanceof Error ? cause.message : 'The command could not be prepared.', command: '' }; }
  });
  function description(option: string) { return definition?.options.find(item => item.option === option)?.description ?? ''; }
</script>

<section class="command-builder" aria-label={`Build ${selected} command`}>
  {#if loadError}<p role="alert">Command descriptions are unavailable.</p><button class="btn" type="button" onclick={reloadDeferredModulePage}>Reload page</button>
  {:else if !definition}<p role="status">Loading command options…</p>
  {:else}
  <p>Prepare literal arguments locally. Nothing runs here, and your values are not added to the page URL or saved.</p>
  <div class="shell-field"><label for={`${id}-shell`}>Shell</label><select id={`${id}-shell`} bind:value={shell}><option value="posix">Bash, zsh or sh</option><option value="powershell">PowerShell</option></select></div>
  {#each grammar?.positionals ?? [] as specification, index}
    <label>{specification.name}{specification.minimum ? ' (required)' : ''}
      {#if specification.maximum > 1}<textarea bind:value={positionalFields[index]} rows="3" maxlength={(MAX_CLI_ARGUMENT_LENGTH + 1) * specification.maximum} placeholder="One argument per line"></textarea>
      {:else if specification.values.length}<select bind:value={positionalFields[index]}><option value="">Choose a value</option>{#each specification.values as value}<option {value}>{value}</option>{/each}</select>
      {:else}<input bind:value={positionalFields[index]} maxlength={MAX_CLI_ARGUMENT_LENGTH} autocomplete="off" spellcheck="false">{/if}
    </label>
  {/each}
  <details><summary>Choose options</summary><div class="builder-options">
    {#each specifications as specification, index}
      <div class="builder-option">
        <label class="option-choice"><input type="checkbox" bind:checked={optionFields[specification.option]!.enabled}><code>{specification.option}</code></label>
        <p id={`${id}-description-${index}`}>{description(specification.option)}</p>
        {#if optionFields[specification.option]!.enabled && specification.arity === 1}
          <label>Value for {specification.option}
            {#if specification.occurrence === 'repeatable'}<textarea bind:value={optionFields[specification.option]!.value} rows="2" maxlength={(MAX_CLI_ARGUMENT_LENGTH + 1) * MAX_CLI_ARGUMENTS} aria-describedby={`${id}-description-${index}`} placeholder="One value per line"></textarea>
            {:else if specification.valueKind === 'enum'}<select bind:value={optionFields[specification.option]!.value} aria-describedby={`${id}-description-${index}`}><option value="">Choose a value</option>{#each specification.values as value}<option {value}>{value}</option>{/each}</select>
            {:else}<input bind:value={optionFields[specification.option]!.value} maxlength={MAX_CLI_ARGUMENT_LENGTH} inputmode={specification.valueKind === 'integer' ? 'numeric' : 'text'} aria-describedby={`${id}-description-${index}`} autocomplete="off" spellcheck="false">{/if}
          </label>
        {/if}
      </div>
    {/each}
  </div></details>
  {#if result.error}<p role="status">{result.error}</p>{:else}<CopyableCommand command={result.command} label={`Prepared ${selected} command`} /><p>Grammar checked. The installed CLI still validates files, target eligibility, permissions and available sources.</p>{/if}
  {/if}
</section>

<style>
  .shell-field{display:grid;gap:6px}
  .command-builder{display:grid;gap:16px;min-width:0;padding-block:12px}.command-builder>p{margin:0;color:var(--muted);font-size:var(--text-sm);line-height:1.6}label{display:grid;gap:6px;font-size:var(--text-sm)}input,textarea,select{max-width:100%;min-width:0;min-height:44px}textarea{resize:vertical;font-family:var(--mono)}summary{min-height:44px}.builder-options{display:grid;gap:16px}.builder-option{min-width:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm)}.option-choice{display:flex;align-items:center;gap:8px}.option-choice input{min-height:0}.builder-option p{margin:6px 0;color:var(--muted);font-size:var(--text-xs);line-height:1.5}code{overflow-wrap:anywhere}
</style>
