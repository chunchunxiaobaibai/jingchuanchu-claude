import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { compileViews, compileStyle } from '../packages/tooling/compiler.mjs';
import { createProject, generate } from '../packages/tooling/scaffold.mjs';

const code =
  "import {defineView} from '@xiaobaibaifqy/jingchuanchu-app'; export const Hud=defineView({selector:'game-hud',text:{score:c=>c.state.score}});";
async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'jcc-app-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test('component compiler associates files, validates binding names and scopes imported Less/animations', () =>
  fixture(async (directory) => {
    const file = join(directory, 'Hud.ts');
    await writeFile(
      join(directory, 'Hud.html'),
      '<section><span data-text="score"></span></section>',
    );
    await writeFile(
      join(directory, 'colors.less'),
      '@accent: #176b58; .theme() { color: @accent; }',
    );
    await writeFile(
      join(directory, 'Hud.less'),
      '@import "colors.less"; section { .theme(); span {animation: pulse 1s;} } @keyframes pulse {to {opacity:0.5}}',
    );
    const result = (await compileViews(code, file))!;
    assert.match(result.code, /\$template:/);
    assert.match(result.code, /\$source:/);
    assert.ok(result.dependencies.includes(join(directory, 'colors.less')));
    const css = result.resources[0]!.css;
    assert.match(css, /section\[data-jcc-/);
    assert.match(css, /span\[data-jcc-/);
    assert.match(css, /pulse-data-jcc-/);
    assert.match(css, /#176b58/);
    await writeFile(join(directory, 'Hud.html'), '<span data-text="missing"></span>');
    await assert.rejects(compileViews(code, file), /Hud.html:1.*Unknown text binding/);
  }));
test('missing and ambiguous resources report component sources; explicit paths and styleless views work', () =>
  fixture(async (directory) => {
    const file = join(directory, 'Hud.ts');
    await assert.rejects(compileViews(code, file), /Missing component template/);
    await writeFile(join(directory, 'Hud.html'), '<div></div>');
    assert.equal((await compileViews(code, file))!.resources.length, 0);
    await writeFile(join(directory, 'Hud.css'), 'div {color:red}');
    await writeFile(join(directory, 'Hud.less'), 'div {color:blue}');
    await assert.rejects(compileViews(code, file), /Ambiguous/);
    const explicit = code.replace(
      "selector:'game-hud'",
      "selector:'game-hud', styleUrl:'./Hud.less',templateUrl:'./Hud.html'",
    );
    assert.match((await compileViews(explicit, file))!.resources[0]!.css, /blue/);
    await writeFile(join(directory, 'Hud.less'), '@import "missing.less";');
    await assert.rejects(compileViews(explicit, file), (error) =>
      String((error as { filename?: string }).filename).endsWith('Hud.less'),
    );
  }));
test('component CSS imports are scoped and cannot escape to global selectors', () =>
  fixture(async (directory) => {
    await writeFile(join(directory, 'shared.css'), '.title { color:red; }');
    const file = join(directory, 'Hud.css');
    await writeFile(file, '@import "./shared.css"; section .title:hover {opacity:1;}');
    const result = await compileStyle(file, 'data-test');
    assert.match(result.css, /\.title\[data-test\]/);
    assert.ok(result.dependencies.includes(join(directory, 'shared.css')));
    await writeFile(file, ':global(body) {color:red}');
    await assert.rejects(compileStyle(file, 'data-test'), /:global/);
  }));
test('CLI creates all presets, chooses Less, registers generated references and refuses overwrites', () =>
  fixture(async (directory) => {
    for (const preset of ['core', 'server', 'singleplayer', 'client']) {
      const target = join(directory, preset);
      await createProject(target, { preset, style: 'less', legacy: true });
      const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
      assert.ok(pkg.scripts.build);
      if (preset === 'core')
        assert.deepEqual(Object.keys(pkg.dependencies), ['@xiaobaibaifqy/jingchuanchu-core']);
      if (preset === 'client')
        assert.match(await readFile(join(target, 'src/app/game.ts'), 'utf8'), /return \[network,/);
      await assert.rejects(createProject(target), /empty/);
    }
    const project = join(directory, 'singleplayer');
    await generate('view', 'score-panel', { project });
    await generate('scene', 'menu', { project });
    assert.match(
      await readFile(join(project, 'src/ui/components/GameApp/GameApp.ts'), 'utf8'),
      /components: \[GameControls,ScorePanel\]/,
    );
    assert.match(
      await readFile(join(project, 'src/ui/components/GameApp/GameApp.html'), 'utf8'),
      /<game-score-panel>/,
    );
    assert.match(
      await readFile(join(project, 'src/app/game.ts'), 'utf8'),
      /scenes: \[PlayScene,Menu\]/,
    );
    assert.match(
      await readFile(join(project, 'src/ui/components/score-panel/score-panel.less'), 'utf8'),
      /display/,
    );
    await assert.rejects(generate('view', 'score-panel', { project }), /overwrite/);
    await assert.rejects(generate('view', '../escape', { project }), /kebab/);
  }));
