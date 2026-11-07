import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseFragment } from 'parse5';
import MagicString from 'magic-string';

const forbiddenTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'base']);
const reservedAttributes = new Set(['when', 'each', 'key', 'slot']);
const assignmentOperators = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function fail(location, message) {
  throw new Error(`${location.file}:${location.line}:${location.column}: ${message}`);
}

function locationOfNode(node, file) {
  const location = node.sourceCodeLocation;
  return {
    file,
    line: location?.startLine ?? 1,
    column: location?.startCol ?? 1,
    offset: location?.startOffset ?? 0,
  };
}

function locateInText(node, file, index) {
  const base = locationOfNode(node, file),
    before = node.value.slice(0, index),
    lines = before.split('\n');
  if (lines.length === 1)
    return { ...base, column: base.column + index, offset: base.offset + index };
  return {
    file,
    line: base.line + lines.length - 1,
    column: lines.at(-1).length + 1,
    offset: base.offset + index,
  };
}

function expressionSource(text, expression) {
  return `(${text})`;
}

function convertReference(node, location) {
  if (ts.isIdentifier(node))
    return ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier('__scope'),
      node.text,
    );
  if (ts.isPropertyAccessExpression(node))
    return ts.factory.updatePropertyAccessExpression(
      node,
      convertReference(node.expression, location),
      node.name,
    );
  if (ts.isNonNullExpression(node))
    return ts.factory.updateNonNullExpression(node, convertReference(node.expression, location));
  fail(location, 'Model targets must be writable members');
}

function convertExpression(node, locals, location) {
  const failHere = (message) => fail(location, message);
  const convert = (item) => {
    if (ts.isIdentifier(item))
      return locals.has(item.text)
        ? item
        : ts.factory.createCallExpression(ts.factory.createIdentifier('__read'), undefined, [
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier('__scope'),
              item.text,
            ),
          ]);
    if (ts.isPropertyAccessExpression(item))
      return ts.factory.updatePropertyAccessExpression(item, convert(item.expression), item.name);
    if (ts.isElementAccessExpression(item))
      return ts.factory.updateElementAccessExpression(
        item,
        convert(item.expression),
        item.argumentExpression ? convert(item.argumentExpression) : undefined,
      );
    if (ts.isCallExpression(item)) {
      const callee =
        ts.isIdentifier(item.expression) && !locals.has(item.expression.text)
          ? ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier('__scope'),
              item.expression.text,
            )
          : convert(item.expression);
      return ts.factory.updateCallExpression(
        item,
        callee,
        item.typeArguments,
        item.arguments.map(convert),
      );
    }
    if (ts.isParenthesizedExpression(item))
      return ts.factory.updateParenthesizedExpression(item, convert(item.expression));
    if (ts.isBinaryExpression(item)) {
      if (assignmentOperators.has(item.operatorToken.kind))
        failHere('Template expressions cannot assign values');
      return ts.factory.updateBinaryExpression(
        item,
        convert(item.left),
        item.operatorToken,
        convert(item.right),
      );
    }
    if (ts.isPrefixUnaryExpression(item)) {
      if (
        item.operator === ts.SyntaxKind.PlusPlusToken ||
        item.operator === ts.SyntaxKind.MinusMinusToken
      )
        failHere('Template expressions cannot assign values');
      return ts.factory.updatePrefixUnaryExpression(item, convert(item.operand));
    }
    if (ts.isPostfixUnaryExpression(item)) failHere('Template expressions cannot assign values');
    if (ts.isConditionalExpression(item))
      return ts.factory.updateConditionalExpression(
        item,
        convert(item.condition),
        item.questionToken,
        convert(item.whenTrue),
        item.colonToken,
        convert(item.whenFalse),
      );
    if (ts.isTemplateExpression(item))
      return ts.factory.updateTemplateExpression(
        item,
        ts.factory.createTemplateHead(item.head.text),
        item.templateSpans.map((span) =>
          ts.factory.updateTemplateSpan(span, convert(span.expression), span.literal),
        ),
      );
    if (ts.isObjectLiteralExpression(item)) {
      const properties = item.properties.map((property) => {
        if (ts.isShorthandPropertyAssignment(property)) {
          const name = property.name.text;
          if (locals.has(name)) failHere(`Local ${name} cannot be used as a shorthand property`);
          return ts.factory.createPropertyAssignment(
            property.name,
            ts.factory.createCallExpression(ts.factory.createIdentifier('__read'), undefined, [
              ts.factory.createPropertyAccessExpression(
                ts.factory.createIdentifier('__scope'),
                name,
              ),
            ]),
          );
        }
        if (ts.isPropertyAssignment(property)) {
          if (ts.isComputedPropertyName(property.name))
            failHere('Computed object keys are not supported');
          return ts.factory.updatePropertyAssignment(
            property,
            property.name,
            convert(property.initializer),
          );
        }
        failHere('Object methods and spreads are not supported in templates');
      });
      return ts.factory.updateObjectLiteralExpression(item, properties);
    }
    if (ts.isArrayLiteralExpression(item)) {
      if (item.elements.some((element) => ts.isSpreadElement(element)))
        failHere('Array spreads are not supported in templates');
      return ts.factory.updateArrayLiteralExpression(item, item.elements.map(convert));
    }
    if (ts.isNonNullExpression(item))
      return ts.factory.updateNonNullExpression(item, convert(item.expression));
    if (ts.isVoidExpression(item))
      return ts.factory.updateVoidExpression(item, convert(item.expression));
    if (ts.isTypeOfExpression(item))
      return ts.factory.updateTypeOfExpression(item, convert(item.expression));
    if (ts.isNoSubstitutionTemplateLiteral(item) || ts.isLiteralExpression(item)) return item;
    if (ts.isNewExpression(item)) failHere('Templates cannot create objects with new');
    if (ts.isArrowFunction(item) || ts.isFunctionExpression(item) || ts.isClassExpression(item))
      failHere('Templates cannot declare functions or classes');
    if (ts.isAwaitExpression(item) || ts.isYieldExpression(item))
      failHere('Templates cannot await or yield');
    if (ts.isTaggedTemplateExpression(item)) failHere('Tagged templates are not supported');
    if (item.kind === ts.SyntaxKind.ThisKeyword) failHere('Templates cannot use this');
    failHere(`Unsupported template expression: ${ts.SyntaxKind[item.kind]}`);
  };
  return convert(node);
}

export function compileExpression(text, file, location, options = {}) {
  const trimmed = text.trim();
  if (!trimmed) fail(location, 'Empty template expression');
  const source = ts.createSourceFile(
    `${file}.expression.ts`,
    expressionSource(trimmed),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (source.parseDiagnostics.length) {
    const diagnostic = source.parseDiagnostics[0];
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    fail(location, `Invalid expression: ${message}`);
  }
  const statement = source.statements[0];
  if (!statement || !ts.isExpressionStatement(statement))
    fail(location, 'Invalid template expression');
  let root = statement.expression;
  while (ts.isParenthesizedExpression(root)) root = root.expression;
  const locals = new Set(options.event ? ['$event'] : []);
  const converted = options.reference
    ? convertReference(root, location)
    : options.event && !ts.isCallExpression(root)
      ? fail(location, 'Event bindings must call a public operation')
      : convertExpression(statement.expression, locals, location);
  const code = ts
    .createPrinter({ newLine: ts.NewLineKind.LineFeed })
    .printNode(ts.EmitHint.Expression, converted, source);
  return { code, location, extraScope: options.extraScope };
}

export function analyzeTemplate(html, file) {
  const tree = parseFragment(html, { sourceCodeLocationInfo: true });
  const bindings = [];
  const expressions = [];
  const removals = [];
  const markerInsertions = new Map();
  const blocks = [];
  let nextId = 0;

  const addMarker = (element, name) => {
    const location = element.sourceCodeLocation;
    if (!location?.startTag) return false;
    const end = location.startTag.endOffset;
    const offset = html[end - 2] === '/' ? end - 2 : end - 1;
    const list = markerInsertions.get(offset) ?? [];
    list.push(name);
    markerInsertions.set(offset, list);
    return true;
  };
  const currentBlock = () => blocks.at(-1);
  const currentExtraScope = () => {
    const each = [...blocks].reverse().find((block) => block.kind === 'each');
    if (!each) return undefined;
    const index = each.index ?? 'index';
    return `{ ${each.item}: any; ${index}: number }`;
  };
  const withBlock = (binding) => {
    const block = currentBlock();
    if (block) binding.block = block.id;
    return binding;
  };
  const record = (expression) => {
    expressions.push(expression);
    return expression;
  };
  const compile = (text, location, options = {}) =>
    record(
      compileExpression(text, file, location, {
        ...options,
        extraScope: options.extraScope ?? currentExtraScope(),
      }),
    );

  function visit(node, parentElement) {
    let opened;
    if (node.tagName === 'template') {
      const attrs = node.attrs ?? [];
      const attribute = (name) => attrs.find((item) => item.name === name);
      const locationFor = (name) =>
        node.sourceCodeLocation?.attrs?.[name]
          ? { ...locationOfNode(node, file), ...node.sourceCodeLocation.attrs[name] }
          : locationOfNode(node, file);
      const remove = (name) => {
        const range = node.sourceCodeLocation?.attrs?.[name];
        if (range) removals.push([range.startOffset, range.endOffset]);
      };
      const when = attribute('when');
      const each = attribute('each');
      const slot = attribute('slot');
      if ([when, each, slot].filter(Boolean).length > 1)
        fail(locationOfNode(node, file), 'A template can only use one of when, each or slot');
      if ((when || each || slot) && blocks.length)
        fail(
          locationOfNode(node, file),
          'Nested when/each/slot templates are not supported by this compiler stage',
        );
      if (when) {
        const condition = compile(when.value, locationFor('when'));
        const id = nextId++;
        bindings.push({ kind: 'when', id, condition });
        addMarker(node, `data-jcc-when-${id}`);
        remove('when');
        opened = { id, kind: 'when' };
      } else if (each) {
        const parsed =
          /^\s*([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s+of\s+([\s\S]+)$/.exec(
            each.value ?? '',
          );
        if (!parsed) fail(locationFor('each'), 'each must use "item of items" syntax');
        const [, itemName, indexName, sourceText] = parsed;
        const source = compile(sourceText, locationFor('each'));
        const key = attribute('key');
        if (!key) fail(locationFor('each'), 'each requires a key attribute');
        const keyExpression = compile(key.value, locationFor('key'), {
          extraScope: `{ ${itemName}: any; ${indexName ?? 'index'}: number }`,
        });
        const id = nextId++;
        bindings.push({
          kind: 'each',
          id,
          item: itemName,
          index: indexName,
          source,
          key: keyExpression,
        });
        addMarker(node, `data-jcc-each-${id}`);
        remove('each');
        remove('key');
        opened = { id, kind: 'each', item: itemName, index: indexName };
      } else if (slot) {
        const name = (slot.value ?? '').trim();
        if (!name) fail(locationFor('slot'), 'slot requires a name');
        const id = nextId++;
        bindings.push({ kind: 'slot', id, name });
        addMarker(node, `data-jcc-slot-content-${id}`);
        remove('slot');
        opened = { id, kind: 'slot' };
      }
      if (opened) blocks.push(opened);
    } else if (
      ['when', 'each', 'key', 'slot'].some((name) =>
        (node.attrs ?? []).some((item) => item.name === name),
      )
    ) {
      fail(locationOfNode(node, file), 'when/each/key/slot must be declared on a template element');
    }

    if (node.tagName && !forbiddenTags.has(node.tagName)) {
      const elementLocation = locationOfNode(node, file);
      for (const attribute of node.attrs ?? []) {
        const name = attribute.name;
        if (['when', 'each', 'key', 'slot'].includes(name)) continue;
        const attributeLocation = node.sourceCodeLocation?.attrs?.[name]
          ? { ...elementLocation, ...node.sourceCodeLocation.attrs[name] }
          : elementLocation;
        if (/^on/i.test(name))
          fail(attributeLocation, 'Inline event attributes are forbidden; use @event bindings');
        if (name === 'style' || name === 'srcdoc')
          fail(attributeLocation, `Inline ${name} is forbidden in component templates`);
        if (name.startsWith('data-jcc-')) fail(attributeLocation, 'data-jcc-* is reserved');
        if (/^data-(?:text|attr-|on-)/.test(name))
          fail(attributeLocation, 'Legacy data-* bindings are not supported in defineComponent');
        if (
          /^(?:href|src|action|formaction|xlink:href)$/i.test(name) &&
          /^\s*javascript:/i.test(attribute.value ?? '')
        )
          fail(attributeLocation, 'Unsafe URL');

        if (name.startsWith('@')) {
          const eventName = name.slice(1);
          if (!eventName) fail(attributeLocation, 'Event binding requires an event name');
          const expression = compile(attribute.value, attributeLocation, { event: true });
          const id = nextId++;
          bindings.push(withBlock({ kind: 'event', id, name: eventName, expression }));
          if (!addMarker(node, `data-jcc-on-${id}`))
            fail(attributeLocation, 'Event bindings require an element host');
          const range = node.sourceCodeLocation.attrs[name];
          if (range) removals.push([range.startOffset, range.endOffset]);
        } else if (name.startsWith(':')) {
          const target = name.slice(1);
          if (!target) fail(attributeLocation, 'Attribute binding requires a name');
          if (target === 'style' || target === 'srcdoc')
            fail(attributeLocation, `:${target} bindings are forbidden`);
          const customElement = (node.tagName ?? '').includes('-');
          const componentInput =
            customElement &&
            target !== 'class' &&
            !target.startsWith('aria-') &&
            !target.startsWith('data-');
          const expression = compile(attribute.value, attributeLocation);
          const id = nextId++;
          bindings.push(
            withBlock(
              componentInput
                ? { kind: 'component-input', id, name: target, expression }
                : { kind: 'attribute', id, name: target, expression },
            ),
          );
          if (!addMarker(node, componentInput ? `data-jcc-input-${id}` : `data-jcc-attr-${id}`))
            fail(attributeLocation, 'Attribute bindings require an element host');
          const range = node.sourceCodeLocation.attrs[name];
          if (range) removals.push([range.startOffset, range.endOffset]);
        } else if (name.startsWith('model:')) {
          const modelName = name.slice('model:'.length);
          if (!modelName) fail(attributeLocation, 'Model binding requires a model name');
          const reference = compile(attribute.value, attributeLocation, { reference: true });
          const id = nextId++;
          const native = ['input', 'textarea', 'select'].includes(node.tagName);
          bindings.push(
            withBlock(
              native
                ? { kind: 'native-model', id, name: 'value', reference }
                : { kind: 'component-model', id, model: modelName, reference },
            ),
          );
          record({
            code: `(${reference.code}.set(null as any), ${reference.code})`,
            location: attributeLocation,
            extraScope: currentExtraScope(),
          });
          if (!addMarker(node, `data-jcc-model-${id}`))
            fail(attributeLocation, 'Model bindings require an element host');
          const range = node.sourceCodeLocation.attrs[name];
          if (range) removals.push([range.startOffset, range.endOffset]);
        }
      }
    } else if (node.tagName) {
      fail(locationOfNode(node, file), `Unsupported component tag ${node.tagName}`);
    }

    try {
      for (const child of node.childNodes ?? []) {
        if (child.nodeName === '#text') {
          const matches = [...child.value.matchAll(/\{\{([\s\S]*?)\}\}/g)];
          if (!matches.length) continue;
          const host = parentElement;
          if (!host || host.tagName === 'template')
            fail(
              locationOfNode(child, file),
              'Interpolation requires an element host inside the block',
            );
          const parts = [];
          let lastIndex = 0;
          for (const match of matches) {
            parts.push({ text: child.value.slice(lastIndex, match.index) });
            const location = locateInText(child, file, match.index + 2);
            parts.push({ expression: compile(match[1], location) });
            lastIndex = match.index + match[0].length;
          }
          parts.push({ text: child.value.slice(lastIndex) });
          const id = nextId++;
          const textIndex = (child.parentNode?.childNodes ?? []).indexOf(child);
          bindings.push(withBlock({ kind: 'text', id, textIndex, parts }));
          if (!addMarker(host, `data-jcc-text-${id}`))
            fail(locationOfNode(child, file), 'Interpolation requires an element host');
        } else if (child.tagName) {
          visit(child, child);
        } else if (child.content) {
          visit(child.content, child);
        } else {
          visit(child, parentElement);
        }
      }
      if (node.content) visit(node.content, parentElement);
    } finally {
      if (opened) blocks.pop();
    }
  }

  visit(tree, undefined);

  const output = new MagicString(html);
  for (const [start, end] of removals) output.remove(start, end);
  for (const [offset, names] of [...markerInsertions.entries()].sort((a, b) => a[0] - b[0]))
    output.appendLeft(offset, names.map((name) => ` ${name}`).join(''));

  return {
    html: output.toString(),
    bindings,
    expressions,
  };
}

export function renderBindings(bindings) {
  const blockField = (binding) => (binding.block === undefined ? '' : `,block:${binding.block}`);
  const entries = bindings.map((binding) => {
    if (binding.kind === 'text') {
      const values = binding.parts
        .map((part) =>
          'expression' in part ? `(${part.expression.code} ?? '')` : JSON.stringify(part.text),
        )
        .join(',');
      return `{kind:"text",id:${binding.id},textIndex:${binding.textIndex},read:(__scope:any)=>[${values}].join("")${blockField(binding)}}`;
    }
    if (binding.kind === 'attribute')
      return `{kind:"attribute",id:${binding.id},name:${JSON.stringify(binding.name)},read:(__scope:any)=>(${binding.expression.code})${blockField(binding)}}`;
    if (binding.kind === 'component-input')
      return `{kind:"component-input",id:${binding.id},name:${JSON.stringify(binding.name)},read:(__scope:any)=>(${binding.expression.code})${blockField(binding)}}`;
    if (binding.kind === 'native-model')
      return `{kind:"native-model",id:${binding.id},name:"value",read:(__scope:any)=>__read(${binding.reference.code}),write:(__scope:any,value:any)=>{${binding.reference.code}.set(value)},config:(__scope:any)=>(((${binding.reference.code}) as any).__jccModel)${blockField(binding)}}`;
    if (binding.kind === 'component-model')
      return `{kind:"component-model",id:${binding.id},model:${JSON.stringify(binding.model)},read:(__scope:any)=>__read(${binding.reference.code}),write:(__scope:any,value:any)=>{${binding.reference.code}.set(value)}${blockField(binding)}}`;
    if (binding.kind === 'when')
      return `{kind:"when",id:${binding.id},condition:(__scope:any)=>(${binding.condition.code})}`;
    if (binding.kind === 'each')
      return `{kind:"each",id:${binding.id},item:${JSON.stringify(binding.item)},${binding.index ? `index:${JSON.stringify(binding.index)},` : ''}source:(__scope:any)=>__read(${binding.source.code}),key:(__scope:any)=>__read(${binding.key.code})}`;
    if (binding.kind === 'slot')
      return `{kind:"slot",id:${binding.id},name:${JSON.stringify(binding.name)}}`;
    return `{kind:"event",id:${binding.id},name:${JSON.stringify(binding.name)},run:(__scope:any,$event:Event)=>{(${binding.expression.code});}${blockField(binding)}}`;
  });
  return `(()=>{const __read=(value:any)=>(value&&value.__jccSignal?value():value);return [${entries.join(',')}];})()`;
}

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const fallbackModules = {
  '@xiaobaibaifqy/jingchuanchu-app': 'packages/app/index.ts',
  '@xiaobaibaifqy/jingchuanchu-app/application': 'packages/app/application.ts',
  '@xiaobaibaifqy/jingchuanchu-core': 'packages/core/index.ts',
  '@xiaobaibaifqy/jingchuanchu-assets': 'packages/assets/index.ts',
  '@xiaobaibaifqy/jingchuanchu-input': 'packages/input/index.ts',
  '@xiaobaibaifqy/jingchuanchu-browser': 'packages/browser/index.ts',
  '@xiaobaibaifqy/jingchuanchu-renderer-2d': 'packages/renderer-2d/index.ts',
};

function samePath(a, b) {
  return resolve(a) === resolve(b);
}

export function checkTemplateTypes(code, id, components) {
  if (!components.length) return;
  const virtualPath = id + '.__jcc-check.ts';
  const appended = [];
  const lineMap = [];
  let lineCount = code.split('\n').length;
  const append = (text, location) => {
    const startLine = lineCount;
    appended.push(text);
    const lines = (text.match(/\n/g) ?? []).length;
    if (location) lineMap.push({ startLine, endLine: startLine + lines, location });
    lineCount += lines;
  };

  append(`\ndeclare function __read<T>(value: T): T extends () => infer R ? R : T;\n`);

  components.forEach((component, index) => {
    append(
      `\nconst __jcc_component_${index} = (${component.callText});\ntype __JccScope_${index} = ReturnType<typeof __jcc_component_${index}['setup']>;\n`,
    );
    component.expressions.forEach((expression, expressionIndex) => {
      const extraScope = expression.extraScope ? ` & ${expression.extraScope}` : '';
      append(
        `function __jcc_check_${index}_${expressionIndex}(__scope: __JccScope_${index}${extraScope}, $event: Event) {\n  return (${expression.code});\n}\n`,
        expression.location,
      );
    });
  });

  const content = code + '\n' + appended.join('');
  const options = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    customConditions: ['source'],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    samePath(fileName, virtualPath)
      ? ts.createSourceFile(
          fileName,
          content,
          languageVersion,
          true,
          id.endsWith('.mts') || id.endsWith('.cts') ? ts.ScriptKind.TS : ts.ScriptKind.TS,
        )
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = (fileName) =>
    samePath(fileName, virtualPath) ? true : originalFileExists(fileName);
  host.readFile = (fileName) =>
    samePath(fileName, virtualPath) ? content : originalReadFile(fileName);
  const resolveModule = (name, containingFile) => {
    const resolved = ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
    if (resolved) return resolved;
    const relative = fallbackModules[name];
    if (!relative) return undefined;
    const target = resolve(repositoryRoot, relative);
    if (!existsSync(target)) return undefined;
    return {
      resolvedFileName: target,
      extension: ts.Extension.Ts,
      isExternalLibraryImport: false,
    };
  };
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) => resolveModule(name, containingFile));
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal) => ({ resolvedModule: resolveModule(literal.text, containingFile) }));

  const program = ts.createProgram([virtualPath], options, host);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) =>
        diagnostic.file &&
        samePath(diagnostic.file.fileName, virtualPath) &&
        diagnostic.start !== undefined &&
        diagnostic.start >= code.length,
    )
    .sort((a, b) => a.start - b.start);
  for (const diagnostic of diagnostics) {
    const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line;
    const mapped = lineMap.find((entry) => line >= entry.startLine && line <= entry.endLine);
    if (!mapped) continue;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    fail(mapped.location, message);
  }
}
