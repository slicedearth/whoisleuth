import { decodeBase64url } from '../../../lib/base64url.mts';

/** Version 1 fixes the KDF, cipher and domain separation in the codec owner. */
export type BrowserWorkspaceEncryption = Readonly<{ version: 1; salt: string; verifier: string }>;
export const BROWSER_WORKSPACE_ENCRYPTION_CODEC = 'aes-gcm-hmac-v1';
export const MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS = 12;
export const MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES = 1_024;

export function readBrowserWorkspaceEncryption(value: unknown): BrowserWorkspaceEncryption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workspace encryption metadata is unreadable.');
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== 3 || keys.some(key => !['version', 'salt', 'verifier'].includes(key)) || row.version !== 1) throw new Error('Workspace encryption uses an unsupported format. Update the application before opening it.');
  try { decodeBase64url(row.salt, 16, 16); decodeBase64url(row.verifier, 32, 32); }
  catch { throw new Error('Workspace encryption metadata is invalid. No saved records were changed.'); }
  return Object.freeze({ version: 1, salt: row.salt as string, verifier: row.verifier as string });
}

export function workspaceEncryptionIdentity(value: BrowserWorkspaceEncryption): string {
  const encryption = readBrowserWorkspaceEncryption(value);
  return `${encryption.version}:${encryption.salt}:${encryption.verifier}`;
}
