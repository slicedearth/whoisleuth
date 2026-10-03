import { parseBoundedJson } from '../../../packages/analysis/bounded-json.mts';
import { MAX_CONTEXT_INPUT_BYTES, CONTEXT_INPUT_CONTRACTS } from '../../../packages/contracts/context-review.mts';
import { exact } from '../../../packages/evidence/artifact-structure.mts';

export async function readContextFile(file: File): Promise<string> {
  if (!file.size || file.size > MAX_CONTEXT_INPUT_BYTES) throw new TypeError('Select a non-empty JSON file of at most 16 MiB.');
  return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
}
export function readContextEvidence(input: string, schema: string): unknown {
  const root = exact(parseBoundedJson(input, { label: 'Context review input', maximumBytes: MAX_CONTEXT_INPUT_BYTES }), ['schema', 'version', 'evidence'], 'Context input');
  if (root.schema !== schema || !CONTEXT_INPUT_CONTRACTS.some(input => input.schema === root.schema && input.version === root.version)) throw new TypeError('This file uses a different review schema or an unsupported version.');
  return root.evidence;
}
