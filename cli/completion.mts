import { CLI_COMMANDS, type CompletionShell } from './arguments.mts';
import { INVESTIGATION_PLAN_RECIPES } from './investigation-plan.mts';

const COMMON_OPTIONS = Object.freeze(['--help', '--output', '--force']);
const OPTIONS_BY_COMMAND: Readonly<Record<string, readonly string[]>> = Object.freeze({
  lookup: ['--json', '--markdown', '--html', '--fast', '--deep', '--observer', '--vantage', '--plan', '--summary', '--verbose', '--strict-exit', '--events', '--quiet', '--no-color'],
  bulk: ['--json', '--jsonl', '--csv', '--domains', '--queries', '--registered-only', '--inconclusive-only', '--errors-only', '--fast', '--deep', '--concurrency', '--checkpoint', '--resume', '--events', '--quiet', '--no-color'],
  'ct-search': ['--json', '--quiet', '--no-color'],
  discover: ['--tlds', '--preset', '--families', '--keyboard', '--dictionary', '--snapshot', '--json', '--jsonl', '--domains', '--quiet', '--no-color'],
  'discover-scan': ['--tlds', '--preset', '--families', '--keyboard', '--dictionary', '--fast', '--deep', '--scan-limit', '--chunk-size', '--concurrency', '--resolver', '--allowlist', '--checkpoint', '--resume', '--observation-snapshot', '--registered-only', '--inconclusive-only', '--acquisition-only', '--suppressed-only', '--events', '--json', '--jsonl', '--csv', '--domains', '--quiet', '--no-color'],
  posture: ['--selectors', '--retired-selectors', '--mail-profile', '--json', '--quiet', '--no-color'],
  http: ['--json', '--quiet', '--no-color'],
  tls: ['--json', '--quiet', '--no-color'],
  'registry-support': ['--json', '--quiet', '--no-color'],
  'registry-doctor': ['--json', '--quiet', '--no-color'],
  'risk-calibrate': ['--json', '--quiet', '--no-color'],
  'lookalike-calibrate': ['--json', '--quiet', '--no-color'],
  'verify-artifact': ['--passphrase-file', '--json', '--quiet', '--no-color'],
  'inspect-archive': ['--passphrase-file', '--search', '--require-match', '--reveal', '--json', '--quiet', '--no-color'],
  'sign-artifact': ['--private-key-file'],
  'verify-signature': ['--public-key-file', '--json', '--quiet', '--no-color'],
  'source-report': ['--json', '--quiet', '--no-color'],
  compare: ['--json', '--quiet', '--no-color'],
  'page-compare': ['--json', '--quiet', '--no-color'],
  'mail-review': ['--json', '--quiet', '--no-color'],
  'review-evidence': ['--mmdb', '--json', '--strict-exit', '--quiet', '--no-color'],
  'domain-control': ['--json', '--quiet', '--no-color'],
  assurance: ['--json', '--quiet', '--no-color'],
  'sharing-review': ['--marking', '--recipient-scope', '--purpose', '--human-reviewed', '--personal-data-reviewed', '--redactions-confirmed', '--json', '--quiet', '--no-color'],
  'workflow-plan': ['--json', '--quiet', '--no-color'],
  diff: ['--json', '--quiet', '--no-color'],
  reconcile: ['--json', '--quiet', '--no-color'],
  timeline: ['--json', '--quiet', '--no-color'],
  export: ['--markdown', '--html', '--compact'],
  completion: [],
  commands: ['--json', '--quiet', '--no-color'],
  doctor: ['--network', '--json', '--quiet', '--no-color'],
  manual: [],
});

const COMMAND_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  lookup: 'Collect one domain, IP, or ASN',
  bulk: 'Run bounded multi-target collection',
  'ct-search': 'Search certificate observations',
  discover: 'Generate lookalike candidates offline',
  'discover-scan': 'Collect a supervised candidate review queue',
  posture: 'Review DNS and mail posture',
  http: 'Inspect one homepage request',
  tls: 'Inspect one TLS connection',
  'registry-support': 'Explain local registry coverage',
  'registry-doctor': 'Diagnose saved registry collection',
  'risk-calibrate': 'Replay reviewed Risk labels offline',
  'lookalike-calibrate': 'Summarise reviewed lookalike yield offline',
  'verify-artifact': 'Validate saved evidence offline',
  'inspect-archive': 'Inspect an archive locally',
  'sign-artifact': 'Sign a reviewed artefact locally',
  'verify-signature': 'Verify a signed evidence package',
  'source-report': 'Build a target-free source report',
  compare: 'Compare registry publications in one lookup',
  'page-compare': 'Compare saved static page evidence',
  'mail-review': 'Review saved passive mail evidence',
  'review-evidence': 'Review supplied evidence offline',
  'domain-control': 'Build or review a domain control manifest',
  assurance: 'Review domain change, recovery, or retirement plans',
  'sharing-review': 'Lint an artefact before deliberate sharing',
  'workflow-plan': 'Plan a fixed investigation recipe',
  diff: 'Compare two saved domain lookups',
  reconcile: 'Reconcile independently labelled observations',
  timeline: 'Build same-domain history from saved lookups',
  export: 'Convert a lookup to an evidence report',
  completion: 'Print shell completion',
  commands: 'List installed command contracts',
  doctor: 'Check the local CLI runtime',
  manual: 'Print the generated manual page',
});

const VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '--preset': ['common', 'impersonation', 'all'],
  '--keyboard': ['qwerty', 'azerty', 'qwertz', 'all'],
  '--mail-profile': ['standard', 'defensive-no-mail', 'parked'],
  '--marking': ['clear', 'green', 'amber', 'amber-strict', 'red'],
  '--recipient-scope': ['public', 'community', 'organization', 'named-recipients'],
  '--concurrency': ['1', '2', '3', '4', '5', '6', '7', '8'],
});

const FILE_OPTIONS = Object.freeze([
  '--checkpoint',
  '--allowlist',
  '--dictionary',
  '--output',
  '--passphrase-file',
  '--private-key-file',
  '--public-key-file',
  '--snapshot',
  '--observation-snapshot',
]);

const TEXT_OPTIONS = Object.freeze([
  '--families',
  '--resolver',
  '--purpose',
  '--observer',
  '--retired-selectors',
  '--search',
  '--selectors',
  '--tlds',
  '--vantage',
]);

function commandOptions(command: string): string {
  return [...COMMON_OPTIONS, ...(OPTIONS_BY_COMMAND[command] || [])].join(' ');
}

function bashCompletion(): string {
  const cases = CLI_COMMANDS.map((command) => `    ${command}) options="${commandOptions(command)}" ;;`).join('\n');
  const valueCases = Object.entries(VALUE_OPTIONS).map(([option, values]) => `    ${option}) COMPREPLY=( $(compgen -W "${values.join(' ')}" -- "\${current}") ); return ;;`).join('\n');
  return `# WHOISleuth bash completion
_whoisleuth_completion() {
  local current previous command options
  current="\${COMP_WORDS[COMP_CWORD]}"
  previous="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${CLI_COMMANDS.join(' ')} --help --version" -- "\${current}") )
    return
  fi
  if [[ "\${command}" == "completion" && \${COMP_CWORD} -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "\${current}") )
    return
  fi
  if [[ "\${command}" == "workflow-plan" && \${COMP_CWORD} -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "${INVESTIGATION_PLAN_RECIPES.join(' ')}" -- "\${current}") )
    return
  fi
  case "\${previous}" in
${valueCases}
    ${FILE_OPTIONS.join('|')}) COMPREPLY=( $(compgen -f -- "\${current}") ); return ;;
    ${TEXT_OPTIONS.join('|')}) COMPREPLY=(); return ;;
  esac
  case "\${command}" in
${cases}
    *) options="--help" ;;
  esac
  COMPREPLY=( $(compgen -W "\${options}" -- "\${current}") )
}
complete -F _whoisleuth_completion whoisleuth
`;
}

function zshCompletion(): string {
  const commandEntries = CLI_COMMANDS.map((command) => `'${command}:${COMMAND_DESCRIPTIONS[command] || command}'`).join(' ');
  const cases = CLI_COMMANDS.map((command) => `    ${command}) options=(${commandOptions(command)}) ;;`).join('\n');
  const valueCases = Object.entries(VALUE_OPTIONS).map(([option, values]) => `    ${option}) compadd -- ${values.join(' ')}; return ;;`).join('\n');
  return `#compdef whoisleuth
_whoisleuth() {
  local command previous
  local -a options commands
  commands=(${commandEntries})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  command="\${words[2]}"
  previous="\${words[CURRENT-1]}"
  if [[ "\${command}" == "completion" && CURRENT -eq 3 ]]; then
    compadd -- bash zsh fish powershell
    return
  fi
  if [[ "\${command}" == "workflow-plan" && CURRENT -eq 3 ]]; then
    compadd -- ${INVESTIGATION_PLAN_RECIPES.join(' ')}
    return
  fi
  case "\${previous}" in
${valueCases}
    ${FILE_OPTIONS.join('|')}) _files; return ;;
    ${TEXT_OPTIONS.join('|')}) _message 'value'; return ;;
  esac
  case "\${command}" in
${cases}
    *) options=(--help) ;;
  esac
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
    `complete -c whoisleuth -n '__fish_use_subcommand' -a '${command}' -d '${COMMAND_DESCRIPTIONS[command] || command}'`
  ));
  const optionLines = Object.entries(OPTIONS_BY_COMMAND).flatMap(([command, options]) => (
    [...COMMON_OPTIONS, ...options].map((option) => {
      const name = option.replace(/^--/u, '');
      const fileValue = FILE_OPTIONS.includes(option);
      const requiresValue = fileValue || [...Object.keys(VALUE_OPTIONS), ...TEXT_OPTIONS].includes(option);
      return `complete -c whoisleuth -n '__fish_seen_subcommand_from ${command}' -l ${name}${requiresValue ? ' -r' : ''}${fileValue ? ' -F' : ''}`;
    })
  ));
  const valueLines = Object.entries(VALUE_OPTIONS).flatMap(([option, values]) => (
    values.map((value) => `complete -c whoisleuth -n '__fish_prev_arg_in ${option}' -a '${value}'`)
  ));
  return `# WHOISleuth fish completion
complete -c whoisleuth -f
complete -c whoisleuth -n '__fish_use_subcommand' -l help
complete -c whoisleuth -n '__fish_use_subcommand' -l version
${commandLines.join('\n')}
complete -c whoisleuth -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish powershell'
complete -c whoisleuth -n '__fish_seen_subcommand_from workflow-plan' -a '${INVESTIGATION_PLAN_RECIPES.join(' ')}'
${optionLines.join('\n')}
${valueLines.join('\n')}
`;
}

function powershellCompletion(): string {
  const commandOptions = Object.fromEntries(CLI_COMMANDS.map((command) => [
    command,
    [...COMMON_OPTIONS, ...(OPTIONS_BY_COMMAND[command] || [])],
  ]));
  return `# WHOISleuth PowerShell completion
Register-ArgumentCompleter -Native -CommandName whoisleuth -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @(${CLI_COMMANDS.map((command) => `'${command}'`).join(', ')})
  $options = @{
${Object.entries(commandOptions).map(([command, options]) => `    '${command}' = @(${options.map((option) => `'${option}'`).join(', ')})`).join('\n')}
  }
  $values = @{
${Object.entries(VALUE_OPTIONS).map(([option, values]) => `    '${option}' = @(${values.map((value) => `'${value}'`).join(', ')})`).join('\n')}
    'completion' = @('bash', 'zsh', 'fish', 'powershell')
    'workflow-plan' = @(${INVESTIGATION_PLAN_RECIPES.map((value) => `'${value}'`).join(', ')})
  }
  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  $command = if ($elements.Count -gt 1) { $elements[1] } else { '' }
  $previous = if ($elements.Count -gt 1) { $elements[$elements.Count - 1] } else { '' }
  $candidates = if ($elements.Count -le 2) {
    @($commands) + @('--help', '--version')
  } elseif ($command -eq 'completion' -and $elements.Count -le 3) {
    $values['completion']
  } elseif ($command -eq 'workflow-plan' -and $elements.Count -le 3) {
    $values['workflow-plan']
  } elseif ($values.ContainsKey($previous)) {
    $values[$previous]
  } elseif ($options.ContainsKey($command)) {
    $options[$command]
  } else {
    @('--help')
  }
  foreach ($candidate in $candidates) {
    if ($candidate.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {
      [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
    }
  }
}
`;
}

function buildShellCompletion(shell: CompletionShell): string {
  if (shell === 'bash') return bashCompletion();
  if (shell === 'zsh') return zshCompletion();
  if (shell === 'fish') return fishCompletion();
  return powershellCompletion();
}

export {
  buildShellCompletion,
};
