/**
 * Fade a public section in once it first scrolls into view.
 *
 * Content is never hidden without script support, when it is already on screen
 * at mount, under reduced motion, or with minimal effects. Print and later
 * preference changes reveal any section still waiting through CSS.
 */
export function revealOnScroll(node: HTMLElement) {
  if (typeof IntersectionObserver === 'undefined'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.effects === 'minimal'
    || node.getBoundingClientRect().top < window.innerHeight) return;
  node.classList.add('reveal-pending');
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    node.classList.add('reveal-in');
    node.classList.remove('reveal-pending');
    observer.disconnect();
  }, { rootMargin: '0px 0px -8% 0px' });
  observer.observe(node);
  return {
    destroy() {
      observer.disconnect();
      node.classList.remove('reveal-pending');
    },
  };
}
