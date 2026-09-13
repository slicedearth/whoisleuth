import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from './selected-file-limits.mts';

export const MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES = 512 * 1024;
export const MAX_INVESTIGATION_PACKAGE_ENTRIES = MAX_SELECTED_FILES + 1;
// Stored ZIP entries use 76 header bytes and two generated ASCII paths (at
// most 21 bytes each). 128 bytes per entry plus the 22-byte end record cover
// this writer's overhead without reducing the independently admitted payload.
export const MAX_INVESTIGATION_PACKAGE_BYTES = MAX_SELECTED_FILE_TOTAL_BYTES
  + MAX_INVESTIGATION_MANIFEST_DOCUMENT_BYTES + MAX_INVESTIGATION_PACKAGE_ENTRIES * 128 + 22;

export const ENCRYPTED_INVESTIGATION_PACKAGE_MAGIC = 'WHOISLEUTH-ENCRYPTED\0';
export const ENCRYPTED_INVESTIGATION_PACKAGE_VERSION = 1;
// Magic, version byte, iteration count, salt, IV and plaintext byte count.
export const ENCRYPTED_INVESTIGATION_PACKAGE_HEADER_BYTES = ENCRYPTED_INVESTIGATION_PACKAGE_MAGIC.length + 1 + 4 + 16 + 12 + 4;
export const MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES = MAX_INVESTIGATION_PACKAGE_BYTES
  + ENCRYPTED_INVESTIGATION_PACKAGE_HEADER_BYTES + 16;

export function hasEncryptedInvestigationPackagePrefix(bytes: Uint8Array): boolean {
  return bytes.byteLength >= ENCRYPTED_INVESTIGATION_PACKAGE_MAGIC.length
    && [...ENCRYPTED_INVESTIGATION_PACKAGE_MAGIC].every((character, index) => bytes[index] === character.charCodeAt(0));
}
