// A complete 32-MiB workspace's encrypted JSON exceeds 42 MiB. This allowance
// admits that file and supporting evidence without splitting a selected file.
export const MAX_SELECTED_FILES = 128;
export const MAX_SELECTED_FILE_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_SELECTED_FILE_BYTES = MAX_SELECTED_FILE_TOTAL_BYTES;
export const SELECTED_FILE_MEDIA_TYPES = ['application/json', 'application/octet-stream', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'] as const;
export type SelectedFileMediaType = typeof SELECTED_FILE_MEDIA_TYPES[number];
