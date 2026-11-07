import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const bundle = resolve('dist/releases', `jingchuanchu-engine-${version}`);
const temporary = await mkdtemp(join(tmpdir(), 'jingchuanchu-suite-'));
function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'npm.cmd',
  });
  if (result.status !== 0) throw result.error ?? new Error(`${command} ${args.join(' ')} failed`);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function writeApplicationConsumer(project: string): Promise<void> {
  const tgz = (name: string) =>
    `file:${join(bundle, 'packages', `xiaobaibaifqy-jingchuanchu-${name}-${version}.tgz`)}`;
  const dependencies = Object.fromEntries(
    ['app', 'core', 'ecs', 'assets', 'browser', 'input', 'renderer-2d'].map((name) => [
      `@xiaobaibaifqy/jingchuanchu-${name}`,
      tgz(name),
    ]),
  );
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        scripts: { check: 'tsc --noEmit', build: 'vite build' },
        dependencies,
        devDependencies: {
          '@xiaobaibaifqy/jingchuanchu-tooling': tgz('tooling'),
          typescript: '^5.9.0',
          vite: '^7.1.0',
        },
      },
      null,
      2,
    ),
  );
  const files: Record<string, string> = {
    'index.html':
      '<!doctype html><html><head><title>Application</title></head><body><game-app></game-app><script type="module" src="/src/main.ts"></script></body></html>',
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['vite/client'],
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        },
        include: ['src', 'vite.config.ts'],
      },
      null,
      2,
    ),
    'vite.config.ts': `import { defineConfig } from 'vite';
import { jingchuanchu } from '@xiaobaibaifqy/jingchuanchu-tooling/vite';
export default defineConfig({ plugins: [jingchuanchu()] });
`,
    'jingchuanchu.json': JSON.stringify({
      schemaVersion: 2,
      profile: 'application',
      preset: 'singleplayer',
      style: 'less',
    }),
    'src/main.ts': `import { mountApplication } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { app } from './app/app-config.js';
const host = document.querySelector('game-app');
if (!host) throw new Error('Missing game-app host');
await mountApplication(host, app);
`,
    'src/app/app-config.ts': `import { defineApplication } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AppShell } from './app-shell.js';
import { routes } from './app-routes.js';
export const app = defineApplication({ root: AppShell, routes });
`,
    'src/app/app-routes.ts': `import { defineRoutes } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const routes = defineRoutes([
  { name: 'home', path: '/', loadPage: () => import('../pages/home/home-page.js').then((module) => module.HomePage) },
]);
`,
    'src/app/app-shell.ts': `import { defineComponent } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const AppShell = defineComponent({ selector: 'game-app', setup() { return {}; } });
`,
    'src/app/app-shell.html': '<main><router-outlet></router-outlet></main>\n',
    'src/app/app-shell.less': 'main { display: block; }\n',
    'src/pages/home/home-page.ts': `import { definePage } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const HomePage = definePage({ selector: 'home-page', setup() { return {}; } });
`,
    'src/pages/home/home-page.html': '<section><h1>JCC_HOME_MARKER</h1></section>\n',
    'src/pages/home/home-page.less': 'section { display: block; }\n',
    'src/themes/default/default-theme.ts': `import { defineTheme } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const DefaultTheme = defineTheme({ name: 'default', tokens: { accent: '#176b58' }, assets: {} });
`,
  };
  for (const [name, source] of Object.entries(files)) {
    const file = join(project, name);
    await mkdir(resolve(file, '..'), { recursive: true });
    await writeFile(file, source);
  }
}

async function assertApplicationChunks(project: string, marker: string): Promise<void> {
  const files = (await readdir(join(project, 'dist'), { recursive: true })) as string[];
  const scripts = files.filter((file) => file.endsWith('.js'));
  assert.ok(scripts.length >= 2, `Expected lazy chunks, found ${scripts.length} scripts`);
  const contents = await Promise.all(
    scripts.map((file) => readFile(join(project, 'dist', file), 'utf8')),
  );
  assert.ok(
    contents.some((content) => content.includes(marker)),
    `No chunk contains ${marker}`,
  );
}

try {
  // Bootstrap the actual packaged CLI into a separate tool project.
  const tool = join(temporary, 'tool');
  await mkdir(tool);
  await writeFile(
    join(tool, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      devDependencies: {
        '@xiaobaibaifqy/jingchuanchu-tooling': `file:${join(bundle, 'packages', `xiaobaibaifqy-jingchuanchu-tooling-${version}.tgz`)}`,
      },
    }),
  );
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], tool);
  const cli = join(tool, 'node_modules/@xiaobaibaifqy/jingchuanchu-tooling/dist/cli.mjs');
  for (const [preset, style] of [
    ['core', 'css'],
    ['server', 'css'],
    ['singleplayer', 'css'],
    ['singleplayer', 'less'],
    ['client', 'css'],
  ] as const) {
    if (process.argv.includes('--browser-only') && ['core', 'server'].includes(preset)) continue;
    const project = join(temporary, `${preset}-${style}`);
    run(
      process.execPath,
      [cli, 'create', project, '--preset', preset, '--style', style, '--bundle', bundle],
      tool,
    );
    run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], project);
    const browser = ['singleplayer', 'client'].includes(preset);
    const projectConfig = JSON.parse(
      await readFile(join(project, 'jingchuanchu.json'), 'utf8'),
    ) as { schemaVersion?: number };
    const applicationLayout = browser && projectConfig.schemaVersion === 2;
    if (browser) {
      const localCli = join(
        project,
        'node_modules/@xiaobaibaifqy/jingchuanchu-tooling/dist/cli.mjs',
      );
      if (applicationLayout) {
        const generated = [
          join(project, 'src/pages/score-panel/score-panel-page.ts'),
          join(project, 'src/pages/score-panel/score-panel-page.html'),
          join(project, 'src/pages/score-panel/score-panel-page.' + style),
        ];
        run(
          process.execPath,
          [localCli, 'generate', 'page', 'score-panel', '--route', '/score-panel'],
          project,
        );
        for (const file of generated) await readFile(file, 'utf8');
      } else {
        run(process.execPath, [localCli, 'generate', 'view', 'score-panel'], project);
        run(process.execPath, [localCli, 'generate', 'scene', 'menu'], project);
        if (style === 'less') {
          await writeFile(join(project, 'src/styles/tokens.less'), '@accent: #176b58;');
          await writeFile(
            join(project, 'src/ui/components/score-panel/score-panel.less'),
            '@import "../../../styles/tokens.less"; section {color:@accent;}',
          );
        }
      }
    }
    run(npm, ['run', 'build'], project);
    const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'));
    for (const [name, entry] of Object.entries(lock.packages) as Array<
      [string, { resolved?: string }]
    >)
      if (name.startsWith('node_modules/@xiaobaibaifqy/jingchuanchu-'))
        assert.ok(entry.resolved?.startsWith('file:'), name);
    if (preset !== 'server') assert.equal('node_modules/ws' in lock.packages, false);
    if (preset === 'core') assert.equal('node_modules/less' in lock.packages, false);
    if (browser) {
      assert.ok((await readFile(join(project, 'dist/index.html'), 'utf8')).includes('game-app'));
      if (applicationLayout) await assertApplicationChunks(project, 'ScorePanel Page');
    }
    console.log(`Packaged CLI consumer passed: ${preset}/${style}`);
  }

  const applicationProject = join(temporary, 'application');
  await mkdir(applicationProject);
  await writeApplicationConsumer(applicationProject);
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], applicationProject);
  run(npm, ['run', 'check'], applicationProject);
  run(npm, ['run', 'build'], applicationProject);
  await assertApplicationChunks(applicationProject, 'JCC_HOME_MARKER');
  const applicationCli = join(
    applicationProject,
    'node_modules/@xiaobaibaifqy/jingchuanchu-tooling/dist/cli.mjs',
  );
  run(
    process.execPath,
    [applicationCli, 'generate', 'page', 'settings', '--route', '/settings'],
    applicationProject,
  );
  run(npm, ['run', 'build'], applicationProject);
  await assertApplicationChunks(applicationProject, 'Settings Page');
  const routes = await readFile(join(applicationProject, 'src/app/app-routes.ts'), 'utf8');
  assert.match(routes, /name: "settings"/);
  console.log('Packaged application consumer passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
