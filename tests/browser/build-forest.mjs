import { build } from 'vite';
import { resolve } from 'node:path';

await build({
  root: resolve('templates/browser'),
  configFile: resolve('templates/browser/vite.config.ts'),
  define: {
    __JCC_THEME__: JSON.stringify('forest'),
  },
  build: {
    outDir: resolve('tests/browser/artifacts/forest-dist'),
    emptyOutDir: true,
  },
});
console.log('Forest theme build: tests/browser/artifacts/forest-dist');
