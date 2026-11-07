import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import ts from 'typescript';

async function typescriptFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await typescriptFiles(path)));
    else if (entry.name.endsWith('.ts')) result.push(path);
  }
  return result;
}

test('engine packages declare dependencies and never import sibling internals or game code', async () => {
  for (const name of await readdir('packages')) {
    const directory = resolve('packages', name);
    const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    for (const path of await typescriptFiles(directory)) {
      const source = ts.createSourceFile(
        path,
        await readFile(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        if (specifier.startsWith('.'))
          assert.ok(
            resolve(dirname(path), specifier).startsWith(directory + sep),
            `${manifest.name} imports internals: ${specifier}`,
          );
        else if (specifier.startsWith('@xiaobaibaifqy/jingchuanchu-'))
          assert.ok(
            specifier.split('/').slice(0, 2).join('/') in manifest.dependencies,
            `Undeclared dependency: ${specifier}`,
          );
        else
          assert.ok(
            specifier.startsWith('node:') || specifier in manifest.dependencies,
            `Unexpected dependency: ${specifier}`,
          );
      }
    }
    if (name !== 'net-server') assert.equal('ws' in manifest.dependencies, false);
    assert.equal('zod' in manifest.dependencies, false);
  }
});

test('the application subentry exposes the fixed public API while the root entry stays compatible', async () => {
  const manifest = JSON.parse(await readFile('packages/app/package.json', 'utf8')) as {
    exports: Record<string, unknown>;
  };
  assert.ok('./application' in manifest.exports);
  const application = await import('@xiaobaibaifqy/jingchuanchu-app/application');
  for (const name of [
    'signal',
    'computed',
    'effect',
    'batch',
    'nextTick',
    'defineComponent',
    'definePage',
    'input',
    'output',
    'model',
    'writableModel',
    'mountComponent',
    'defineStore',
    'defineService',
    'defineApplication',
    'mountApplication',
    'bootstrapApplication',
    'defineRoutes',
    'createRouter',
    'createRouterOutlet',
    'bindRouteLink',
    'createAssetContext',
    'defineAssetGroup',
    'defineTheme',
    'extendTheme',
    'createThemeService',
    'createViewport',
    'defineActions',
    'createInputActions',
    'createGameClock',
    'createTweenRunner',
    'defineGameScene',
    'createGameCanvas',
    'GameCanvas',
    'defineAudio',
    'createAudioService',
    'defineSave',
    'createSaveService',
    'createAuthService',
    'defineAccess',
    'createAccessService',
  ] as const)
    assert.ok(name in application, `Missing application export: ${name}`);
  const root = await import('@xiaobaibaifqy/jingchuanchu-app');
  for (const name of ['defineView', 'mountView', 'defineGame', 'mountGame', 'StateStore'] as const)
    assert.equal(typeof root[name], 'function', `Missing legacy root export: ${name}`);
});
