/** Keep keyboard and post-operation focus clear of sticky controls and viewport edges. */
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
    const top = edge.bottom + 12, bottom = window.innerHeight - 12;
    if (edge.bottom <= 0 || position.bottom <= edge.top) return;
    if (position.top < top) {
      window.scrollBy({ top: position.top - top, behavior: 'instant' });
    } else if (position.bottom > bottom && position.bottom - position.top <= bottom - top) {
      // Native focus scrolling can leave a fractional lower edge clipped. Round
      // outward and retain clearance without hiding an oversized target's top.
      window.scrollBy({ top: Math.ceil(position.bottom - bottom), behavior: 'instant' });
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
