import {
  createAssetContext,
  createAudioService,
  createThemeService,
  defineAudio,
  defineService,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  AssetAdapters,
  AssetContext,
  AudioService,
  ThemeService,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { createWebAudioDriver } from './audio-driver.js';
import { DefaultTheme } from '../themes/default/default-theme.js';
import { ForestTheme } from '../themes/forest/forest-theme.js';

declare const __JCC_THEME__: string;

const SelectedTheme = __JCC_THEME__ === 'forest' ? ForestTheme : DefaultTheme;

const clickUrl = new URL('../assets/audio/click.wav', import.meta.url).href;
const coinSoundUrl = new URL('../assets/audio/coin.wav', import.meta.url).href;
const musicUrl = new URL('../assets/audio/theme.wav', import.meta.url).href;

const AudioCatalog = defineAudio({
  name: 'reference',
  music: { theme: musicUrl },
  effects: { coin: coinSoundUrl, click: clickUrl },
});

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Cannot load image: ${url}`));
    image.src = url;
  });
}

const adapters: AssetAdapters = {
  image: (url) => loadImage(url),
  async atlas(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot load atlas: ${url}`);
    return response.json();
  },
  async audio(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot load audio: ${url}`);
    return response.arrayBuffer();
  },
  async json(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot load json: ${url}`);
    return response.json();
  },
};

export interface AppServices {
  readonly assets: AssetContext;
  readonly theme: ThemeService;
  readonly audio: AudioService<typeof AudioCatalog.music, typeof AudioCatalog.effects>;
}

export const AppServicesDef = defineService<AppServices>({
  name: 'reference-app-services',
  factory(context) {
    const assets = createAssetContext({ adapters });
    context.own(() => assets.dispose());
    const theme = createThemeService(SelectedTheme, {
      assets,
      onError: (error) => console.error(error),
    });
    const audio = createAudioService({
      audio: AudioCatalog,
      assets,
      driver: createWebAudioDriver(),
      scope: context.scope,
      ownsDriver: true,
      maxConcurrentEffects: 4,
      onError: (error) => console.error(error),
    });
    return { assets, theme, audio };
  },
});
