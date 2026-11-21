import { MAX_CLI_LOOKUP_BYTES } from './cli-lookup.mts';

export const MAX_MCP_EVIDENCE_FILES = 8;
export const MAX_MCP_EVIDENCE_BYTES = MAX_CLI_LOOKUP_BYTES;
export const MAX_MCP_TOTAL_BYTES = 2 * MAX_MCP_EVIDENCE_BYTES;
export const MAX_MCP_OUTPUT_BYTES = 64 * 1024;
export const MAX_MCP_MESSAGE_BYTES = 32 * 1024;
