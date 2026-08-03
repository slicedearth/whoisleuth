import { sveltekit } from '@sveltejs/kit/vite';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { defineConfig, type Plugin } from 'vite';

const THEME_INIT_PATH = fileURLToPath(new URL('./src/theme-init.ts', import.meta.url));
const THEME_INIT_ASSET = 'theme-init.js';
const ROOT_PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

async function applicationVersion(): Promise<string> {
  const document = JSON.parse(await readFile(ROOT_PACKAGE_PATH, 'utf8')) as { version?: unknown };
  if (typeof document.version !== 'string' || document.version.length > 128) {
    throw new TypeError('Root package version is unavailable to the frontend build.');
  }
  return document.version;
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

async function compileThemeInitializer(): Promise<string> {
  const source = await readFile(THEME_INIT_PATH, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: THEME_INIT_PATH,
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      removeComments: true,
      sourceMap: false,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return result.outputText;
}

function themeInitializerPlugin(): Plugin {
  return {
    name: 'whoisleuth-theme-initializer',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?', 1)[0] !== `/${THEME_INIT_ASSET}`) {
          next();
          return;
        }

        try {
          const source = await compileThemeInitializer();
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
        source: await compileThemeInitializer(),
      });
    },
  };
}

export default defineConfig(async () => ({
  define: {
    __WHOISLEUTH_VERSION__: JSON.stringify(await applicationVersion()),
    __WHOISLEUTH_BUILD_REVISION__: JSON.stringify(buildRevision()),
  },
  plugins: [themeInitializerPlugin(), sveltekit()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
}));
