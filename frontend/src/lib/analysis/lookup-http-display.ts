import {
  boundedTechnologyText,
  rec,
  records,
  show,
  type JsonRecord,
} from './lookup-display-shared.ts';
import { MAX_HTTP_ATTEMPTS, MAX_HTTP_EVIDENCE_REDIRECTS } from '../../../../lib/http-evidence-bounds.mts';
import { deliveryMetadataDisplay } from './lookup-homepage-metadata-display.ts';

function httpStatus(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 100 && Number(value) <= 599
    ? Number(value)
    : null;
}

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;
}

export function buildLookupHttpDisplay(input: {
  httpEvidence: JsonRecord;
  httpResponse: JsonRecord;
  httpSecurityHeaders: JsonRecord;
  httpDeliveryMetadata?: JsonRecord | undefined;
}) {
  const {
    httpEvidence,
    httpResponse,
    httpSecurityHeaders,
    httpDeliveryMetadata = {},
  } = input;
  const responseStatus = httpStatus(httpResponse.status);
  const httpSecurityRows: Array<[string, unknown]> = [
    ['HSTS', httpSecurityHeaders.strictTransportSecurity],
    ['Content Security Policy', httpSecurityHeaders.contentSecurityPolicy],
    ['Frame protection', httpSecurityHeaders.xFrameOptions],
    ['Content-type protection', httpSecurityHeaders.xContentTypeOptions],
    ['Referrer policy', httpSecurityHeaders.referrerPolicy],
  ];
  const httpMetadata: Array<{ label: string; value: string; hash?: boolean }> = [];
  if (responseStatus !== null) {
    httpMetadata.push(
      ...httpSecurityRows.map(([label, value]) => ({
        label,
        value: value === 'observed' ? 'Observed' : show(value),
      })),
      { label: 'Server', value: show(httpResponse.server) },
      { label: 'Content language', value: show(httpResponse.contentLanguage) },
      {
        label: 'Declared length',
        value: httpResponse.declaredContentLength === null
          || httpResponse.declaredContentLength === undefined
          ? '—'
          : formatBytes(httpResponse.declaredContentLength),
      },
    );
    const bodyHash = rec(httpResponse.bodyHash);
    if (bodyHash.value) {
      httpMetadata.push(
        { label: 'Body SHA-256', value: show(bodyHash.value), hash: true },
        {
          label: 'Hash scope',
          value: bodyHash.scope === 'captured-prefix'
            ? `Captured prefix (${formatBytes(bodyHash.bytes)})`
            : `Complete captured body (${formatBytes(bodyHash.bytes)})`,
        },
      );
    }
  }

  return {
    httpRows: [
      { label: 'Final URL', value: show(httpEvidence.finalUrl || httpEvidence.requestUrl) },
      {
        label: 'Response',
        value: responseStatus === null ? 'Not observed' : `HTTP ${responseStatus}`,
      },
      {
        label: 'Transport',
        value: httpEvidence.transportSecurity === 'https'
          ? 'HTTPS'
          : httpEvidence.transportSecurity === 'http'
            ? 'Cleartext HTTP'
            : 'Not observed',
      },
      { label: 'Redirects', value: show(httpEvidence.redirectCount) },
      { label: 'Content type', value: show(httpResponse.contentType) },
      {
        label: 'Body captured',
        value: `${formatBytes(httpResponse.capturedBodyBytes)}${
          httpResponse.bodyTruncated ? ' · capped' : ''
        }`,
      },
    ],
    httpRedirects: records(httpEvidence.redirects).slice(0, MAX_HTTP_EVIDENCE_REDIRECTS).map((redirect) => ({
      status: show(redirect.status),
      from: show(redirect.from),
      to: show(redirect.to),
      queryOmitted: Boolean(redirect.queryOmitted),
    })),
    httpAttempts: (() => {
      const attempts = records(httpEvidence.attempts).slice(0, MAX_HTTP_ATTEMPTS);
      return attempts.some((attempt) => attempt.error)
        ? attempts.map((attempt) => ({
            url: show(attempt.url),
            detail: attempt.error ? String(attempt.error) : `HTTP ${show(attempt.httpStatus)}`,
          }))
        : [];
    })(),
    httpMetadata,
    httpDeliveryMetadata: deliveryMetadataDisplay(
      Object.keys(httpDeliveryMetadata).length ? httpDeliveryMetadata : null,
    ),
  };
}
