import {
  WHOISLEUTH_SOURCE_REPOSITORY_URL,
} from './project-metadata.mts';
import { normalizeBoundedSemanticVersion } from './semantic-version.mts';

export type PortableGeneratorMetadata = Readonly<{
  name: 'WHOISleuth';
  version: string | null;
  projectUrl: typeof WHOISLEUTH_SOURCE_REPOSITORY_URL;
}>;

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
