import { defineConfig } from 'vite';
import { jingchuanchu } from '@xiaobaibaifqy/jingchuanchu-tooling/vite';

export default defineConfig({
  plugins: [jingchuanchu()],
  define: {
    __JCC_THEME__: JSON.stringify('default'),
  },
  build: {
    target: 'es2022',
  },
});
