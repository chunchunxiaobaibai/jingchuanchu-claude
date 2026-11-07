import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, relative, dirname, basename, sep } from 'node:path';
import ts from 'typescript';
import { parse, parseFragment } from 'parse5';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import {
  APPLICATION_PROFILE,
  readProjectConfig,
} from '@xiaobaibaifqy/jingchuanchu-tooling/project-config';

const root = resolve(process.argv[2] ?? '.');
const errors = [];
const normalize = (file) => relative(root, file).split(sep).join('/');
const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
function report(file, rule, message, line = 1) {
  errors.push(`${normalize(file)}:${line} [${rule}] ${message}`);
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(file)));
    else result.push(file);
  }
  return result;
}
const sourceFiles = await files(resolve(root, 'src'));
let project;
try {
  project = await readProjectConfig(root);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
function finish() {
  if (errors.length) {
    console.error([...new Set(errors)].join('\n'));
    process.exitCode = 1;
  } else console.log('Project structure passed');
}
if (project.profile === APPLICATION_PROFILE) {
  await checkApplicationProject(project);
  finish();
  process.exit();
}

function kebab(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
function stem(file) {
  const base = basename(file);
  if (base.endsWith('.d.ts')) return base.slice(0, -5);
  return base.replace(/\.[^.]+$/, '');
}
async function entries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}
async function checkApplicationProject(config) {
  const { paths } = config;
  const src = resolve(root, 'src');
  const configured = Object.values(paths).map((value) => resolve(root, value));
  const topLevel = new Set([
    'main.ts',
    'env.d.ts',
    'vite-env.d.ts',
    'styles',
    'assets',
    ...configured
      .map((value) => relative(src, value).split(sep)[0])
      .filter((value) => value && !value.startsWith('..')),
  ]);
  for (const file of sourceFiles) {
    const name = normalize(file);
    const relativeToSrc = relative(src, file).split(sep).join('/');
    const top = relativeToSrc.split('/')[0];
    if (!top || !topLevel.has(top)) {
      report(file, 'file-location', 'File is outside the configured project paths');
      continue;
    }
    const parts = relativeToSrc.split('/');
    for (const part of parts.slice(0, -1))
      if (!kebab(part)) report(file, 'file-naming', `Directory must be kebab-case: ${part}`);
    const fileStem = stem(file);
    if (
      name !== 'src/main.ts' &&
      name !== 'src/env.d.ts' &&
      name !== 'src/vite-env.d.ts' &&
      !kebab(fileStem)
    )
      report(file, 'file-naming', `File must be kebab-case: ${basename(file)}`);
  }

  const appDir = resolve(root, paths.app);
  const appFiles = await entries(appDir);
  if (appFiles.length) {
    for (const required of ['app-config.ts', 'app-routes.ts']) {
      if (!appFiles.some((entry) => entry.isFile() && entry.name === required))
        report(resolve(appDir, required), 'app-files', `Missing ${required}`);
    }
  }

  const componentRoot = resolve(root, paths.components);
  for (const entry of await entries(componentRoot)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = resolve(componentRoot, entry.name);
    if (!kebab(entry.name))
      report(directory, 'file-naming', 'Component directory must be kebab-case');
    for (const suffix of ['ts', 'html']) {
      if (!(await exists(resolve(directory, `${entry.name}.${suffix}`))))
        report(directory, 'component-files', `Missing ${entry.name}.${suffix}`);
    }
    const css = await exists(resolve(directory, `${entry.name}.css`));
    const less = await exists(resolve(directory, `${entry.name}.less`));
    if (css && less)
      report(directory, 'component-files', 'Component cannot have both CSS and Less styles');
    for (const file of await entries(directory)) {
      if (file.isDirectory()) {
        report(
          resolve(directory, file.name),
          'component-files',
          'Components contain only three files',
        );
        continue;
      }
      const allowed =
        /\.(?:ts|html|css|less)$/.test(file.name) &&
        stem(resolve(directory, file.name)) === entry.name;
      if (!allowed)
        report(resolve(directory, file.name), 'component-files', 'Unexpected component file');
    }
  }

  const pageRoot = resolve(root, paths.pages);
  for (const entry of await entries(pageRoot)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = resolve(pageRoot, entry.name);
    const pageFiles = await entries(directory);
    const expected = `${entry.name}-page`;
    if (!pageFiles.some((file) => file.isFile() && file.name === `${expected}.ts`))
      report(directory, 'page-files', `Missing ${expected}.ts`);
    if (!pageFiles.some((file) => file.isFile() && file.name === `${expected}.html`))
      report(directory, 'page-files', `Missing ${expected}.html`);
  }

  const themeRoot = resolve(root, paths.themes);
  for (const entry of await entries(themeRoot)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = resolve(themeRoot, entry.name);
    const files = (await entries(directory)).filter((file) => file.isFile());
    const themes = files.filter((file) => /-theme\.ts$/.test(file.name));
    if (themes.length !== 1)
      report(directory, 'theme-files', 'A theme directory contains one *-theme.ts definition');
  }
}

const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const allowed = {
  main: ['app', 'styles'],
  app: ['app', 'game', 'ui', 'contracts', 'assets'],
  game: ['game', 'contracts', 'assets'],
  ui: ['ui', 'contracts', 'assets'],
  contracts: ['contracts'],
};
function layer(file) {
  const name = normalize(file);
  return name === 'src/main.ts' ? 'main' : name.split('/')[1];
}
function dependency(file, specifier, line) {
  const clean = specifier.split('?')[0];
  const origin = layer(file);
  if (
    /(?:^|\/)packages\//.test(clean) ||
    (clean.includes('jingchuanchu-') && /\/(?:dist|src)\/|\.ts$/.test(clean))
  ) {
    report(
      file,
      'engine-internals',
      'Use the engine public package entry, not source/dist paths',
      line,
    );
  }
  if (clean.startsWith('@xiaobaibaifqy/jingchuanchu-')) {
    if (
      !['app', 'game'].includes(origin) &&
      !(origin === 'ui' && clean === '@xiaobaibaifqy/jingchuanchu-app')
    )
      report(file, 'dependency-boundary', `${origin} cannot import engine packages`, line);
    return;
  }
  const resolved = ts.resolveModuleName(clean, file, options, ts.sys).resolvedModule;
  const target =
    resolved?.resolvedFileName ??
    (clean.startsWith('.') ? resolve(dirname(file), clean) : undefined);
  if (
    resolved?.packageId?.name?.startsWith('@xiaobaibaifqy/jingchuanchu-') &&
    !['app', 'game'].includes(origin) &&
    !(origin === 'ui' && resolved.packageId.name === '@xiaobaibaifqy/jingchuanchu-app')
  ) {
    report(
      file,
      'dependency-boundary',
      `${origin} cannot import engine packages through an alias`,
      line,
    );
  }
  if (target && !resolved?.isExternalLibraryImport) {
    const targetLayer = layer(target);
    if (!allowed[origin]?.includes(targetLayer))
      report(file, 'dependency-boundary', `${origin} cannot depend on ${normalize(target)}`, line);
    if (
      /\.(html|css)$/.test(clean) &&
      origin !== 'ui' &&
      !(origin === 'main' && targetLayer === 'styles')
    ) {
      report(
        file,
        'dependency-boundary',
        'Only UI loads component HTML/CSS; main loads global styles',
        line,
      );
    }
    if (/\.(html|css)$/.test(clean) && origin === 'ui' && dirname(file) !== dirname(target)) {
      report(
        file,
        'component-files',
        'Import template and style from the component own directory',
        line,
      );
    }
  } else if (!resolved && !clean.startsWith('.')) {
    // Unresolved aliases must not silently bypass layer checks; normal npm imports resolve after install.
    report(
      file,
      'unresolved-import',
      `Cannot resolve ${specifier}; install dependencies or correct tsconfig paths`,
      line,
    );
  }
}
const domNames = new Set([
  'document',
  'window',
  'navigator',
  'HTMLElement',
  'HTMLCanvasElement',
  'Element',
  'Document',
  'Window',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]);
for (const file of sourceFiles) {
  const name = normalize(file);
  const source = await readFile(file, 'utf8');
  const origin = layer(file);
  const extension = file.endsWith('.ts')
    ? 'ts'
    : file.endsWith('.html')
      ? 'html'
      : file.endsWith('.css')
        ? 'css'
        : file.endsWith('.less')
          ? 'less'
          : 'asset';
  if (!(
    (extension === 'ts' &&
      (name === 'src/main.ts' ||
        name === 'src/env.d.ts' ||
        ['app', 'contracts', 'game', 'ui'].includes(origin))) ||
    (extension === 'html' && /^src\/ui\/components\/[^/]+\/[^/]+\.html$/.test(name)) ||
    (['css', 'less'].includes(extension) &&
      (origin === 'styles' ||
        /^src\/ui\/components\/[^/]+\/[^/]+\.(?:module\.)?(?:css|less)$/.test(name))) ||
    (extension === 'asset' && origin === 'assets')
  )) {
    report(file, 'file-location', 'File does not belong in this directory');
  }
  if (extension === 'ts') {
    if (origin === 'game' && !/^src\/game\/(scenes|components|systems)\//.test(name)) {
      report(file, 'file-location', 'Game code belongs in scenes, components or systems');
    }
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const line = (node) => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        dependency(file, node.moduleSpecifier.text, line(node));
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      )
        dependency(file, node.argument.literal.text, line(node));
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const value = node.arguments[0];
        if (value && ts.isStringLiteralLike(value)) dependency(file, value.text, line(node));
        else
          report(
            file,
            'dynamic-import',
            'Use a static module path so dependencies can be checked',
            line(node),
          );
      }
      if (
        (origin === 'game' || origin === 'contracts') &&
        ts.isIdentifier(node) &&
        domNames.has(node.text)
      ) {
        report(
          file,
          'game-dom',
          `${origin} cannot access browser DOM APIs; adapt them in app/ui`,
          line(node),
        );
      }
      if (
        (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) &&
        /<\/?[a-z][\s>]|<\/?[a-z][\w-]*[\s>]/i.test(node.getText(ast).slice(1, -1))
      ) {
        report(file, 'embedded-markup', 'Move markup into a component HTML file', line(node));
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        ['style', 'cssText', 'insertRule'].includes(node.name.text)
      )
        report(file, 'embedded-style', 'Use stylesheet files, not CSS strings in TS', line(node));
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === 'innerHTML' &&
        name !== 'src/ui/template.ts'
      ) {
        report(
          file,
          'embedded-markup',
          'Only the static UI template loader assigns innerHTML',
          line(node),
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  if (extension === 'css') {
    try {
      const css = postcss.parse(source, { from: file });
      if (origin === 'ui' && file.endsWith('.module.css')) {
        css.walkAtRules('import', (node) =>
          report(
            file,
            'css-scope',
            'Component CSS cannot import global styles',
            node.source.start.line,
          ),
        );
        css.walkRules((rule) => {
          if (rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
          const selectors = selectorParser().astSync(rule.selector);
          selectors.each((selector) => {
            let local = false;
            for (const node of selector.nodes) {
              if (node.type === 'combinator') break;
              if (node.type === 'class') local = true;
            }
            let global = false;
            selector.walkPseudos((node) => {
              if (node.value === ':global') global = true;
            });
            if (!local || global)
              report(
                file,
                'css-scope',
                'Each selector must start in a local CSS Module class; :global is forbidden',
                rule.source.start.line,
              );
          });
        });
      }
    } catch (error) {
      report(file, 'css-syntax', error.message);
    }
  }
}
for (const file of sourceFiles.filter((file) => normalize(file).startsWith('src/ui/components/'))) {
  const ownerTs = resolve(dirname(file), `${basename(dirname(file))}.ts`);
  const suiteComponent = await readFile(ownerTs, 'utf8').then(
    (code) => /\bdefineView\s*(?:<[^;]*?>)?\s*\(/.test(code),
    () => false,
  );
  if (suiteComponent) continue; // New component resources and binding names are checked by the suite compiler.
  const name = basename(dirname(file));
  if (
    !new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(ts|html|module\\.css)$`).test(
      basename(file),
    )
  ) {
    report(
      file,
      'component-files',
      'A component directory contains its same-name TS, HTML and module.css files',
    );
  }
  for (const suffix of ['ts', 'html', 'module.css']) {
    try {
      await access(resolve(dirname(file), `${name}.${suffix}`));
    } catch {
      report(file, 'component-files', `Missing ${name}.${suffix}`);
    }
  }
}
async function html(file, shell) {
  const source = await readFile(file, 'utf8');
  const tree = (shell ? parse : parseFragment)(source, { sourceCodeLocationInfo: true });
  let scripts = 0;
  let mounts = 0;
  function visit(node) {
    const attrs = Object.fromEntries((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
    const line = node.sourceCodeLocation?.startLine ?? 1;
    if (
      Object.keys(attrs).some((name) => name === 'style' || /^on/i.test(name)) ||
      node.tagName === 'style'
    )
      report(file, 'html-inline', 'Move inline behavior/styles into component TS/CSS', line);
    if (node.tagName === 'script') {
      scripts++;
      if (
        !shell ||
        attrs.type !== 'module' ||
        attrs.src !== '/src/main.ts' ||
        node.childNodes?.some((child) => child.value?.trim())
      )
        report(file, 'html-inline', 'Only the root main.ts module script is allowed', line);
    }
    if (node.tagName === 'link' && attrs.rel === 'stylesheet')
      report(file, 'html-inline', 'Import styles from the owning TS file', line);
    if (shell && node.tagName === 'body') {
      const elements = node.childNodes.filter((child) => child.tagName);
      if (
        elements.length !== 2 ||
        elements.some(
          (child) => !['div', 'script'].includes(child.tagName) && !child.tagName.includes('-'),
        )
      )
        report(
          file,
          'html-shell',
          'Root body contains only the app mount and startup script',
          line,
        );
    }
    if (shell && attrs.id === 'app') {
      mounts++;
      if (node.childNodes?.some((child) => child.tagName || child.value?.trim()))
        report(file, 'html-shell', 'App mount must be empty', line);
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(tree);
  if (shell && (scripts !== 1 || mounts !== 1))
    report(file, 'html-shell', 'Root must have one app mount and one main.ts script');
}
await html(resolve(root, 'index.html'), true);
for (const file of sourceFiles.filter((file) => file.endsWith('.html'))) await html(file, false);
if (errors.length) {
  console.error([...new Set(errors)].join('\n'));
  process.exitCode = 1;
} else console.log('Project structure passed');
