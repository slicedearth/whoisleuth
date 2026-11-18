import { enumeration, exact } from '../evidence/artifact-structure.mts';
import { SIGHTING_CONTEXT_CASE_SCHEMA_VERSION } from '../contracts/case-portability.mts';
import { normalizeOpaqueReferenceId } from './opaque-reference-id.mts';

export const CASE_SIGHTING_CHANNELS = ['unknown', 'search_result', 'advertisement', 'social_post', 'email', 'sms', 'qr', 'referral', 'direct_navigation', 'messaging', 'document', 'other'] as const;
export const CASE_SIGHTING_DEVICES = ['unknown', 'desktop', 'tablet', 'mobile', 'other'] as const;
export type CaseSightingContext = Readonly<{
  version: 1; channel: typeof CASE_SIGHTING_CHANNELS[number]; deviceClass: typeof CASE_SIGHTING_DEVICES[number];
  declaredCountryCode: string | null; reviewedPathSupplied: 'unknown' | 'yes' | 'no'; captureAttachmentId: string | null;
}>;

/** Declarations only: no location lookup, URL, search terms or message content. */
export function readCaseSightingContext(value: unknown, sourceVersion?: number | null): CaseSightingContext {
  if (sourceVersion != null && sourceVersion < SIGHTING_CONTEXT_CASE_SCHEMA_VERSION) throw new TypeError('Typed sighting context requires the declared compatible Case version.');
  const input = exact(value, ['version', 'channel', 'deviceClass', 'declaredCountryCode', 'reviewedPathSupplied', 'captureAttachmentId'], 'Sighting context');
  if (input.version !== 1 || input.declaredCountryCode !== null && (typeof input.declaredCountryCode !== 'string' || !/^[A-Z]{2}$/u.test(input.declaredCountryCode))
    || input.captureAttachmentId !== null && !normalizeOpaqueReferenceId(input.captureAttachmentId)) throw new TypeError('Sighting context must use supported bounded declarations and an opaque capture reference.');
  return Object.freeze({ version: 1, channel: enumeration(input.channel, CASE_SIGHTING_CHANNELS, 'Encounter channel'),
    deviceClass: enumeration(input.deviceClass, CASE_SIGHTING_DEVICES, 'Declared device class'), declaredCountryCode: input.declaredCountryCode as string | null,
    reviewedPathSupplied: enumeration(input.reviewedPathSupplied, ['unknown', 'yes', 'no'] as const, 'Reviewed path declaration'), captureAttachmentId: input.captureAttachmentId as string | null });
}

export function assertSightingCaptureReferences(sightings: readonly { context?: CaseSightingContext }[], attachments: readonly { id: string }[] | undefined): void {
  const ids = new Set(attachments?.map(item => item.id) ?? []);
  if (sightings.some(item => item.context?.captureAttachmentId && !ids.has(item.context.captureAttachmentId))) throw new TypeError('A sighting capture reference must identify a retained file in this Case.');
}

/** Ordinary reports and shared audiences keep their established private boundary. */
export function withoutSightingContext<T extends { context?: CaseSightingContext }>(value: T): Omit<T, 'context'> {
  const { context: _privateContext, ...rest } = value;
  return rest;
}
