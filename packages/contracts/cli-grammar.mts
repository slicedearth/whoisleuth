import { MAX_INVESTIGATION_MANIFEST_ARTIFACTS } from './investigation-package-limits.mts';

export const MAX_CLI_ARGUMENTS = MAX_INVESTIGATION_MANIFEST_ARTIFACTS + 32;
export const MAX_CLI_ARGUMENT_LENGTH = 1024;
export function hasUnsafeCliText(value: string): boolean {
  return /[\x00-\x1f\x7f-\x9f]|\p{Default_Ignorable_Code_Point}/u.test(value);
}

export type CliOptionValueKind = 'enum' | 'file' | 'flag' | 'integer' | 'policy_list' | 'text';
export type CliOptionOccurrence = 'idempotent' | 'once' | 'repeatable';
export type CliOptionScope = 'command' | 'common';
export type CliPositionalValueKind = 'enum' | 'file' | 'text';
export type CliPositionalInputSource = 'argv' | 'argv_or_stdin';
export type CliMetaActionId = 'help' | 'version';
export type CliMetaAction = Readonly<{
  id: CliMetaActionId;
  aliases: readonly string[];
  scope: 'root_only' | 'root_or_command';
  precedence: 'before_command_grammar';
  bypassesOrdinaryRequirements: true;
  acceptsAdditionalArguments: false;
}>;
export type CliOptionIntegerRange = Readonly<{
  minimum: number;
  maximum: number;
  whenOptionPresent: string | null;
}>;
export type CliOptionSpec = Readonly<{
  option: string;
  scope: CliOptionScope;
  arity: 0 | 1;
  valueKind: CliOptionValueKind;
  values: readonly string[];
  integerRanges: readonly CliOptionIntegerRange[];
  occurrence: CliOptionOccurrence;
  acceptsOptionLikeValue: boolean;
  metaAction: CliMetaActionId | null;
}>;
export type CliPositionalSpec = Readonly<{
  name: string;
  valueKind: CliPositionalValueKind;
  minimum: number;
  maximum: number;
  values: readonly string[];
  inputSource: CliPositionalInputSource;
  requiredWhenOptions: readonly string[];
}>;
export type CliGrammarConstraint =
  | Readonly<{ kind: 'mutually_exclusive'; options: readonly string[] }>
  | Readonly<{ kind: 'excludes_all'; option: string; excludedOptions: readonly string[] }>
  | Readonly<{ kind: 'requires_all'; option: string; requiredOptions: readonly string[] }>
  | Readonly<{ kind: 'requires_any'; option: string; requiredOptions: readonly string[] }>
  | Readonly<{ kind: 'value_excludes'; option: string; value: string; excludedOptions: readonly string[] }>
  | Readonly<{ kind: 'required'; options: readonly string[] }>;
export type CliCommandGrammar = Readonly<{
  parserKey: string;
  bootstrapProfile: 'allowed' | 'command_owned';
  options: readonly CliOptionSpec[];
  positionals: readonly CliPositionalSpec[];
  constraints: readonly CliGrammarConstraint[];
  metaActions: readonly CliMetaActionId[];
}>;
