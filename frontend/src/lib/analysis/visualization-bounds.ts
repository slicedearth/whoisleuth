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

export function boundedVisualizationNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback = 0,
) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

export function validVisualizationDate(value: unknown) {
  const text = boundedVisualizationText(value, 64);
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds)
    ? { text: new Date(milliseconds).toISOString(), milliseconds }
    : null;
}
