import { extendTheme } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { DefaultTheme } from '../default/default-theme.js';

const forestCoinUrl = new URL('../../assets/coin-forest.svg', import.meta.url).href;

export const ForestTheme = extendTheme(DefaultTheme, {
  name: 'forest',
  tokens: {
    accent: '#2f6b41',
    background: '#eef4e8',
    ink: '#22301f',
  },
  assets: {
    'game.coin': { kind: 'image', src: forestCoinUrl },
  },
});
