import {
  createAssetContext,
  createThemeService,
  defineTheme,
  extendTheme,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  ThemeAsset,
  ThemeImageLease,
  ThemeService,
  ThemeTokenValue,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

const base = defineTheme({
  name: 'default',
  tokens: { accent: '#176b58', gap: 4 },
  assets: {
    'ui.pause': { kind: 'image', src: '/pause.png' },
    'game.coin': {
      kind: 'atlas-region',
      src: '/atlas.png',
      frame: { x: 0, y: 0, width: 16, height: 16 },
    },
  },
});

const forest = extendTheme(base, {
  name: 'forest',
  tokens: { accent: '#254f3a' },
  assets: { 'game.coin': { kind: 'image', src: '/coin.png' } },
});

const token: ThemeTokenValue = forest.tokens.accent;
const asset: ThemeAsset = forest.assets['game.coin'];
const service = {} as ThemeService;
const url: string = service.url('game.coin');
const load: Promise<ThemeImageLease> = service.loadImage('game.coin');
void token;
void asset;
void url;
void load;
void createAssetContext;
void createThemeService;

// @ts-expect-error Overrides must use keys declared by the base theme.
extendTheme(base, { name: 'bad', assets: { missing: { kind: 'image', src: '/x.png' } } });
// @ts-expect-error Overrides must use tokens declared by the base theme.
extendTheme(base, { name: 'bad', tokens: { missing: 'x' } });
defineTheme({
  name: 'bad',
  tokens: {},
  // @ts-expect-error Atlas regions require an explicit frame.
  assets: { broken: { kind: 'atlas-region', src: '/x.png' } },
});
// @ts-expect-error Theme assets only support image or atlas-region.
defineTheme({ name: 'bad', tokens: {}, assets: { audio: { kind: 'audio', src: '/x' } } });
