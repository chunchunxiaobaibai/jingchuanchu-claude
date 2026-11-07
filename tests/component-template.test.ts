import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { mountComponent, Owner } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { ComponentDefinition } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { compileViews } from '../packages/tooling/compiler.mjs';

const componentSource = `import {
  defineComponent,
  input,
  model,
  output,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
export const NicknameEditor = defineComponent({
  selector: 'nickname-editor',
  inputs: { label: input<string>() },
  outputs: { save: output<string>() },
  models: { value: model<string>() },
  setup(context) {
    return {
      label: context.inputs.label,
      value: context.models.value,
      valid: context.signal(true),
      save: () => {},
    };
  },
});`;

const template = `<label>{{ label }}</label>
<input model:value="value" />
<button :disabled="!valid" @click="save()">保存</button>
<template when="valid"><span>可以提交</span></template>`;

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'jcc-component-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('defineComponent associates same-name HTML and Less with scoped source metadata', () =>
  fixture(async (directory) => {
    const file = join(directory, 'nickname-editor.ts');
    await writeFile(join(directory, 'nickname-editor.html'), template);
    await writeFile(
      join(directory, 'nickname-editor.less'),
      '@accent: #176b58; label { color: @accent; }',
    );
    const result = (await compileViews(componentSource, file))!;
    assert.match(result.code, /\$template:/);
    assert.match(result.code, /\$style:__jcc_style_0/);
    assert.match(result.code, /\$scope:"data-jcc-/);
    assert.match(result.code, /\$source:/);
    assert.match(result.dependencies.at(-1)!, /nickname-editor\.less$/);
    assert.match(result.resources[0]!.css, /label\[data-jcc-[a-f0-9]+\]/);
    assert.match(result.resources[0]!.css, /#176b58/);
  }));

test('defineComponent supports aliases and explicit template/style paths', () =>
  fixture(async (directory) => {
    const file = join(directory, 'editor.ts');
    await writeFile(join(directory, 'view.html'), template);
    await writeFile(join(directory, 'theme.less'), 'label { color: blue; }');
    const source = componentSource
      .replace('defineComponent', 'defineComponent as component')
      .replace('defineComponent({', 'component({')
      .replace(
        "selector: 'nickname-editor',",
        "selector: 'nickname-editor', templateUrl: './view.html', styleUrl: './theme.less',",
      );
    const result = (await compileViews(source, file))!;
    assert.match(result.code, /\$source:/);
    assert.match(result.resources[0]!.css, /blue/);
    assert.ok(result.dependencies.some((item) => item.endsWith('view.html')));
  }));

test('defineComponent requires its template and rejects compiler-owned or spread metadata', () =>
  fixture(async (directory) => {
    const file = join(directory, 'nickname-editor.ts');
    await assert.rejects(compileViews(componentSource, file), /Missing component template/);
    await writeFile(join(directory, 'nickname-editor.html'), template);
    const owned = componentSource.replace('selector:', "$template: '<span></span>', selector:");
    await assert.rejects(compileViews(owned, file), /\$template is compiler-owned/);
    const spread = componentSource.replace('setup(context)', '...metadata, setup(context)');
    await assert.rejects(compileViews(spread, file), /spread metadata/);
  }));

test('template expressions are type checked against setup members with HTML locations', () =>
  fixture(async (directory) => {
    const file = join(directory, 'nickname-editor.ts');
    const write = (html: string) => writeFile(join(directory, 'nickname-editor.html'), html);
    await write('<span>{{ missing }}</span>');
    await assert.rejects(compileViews(componentSource, file), /nickname-editor\.html:1.*missing/);
    await write('<span>{{ label }}</span><button @click="save(1)">x</button>');
    await assert.rejects(compileViews(componentSource, file), /nickname-editor\.html:1.*arguments/);
    await write('<button :disabled="unknownFlag">x</button>');
    await assert.rejects(
      compileViews(componentSource, file),
      /nickname-editor\.html:1.*unknownFlag/,
    );
    await write('<button @click="alert(\'x\')">x</button>');
    await assert.rejects(compileViews(componentSource, file), /nickname-editor\.html:1.*alert/);
    await write('<button @click="valid">x</button>');
    await assert.rejects(compileViews(componentSource, file), /must call a public operation/);
    await write('<span>{{ label = "x" }}</span>');
    await assert.rejects(compileViews(componentSource, file), /cannot assign/);
    await write('<span>{{ $event }}</span>');
    await assert.rejects(compileViews(componentSource, file), /nickname-editor\.html:1.*\$event/);

    const readonlySource = `import { defineComponent, input } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const ReadOnly = defineComponent({
  selector: 'readonly-model',
  inputs: { label: input<string>() },
  setup(context) {
    return { label: context.inputs.label };
  },
});`;
    const readonlyFile = join(directory, 'readonly-model.ts');
    await writeFile(join(directory, 'readonly-model.html'), '<input model:value="label" />');
    await assert.rejects(compileViews(readonlySource, readonlyFile), /readonly-model\.html:1.*set/);
  }));

test('compiled definitions mount with generated interpolation, attributes and events', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.jcc-template-'));
  try {
    const file = join(directory, 'generated-badge.ts');
    const source = `import { defineComponent, input } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const GeneratedBadge = defineComponent({
  selector: 'generated-badge',
  inputs: { label: input<string>({ default: 'start' }) },
  setup(context) {
    const pressed = context.signal(false);
    return { label: context.inputs.label, pressed, press: () => pressed.set(true) };
  },
});`;
    await writeFile(
      join(directory, 'generated-badge.html'),
      '<span>{{ label }}</span><button :disabled="!pressed" @click="press()">x</button>',
    );
    const compiled = (await compileViews(source, file))!;
    await writeFile(file, compiled.code);
    const module = (await import(`${pathToFileURL(file).href}?v=${Date.now()}`)) as {
      GeneratedBadge: ComponentDefinition<any, any, any, any>;
    };
    const window = new Window();
    const document = window.document as unknown as Document;
    const host = document.createElement('div');
    document.body.append(host);
    const instance = mountComponent(host, module.GeneratedBadge, {
      owner: new Owner(),
      onError(error) {
        throw error;
      },
    });
    const span = host.querySelector('span')!;
    const button = host.querySelector('button')!;
    assert.equal(span.textContent, 'start');
    assert.equal((button as HTMLButtonElement).disabled, true);
    button.dispatchEvent(new window.Event('click') as unknown as Event);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal((button as HTMLButtonElement).disabled, false);
    instance.setInputs({ label: 'next' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(span.textContent, 'next');
    instance.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('definePage uses the same compiler pipeline and reports template diagnostics', () =>
  fixture(async (directory) => {
    const file = join(directory, 'play-page.ts');
    const source = `import { definePage, input } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const PlayPage = definePage({
  selector: 'play-page',
  inputs: { levelId: input<string>({ default: '' }) },
  setup(context) {
    return { levelId: context.inputs.levelId };
  },
});`;
    await writeFile(join(directory, 'play-page.html'), '<h1>{{ levelId }}</h1>');
    const compiled = (await compileViews(source, file))!;
    assert.match(compiled.code, /\$template:/);
    assert.match(compiled.code, /\$bindings:/);
    await writeFile(join(directory, 'play-page.html'), '<h1>{{ missing }}</h1>');
    await assert.rejects(compileViews(source, file), /play-page\.html:1.*missing/);
  }));

test('component elements receive input bindings and emit output events', () =>
  fixture(async (directory) => {
    const file = join(directory, 'parent-view.ts');
    const source = `import { defineComponent } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const ParentView = defineComponent({
  selector: 'parent-view',
  setup(context) {
    const label = context.signal('one');
    return { label, onSave: (_event: Event) => {} };
  },
});`;
    await writeFile(
      join(directory, 'parent-view.html'),
      '<child-widget :label="label" @save="onSave($event)"></child-widget>',
    );
    const compiled = (await compileViews(source, file))!;
    assert.match(compiled.code, /kind:"component-input"/);
    assert.match(compiled.code, /name:"label"/);
    assert.match(compiled.code, /kind:"event"/);
    assert.match(compiled.code, /data-jcc-input-0/);
  }));

test('the same compiler still validates legacy defineView fixtures', () =>
  fixture(async (directory) => {
    const file = join(directory, 'old-hud.ts');
    await writeFile(join(directory, 'old-hud.html'), '<span data-text="score"></span>');
    const source = `import { defineView } from '@xiaobaibaifqy/jingchuanchu-app';
export const OldHud = defineView({
  selector: 'old-hud',
  text: { score: (context) => context.state.score },
});`;
    const result = (await compileViews(source, file))!;
    assert.match(result.code, /\$template:/);
    await writeFile(join(directory, 'old-hud.html'), '<span data-text="missing"></span>');
    await assert.rejects(compileViews(source, file), /Unknown text binding/);
  }));
