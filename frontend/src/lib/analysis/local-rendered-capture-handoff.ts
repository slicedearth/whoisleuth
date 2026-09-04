import { parseIncidentUrlContext } from './case-model.ts';

export type LocalRenderedCaptureHandoff = Readonly<{
  command: string;
  exactUrl: string;
  hostname: string;
  outputDirectory: string;
  manifestPath: string;
}>;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function captureDirectory(hostname: string, now: Date): string {
  const host = hostname.replace(/[^a-z0-9.-]+/giu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'target';
  const timestamp = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return `~/whoisleuth-capture-${host}-${timestamp}`;
}

export function buildLocalRenderedCaptureHandoff(
  incidentUrl: unknown,
  now: Date = new Date(),
): LocalRenderedCaptureHandoff {
  const parsed = parseIncidentUrlContext(incidentUrl);
  if (!parsed) throw new Error('A retained absolute HTTP(S) Incident URL is required for rendered capture.');
  const url = new URL(parsed.exactUrl);
  if (url.port) {
    throw new Error('Local rendered capture does not support a non-default target port.');
  }
  const outputDirectory = captureDirectory(parsed.hostname, now);
  return Object.freeze({
    command: `npm run capture:local -- ${shellQuote(parsed.exactUrl)} --output-dir ${outputDirectory} --authorize-rendered-capture`,
    exactUrl: parsed.exactUrl,
    hostname: parsed.hostname,
    outputDirectory,
    manifestPath: `${outputDirectory}/manifest.json`,
  });
}
