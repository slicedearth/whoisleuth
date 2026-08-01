import { CLI_COMMANDS, type CompletionShell } from './arguments.mts';

const COMMON_OPTIONS = Object.freeze(['--help', '--output', '--force']);
const OPTIONS_BY_COMMAND: Readonly<Record<string, readonly string[]>> = Object.freeze({
  lookup: ['--json', '--markdown', '--html', '--fast', '--deep', '--summary', '--verbose', '--strict-exit', '--events', '--quiet', '--no-color'],
  bulk: ['--json', '--jsonl', '--fast', '--deep', '--concurrency', '--checkpoint', '--resume', '--events', '--quiet', '--no-color'],
  'ct-search': ['--json', '--quiet', '--no-color'],
  discover: ['--tlds', '--preset', '--families', '--keyboard', '--dictionary', '--json', '--jsonl', '--quiet', '--no-color'],
  posture: ['--selectors', '--retired-selectors', '--mail-profile', '--json', '--quiet', '--no-color'],
  http: ['--json', '--quiet', '--no-color'],
  tls: ['--json', '--quiet', '--no-color'],
  'registry-support': ['--json', '--quiet', '--no-color'],
  'risk-calibrate': ['--json', '--quiet', '--no-color'],
  'verify-artifact': ['--passphrase-file', '--json', '--quiet', '--no-color'],
  'inspect-archive': ['--passphrase-file', '--search', '--require-match', '--reveal', '--json', '--quiet', '--no-color'],
  'sign-artifact': ['--private-key-file'],
  'verify-signature': ['--public-key-file', '--json', '--quiet', '--no-color'],
  'source-report': ['--json', '--quiet', '--no-color'],
  compare: ['--json', '--quiet', '--no-color'],
  diff: ['--json', '--quiet', '--no-color'],
  export: ['--markdown', '--html', '--compact'],
  completion: [],
  doctor: ['--network', '--json', '--quiet', '--no-color'],
  manual: [],
});

const COMMAND_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  lookup: 'Collect one domain, IP, or ASN',
  bulk: 'Run bounded multi-target collection',
  'ct-search': 'Search certificate observations',
  discover: 'Generate lookalike candidates offline',
  posture: 'Review DNS and mail posture',
  http: 'Inspect one homepage request',
  tls: 'Inspect one TLS connection',
  'registry-support': 'Explain local registry coverage',
  'risk-calibrate': 'Replay reviewed Risk labels offline',
  'verify-artifact': 'Validate an evidence artifact offline',
  'inspect-archive': 'Inspect an archive locally',
  'sign-artifact': 'Sign a reviewed artifact locally',
  'verify-signature': 'Verify a signed evidence package',
  'source-report': 'Build a target-free source report',
  compare: 'Compare registry publications in one lookup',
  diff: 'Compare two saved domain lookups',
  export: 'Convert a lookup to an evidence report',
  completion: 'Print shell completion',
  doctor: 'Check the local CLI runtime',
  manual: 'Print the generated manual page',
});

const VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '--preset': ['common', 'impersonation', 'all'],
  '--keyboard': ['qwerty', 'azerty', 'qwertz', 'all'],
  '--mail-profile': ['standard', 'defensive-no-mail', 'parked'],
  '--concurrency': ['1', '2', '3', '4', '5', '6', '7', '8'],
});

const FILE_OPTIONS = Object.freeze([
  '--checkpoint',
  '--dictionary',
  '--output',
  '--passphrase-file',
  '--private-key-file',
  '--public-key-file',
]);

const TEXT_OPTIONS = Object.freeze([
  '--families',
  '--retired-selectors',
  '--search',
  '--selectors',
  '--tlds',
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
    COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${current}") )
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
    compadd -- bash zsh fish
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
complete -c whoisleuth -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
${optionLines.join('\n')}
${valueLines.join('\n')}
`;
}

function buildShellCompletion(shell: CompletionShell): string {
  if (shell === 'bash') return bashCompletion();
  if (shell === 'zsh') return zshCompletion();
  return fishCompletion();
}

export {
  COMMAND_DESCRIPTIONS,
  FILE_OPTIONS,
  OPTIONS_BY_COMMAND,
  TEXT_OPTIONS,
  VALUE_OPTIONS,
  buildShellCompletion,
};
