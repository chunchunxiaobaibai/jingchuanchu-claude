import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const prefix = '@xiaobaibaifqy/jingchuanchu-';
const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const slash = (path) => path.split(sep).join('/');

function componentName(name) {
  return name
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
}
function kebabName(name) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name))
    throw new Error('Name must be lowercase kebab-case');
  return name;
}
function registerRoute(code, file, entry, conflictName, conflictPath) {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  let array;
  function visit(node) {
    if (
      !array &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineRoutes'
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isArrayLiteralExpression(argument)) array = argument;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!array) throw new Error(`${file}: expected a static defineRoutes([...]) table`);
  const names = [];
  const paths = [];
  for (const element of array.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer))
        continue;
      const key = property.name.getText(ast);
      if (key === 'name') names.push(property.initializer.text);
      if (key === 'path') paths.push(property.initializer.text);
    }
  }
  if (names.includes(conflictName))
    throw new Error(`Route name already registered: ${conflictName}`);
  if (paths.includes(conflictPath))
    throw new Error(`Route path already registered: ${conflictPath}`);
  const offset = array.getStart(ast) + 1;
  return code.slice(0, offset) + `${entry},` + code.slice(offset);
}
async function writeArtifacts(root, outputs, edits = new Map()) {
  for (const file of [...outputs.keys(), ...edits.keys()]) {
    const relativePath = relative(root, file);
    if (relativePath.startsWith('..')) throw new Error('Generated file escapes the project');
  }
  for (const file of outputs.keys())
    if (await exists(file)) throw new Error(`Refusing to overwrite ${file}`);
  const created = [];
  const originals = new Map();
  try {
    for (const [file, source] of edits) {
      originals.set(file, await readFile(file, 'utf8'));
      await writeFile(file, source);
    }
    for (const [file, source] of outputs) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, source, { flag: 'wx' });
      created.push(file);
    }
  } catch (error) {
    for (const file of created.reverse()) await rm(file, { force: true });
    for (const [file, source] of originals) await writeFile(file, source);
    throw error;
  }
  return [...outputs.keys(), ...edits.keys()];
}
function componentSource(exported, selector) {
  return `import { defineComponent } from '${prefix}app/application';\n\nexport const ${exported} = defineComponent({\n  selector: '${selector}',\n  setup() {\n    return {};\n  },\n});\n`;
}
function styleSource(selector) {
  return `${selector} {\n  display: block;\n}\n`;
}
async function exportedThemeName(file) {
  const code = await readFile(file, 'utf8');
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) continue;
    for (const declaration of statement.declarationList.declarations)
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isCallExpression(declaration.initializer)
      )
        return declaration.name.text;
  }
  throw new Error(`${file}: expected an exported theme constant`);
}

export async function generateApplicationArtifact(config, kind, name, options) {
  const exported = componentName(kebabName(name));
  const root = config.root;
  const style = options.style ?? config.style;
  if (!['css', 'less'].includes(style)) throw new Error('Style must be css or less');
  const outputs = new Map();
  const edits = new Map();

  if (kind === 'page') {
    const route = options.route ?? `/${name}`;
    if (!route.startsWith('/') || /^[a-zA-Z][\w+.-]*:/.test(route) || route.startsWith('//'))
      throw new Error('Page routes must be internal application paths');
    const directory = resolve(root, config.paths.pages, name);
    const base = join(directory, `${name}-page`);
    outputs.set(
      base + '.ts',
      `import { definePage } from '${prefix}app/application';\n\nexport const ${exported}Page = definePage({\n  selector: '${name}-page',\n  setup() {\n    return {};\n  },\n});\n`,
    );
    outputs.set(
      base + '.html',
      `<section class="${name}-page">\n  <h1>${exported} Page</h1>\n</section>\n`,
    );
    outputs.set(base + '.' + style, styleSource(`.${name}-page`));
    const routesFile = resolve(root, config.paths.app, 'app-routes.ts');
    if (!(await exists(routesFile)))
      throw new Error(`${routesFile}: app routes are required for page generation`);
    const specifier = slash(
      relative(dirname(routesFile), join(directory, `${name}-page.ts`)),
    ).replace(/\.ts$/, '.js');
    const entry = `{ name: ${JSON.stringify(name)}, path: ${JSON.stringify(route)}, loadPage: () => import(${JSON.stringify(specifier)}).then((module) => module.${exported}Page) }`;
    edits.set(
      routesFile,
      registerRoute(await readFile(routesFile, 'utf8'), routesFile, entry, name, route),
    );
  } else if (kind === 'component') {
    if (!!options.page === !!options.shared)
      throw new Error('Component generation requires exactly one of --page or --shared');
    const directory = options.shared
      ? resolve(root, config.paths.components, name)
      : resolve(root, config.paths.pages, kebabName(options.page), name);
    if (!options.shared && !(await exists(dirname(directory))))
      throw new Error(`Page directory does not exist: ${dirname(directory)}`);
    const base = join(directory, name);
    outputs.set(base + '.ts', componentSource(exported, name));
    outputs.set(base + '.html', `<div class="${name}">\n  <span>${exported}</span>\n</div>\n`);
    outputs.set(base + '.' + style, styleSource(`.${name}`));
  } else if (kind === 'scene') {
    if (!options.page) throw new Error('Scene generation requires --page');
    const directory = resolve(root, config.paths.pages, kebabName(options.page));
    if (!(await exists(directory))) throw new Error(`Page directory does not exist: ${directory}`);
    outputs.set(
      join(directory, `${name}-scene.ts`),
      `import { defineGameScene } from '${prefix}app/application';\n\nexport const ${exported}Scene = defineGameScene({\n  setup() {\n    // Mount with createGameCanvas from the page once its canvas is ready.\n  },\n});\n`,
    );
  } else if (kind === 'store') {
    if (!options.domain) throw new Error('Store generation requires --domain');
    const directory = resolve(root, config.paths.game, kebabName(options.domain));
    outputs.set(
      join(directory, `${name}-store.ts`),
      `import { defineStore } from '${prefix}app/application';\n\nexport const ${exported}Store = defineStore({\n  name: '${name}',\n  setup(context) {\n    const value = context.signal(0);\n    return {\n      state: { value },\n      actions: {\n        set(next: number) {\n          value.set(next);\n        },\n      },\n    };\n  },\n});\n`,
    );
  } else if (kind === 'theme') {
    const baseName = kebabName(options.extends ?? 'default');
    const baseFile = resolve(root, config.paths.themes, baseName, `${baseName}-theme.ts`);
    if (!(await exists(baseFile))) throw new Error(`Base theme does not exist: ${baseFile}`);
    const baseExport = await exportedThemeName(baseFile);
    const directory = resolve(root, config.paths.themes, name);
    const specifier = slash(relative(directory, baseFile)).replace(/\.ts$/, '.js');
    outputs.set(
      join(directory, `${name}-theme.ts`),
      `import { extendTheme } from '${prefix}app/application';\nimport { ${baseExport} } from ${JSON.stringify(specifier)};\n\nexport const ${exported}Theme = extendTheme(${baseExport}, {\n  name: '${name}',\n  tokens: {},\n  assets: {},\n});\n`,
    );
  } else {
    throw new Error(`Unsupported generate target: ${kind}`);
  }
  return writeArtifacts(root, outputs, edits);
}
