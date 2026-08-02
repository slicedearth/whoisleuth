export function boundedVisualizationText(value: unknown, maxLength: number) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

export function boundedVisualizationId(value: unknown) {
  return boundedVisualizationText(value, 64)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}
