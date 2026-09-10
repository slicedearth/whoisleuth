/** Download an already prepared local file without rendering its contents. */
export function downloadLocalFile(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally { URL.revokeObjectURL(url); }
}
