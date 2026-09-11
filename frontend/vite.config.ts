import { sveltekit } from '@sveltejs/kit/vite';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, defineConfig, type Plugin } from 'vite';
import { normalizeBoundedSemanticVersion } from '../lib/semantic-version.mts';
import { browserThirdPartyNoticesPlugin } from '../tools/third-party-notices.mts';
import { frontendWorkerBuild } from '../tools/frontend-worker-build.mts';

const THEME_INIT_PATH = fileURLToPath(new URL('./src/theme-init.ts', import.meta.url));
const THEME_INIT_ASSET = 'theme-init.js';
const ROOT_PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

export const LOCAL_API_PROXY = {
  target: 'http://localhost:3000',
  // The authentication boundary compares Origin with Host. Preserve the
  // browser-facing development host instead of rewriting it to the API host.
  changeOrigin: false,
};

async function applicationVersion(): Promise<string> {
  const document = JSON.parse(await readFile(ROOT_PACKAGE_PATH, 'utf8')) as { version?: unknown };
  return normalizeBoundedSemanticVersion(document.version, 'Root package');
}

function buildRevision(): string {
  const candidates = [
    process.env.WHOISLEUTH_BUILD_REVISION,
    process.env.COMMIT_REF,
    process.env.DEPLOY_COMMIT_REF,
    process.env.GITHUB_SHA,
  ];
  for (const value of candidates) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (/^[a-f0-9]{7,64}$/u.test(normalized)) return normalized;
  }
  try {
    const local = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLowerCase();
    return /^[a-f0-9]{7,64}$/u.test(local) ? local : 'local';
  } catch {
    return 'local';
  }
}

async function compileThemeInitializer(mode: string): Promise<string> {
  // Bundle the same preference owners used by the client into the blocking
  // initialiser. It must not wait for hydration or maintain a second parser.
  const result = await build({
    configFile: false,
    envDir: false,
    mode,
    logLevel: 'silent',
    build: {
      write: false,
      target: 'es2022',
      lib: { entry: THEME_INIT_PATH, name: 'appearance', formats: ['iife'] },
    },
  });
  if ('close' in result) throw new Error('Appearance initialisation cannot use watch mode.');
  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap(output => output.output).filter(output => output.type === 'chunk');
  if (chunks.length !== 1 || chunks[0]!.imports.length || chunks[0]!.dynamicImports.length) {
    throw new Error('Appearance initialisation must be one self-contained script.');
  }
  return chunks[0]!.code;
}

function themeInitializerPlugin(): Plugin {
  let mode = 'production';
  return {
    name: 'whoisleuth-theme-initializer',
    configResolved(config) { mode = config.mode; },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?', 1)[0] !== `/${THEME_INIT_ASSET}`) {
          next();
          return;
        }

        try {
          const source = await compileThemeInitializer(mode);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(source);
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      if (this.environment.name !== 'client') return;
      this.emitFile({
        type: 'asset',
        fileName: THEME_INIT_ASSET,
        source: await compileThemeInitializer(mode),
      });
    },
  };
}

export default defineConfig(async () => {
  const workerBuild = frontendWorkerBuild(fileURLToPath(new URL('.', import.meta.url)));
  return {
    define: {
      __WHOISLEUTH_VERSION__: JSON.stringify(await applicationVersion()),
      __WHOISLEUTH_BUILD_REVISION__: JSON.stringify(buildRevision()),
    },
    plugins: [
      themeInitializerPlugin(),
      workerBuild.client,
      browserThirdPartyNoticesPlugin(fileURLToPath(new URL('..', import.meta.url)), workerBuild.renderedWorkerModules),
      sveltekit(),
    ],
    worker: { plugins: workerBuild.workerPlugins },
    server: {
      proxy: { '/api': LOCAL_API_PROXY },
    },
  };
});
