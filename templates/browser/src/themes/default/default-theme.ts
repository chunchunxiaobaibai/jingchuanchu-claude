import { defineTheme } from '@xiaobaibaifqy/jingchuanchu-app/application';

const coinUrl = new URL('../../assets/coin.svg', import.meta.url).href;
const pauseUrl = new URL('../../assets/pause.svg', import.meta.url).href;

export const DefaultTheme = defineTheme({
  name: 'default',
  tokens: {
    accent: '#176b58',
    background: '#f6f1e7',
    ink: '#1f2a26',
    muted: '#6c7a72',
  },
  assets: {
    'ui.pause': { kind: 'image', src: pauseUrl },
    'game.coin': {
      kind: 'atlas-region',
      src: coinUrl,
      frame: { x: 0, y: 0, width: 16, height: 16 },
    },
  },
});
