import {
  CLI_COMMAND_REGISTRY,
  CLI_COMMANDS,
  COMMAND_DESCRIPTIONS,
  FILE_POSITIONAL_COMMANDS,
  commandOptionSpec,
  commandDefinition,
  commandPositionalSpecs,
  metaActionDefinition,
  type CliCommand,
  type CompletionShell,
} from './command-reference.mts';

const MAX_CLI_COMPLETION_BYTES = 32 * 1024;
const HELP_META_ACTION = metaActionDefinition('help');
const VERSION_META_ACTION = metaActionDefinition('version');
const COMMAND_META_ALIASES = Object.freeze([...HELP_META_ACTION.aliases]);
const ROOT_META_ALIASES = Object.freeze([
  ...HELP_META_ACTION.aliases,
  ...VERSION_META_ACTION.aliases,
]);

function longMetaAlias(action: typeof HELP_META_ACTION): string {
  const alias = action.aliases.find((candidate) => candidate.startsWith('--'));
  if (!alias) throw new Error(`Missing long CLI meta-action alias for ${action.id}.`);
  return alias;
}

function shortMetaAlias(action: typeof HELP_META_ACTION): string {
  const alias = action.aliases.find((candidate) => /^-[^-]$/u.test(candidate));
  if (!alias) throw new Error(`Missing short CLI meta-action alias for ${action.id}.`);
  return alias;
}

const HELP_LONG_ALIAS = longMetaAlias(HELP_META_ACTION);
const HELP_SHORT_ALIAS = shortMetaAlias(HELP_META_ACTION);

function optionNames(command: CliCommand): readonly string[] {
  const definition = commandDefinition(command);
  return Object.freeze([...new Set([
    ...definition.grammar.options.map((option) => option.option),
    ...definition.grammar.metaActions.flatMap((id) => metaActionDefinition(id).aliases),
  ])]);
}

function optionNamesByKind(command: CliCommand, kinds: readonly string[]): readonly string[] {
  return commandDefinition(command).grammar.options
    .filter((option) => kinds.includes(option.valueKind))
    .map((option) => option.option);
}

function positionalValues(command: CliCommand, oneBasedIndex: number): readonly string[] {
  let offset = 0;
  for (const specification of commandPositionalSpecs(command)) {
    if (oneBasedIndex > offset && oneBasedIndex <= offset + specification.maximum) {
      return specification.values;
    }
    offset += specification.maximum;
  }
  return Object.freeze([]);
}

function maximumFilePositionals(command: CliCommand): number {
  const positionals = commandPositionalSpecs(command);
  return positionals.length > 0 && positionals.every((specification) => specification.valueKind === 'file')
    ? positionals.reduce((total, specification) => total + specification.maximum, 0)
    : 0;
}

function positionalEnumValues(command: CliCommand): readonly string[] {
  return positionalValues(command, 1);
}

const VALUE_OPTIONS = Object.freeze(Object.fromEntries(
  CLI_COMMAND_REGISTRY.flatMap((definition) => definition.grammar.options)
    .filter((option) => option.values.length > 0)
    .map((option) => [option.option, option.values]),
)) as Readonly<Record<string, readonly string[]>>;

function integerValues(command: CliCommand, option: string, whenOptionPresent: string | null): readonly string[] {
  const range = commandOptionSpec(command, option)?.integerRanges
    .find((candidate) => candidate.whenOptionPresent === whenOptionPresent);
  if (!range) throw new Error(`Missing completion range for ${command} ${option}.`);
  return Object.freeze(Array.from(
    { length: range.maximum - range.minimum + 1 },
    (_, index) => String(range.minimum + index),
  ));
}

function commandOptions(command: CliCommand): string {
  return optionNames(command).join(' ');
}

function commandOptionPatterns(kinds: readonly string[]): string {
  return CLI_COMMANDS.flatMap((command) => optionNamesByKind(command, kinds)
    .map((option) => `${command}:${option}`)).join('|');
}

function bashCompletion(): string {
  const cases = CLI_COMMANDS.map((command) => `    ${command}) options="${commandOptions(command)}"; value_options="${optionNamesByKind(command, ['enum', 'file', 'integer', 'policy_list', 'text']).join(' ')}"; file_limit=${maximumFilePositionals(command)} ;;`).join('\n');
  const valueCases = Object.entries(VALUE_OPTIONS).map(([option, values]) => `    ${option}) COMPREPLY=( $(compgen -W "${values.join(' ')}" -- "\${current}") ); return ;;`).join('\n');
  const integerCases = CLI_COMMAND_REGISTRY.flatMap((definition) => definition.grammar.options
    .filter((option) => option.valueKind === 'integer')
    .map((option) => {
      const ordinary = integerValues(definition.command, option.option, null).join(' ');
      const conditional = option.integerRanges.find((range) => range.whenOptionPresent !== null);
      if (!conditional) {
        return `      ${definition.command}:${option.option}) COMPREPLY=( $(compgen -W "${ordinary}" -- "\${current}") ); return ;;`;
      }
      const narrowed = integerValues(definition.command, option.option, conditional.whenOptionPresent).join(' ');
      return `      ${definition.command}:${option.option}) if [[ " \${seen_options} " == *" ${conditional.whenOptionPresent} "* ]]; then integer_values="${narrowed}"; else integer_values="${ordinary}"; fi; COMPREPLY=( $(compgen -W "\${integer_values}" -- "\${current}") ); return ;;`;
    })).join('\n');
  const positionalValueCases = CLI_COMMANDS.flatMap((command) => {
    const values = positionalEnumValues(command);
    return values.length > 0
      ? [`      ${command}:0) if (( foreign_option == 0 && expect_value == 0 )) && [[ "\${current}" != -* ]]; then COMPREPLY=( $(compgen -W "${values.join(' ')}" -- "\${current}") ); return; fi ;;`]
      : [];
  }).join('\n');
  return `# WHOISleuth bash completion
_whoisleuth_direct_lookup_target() {
  local candidate="\${1}"
  [[ "\${candidate}" != -* ]] || return 1
  case " ${CLI_COMMANDS.join(' ')} " in *" \${candidate} "*) return 1 ;; esac
  "\${COMP_WORDS[0]}" "\${candidate}" --plan --json >/dev/null 2>&1
}
_whoisleuth_completion() {
  local current previous command options value_options file_limit positional_count expect_value foreign_option word integer_values seen_options i
  current="\${COMP_WORDS[COMP_CWORD]}"
  previous="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${CLI_COMMANDS.join(' ')} ${ROOT_META_ALIASES.join(' ')}" -- "\${current}") )
    return
  fi
  if _whoisleuth_direct_lookup_target "\${command}"; then
    command="lookup"
  fi
  case "\${command}" in
${cases}
    *) options="${COMMAND_META_ALIASES.join(' ')}"; value_options=""; file_limit=0 ;;
  esac
  positional_count=0
  expect_value=0
  foreign_option=0
  seen_options=""
  for ((i=2; i<COMP_CWORD; i++)); do
    word="\${COMP_WORDS[i]}"
    if (( expect_value )); then expect_value=0; continue; fi
    if [[ "\${word}" == -* ]]; then
      if [[ " \${options} " != *" \${word} "* ]]; then foreign_option=1; continue; fi
      seen_options="\${seen_options} \${word}"
      [[ " \${value_options} " == *" \${word} "* ]] && expect_value=1
    else
      ((positional_count+=1))
    fi
  done
  if [[ " \${options} " == *" \${previous} "* ]]; then
    case "\${previous}" in
${valueCases}
    esac
    case "\${command}:\${previous}" in
      ${commandOptionPatterns(['file'])}) COMPREPLY=( $(compgen -f -- "\${current}") ); return ;;
${integerCases}
      ${commandOptionPatterns(['text'])}) COMPREPLY=(); return ;;
    esac
  fi
  case "\${command}:\${positional_count}" in
${positionalValueCases}
  esac
  if (( file_limit > positional_count && foreign_option == 0 && expect_value == 0 )) && [[ "\${current}" != -* ]]; then
    COMPREPLY=( $(compgen -f -- "\${current}") )
    return
  fi
  COMPREPLY=( $(compgen -W "\${options}" -- "\${current}") )
}
complete -F _whoisleuth_completion whoisleuth
`;
}

function zshCompletion(): string {
  const commandEntries = CLI_COMMANDS.map((command) => `'${command}:${COMMAND_DESCRIPTIONS[command] || command}'`).join(' ');
  const cases = CLI_COMMANDS.map((command) => `    ${command}) options=(${commandOptions(command)}); value_options=(${optionNamesByKind(command, ['enum', 'file', 'integer', 'policy_list', 'text']).join(' ')}); file_limit=${maximumFilePositionals(command)} ;;`).join('\n');
  const valueCases = Object.entries(VALUE_OPTIONS).map(([option, values]) => `    ${option}) compadd -- ${values.join(' ')}; return ;;`).join('\n');
  const integerCases = CLI_COMMAND_REGISTRY.flatMap((definition) => definition.grammar.options
    .filter((option) => option.valueKind === 'integer')
    .map((option) => {
      const ordinary = integerValues(definition.command, option.option, null).join(' ');
      const conditional = option.integerRanges.find((range) => range.whenOptionPresent !== null);
      if (!conditional) return `      ${definition.command}:${option.option}) compadd -- ${ordinary}; return ;;`;
      const narrowed = integerValues(definition.command, option.option, conditional.whenOptionPresent).join(' ');
      return `      ${definition.command}:${option.option}) if [[ " \${seen_options[*]} " == *" ${conditional.whenOptionPresent} "* ]]; then compadd -- ${narrowed}; else compadd -- ${ordinary}; fi; return ;;`;
    })).join('\n');
  const positionalValueCases = CLI_COMMANDS.flatMap((command) => {
    const values = positionalEnumValues(command);
    return values.length > 0
      ? [`    ${command}:0) if (( foreign_option == 0 && expect_value == 0 )) && [[ "\${words[CURRENT]}" != -* ]]; then compadd -- ${values.join(' ')}; return; fi ;;`]
      : [];
  }).join('\n');
  return `#compdef whoisleuth
_whoisleuth_direct_lookup_target() {
  local candidate="\${1}"
  [[ "\${candidate}" != -* ]] || return 1
  [[ " ${CLI_COMMANDS.join(' ')} " == *" \${candidate} "* ]] && return 1
  "\${words[1]}" "\${candidate}" --plan --json >/dev/null 2>&1
}
_whoisleuth() {
  local command previous word
  local -a options commands value_options seen_options
  integer file_limit=0 positional_count=0 expect_value=0 foreign_option=0 i
  commands=(${commandEntries} ${[
    ...HELP_META_ACTION.aliases.map((alias) => `'${alias}:Show help'`),
    ...VERSION_META_ACTION.aliases.map((alias) => `'${alias}:Show version'`),
  ].join(' ')})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  command="\${words[2]}"
  previous="\${words[CURRENT-1]}"
  if _whoisleuth_direct_lookup_target "\${command}"; then
    command="lookup"
  fi
  case "\${command}" in
${cases}
    *) options=(${COMMAND_META_ALIASES.join(' ')}); value_options=(); file_limit=0 ;;
  esac
  for ((i=3; i<CURRENT; i++)); do
    word="\${words[i]}"
    if (( expect_value )); then expect_value=0; continue; fi
    if [[ "\${word}" == -* ]]; then
      if [[ " \${options[*]} " != *" \${word} "* ]]; then foreign_option=1; continue; fi
      seen_options+=("\${word}")
      [[ " \${value_options[*]} " == *" \${word} "* ]] && expect_value=1
    else
      ((positional_count+=1))
    fi
  done
  if [[ " \${options[*]} " == *" \${previous} "* ]]; then
    case "\${previous}" in
${valueCases}
    esac
    case "\${command}:\${previous}" in
      ${commandOptionPatterns(['file'])}) _files; return ;;
${integerCases}
      ${commandOptionPatterns(['text'])}) _message 'value'; return ;;
    esac
  fi
  case "\${command}:\${positional_count}" in
${positionalValueCases}
  esac
  if (( file_limit > positional_count && foreign_option == 0 && expect_value == 0 )) && [[ "\${words[CURRENT]}" != -* ]]; then
    _files
    return
  fi
  compadd -- \${options[@]}
}
if [[ "\${funcstack[1]}" == "_whoisleuth" ]]; then
  _whoisleuth "\$@"
else
  compdef _whoisleuth whoisleuth
fi
`;
}

function fishCompletion(): string {
  const commandLines = CLI_COMMANDS.map((command) => (
    `complete -c whoisleuth -n '__fish_use_subcommand' -a '${command}' -d '${COMMAND_DESCRIPTIONS[command]}'`
  ));
  const optionGroups = new Map<string, { option: string; arity: 0 | 1; file: boolean; commands: CliCommand[] }>();
  for (const definition of CLI_COMMAND_REGISTRY) {
    for (const option of definition.grammar.options) {
      const key = `${option.option}\u0000${option.arity}\u0000${option.valueKind === 'file'}`;
      const group = optionGroups.get(key) ?? {
        option: option.option,
        arity: option.arity,
        file: option.valueKind === 'file',
        commands: [],
      };
      group.commands.push(definition.command);
      optionGroups.set(key, group);
    }
  }
  const optionLines = [...optionGroups.values()].map((group) => {
    const condition = `__whoisleuth_command_is ${group.commands.join(' ')}`
      + (group.commands.includes('lookup') ? '; or __whoisleuth_direct_lookup_target' : '');
    return `complete -c whoisleuth -n '${condition}'${group.option === HELP_LONG_ALIAS ? ` -s ${HELP_SHORT_ALIAS.slice(1)}` : ''} -l ${group.option.slice(2)}${group.arity === 1 ? ' -r' : ''}${group.file ? ' -F' : ''}`;
  });
  const valueLines = Object.entries(VALUE_OPTIONS).flatMap(([option, values]) => {
    const commands = CLI_COMMANDS.filter((command) => commandOptionSpec(command, option) !== null);
    const namedCondition = commands.length === CLI_COMMANDS.length
      ? `__fish_prev_arg_in ${option}`
      : `__whoisleuth_command_is ${commands.join(' ')}; and __fish_prev_arg_in ${option}`;
    const lines = commands.length > 0
      ? [`complete -c whoisleuth -n '${namedCondition}' -a '${values.join(' ')}'`]
      : [];
    if (commands.includes('lookup')) {
      lines.push(`complete -c whoisleuth -n '__whoisleuth_direct_lookup_target; and __fish_prev_arg_in ${option}' -a '${values.join(' ')}'`);
    }
    return lines;
  });
  const integerLines = CLI_COMMAND_REGISTRY.flatMap((definition) => definition.grammar.options
    .filter((option) => option.valueKind === 'integer')
    .flatMap((option) => option.integerRanges.map((range) => {
      const qualifiers = [
        `__fish_prev_arg_in ${option.option}`,
        `and __whoisleuth_command_is ${definition.command}`,
        ...(range.whenOptionPresent
          ? [`and __whoisleuth_seen ${definition.command} ${range.whenOptionPresent}`]
          : option.integerRanges.length > 1
            ? [`and not __whoisleuth_seen ${definition.command} ${option.integerRanges.find((candidate) => candidate.whenOptionPresent)?.whenOptionPresent}`]
            : []),
      ].join('; ');
      return `complete -c whoisleuth -n '${qualifiers}' -a '(__whoisleuth_integer_values ${range.minimum} ${range.maximum})'`;
    })));
  const positionalCases = [...new Set([
    ...FILE_POSITIONAL_COMMANDS,
    ...CLI_COMMANDS.filter((command) => positionalEnumValues(command).length > 0),
    ...CLI_COMMAND_REGISTRY.filter((definition) => definition.grammar.options
      .some((option) => option.integerRanges.some((range) => range.whenOptionPresent !== null)))
      .map((definition) => definition.command),
  ])].map((command) => {
    const definition = commandDefinition(command);
    const commandValueOptions = definition.grammar.options
      .filter((option) => option.scope === 'command' && option.arity === 1)
      .map((option) => option.option);
    const positioning = FILE_POSITIONAL_COMMANDS.includes(command)
      || positionalEnumValues(command).length > 0;
    return `    case ${command}\n${positioning
      ? `        set options $options ${definition.completion.options.join(' ')}\n`
      : '        set strict 0\n'}        set value_options $value_options ${commandValueOptions.join(' ')}\n        set limit ${maximumFilePositionals(command)}`;
  }).join('\n');
  const positionalEnumLines = CLI_COMMANDS.flatMap((command) => {
    const values = positionalEnumValues(command);
    return values.length > 0
      ? [`complete -c whoisleuth -n '__whoisleuth_position_is 0 ${command}' -a '${values.join(' ')}'`]
      : [];
  });
  return `# WHOISleuth fish completion
function __whoisleuth_clear_direct_lookup_cache --on-event fish_prompt
    set -e __whoisleuth_direct_lookup_cache_key
    set -e __whoisleuth_direct_lookup_cache_status
end
function __whoisleuth_direct_lookup_target
    set -l words (commandline -opc)
    if test (count \$words) -lt 2
        return 1
    end
    set -l first \$words[2]
    string match -q -- '-*' \$first; and return 1
    contains -- \$first ${CLI_COMMANDS.join(' ')}; and return 1
    set -l cache_key "\$words[1]:\$first"
    if test "\$__whoisleuth_direct_lookup_cache_key" = "\$cache_key"
        return \$__whoisleuth_direct_lookup_cache_status
    end
    \$words[1] \$first --plan --json >/dev/null 2>/dev/null
    set -l result \$status
    set -g __whoisleuth_direct_lookup_cache_key \$cache_key
    set -g __whoisleuth_direct_lookup_cache_status \$result
    return \$result
end
function __whoisleuth_command_is
    set -l words (commandline -opc)
    test (count \$words) -ge 2; or return 1
    contains -- \$words[2] $argv
end
function __whoisleuth_integer_values
    set -l value $argv[1]
    while test $value -le $argv[2]
        echo $value
        set value (math $value + 1)
    end
end
function __whoisleuth_position_state
    set -l expected_command $argv[1]
    set -l words (commandline -opc)
    test (count $words) -ge 2; or return 1
    set -l command $words[2]
    test "$command" = "$expected_command"; or return 1
    set -l options ${COMMAND_META_ALIASES.join(' ')} --output --force --config --profile --palette
    set -l value_options --output --config --profile --palette
    set -l limit 0
    set -l strict 1
    switch $command
${positionalCases}
        case '*'
            return 1
    end
    set -l expect_value 0
    set -l positional_count 0
    set -l seen
    for word in $words[3..-1]
        if test $expect_value -eq 1
            set expect_value 0
            continue
        end
        if string match -q -- '-*' $word
            if test $strict -eq 1
                contains -- $word $options; or return 1
            end
            set -a seen $word
            contains -- $word $value_options; and set expect_value 1
        else
            set positional_count (math $positional_count + 1)
        end
    end
    test $expect_value -eq 0; or return 1
    echo $positional_count $limit $seen
end
function __whoisleuth_position_is
    set -l state (__whoisleuth_position_state $argv[2]); or return 1
    test $state[1] -eq $argv[1]
end
function __whoisleuth_file_position
    set -l words (commandline -opc)
    test (count $words) -ge 2; or return 1
    set -l state (__whoisleuth_position_state $words[2]); or return 1
    test $state[2] -gt $state[1]; or return 1
    not string match -qr -- ^- (commandline -ct)
end
function __whoisleuth_seen
    set -l s (__whoisleuth_position_state $argv[1]); or return 1
    contains -- $argv[2] $s[3..-1]
end
complete -c whoisleuth -f
${[HELP_META_ACTION, VERSION_META_ACTION].map((action) => (
    `complete -c whoisleuth -n '__fish_use_subcommand' -s ${shortMetaAlias(action).slice(1)} -l ${longMetaAlias(action).slice(2)}`
  )).join('\n')}
${commandLines.join('\n')}
${positionalEnumLines.join('\n')}
complete -c whoisleuth -n '__whoisleuth_file_position' -F
${optionLines.join('\n')}
${valueLines.join('\n')}
${integerLines.join('\n')}
`;
}

function powershellCompletion(): string {
  const commandOptions = Object.fromEntries(CLI_COMMANDS.map((command) => [
    command,
    optionNames(command),
  ]));
  const positionalValuesByCommand = Object.fromEntries(CLI_COMMANDS.flatMap((command) => {
    const values = positionalEnumValues(command);
    return values.length > 0 ? [[`${command}:0`, values]] : [];
  }));
  const integerRanges = Object.fromEntries(CLI_COMMAND_REGISTRY.flatMap((definition) => definition.grammar.options
    .filter((option) => option.valueKind === 'integer')
    .map((option) => {
      const range = option.integerRanges.find((candidate) => candidate.whenOptionPresent === null);
      if (!range) throw new Error(`Missing ordinary completion range for ${definition.command} ${option.option}.`);
      return [`${definition.command}:${option.option}`, Object.freeze({
        minimum: range.minimum,
        maximum: range.maximum,
      })];
    })));
  const conditionalIntegerRanges = Object.fromEntries(CLI_COMMAND_REGISTRY.flatMap((definition) => definition.grammar.options
    .filter((option) => option.valueKind === 'integer')
    .flatMap((option) => option.integerRanges
      .filter((range) => range.whenOptionPresent !== null)
      .map((range) => [`${definition.command}:${option.option}`, Object.freeze({
        option: range.whenOptionPresent,
        minimum: range.minimum,
        maximum: range.maximum,
      })]))));
  return `# WHOISleuth PowerShell completion
Register-ArgumentCompleter -Native -CommandName whoisleuth -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $noMatch = { [System.Management.Automation.CompletionResult]::new(' ', 'no matches', 'ParameterValue', 'No completion available') }
  $commands = @(${CLI_COMMANDS.map((command) => `'${command}'`).join(', ')})
  $options = @{
${Object.entries(commandOptions).map(([command, options]) => `    '${command}' = @(${options.map((option) => `'${option}'`).join(', ')})`).join('\n')}
  }
  $values = @{
${Object.entries(VALUE_OPTIONS).map(([option, values]) => `    '${option}' = @(${values.map((value) => `'${value}'`).join(', ')})`).join('\n')}
  }
  $fileOptions = @{
${CLI_COMMANDS.map((command) => `    '${command}' = @(${optionNamesByKind(command, ['file']).map((option) => `'${option}'`).join(', ')})`).join('\n')}
  }
  $textOptions = @{
${CLI_COMMANDS.map((command) => `    '${command}' = @(${optionNamesByKind(command, ['text']).map((option) => `'${option}'`).join(', ')})`).join('\n')}
  }
  $valueOptions = @{
${CLI_COMMANDS.map((command) => `    '${command}' = @(${optionNamesByKind(command, ['enum', 'file', 'integer', 'policy_list', 'text']).map((option) => `'${option}'`).join(', ')})`).join('\n')}
  }
  $fileLimits = @{
${FILE_POSITIONAL_COMMANDS.map((command) => `    '${command}' = ${maximumFilePositionals(command)}`).join('\n')}
  }
  $positionValues = @{
${Object.entries(positionalValuesByCommand).map(([key, values]) => `    '${key}' = @(${values.map((value) => `'${value}'`).join(', ')})`).join('\n')}
  }
  $integerRanges = @{
${Object.entries(integerRanges).map(([key, range]) => `    '${key}' = @(${range.minimum}, ${range.maximum})`).join('\n')}
  }
  $conditionalIntegerRanges = @{
${Object.entries(conditionalIntegerRanges).map(([key, range]) => `    '${key}' = @('${range.option}', ${range.minimum}, ${range.maximum})`).join('\n')}
  }
  $elements = @($commandAst.CommandElements | ForEach-Object {
    if ($_ -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $_.Value }
    else { $_.Extent.Text }
  })
  $command = if ($elements.Count -gt 1) { $elements[1] } else { '' }
  $previousIndex = if ($wordToComplete) { $elements.Count - 2 } else { $elements.Count - 1 }
  $previous = if ($previousIndex -ge 0) { $elements[$previousIndex] } else { '' }
  $rootCompletion = $elements.Count -eq 1 -or (
    $elements.Count -eq 2 -and $cursorPosition -le $commandAst.Extent.EndOffset
  )
  $directLookup = $false
  if ($command -notmatch '^-' -and $elements.Count -gt 1 -and $commands -notcontains $command) {
    & $elements[0] $command '--plan' '--json' *> $null
    $directLookup = $LASTEXITCODE -eq 0
  }
  if ($directLookup) { $command = 'lookup' }
  $commandKnown = $options.ContainsKey($command)
  $activeOptions = if ($commandKnown) { $options[$command] } else { @(${COMMAND_META_ALIASES.map((alias) => `'${alias}'`).join(', ')}) }
  $previousOwned = $activeOptions -contains $previous
  if ($previousOwned -and $fileOptions.ContainsKey($command) -and $fileOptions[$command] -contains $previous) {
    $files = @(Get-ChildItem -Path "${'$'}wordToComplete*" -File -ErrorAction SilentlyContinue)
    $files | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_.FullName, $_.Name, 'ProviderItem', $_.FullName)
    }
    if ($files.Count -eq 0) { & $noMatch }
    return
  }
  if ($previousOwned -and $textOptions.ContainsKey($command) -and $textOptions[$command] -contains $previous) {
    $completionText = if ([string]::IsNullOrEmpty($wordToComplete)) { ' ' } else { [string]$wordToComplete }
    $listItemText = if ([string]::IsNullOrEmpty($wordToComplete)) { 'value' } else { [string]$wordToComplete }
    [System.Management.Automation.CompletionResult]::new($completionText, $listItemText, 'ParameterValue', 'Enter a value')
    return
  }
  $positionCount = 0
  $expectValue = $false
  $foreignOption = $false
  $seenOptions = @()
  for ($index = 2; $index -le $previousIndex; $index += 1) {
    $word = $elements[$index]
    if ($expectValue) { $expectValue = $false; continue }
    if ($word.StartsWith('-')) {
      if ($activeOptions -notcontains $word) { $foreignOption = $true; continue }
      $seenOptions += $word
      if ($valueOptions.ContainsKey($command) -and $valueOptions[$command] -contains $word) { $expectValue = $true }
    } else {
      $positionCount += 1
    }
  }
  $integerKey = "${'$'}{command}:${'$'}previous"
  if ($previousOwned -and $integerRanges.ContainsKey($integerKey)) {
    $range = $integerRanges[$integerKey]
    if ($conditionalIntegerRanges.ContainsKey($integerKey)) {
      $condition = $conditionalIntegerRanges[$integerKey]
      if ($seenOptions -contains $condition[0]) { $range = @($condition[1], $condition[2]) }
    }
    $matched = $false
    foreach ($number in $range[0]..$range[1]) {
      $candidate = [string]$number
      if ($candidate.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {
        [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
        $matched = $true
      }
    }
    if (-not $matched) { & $noMatch }
    return
  }
  if ($previousOwned -and $values.ContainsKey($previous)) {
    $matched = $false
    foreach ($candidate in $values[$previous]) {
      if ($candidate.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {
        [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
        $matched = $true
      }
    }
    if (-not $matched) { & $noMatch }
    return
  }
  $positionKey = "${'$'}{command}:${'$'}positionCount"
  if ($positionValues.ContainsKey($positionKey) -and -not $foreignOption -and -not $expectValue -and -not $wordToComplete.StartsWith('-')) {
    $matched = $false
    foreach ($candidate in $positionValues[$positionKey]) {
      if ($candidate.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {
        [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
        $matched = $true
      }
    }
    if (-not $matched) { & $noMatch }
    return
  }
  if ($fileLimits.ContainsKey($command) -and $fileLimits[$command] -gt $positionCount -and -not $foreignOption -and -not $expectValue -and -not $wordToComplete.StartsWith('-')) {
    $files = @(Get-ChildItem -Path "${'$'}wordToComplete*" -File -ErrorAction SilentlyContinue)
    $files | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_.FullName, $_.Name, 'ProviderItem', $_.FullName)
    }
    if ($files.Count -eq 0) { & $noMatch }
    return
  }
  $candidates = if ($rootCompletion -and -not $directLookup) {
    @($commands) + @(${ROOT_META_ALIASES.map((alias) => `'${alias}'`).join(', ')})
  } elseif ($commandKnown) {
    $activeOptions
  } else {
    @(${COMMAND_META_ALIASES.map((alias) => `'${alias}'`).join(', ')})
  }
  $matched = $false
  foreach ($candidate in $candidates) {
    if ($candidate.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {
      [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
      $matched = $true
    }
  }
  if (-not $matched) { & $noMatch }
}
`;
}

function buildShellCompletion(shell: CompletionShell): string {
  const script = shell === 'bash'
    ? bashCompletion()
    : shell === 'zsh'
      ? zshCompletion()
      : shell === 'fish'
        ? fishCompletion()
        : powershellCompletion();
  if (Buffer.byteLength(script, 'utf8') > MAX_CLI_COMPLETION_BYTES) {
    throw new RangeError(`Generated completion is limited to ${MAX_CLI_COMPLETION_BYTES} UTF-8 bytes.`);
  }
  return script;
}

export {
  MAX_CLI_COMPLETION_BYTES,
  buildShellCompletion,
};
