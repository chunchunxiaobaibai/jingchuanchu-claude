import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const valid: Record<string, string> = {
  'index.html':
    '<!doctype html><html><head><title>Game</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>',
  'tsconfig.json': JSON.stringify({
    compilerOptions: { moduleResolution: 'Bundler', module: 'ESNext' },
  }),
  'src/main.ts': "import { start } from './app/start.js'; start();",
  'src/app/start.ts': 'export function start() {}',
  'src/contracts/game.ts': 'export interface Snapshot { paused: boolean }',
  'src/game/scenes/play.ts': 'export const scene = { id: "play" };',
  'src/ui/components/Hud/Hud.ts':
    "import html from './Hud.html?raw'; import styles from './Hud.module.css'; export const view = { html, styles };",
  'src/ui/components/Hud/Hud.html': '<section><button type="button">暂停</button></section>',
  'src/ui/components/Hud/Hud.module.css': '.root { display: flex; }',
  'src/styles/base.css': 'body { margin: 0; }',
};
async function checkWith(base: Record<string, string>, changes: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'jingchuanchu-structure-'));
  try {
    for (const [name, source] of Object.entries({ ...base, ...changes })) {
      const file = join(directory, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source);
    }
    return spawnSync(
      process.execPath,
      ['--conditions=source', resolve('templates/browser/scripts/check-project.mjs'), directory],
      { encoding: 'utf8' },
    );
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'jingchuanchu-structure-')));
    await rm(directory, { recursive: true, force: true });
  }
}
async function check(changes: Record<string, string>) {
  return checkWith(valid, changes);
}

const application: Record<string, string> = {
  'index.html':
    '<!doctype html><html><head><title>Game</title></head><body><game-app></game-app><script type="module" src="/src/main.ts"></script></body></html>',
  'tsconfig.json': JSON.stringify({
    compilerOptions: { moduleResolution: 'Bundler', module: 'ESNext' },
  }),
  'jingchuanchu.json': JSON.stringify({
    schemaVersion: 2,
    profile: 'application',
    preset: 'singleplayer',
    style: 'less',
    paths: {
      app: 'src/app',
      pages: 'src/pages',
      game: 'src/game',
      components: 'src/components',
      themes: 'src/themes',
      account: 'src/account',
    },
  }),
  'src/main.ts': "import { app } from './app/app-config.js';",
  'src/app/app-config.ts': 'export const app = {};',
  'src/app/app-routes.ts': 'export const routes = [];',
  'src/app/app-shell.ts': 'export const AppShell = {};',
  'src/app/app-shell.html': '<div><router-outlet></router-outlet></div>',
  'src/app/app-shell.less': 'div { display: block; }',
  'src/pages/home/home-page.ts': 'export const HomePage = {};',
  'src/pages/home/home-page.html': '<section>home</section>',
  'src/components/icon-button/icon-button.ts': 'export const IconButton = {};',
  'src/components/icon-button/icon-button.html': '<button type="button"></button>',
  'src/components/icon-button/icon-button.less': 'button { display: block; }',
  'src/game/session/game-store.ts': 'export const GameStore = {};',
  'src/themes/default/default-theme.ts': 'export const defaultTheme = {};',
  'src/styles/base.less': 'body { margin: 0; }',
};
test('structured native TS project passes', async () => {
  const result = await check({});
  assert.equal(result.status, 0, result.stderr);
});
test('UI cannot import Engine and game cannot re-export UI through an alias', async () => {
  const result = await check({
    'src/ui/engine.ts': "import { Engine } from '@xiaobaibaifqy/jingchuanchu-core';",
    'src/game/scenes/play.ts': "export * from '@ui/engine';",
    'tsconfig.json': JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@ui/*': ['src/ui/*'] } },
    }),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dependency-boundary/);
  assert.match(result.stderr, /src\/game\/scenes\/play.ts/);
});
test('game DOM access and dynamic imports across layers are diagnosed', async () => {
  const result = await check({
    'src/game/scenes/play.ts':
      "document.querySelector('canvas'); import('../../ui/components/Hud/Hud.js');",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /game-dom/);
  assert.match(result.stderr, /dependency-boundary/);
});
test('inline HTML behavior and global component selectors fail', async () => {
  const result = await check({
    'src/ui/components/Hud/Hud.html':
      '<section style="color:red" onclick="pause()"><script>pause()</script></section>',
    'src/ui/components/Hud/Hud.module.css': ':global(body) { color: red; } button { color: red; }',
    'src/ui/inline.ts':
      "const node = document.createElement('div'); node.innerHTML = '<p>inline</p>'; node.style.color = 'red';",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /html-inline/);
  assert.match(result.stderr, /css-scope/);
  assert.match(result.stderr, /embedded-markup/);
  assert.match(result.stderr, /embedded-style/);
});
test('misplaced files, missing component files and internal engine paths fail', async () => {
  const result = await check({
    'src/game.ts': 'export const loose = true;',
    'src/ui/components/Menu/Menu.ts': 'export const menu = true;',
    'src/app/start.ts': "import '../../../../../packages/core/index.ts';",
  });
  assert.notEqual(result.status, 0);
  for (const rule of ['file-location', 'component-files', 'engine-internals'])
    assert.match(result.stderr, new RegExp(rule));
});

test('application profile projects use configured paths and component layouts', async () => {
  const result = await checkWith(application, {});
  assert.equal(result.status, 0, result.stderr);

  const missing = await checkWith(application, {
    'src/components/icon-button/extra.md': 'notes',
    'src/components/missing-html/missing-html.ts': 'export const Missing = {};',
    'src/ui/legacy.ts': 'export const legacy = true;',
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /component-files/);
  assert.match(missing.stderr, /file-location/);

  const withoutConfig = { ...application };
  delete withoutConfig['src/app/app-config.ts'];
  const missingApp = await checkWith(withoutConfig, {});
  assert.notEqual(missingApp.status, 0);
  assert.match(missingApp.stderr, /app-files/);
});

test('custom paths must stay inside the project and schemaVersion is explicit', async () => {
  const escaped = await checkWith(application, {
    'jingchuanchu.json': JSON.stringify({
      schemaVersion: 2,
      profile: 'application',
      preset: 'singleplayer',
      style: 'less',
      paths: { app: '../outside' },
    }),
  });
  assert.notEqual(escaped.status, 0);
  assert.match(escaped.stderr, /must point inside the project/);

  const unknownVersion = await checkWith(application, {
    'jingchuanchu.json': JSON.stringify({
      schemaVersion: 3,
      profile: 'application',
      preset: 'singleplayer',
      style: 'less',
    }),
  });
  assert.notEqual(unknownVersion.status, 0);
  assert.match(unknownVersion.stderr, /Unsupported schemaVersion/);

  const missingProfile = await checkWith(application, {
    'jingchuanchu.json': JSON.stringify({
      schemaVersion: 2,
      preset: 'singleplayer',
      style: 'less',
    }),
  });
  assert.notEqual(missingProfile.status, 0);
  assert.match(missingProfile.stderr, /profile "application"/);
});
