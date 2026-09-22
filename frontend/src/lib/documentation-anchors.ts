export function documentationAnchor(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}

export function revealDocumentationTarget(target: HTMLElement): void {
  let current: HTMLElement | null = target;
  while (current) {
    if (current instanceof HTMLDetailsElement) current.open = true;
    current = current.parentElement;
  }
}
