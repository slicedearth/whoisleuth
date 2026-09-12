/** Keep keyboard and post-operation focus below a sticky control surface. */
export function keepFocusBelow(container: HTMLElement, boundary: () => HTMLElement | null | undefined) {
  let pointerActive = false;
  const startPointer = () => { pointerActive = true; };
  const endPointer = () => { pointerActive = false; };
  const reveal = () => {
    const target = document.activeElement, surface = boundary();
    // Moving a pressed target can change what receives pointer release. Modal
    // controls belong to their own scroll container, not the page behind it.
    if (pointerActive || !surface || !(target instanceof HTMLElement)
      || !container.contains(target) || surface.contains(target) || target.closest('dialog[open]')) return;
    const edge = surface.getBoundingClientRect(), position = target.getBoundingClientRect();
    if (edge.bottom > 0 && position.top < edge.bottom + 12 && position.bottom > edge.top) {
      window.scrollBy({ top: position.top - edge.bottom - 12, behavior: 'instant' });
    }
  };
  container.addEventListener('pointerdown', startPointer, true);
  window.addEventListener('pointerup', endPointer, true);
  window.addEventListener('pointercancel', endPointer, true);
  window.addEventListener('blur', endPointer);
  container.addEventListener('focusin', reveal);
  return { reveal, destroy() {
    container.removeEventListener('pointerdown', startPointer, true);
    window.removeEventListener('pointerup', endPointer, true);
    window.removeEventListener('pointercancel', endPointer, true);
    window.removeEventListener('blur', endPointer);
    container.removeEventListener('focusin', reveal);
  } };
}
