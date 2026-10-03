import packageDocument from '../package.json' with { type: 'json' };
import { normalizeBoundedSemanticVersion } from '../packages/analysis/semantic-version.mts';

export const WHOISLEUTH_APPLICATION_VERSION = normalizeBoundedSemanticVersion(
  packageDocument.version,
  'Application manifest',
);
