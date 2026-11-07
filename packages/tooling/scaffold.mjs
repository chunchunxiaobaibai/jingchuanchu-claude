import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { APPLICATION_PROFILE, readProjectConfig } from './project-config.mjs';
import { generateApplicationArtifact } from './application-scaffold.mjs';

const prefix = '@xiaobaibaifqy/jingchuanchu-';
const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const slash = (path) => path.split(sep).join('/');
const manifest = JSON.parse(
  await readFile(new URL('./package.json', import.meta.url), 'utf8').catch(() =>
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ),
);
const presets = {
  core: ['core'],
  singleplayer: ['app', 'renderer-2d'],
  client: ['app', 'renderer-2d', 'net'],
  server: ['core', 'net-server'],
};
function componentName(name) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name))
    throw new Error('Name must be lowercase kebab-case');
  return name
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}
async function localDependencies(bundle, names, target) {
  const data = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
  const entries = new Map(data.packages.map((entry) => [entry.name, entry])),
    needed = new Set();
  function select(name) {
    if (needed.has(name)) return;
    const entry = entries.get(name);
    if (!entry) throw new Error(`Module missing from bundle: ${name}`);
    needed.add(name);
    for (const dependency of Object.keys(entry.dependencies))
      if (dependency.startsWith(prefix)) select(dependency);
  }
  names.forEach((name) => select(prefix + name));
  const result = {};
  for (const name of needed) {
    const entry = entries.get(name);
    if (!/^[\w.-]+\.tgz$/.test(entry.file)) throw new Error('Invalid bundle filename');
    const file = join(bundle, 'packages', entry.file),
      bytes = await readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      throw new Error(`Checksum mismatch: ${entry.file}`);
    result[name] = { file, dependency: `file:vendor/${entry.file}` };
  }
  return result;
}
export async function createProject(
  target,
  { preset = 'singleplayer', style = 'css', bundle, legacy = false } = {},
) {
  if (!Object.hasOwn(presets, preset)) throw new Error(`Unknown preset: ${preset}`);
  if (!['css', 'less'].includes(style)) throw new Error(`Unknown style: ${style}`);
  target = resolve(target);
  if ((await exists(target)) && (await readdir(target)).length)
    throw new Error('Target directory must be empty');
  const browser = ['singleplayer', 'client'].includes(preset);
  const applicationLayout = browser && !legacy;
  const selected = applicationLayout
    ? [
        'app',
        'core',
        'ecs',
        'assets',
        'browser',
        'input',
        'renderer-2d',
        'tooling',
        ...(preset === 'client' ? ['net'] : []),
      ]
    : [...presets[preset], ...(browser ? ['tooling'] : [])];
  // Resolve and verify every local archive before writing project files.
  const local = bundle ? await localDependencies(resolve(bundle), selected, target) : undefined;
  await mkdir(target, { recursive: true });
  let pkg;
  if (browser) {
    let starter = fileURLToPath(
      new URL(legacy ? './starters/legacy-browser' : './starters/browser', import.meta.url),
    );
    if (!(await exists(starter)))
      starter = fileURLToPath(
        new URL(
          legacy ? '../../templates/legacy-browser' : '../../templates/browser',
          import.meta.url,
        ),
      );
    await cp(starter, target, {
      recursive: true,
      filter: (file) => !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(relative(starter, file)),
    });
    pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    if (applicationLayout) {
      if (style === 'css') {
        async function renameApplicationStyles(directory) {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            const file = join(directory, entry.name);
            if (entry.isDirectory()) await renameApplicationStyles(file);
            else if (file.endsWith('.less')) {
              const { rename } = await import('node:fs/promises');
              await rename(file, file.slice(0, -5) + '.css');
            }
          }
        }
        async function rewriteStyleImports(directory) {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            const file = join(directory, entry.name);
            if (entry.isDirectory()) await rewriteStyleImports(file);
            else if (file.endsWith('.ts')) {
              const source = await readFile(file, 'utf8');
              const next = source.replace(/(['"])([^'"]+)\.less\1/g, '$1$2.css$1');
              if (next !== source) await writeFile(file, next);
            }
          }
        }
        await renameApplicationStyles(join(target, 'src'));
        await rewriteStyleImports(join(target, 'src'));
        delete pkg.devDependencies.less;
      }
      if (preset === 'client') {
        pkg.dependencies[prefix + 'net'] = '^' + manifest.version;
        await writeFile(
          join(target, 'src/app/network.ts'),
          `import { networkModule } from '${prefix}net/module';\nexport const network = networkModule<unknown, unknown>({url: 'ws://localhost:8080/ws', decoder: {parse: value => value}, onMessage(message) { console.log(message); }});\n`,
        );
      }
    } else if (style === 'less') {
      async function renameStyles(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const file = join(directory, entry.name);
          if (entry.isDirectory()) await renameStyles(file);
          else if (file.endsWith('.css') && !file.endsWith('.module.css')) {
            const { rename } = await import('node:fs/promises');
            await rename(file, file.slice(0, -4) + '.less');
          }
        }
      }
      await renameStyles(join(target, 'src/ui/components'));
      pkg.devDependencies.less = manifest.dependencies.less;
    }
    if (!applicationLayout && preset === 'client') {
      pkg.dependencies[prefix + 'net'] = '^' + manifest.version;
      await writeFile(
        join(target, 'src/app/network.ts'),
        `import { networkModule } from '${prefix}net/module';\nexport const network = networkModule<unknown, unknown>({url: 'ws://localhost:8080/ws', decoder: {parse: value => value}, onMessage(message) { console.log(message); }});\n`,
      );
      const file = join(target, 'src/app/game.ts');
      let code = await readFile(file, 'utf8');
      code =
        "import { network } from './network.js';\n" +
        code.replace('return [canvas2DModule(', 'return [network, canvas2DModule(');
      await writeFile(file, code);
    }
  } else {
    pkg = {
      private: true,
      type: 'module',
      scripts: {
        dev: 'tsx src/main.ts',
        check: 'tsc --noEmit',
        build: 'tsc',
        start: 'node dist/main.js',
      },
      dependencies: {},
      devDependencies: { typescript: '^5.9.0', tsx: '^4.20.0', '@types/node': '^24.0.0' },
    };
    await mkdir(join(target, 'src'), { recursive: true });
    await writeFile(
      join(target, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            outDir: 'dist',
            rootDir: 'src',
            skipLibCheck: true,
          },
          include: ['src'],
        },
        null,
        2,
      ) + '\n',
    );
    const code =
      preset === 'core'
        ? `import { Engine } from '${prefix}core';\nconst engine = new Engine();\nengine.start();\nengine.advance(engine.step);\nengine.dispose();\n`
        : `import { createServer } from 'node:http';\nimport { WebSocketHost } from '${prefix}net-server';\nconst server = createServer();\nconst host = new WebSocketHost(server, {parse(value: unknown) { return value; }}, {open() {}, close() {}, error(peer, message) {peer.send({error:message});}, message(peer, message) {peer.send(message);} });\nserver.listen(8080, '127.0.0.1');\nprocess.once('SIGINT', () => {void host.close().finally(() => server.close());});\n`;
    await writeFile(join(target, 'src/main.ts'), code);
    await writeFile(
      join(target, 'README.md'),
      `# ${preset} project\n\nnpm install\nnpm run check\nnpm run build\nnpm run dev\n`,
    );
  }
  pkg.name =
    target
      .split(sep)
      .at(-1)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') || 'my-game';
  for (const name of presets[preset]) pkg.dependencies[prefix + name] = '^' + manifest.version;
  if (local) {
    await mkdir(join(target, 'vendor'), { recursive: true });
    for (const [name, entry] of Object.entries(local)) {
      await cp(entry.file, join(target, 'vendor', entry.file.split(/[\\/]/).at(-1)));
      if (name === prefix + 'tooling') pkg.devDependencies[name] = entry.dependency;
      else pkg.dependencies[name] = entry.dependency;
    }
  }
  await writeFile(join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await writeFile(join(target, '.gitignore'), 'node_modules/\ndist/\n');
  let projectConfig = { preset, style };
  if (applicationLayout) {
    const starterConfig = JSON.parse(await readFile(join(target, 'jingchuanchu.json'), 'utf8'));
    projectConfig = { ...starterConfig, preset, style };
  }
  await writeFile(join(target, 'jingchuanchu.json'), JSON.stringify(projectConfig, null, 2) + '\n');
  return target;
}
function register(code, file, kind, exportName, importFile) {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true),
    calls = [];
  const functionName = kind === 'view' ? 'defineView' : 'defineGame';
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === functionName
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (calls.length !== 1 || !ts.isObjectLiteralExpression(calls[0].arguments[0]))
    throw new Error(`Expected one ${functionName} object in ${file}`);
  const object = calls[0].arguments[0],
    key = kind === 'view' ? 'components' : 'scenes';
  const prop = object.properties.find((node) => node.name?.getText(ast) === key);
  let offset, insert;
  if (prop) {
    if (!ts.isPropertyAssignment(prop) || !ts.isArrayLiteralExpression(prop.initializer))
      throw new Error(`${key} must be a static array`);
    offset = prop.initializer.elements.end;
    insert =
      (prop.initializer.elements.length && !prop.initializer.elements.hasTrailingComma ? ',' : '') +
      exportName;
  } else {
    offset = object.getStart(ast) + 1;
    insert = `${key}: [${exportName}],`;
  }
  const specifier = slash(relative(dirname(file), importFile)).replace(/\.ts$/, '.js');
  return (
    `import { ${exportName} } from '${specifier.startsWith('.') ? specifier : './' + specifier}';\n` +
    code.slice(0, offset) +
    insert +
    code.slice(offset)
  );
}
export async function generate(
  kind,
  name,
  { project = '.', parent, style, route, page, shared, domain, extends: extendFrom } = {},
) {
  const config = await readProjectConfig(project);
  if (config.profile === APPLICATION_PROFILE)
    return generateApplicationArtifact(config, kind, name, {
      route,
      page,
      shared,
      domain,
      extends: extendFrom,
      style,
    });
  if (!['view', 'scene'].includes(kind)) throw new Error('Generate supports view or scene');
  const exported = componentName(name),
    root = resolve(project);
  const legacyConfig = JSON.parse(
    await readFile(join(root, 'jingchuanchu.json'), 'utf8').catch(() => '{}'),
  );
  style ??= legacyConfig.style ?? config.style ?? 'css';
  if (!['css', 'less'].includes(style)) throw new Error('Style must be css or less');
  const base =
    kind === 'view'
      ? join(root, 'src/ui/components', name, name)
      : join(root, 'src/game/scenes', name);
  const file = base + '.ts';
  const owner = resolve(
    root,
    parent ?? (kind === 'view' ? 'src/ui/components/GameApp/GameApp.ts' : 'src/app/game.ts'),
  );
  if (relative(root, owner).startsWith('..'))
    throw new Error('Registration owner must belong to project');
  const code = register(await readFile(owner, 'utf8'), owner, kind, exported, file);
  const contract = slash(relative(dirname(file), join(root, 'src/contracts/application.js')));
  const outputs =
    kind === 'view'
      ? {
          [file]: `import { defineView } from '${prefix}app';\nimport type { AppState, AppCommands } from '${contract}';\nexport const ${exported} = defineView<AppState, AppCommands>({selector:'game-${name}'});\n`,
          [base + '.html']: `<section><h2>${exported}</h2></section>\n`,
          [base + '.' + style]: 'section { display: block; }\n',
        }
      : {
          [file]: `import { defineScene } from '${prefix}app';\nimport type { AppState, AppCommands, AppInput } from '${contract}';\nexport const ${exported} = defineScene<AppState, AppCommands, AppInput>({setup(context) { context.scope.own(() => {}); }});\n`,
        };
  let template, markup;
  if (kind === 'view') {
    const ownerCode = await readFile(owner, 'utf8');
    const ast = ts.createSourceFile(owner, ownerCode, ts.ScriptTarget.Latest, true);
    let templateUrl;
    function visit(node) {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(ast) === 'templateUrl' &&
        ts.isStringLiteralLike(node.initializer)
      )
        templateUrl = node.initializer.text;
      ts.forEachChild(node, visit);
    }
    visit(ast);
    template = templateUrl ? resolve(dirname(owner), templateUrl) : owner.replace(/\.ts$/, '.html');
    if (relative(root, template).startsWith('..'))
      throw new Error('Parent template must belong to project');
    markup = await readFile(template, 'utf8');
  }
  for (const output of Object.keys(outputs))
    if (await exists(output)) throw new Error(`Refusing to overwrite ${output}`);
  for (const [output, text] of Object.entries(outputs)) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, text, { flag: 'wx' });
  }
  await writeFile(owner, code);
  if (template) await writeFile(template, markup + `\n<game-${name}></game-${name}>\n`);
  return Object.keys(outputs);
}
