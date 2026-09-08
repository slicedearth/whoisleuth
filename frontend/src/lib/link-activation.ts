/** Whether an anchor activation belongs to the current page's click handler. */
export function handlesLocalLink(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const link = event.currentTarget as HTMLAnchorElement | null;
  return Boolean(link && !link.hasAttribute('download') && (!link.target || link.target === '_self'));
}
