import {
  WHOISLEUTH_SOURCE_REPOSITORY_URL,
} from './project-metadata.mts';
import { normalizeBoundedSemanticVersion } from './semantic-version.mts';

const URI_LABEL_UNSAFE_GLOBAL_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/gu;
const URI_LABEL_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:(?:\/\/|[^\s])/u;

export type PortableGeneratorMetadata = Readonly<{
  name: 'WHOISleuth';
  version: string | null;
  projectUrl: typeof WHOISLEUTH_SOURCE_REPOSITORY_URL;
}>;

export function isUriShapedLabel(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const candidate = value.replace(URI_LABEL_UNSAFE_GLOBAL_RE, '').trim();
  return URI_LABEL_SCHEME_RE.test(candidate);
}

export function buildPortableGeneratorMetadata(
  applicationVersion: unknown,
): PortableGeneratorMetadata {
  let version: string | null = null;
  if (applicationVersion !== null && applicationVersion !== undefined && applicationVersion !== '') {
    try {
      version = normalizeBoundedSemanticVersion(applicationVersion, 'Portable report application');
    } catch {
      version = null;
    }
  }
  return Object.freeze({
    name: 'WHOISleuth',
    version,
    projectUrl: WHOISLEUTH_SOURCE_REPOSITORY_URL,
  });
}

export function portableGeneratorAttribution(
  generator: PortableGeneratorMetadata,
): string {
  return `Generated with ${generator.name}${generator.version ? ` ${generator.version}` : ''} · Source: ${generator.projectUrl}`;
}
