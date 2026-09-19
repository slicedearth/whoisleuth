// Single plain recipient admission for manually opened drafts, not delivery validation.
const SINGLE_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/u;

export function emailRecipient(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 320 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const address = value.trim();
  return SINGLE_ADDRESS.test(address) ? address : null;
}

/** Encode the recipient independently; upstream text never becomes a header. */
export function recipientMailto(value: unknown, headers?: Readonly<{ subject: string; body: string }>): string | null {
  const address = emailRecipient(value);
  if (!address) return null;
  const query = headers ? `?subject=${encodeURIComponent(headers.subject)}&body=${encodeURIComponent(headers.body)}` : '';
  return `mailto:${encodeURIComponent(address).replace('%40', '@')}${query}`;
}
