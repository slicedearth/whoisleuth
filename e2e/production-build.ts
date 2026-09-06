import {
  assertFrontendBuildIntegrity,
  frontendProductionChunk,
  type FrontendBuildIntegritySnapshot,
} from '../tools/frontend-build-integrity.mts';

let verifiedBuild: FrontendBuildIntegritySnapshot | null = null;

export function productionChunkPath(source: string): string {
  verifiedBuild ??= assertFrontendBuildIntegrity(process.cwd());
  return frontendProductionChunk(verifiedBuild, source);
}
