import { sveltekit } from '@sveltejs/kit/vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { defineConfig, type Plugin } from 'vite';

const THEME_INIT_PATH = fileURLToPath(new URL('./src/theme-init.ts', import.meta.url));
const THEME_INIT_ASSET = 'theme-init.js';

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
      this.emitFile({
        type: 'asset',
        fileName: THEME_INIT_ASSET,
        source: await compileThemeInitializer(),
      });
    },
  };
}

export default defineConfig({
  plugins: [themeInitializerPlugin(), sveltekit()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
