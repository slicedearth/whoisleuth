import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { build, defineConfig, type Plugin } from 'vite';
import { frontendBuildIdentity } from './build-identity.ts';
import { browserThirdPartyNoticesPlugin } from '../tools/third-party-notices.mts';
import { frontendWorkerBuild } from '../tools/frontend-worker-build.mts';

const THEME_INIT_PATH = fileURLToPath(new URL('./src/theme-init.ts', import.meta.url));
const THEME_INIT_ASSET = 'theme-init.js';

export const LOCAL_API_PROXY = {
  target: 'http://localhost:3000',
  // The authentication boundary compares Origin with Host. Preserve the
  // browser-facing development host instead of rewriting it to the API host.
  changeOrigin: false,
};

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
  const identity = frontendBuildIdentity();
  const workerBuild = frontendWorkerBuild(fileURLToPath(new URL('.', import.meta.url)));
  return {
    define: {
      __WHOISLEUTH_VERSION__: JSON.stringify(identity.applicationVersion),
      __WHOISLEUTH_BUILD_REVISION__: JSON.stringify(identity.buildRevision),
    },
    plugins: [
      themeInitializerPlugin(),
      workerBuild.client,
      browserThirdPartyNoticesPlugin(fileURLToPath(new URL('..', import.meta.url)), workerBuild.renderedWorkerModules),
      sveltekit({
        preprocess: vitePreprocess(),
        version: { name: identity.updateVersion, pollInterval: 0 },
        adapter: adapter({ pages: 'build', assets: 'build', strict: true }),
        csp: {
          mode: 'hash',
          directives: {
            'default-src': ['self'],
            'script-src': ['self', 'https://challenges.cloudflare.com'],
            'style-src': ['self', 'unsafe-inline'],
            'img-src': ['self', 'data:'],
            'font-src': ['self'],
            'connect-src': ['self'],
            'frame-src': ['https://challenges.cloudflare.com'],
            'base-uri': ['self'],
            'form-action': ['self'],
            'object-src': ['none'],
          },
        },
      }),
    ],
    worker: { plugins: workerBuild.workerPlugins },
    server: {
      proxy: { '/api': LOCAL_API_PROXY },
    },
  };
});
