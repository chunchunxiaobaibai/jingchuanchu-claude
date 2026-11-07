import { readFile, access } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import less from 'less';
import postcss from 'postcss';
import imports from 'postcss-import';
import selectorParser from 'postcss-selector-parser';
import { parseFragment } from 'parse5';
import MagicString from 'magic-string';
import { analyzeTemplate, checkTemplateTypes, renderBindings } from './template-check.mjs';

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const propertyName = (node) =>
  node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ? node.name.text
    : undefined;
function property(object, name) {
  return object.properties.find((node) => propertyName(node) === name);
}
function staticString(object, name, source) {
  const node = property(object, name);
  if (!node) return undefined;
  if (!ts.isPropertyAssignment(node) || !ts.isStringLiteralLike(node.initializer))
    throw new Error(`${source}: ${name} must be a static string`);
  return node.initializer.text;
}
function bindingNames(object, name, source) {
  const node = property(object, name);
  if (!node) return new Set();
  if (!ts.isPropertyAssignment(node) || !ts.isObjectLiteralExpression(node.initializer))
    throw new Error(`${source}: ${name} must be an object literal for template checking`);
  return new Set(node.initializer.properties.map((item) => propertyName(item)));
}
export function validateTemplate(html, file, bindings) {
  const tree = parseFragment(html, { sourceCodeLocationInfo: true });
  function walk(node) {
    const line = node.sourceCodeLocation?.startLine ?? 1;
    const fail = (message) => {
      throw new Error(`${file}:${line}: ${message}`);
    };
    if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'base'].includes(node.tagName))
      fail(`Unsupported component tag ${node.tagName}`);
    for (const attr of node.attrs ?? []) {
      if (/^on/i.test(attr.name) || attr.name === 'style' || attr.name === 'srcdoc')
        fail('Inline behavior/styles are forbidden');
      if (
        /^(href|src|action|formaction|xlink:href)$/i.test(attr.name) &&
        /^\s*javascript:/i.test(attr.value)
      )
        fail('Unsafe URL');
      const kind =
        attr.name === 'data-text'
          ? 'text'
          : attr.name.startsWith('data-attr-')
            ? 'attributes'
            : attr.name.startsWith('data-on-')
              ? 'actions'
              : undefined;
      if (kind && bindings && !bindings[kind].has(attr.value))
        fail(`Unknown ${kind} binding: ${attr.value}`);
      if (attr.name.startsWith('data-attr-') && /^(on|style$|srcdoc$)/i.test(attr.name.slice(10)))
        fail('Unsafe attribute binding');
      if (attr.name === 'data-text' && node.childNodes?.some((child) => child.tagName))
        fail('Text binding cannot replace child elements');
    }
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  }
  walk(tree);
}
export async function compileStyle(file, scope) {
  const text = await readFile(file, 'utf8'),
    dependencies = new Set([file]);
  let css = text,
    previousMap;
  if (extname(file) === '.less') {
    let result;
    try {
      result = await less.render(text, {
        filename: file,
        javascriptEnabled: false,
        sourceMap: { outputSourceFiles: true },
      });
    } catch (error) {
      error.message = `${error.filename ?? file}:${error.line ?? 1}:${error.column ?? 0}: ${error.message}`;
      throw error;
    }
    css = result.css;
    previousMap = result.map;
    result.imports.forEach((path) => dependencies.add(resolve(path)));
  }
  const imported = await postcss([imports()]).process(css, {
    from: file,
    map: previousMap ? { prev: previousMap, inline: false, annotation: false } : false,
  });
  imported.messages.forEach((message) => {
    if (message.type === 'dependency') dependencies.add(message.file);
  });
  const root = imported.root;
  const animations = new Map();
  root.walkAtRules((rule) => {
    if (/keyframes$/i.test(rule.name)) {
      const name = rule.params.trim();
      const renamed = `${name}-${scope}`;
      animations.set(name, renamed);
      rule.params = renamed;
    }
    if (/^(?:import|page|font-face|property|counter-style)$/i.test(rule.name))
      throw rule.error(`Global @${rule.name} is not allowed in component styles`);
  });
  root.walkRules((rule) => {
    if (rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        selector.walkPseudos((node) => {
          if ([':global', ':root', ':host'].includes(node.value))
            throw rule.error(`${node.value} is not supported in component styles`);
        });
        let compound = [];
        const scopeCompound = () => {
          if (!compound.length) return;
          const anchor = compound.find((node) => node.type === 'pseudo') ?? compound.at(-1);
          const attribute = selectorParser.attribute({ attribute: scope });
          if (anchor.type === 'pseudo') selector.insertBefore(anchor, attribute);
          else selector.insertAfter(anchor, attribute);
          compound = [];
        };
        for (const node of [...selector.nodes]) {
          if (node.type === 'combinator') scopeCompound();
          else compound.push(node);
        }
        scopeCompound();
      });
    }).processSync(rule.selector);
  });
  root.walkDecls((decl) => {
    if (/^(?:-webkit-)?animation(?:-name)?$/.test(decl.prop))
      decl.value = decl.value.replace(/[\w-]+/g, (token) => animations.get(token) ?? token);
  });
  const result = root.toResult({
    from: file,
    to: file + '.css',
    map: { inline: true, annotation: true, sourcesContent: true },
  });
  return { css: result.css, dependencies: [...dependencies] };
}
/** Transform imported defineView/defineComponent calls, preserving ordinary TS and its source map. */
export async function compileViews(code, id) {
  const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const definitions = new Map();
  for (const statement of ast.statements)
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      ['@xiaobaibaifqy/jingchuanchu-app', '@xiaobaibaifqy/jingchuanchu-app/application'].includes(
        statement.moduleSpecifier.text,
      )
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const entry of bindings.elements) {
          const imported = (entry.propertyName ?? entry.name).text;
          if (
            imported === 'defineView' ||
            imported === 'defineComponent' ||
            imported === 'definePage'
          )
            definitions.set(entry.name.text, imported);
        }
    }
  if (!definitions.size) return null;
  const calls = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      definitions.has(node.expression.text)
    ) {
      const object = node.arguments[0];
      if (!object || !ts.isObjectLiteralExpression(object))
        throw new Error(
          `${id}: ${definitions.get(node.expression.text)} requires an object literal`,
        );
      calls.push({ object, kind: definitions.get(node.expression.text), call: node });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const output = new MagicString(code),
    resources = [],
    dependencies = new Set(),
    typeChecks = [];
  for (let index = 0; index < calls.length; index++) {
    const { object, kind, call } = calls[index];
    for (const prop of object.properties)
      if (ts.isSpreadAssignment(prop))
        throw new Error(`${id}: spread metadata cannot be checked statically`);
    for (const name of ['$template', '$style', '$scope', '$source'])
      if (property(object, name)) throw new Error(`${id}: ${name} is compiler-owned`);
    const base = id.slice(0, -extname(id).length);
    const templateUrl = staticString(object, 'templateUrl', id),
      styleUrl = staticString(object, 'styleUrl', id);
    const template = templateUrl ? resolve(dirname(id), templateUrl) : base + '.html';
    if (!(await exists(template))) throw new Error(`${id}: Missing component template ${template}`);
    const html = await readFile(template, 'utf8');
    dependencies.add(template);
    let compiledHtml = html,
      bindingSource;
    if (kind === 'defineView') {
      validateTemplate(
        html,
        template,
        Object.fromEntries(
          ['text', 'attributes', 'actions'].map((name) => [name, bindingNames(object, name, id)]),
        ),
      );
    } else {
      const analyzed = analyzeTemplate(html, template);
      compiledHtml = analyzed.html;
      bindingSource = renderBindings(analyzed.bindings);
      typeChecks.push({ callText: call.getText(ast), expressions: analyzed.expressions });
    }
    let style = styleUrl ? resolve(dirname(id), styleUrl) : undefined;
    if (style && !(await exists(style))) throw new Error(`${id}: Missing component style ${style}`);
    if (!styleUrl) {
      const styles = [];
      for (const suffix of ['.css', '.less'])
        if (await exists(base + suffix)) styles.push(base + suffix);
      if (styles.length > 1) throw new Error(`${id}: Ambiguous same-name CSS/Less styles`);
      style = styles[0];
    }
    const scope =
      'data-jcc-' +
      createHash('sha256')
        .update(id + ':' + index)
        .digest('hex')
        .slice(0, 12);
    let styleExpression = '""';
    if (style) {
      const result = await compileStyle(style, scope);
      result.dependencies.forEach((file) => dependencies.add(file));
      const virtual = (style + `.jingchuanchu-${scope}.css`).replaceAll('\\', '/');
      resources.push({ id: virtual, css: result.css });
      const variable = `__jcc_style_${index}`;
      output.prepend(`import ${variable} from ${JSON.stringify(virtual + '?inline')};\n`);
      styleExpression = variable;
    }
    output.appendLeft(
      object.getStart(ast) + 1,
      `$template:${JSON.stringify(compiledHtml)},$style:${styleExpression},$scope:${JSON.stringify(scope)},$source:${JSON.stringify(id)},${bindingSource ? `$bindings:${bindingSource},` : ''}`,
    );
  }
  checkTemplateTypes(code, id, typeChecks);
  return {
    code: output.toString(),
    map: output.generateMap({ hires: true, source: id, includeContent: true }),
    resources,
    dependencies: [...dependencies],
  };
}
