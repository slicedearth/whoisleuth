import { createLinkIntake, type LinkIntake } from '../../../../packages/investigation/link-intake.mts';
import { MAX_INTAKE_URL_LENGTH } from '../../../../packages/contracts/message-intake.mts';

// Plain pasted input is separate from the broader file/document intake budget.
export const MAX_PUBLIC_LINK_TEXT_BYTES = 64 * 1024;
export const MAX_PUBLIC_LINK_URL_BYTES = MAX_INTAKE_URL_LENGTH;
export const PUBLIC_LINK_EXAMPLE = Object.freeze({
  input: 'hxxps://signin.example/?next=https%3A%2F%2Faccounts.example%2Fverify',
  displayedText: 'portal.example',
});
export type PublicLinkInputKind = 'link' | 'text';
export type PublicLinkInspection = Readonly<
  { state: 'reviewed'; intake: LinkIntake } | { state: 'unavailable'; message: string }
>;

function withinBytes(value: string, maximum: number): boolean {
  return value.length <= maximum && new TextEncoder().encode(value).byteLength <= maximum;
}

/** Inert supplied input only: no resolution, collection, persistence or export. */
export function inspectPublicLinks(kind: PublicLinkInputKind, input: string, displayedText = ''): PublicLinkInspection {
  const maximum = kind === 'link' ? MAX_PUBLIC_LINK_URL_BYTES : MAX_PUBLIC_LINK_TEXT_BYTES;
  if (!withinBytes(input, maximum) || !withinBytes(displayedText, MAX_PUBLIC_LINK_URL_BYTES)) {
    return { state: 'unavailable', message: 'This input exceeds the local review size limit. Review a smaller selection.' };
  }
  if (!input.trim()) return { state: 'unavailable', message: 'Enter a link or paste text to review.' };
  try {
    const parser = createLinkIntake();
    if (kind === 'link') parser.add(input, 'text', displayedText);
    else parser.addText(input);
    return { state: 'reviewed', intake: parser.result() };
  } catch {
    return { state: 'unavailable', message: 'This input could not be reviewed locally. Saved work has not been changed.' };
  }
}
