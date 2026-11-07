import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate, createProject } from '../packages/tooling/scaffold.mjs';
import { addModules } from '../packages/tooling/install.mjs';

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'jingchuanchu-scaffold-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function applicationProject(directory: string): Promise<void> {
  const files = {
    'jingchuanchu.json': JSON.stringify({
      schemaVersion: 2,
      profile: 'application',
      preset: 'singleplayer',
      style: 'less',
    }),
    'package.json': JSON.stringify({ name: 'demo', private: true }),
    'src/app/app-config.ts': 'export const app = {};',
    'src/app/app-routes.ts': `import { defineRoutes } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const routes = defineRoutes([
  { name: 'home', path: '/', loadPage: () => import('../pages/home/home-page.js').then((m) => m.HomePage) },
]);
`,
    'src/pages/home/home-page.ts': 'export const HomePage = {};',
    'src/pages/home/home-page.html': '<section>home</section>',
    'src/themes/default/default-theme.ts': `import { defineTheme } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const DefaultTheme = defineTheme({ name: 'default', tokens: { accent: '#000' }, assets: {} });
`,
  };
  for (const [name, source] of Object.entries(files)) {
    const file = join(directory, name);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, source);
  }
}

test('create defaults to the application profile while legacy projects stay available', () =>
  fixture(async (directory) => {
    const target = join(directory, 'application-game');
    await createProject(target, { preset: 'singleplayer', style: 'css' });
    const config = JSON.parse(await readFile(join(target, 'jingchuanchu.json'), 'utf8')) as {
      schemaVersion?: number;
      profile?: string;
      style?: string;
    };
    assert.equal(config.schemaVersion, 2);
    assert.equal(config.profile, 'application');
    assert.equal(config.style, 'css');
    for (const file of [
      'src/app/app-config.ts',
      'src/app/app-routes.ts',
      'src/app/app-shell.css',
      'src/pages/play/play-page.ts',
      'src/components/icon-button/icon-button.ts',
      'src/themes/default/default-theme.ts',
    ])
      assert.equal(await exists(join(target, file)), true, file);
    assert.equal(await exists(join(target, 'src/ui/components/GameApp/GameApp.ts')), false);
    const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    assert.equal('less' in pkg.devDependencies, false);

    const legacyTarget = join(directory, 'legacy-game');
    await createProject(legacyTarget, { preset: 'singleplayer', style: 'css', legacy: true });
    const legacyConfig = JSON.parse(
      await readFile(join(legacyTarget, 'jingchuanchu.json'), 'utf8'),
    ) as { schemaVersion?: number };
    assert.equal(legacyConfig.schemaVersion, undefined);
    assert.equal(await exists(join(legacyTarget, 'src/ui/components/GameApp/GameApp.ts')), true);
  }));

test('application page generation writes three files and registers a lazy route', () =>
  fixture(async (directory) => {
    await applicationProject(directory);
    const outputs = await generate('page', 'play', {
      project: directory,
      route: '/play/:levelId',
    });
    assert.ok(outputs.some((file) => file.replaceAll('\\', '/').endsWith('play-page.ts')));
    assert.ok(await exists(join(directory, 'src/pages/play/play-page.html')));
    assert.ok(await exists(join(directory, 'src/pages/play/play-page.less')));
    const page = await readFile(join(directory, 'src/pages/play/play-page.ts'), 'utf8');
    assert.match(page, /definePage/);
    assert.match(page, /selector: 'play-page'/);
    const routes = await readFile(join(directory, 'src/app/app-routes.ts'), 'utf8');
    assert.match(routes, /name: "play"/);
    assert.match(routes, /path: "\/play\/:levelId"/);
    assert.match(routes, /import\("\.\.\/pages\/play\/play-page\.js"\)/);

    await assert.rejects(
      () => generate('page', 'levels', { project: directory, route: '/play/:levelId' }),
      /Route path already registered/,
    );
    assert.equal(await exists(join(directory, 'src/pages/levels/levels-page.ts')), false);
  }));

test('components require an explicit page or shared target and scenes stay page-owned', () =>
  fixture(async (directory) => {
    await applicationProject(directory);
    await generate('page', 'play', { project: directory, route: '/play/:levelId' });
    const shared = await generate('component', 'icon-button', {
      project: directory,
      shared: true,
    });
    assert.ok(
      shared.some((file) =>
        file.replaceAll('\\', '/').endsWith('src/components/icon-button/icon-button.ts'),
      ),
    );
    const pageComponent = await generate('component', 'hud', {
      project: directory,
      page: 'play',
    });
    assert.ok(
      pageComponent.some((file) =>
        file.replaceAll('\\', '/').endsWith('src/pages/play/hud/hud.ts'),
      ),
    );
    await assert.rejects(
      () => generate('component', 'bad', { project: directory }),
      /exactly one of --page or --shared/,
    );
    await assert.rejects(
      () => generate('component', 'bad', { project: directory, page: 'play', shared: true }),
      /exactly one of --page or --shared/,
    );
    const scene = await generate('scene', 'play', {
      project: directory,
      page: 'play',
    });
    assert.ok(
      scene.some((file) => file.replaceAll('\\', '/').endsWith('src/pages/play/play-scene.ts')),
    );
    assert.match(
      await readFile(join(directory, 'src/pages/play/play-scene.ts'), 'utf8'),
      /defineGameScene/,
    );
  }));

test('store and theme generation use business directories and explicit base themes', () =>
  fixture(async (directory) => {
    await applicationProject(directory);
    const store = await generate('store', 'game', {
      project: directory,
      domain: 'session',
    });
    assert.ok(
      store.some((file) => file.replaceAll('\\', '/').endsWith('src/game/session/game-store.ts')),
    );
    const storeSource = await readFile(join(directory, 'src/game/session/game-store.ts'), 'utf8');
    assert.match(storeSource, /defineStore/);

    const theme = await generate('theme', 'forest', {
      project: directory,
      extends: 'default',
    });
    assert.ok(
      theme.some((file) =>
        file.replaceAll('\\', '/').endsWith('src/themes/forest/forest-theme.ts'),
      ),
    );
    const themeSource = await readFile(
      join(directory, 'src/themes/forest/forest-theme.ts'),
      'utf8',
    );
    assert.match(themeSource, /extendTheme\(DefaultTheme/);
    assert.match(themeSource, /"\.\.\/default\/default-theme\.js"/);

    await assert.rejects(
      () => generate('theme', 'broken', { project: directory, extends: 'missing' }),
      /Base theme does not exist/,
    );
    assert.equal(await exists(join(directory, 'src/themes/broken/broken-theme.ts')), false);
  }));

test('add installs selected or all modules into vendor with development classification', () =>
  fixture(async (directory) => {
    const bundle = join(directory, 'bundle');
    await mkdir(join(bundle, 'packages'), { recursive: true });
    const packages = [
      { name: '@xiaobaibaifqy/jingchuanchu-app', file: 'app.tgz', body: 'app' },
      { name: '@xiaobaibaifqy/jingchuanchu-core', file: 'core.tgz', body: 'core' },
      { name: '@xiaobaibaifqy/jingchuanchu-tooling', file: 'tooling.tgz', body: 'tooling' },
      { name: '@xiaobaibaifqy/jingchuanchu-net-server', file: 'net-server.tgz', body: 'server' },
    ];
    const manifest = {
      packages: packages.map((entry) => ({
        name: entry.name,
        file: entry.file,
        sha256: createHash('sha256').update(entry.body).digest('hex'),
        dependencies: entry.name.endsWith('app')
          ? { '@xiaobaibaifqy/jingchuanchu-core': '^0.4.0' }
          : {},
      })),
    };
    for (const entry of packages) await writeFile(join(bundle, 'packages', entry.file), entry.body);
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest));

    const project = join(directory, 'project');
    await mkdir(project);
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ name: 'consumer', dependencies: {}, devDependencies: {} }),
    );
    const selected = await addModules(project, { modules: ['app'], bundle });
    assert.deepEqual(selected.packages.sort(), [
      '@xiaobaibaifqy/jingchuanchu-app',
      '@xiaobaibaifqy/jingchuanchu-core',
    ]);
    let pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['@xiaobaibaifqy/jingchuanchu-app'], 'file:vendor/app.tgz');
    assert.equal(pkg.dependencies['@xiaobaibaifqy/jingchuanchu-core'], 'file:vendor/core.tgz');
    assert.equal(await exists(join(project, 'vendor/app.tgz')), true);

    const all = await addModules(project, { all: true, bundle });
    assert.ok(all.packages.includes('@xiaobaibaifqy/jingchuanchu-tooling'));
    assert.ok(all.packages.includes('@xiaobaibaifqy/jingchuanchu-net-server'));
    pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
    assert.equal(
      pkg.devDependencies['@xiaobaibaifqy/jingchuanchu-tooling'],
      'file:vendor/tooling.tgz',
    );
    assert.equal(await exists(join(project, 'vendor/net-server.tgz')), true);

    const before = await readFile(join(project, 'package.json'), 'utf8');
    manifest.packages[0]!.sha256 = 'bad';
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(
      () => addModules(project, { modules: ['app'], bundle }),
      /Checksum mismatch/,
    );
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), before);
    await assert.rejects(
      () => addModules(project, { modules: ['missing'], bundle }),
      /Module missing from bundle/,
    );
  }));
