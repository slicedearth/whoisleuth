import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { normalizeBoundedSemanticVersion } from '../packages/analysis/semantic-version.mts';

/** Build labels, not a substitute for the separately verified source/build digest. */
export function frontendBuildIdentity(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  readRevision: () => string = () => execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }),
  version: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
) {
  const applicationVersion = normalizeBoundedSemanticVersion(version, 'Root package');
  const candidates = [environment.WHOISLEUTH_BUILD_REVISION, environment.COMMIT_REF, environment.DEPLOY_COMMIT_REF, environment.GITHUB_SHA];
  const normalise = (value: string | undefined) => {
    const candidate = (value ?? '').trim().toLowerCase();
    return /^[a-f0-9]{7,64}$/u.test(candidate) ? candidate : null;
  };
  let revision = candidates.map(normalise).find(Boolean);
  if (!revision) {
    try { revision = normalise(readRevision()); } catch { /* Source archives may have no Git metadata. */ }
  }
  const buildRevision = revision || 'local';
  return Object.freeze({ applicationVersion, buildRevision, updateVersion: `${applicationVersion}-${buildRevision}` });
}
