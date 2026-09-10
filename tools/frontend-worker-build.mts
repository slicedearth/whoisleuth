import path from 'node:path';
import { realpathSync } from 'node:fs';
import type { Plugin } from 'vite';
import { parseBoundedJsonObject } from '../lib/bounded-json.mts';
import { boundedSafeRelativePath, compareCodeUnits } from './maintainer-tool-helpers.mts';

const MAX_OUTPUTS = 4_096;
const MAX_MODULES = 4_096;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
type WorkerEntry = Readonly<{ file: string; assets: readonly string[] }>;

/** Vite emits worker files separately; record their actual bundle outputs in its existing manifest. */
export function frontendWorkerBuild(frontendRoot: string) {
  const sourceRoot = realpathSync(frontendRoot);
  const entries = new Map<string, WorkerEntry>();
  const renderedModules = new Set<string>();
  let entryBytes = 0;
  const client: Plugin = {
    name: 'whoisleuth-worker-manifest',
    buildStart() {
      if (this.environment.name !== 'client') return;
      entries.clear();
      renderedModules.clear();
      entryBytes = 0;
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (this.environment.name !== 'client' || entries.size === 0) return;
        const asset = bundle['.vite/manifest.json'];
        if (!asset || asset.type !== 'asset') throw new TypeError('Worker outputs require the current browser manifest.');
        const manifest = parseBoundedJsonObject(Buffer.from(asset.source).toString('utf8'), {
          label: 'Browser worker manifest', maximumBytes: MAX_MANIFEST_BYTES,
        });
        for (const [source, entry] of [...entries].sort(([left], [right]) => compareCodeUnits(left, right))) {
          if (Object.hasOwn(manifest, source)) throw new TypeError('Browser and worker source identities must not collide.');
          manifest[source] = entry;
        }
        if (Object.keys(manifest).length > MAX_OUTPUTS) throw new TypeError('Browser worker manifest exceeds its entry bound.');
        const output = JSON.stringify(manifest, null, 2);
        if (Buffer.byteLength(output) > MAX_MANIFEST_BYTES) throw new TypeError('Browser worker manifest exceeds its byte bound.');
        asset.source = output;
      },
    },
  };
  const workerPlugins = (): Plugin[] => [{
    name: 'whoisleuth-worker-outputs',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const outputs = Object.values(bundle);
        if (outputs.length < 1 || outputs.length > MAX_OUTPUTS) throw new TypeError('Worker output inventory exceeds its bound.');
        const files = outputs.map((output) => {
          const file = boundedSafeRelativePath(output.fileName, 'Worker output', 1_024);
          if (!file.startsWith('_app/immutable/')) throw new TypeError('Worker output must remain in the immutable asset tree.');
          return file;
        }).sort(compareCodeUnits);
        for (const output of outputs) {
          if (output.type !== 'chunk') continue;
          for (const [id, module] of Object.entries(output.modules)) {
            if (module.renderedLength === 0) continue;
            if (id.length > 4_096 || renderedModules.size >= MAX_MODULES && !renderedModules.has(id)) throw new TypeError('Worker module inventory exceeds its bound.');
            renderedModules.add(id);
          }
          if (!output.isEntry) continue;
          if (!output.facadeModuleId) throw new TypeError('Worker entry has no source identity.');
          const source = boundedSafeRelativePath(path.relative(sourceRoot, realpathSync(output.facadeModuleId)).split(path.sep).join('/'), 'Worker source', 1_024);
          if (!source.startsWith('src/')) throw new TypeError('Browser worker entries must have a frontend source identity.');
          const entry = { file: output.fileName, assets: files.filter((file) => file !== output.fileName) };
          const prior = entries.get(source);
          if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) throw new TypeError('Worker source has conflicting bundle outputs.');
          if (!prior) entryBytes += Buffer.byteLength(source) + Buffer.byteLength(JSON.stringify(entry));
          if (entryBytes > MAX_MANIFEST_BYTES) throw new TypeError('Worker entries exceed the manifest byte bound.');
          entries.set(source, entry);
          if (entries.size > MAX_OUTPUTS) throw new TypeError('Worker entry inventory exceeds its bound.');
        }
      },
    },
  }];
  return { client, workerPlugins, renderedWorkerModules: () => [...renderedModules] };
}
