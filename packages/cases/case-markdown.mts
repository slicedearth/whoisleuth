/** Keep untrusted Case prose literal, including block syntax and GFM autolinks. */
export function escapeCaseMarkdownInline(text: unknown): string {
  return String(text)
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/([\\`*_{}\[\]<>()#+!|~])/g, '\\$1')
    .replace(/^(\s*)([-=]+)(?=\s|$)/u, '$1\\$2')
    .replace(/^(\s*\d+)\.(?=\s)/u, '$1\\.')
    // Break automatic links without altering the underlying evidence value.
    .replace(/\b([a-z][a-z0-9+.-]{1,31}):(?=\/\/)/gi, '$1\\:')
    .replace(/\bwww\.(?=\S)/gi, 'www\\.');
}
