import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  ThemeError,
  createAssetContext,
  createThemeService,
  defineTheme,
  extendTheme,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { AssetAdapters } from '@xiaobaibaifqy/jingchuanchu-app/application';

const frame = { x: 0, y: 0, width: 16, height: 16 };

function adapters(failing: (url: string) => boolean = () => false) {
  const calls: string[] = [];
  const value: AssetAdapters = {
    async image(url) {
      calls.push(url);
      await Promise.resolve();
      if (failing(url)) throw new Error(`cannot load ${url}`);
      return { url };
    },
    async atlas(url) {
      return { url };
    },
    async audio(url) {
      return { url };
    },
    async json(url) {
      return { url };
    },
  };
  return { calls, adapters: value };
}

function defaultTheme() {
  return defineTheme({
    name: 'default',
    tokens: { accent: '#176b58', gap: 4 },
    assets: {
      'ui.pause': { kind: 'image', src: '/pause.png' },
      'game.coin': { kind: 'atlas-region', src: '/atlas.png', frame },
    },
  });
}

test('themes merge tokens and replace asset descriptions wholesale', () => {
  const base = defaultTheme();
  const forest = extendTheme(base, {
    name: 'forest',
    tokens: { accent: '#254f3a' },
    assets: { 'game.coin': { kind: 'image', src: '/coin.png' } },
  });
  assert.equal(forest.name, 'forest');
  assert.equal(forest.tokens.accent, '#254f3a');
  assert.equal(forest.tokens.gap, 4);
  assert.equal(forest.assets['game.coin'].kind, 'image');
  assert.equal(forest.assets['game.coin'].src, '/coin.png');
  assert.equal(forest.assets['ui.pause'].src, '/pause.png');
  assert.strictEqual(forest.base, base);
});

test('theme service resolves DOM URLs and Canvas frames from the same key map', async () => {
  const base = defaultTheme();
  const forest = extendTheme(base, {
    name: 'forest',
    assets: { 'game.coin': { kind: 'image', src: '/coin.png' } },
  });
  const created = adapters();
  const assets = createAssetContext({ adapters: created.adapters });
  const service = createThemeService(forest, { assets });
  assert.equal(service.url('game.coin'), '/coin.png');
  const image = await service.loadImage('game.coin');
  assert.deepEqual(image.image, { url: '/coin.png' });
  assert.equal(image.frame, undefined);
  assert.deepEqual(created.calls, ['/coin.png']);
  image.release();

  const atlasService = createThemeService(base, { assets });
  assert.equal(atlasService.url('game.coin'), '/atlas.png');
  const atlasImage = await atlasService.loadImage('game.coin');
  assert.deepEqual(atlasImage.frame, frame);
  atlasImage.release();
  assert.throws(() => service.url('missing.key'), ThemeError);
  assert.throws(() => service.token('missing'), ThemeError);
  assets.dispose();
});

test('failed theme overrides fall back to the default asset and report the source', async () => {
  const base = defaultTheme();
  const forest = extendTheme(base, {
    name: 'forest',
    assets: { 'game.coin': { kind: 'image', src: '/forest-coin.png' } },
  });
  const created = adapters((url) => url === '/forest-coin.png');
  const assets = createAssetContext({ adapters: created.adapters });
  const fallbacks: Array<{ key: string; reason: unknown }> = [];
  const service = createThemeService(forest, {
    assets,
    onFallback: (reason, key) => fallbacks.push({ key, reason }),
  });
  const image = await service.loadImage('game.coin');
  assert.deepEqual(image.image, { url: '/atlas.png' });
  assert.deepEqual(image.frame, frame);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0]!.key, 'game.coin');
  image.release();
  assets.dispose();
});

test('a missing fallback surfaces an explicit theme error', async () => {
  const base = defaultTheme();
  const broken = extendTheme(base, {
    name: 'broken',
    assets: { 'game.coin': { kind: 'image', src: '/broken.png' } },
  });
  const created = adapters((url) => url === '/broken.png' || url === '/atlas.png');
  const assets = createAssetContext({ adapters: created.adapters });
  const errors: unknown[] = [];
  const service = createThemeService(broken, {
    assets,
    onError: (error) => errors.push(error),
  });
  await assert.rejects(service.loadImage('game.coin'), (error) => {
    assert.ok(error instanceof ThemeError);
    assert.equal(error.key, 'game.coin');
    return true;
  });
  assert.equal(errors.length, 1);
  assets.dispose();
});

test('token CSS variables are scoped to the target element and applications stay isolated', () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const element = document.createElement('div');
  const base = defaultTheme();
  const forest = extendTheme(base, { name: 'forest', tokens: { accent: '#254f3a' } });
  const assets = createAssetContext({ adapters: adapters().adapters });
  const baseService = createThemeService(base, { assets });
  const forestService = createThemeService(forest, { assets });
  const cleanup = forestService.applyTokens(element);
  assert.equal(element.style.getPropertyValue('--jcc-accent'), '#254f3a');
  assert.equal(element.style.getPropertyValue('--jcc-gap'), '4');
  assert.equal(baseService.token('accent'), '#176b58');
  assert.equal(forestService.token('accent'), '#254f3a');
  cleanup();
  assert.equal(element.style.getPropertyValue('--jcc-accent'), '');
  assets.dispose();
});

test('extendTheme rejects keys that the base theme does not declare', () => {
  const base = defaultTheme();
  assert.throws(
    () =>
      extendTheme(base, {
        name: 'invalid',
        assets: { unknown: { kind: 'image', src: '/x.png' } },
      } as never),
    /Unknown theme asset key/,
  );
  assert.throws(
    () => extendTheme(base, { name: 'invalid', tokens: { missing: 'x' } } as never),
    /Unknown theme token/,
  );
});
