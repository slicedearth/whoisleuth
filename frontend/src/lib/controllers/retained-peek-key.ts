/** Attach only to the visible retained-inspection button, never to the window or an editor. */
export function openRetainedPeek(event: KeyboardEvent, open: () => void): void {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey
    || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'p') return;
  event.preventDefault();
  open();
}
