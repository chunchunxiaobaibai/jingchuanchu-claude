import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { mountComponent, Owner } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { ComponentDefinition } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { compileViews } from '../packages/tooling/compiler.mjs';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('structural templates require keys and reject nesting', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.jcc-structure-neg-'));
  try {
    const file = join(directory, 'structure.ts');
    const source = `import { defineComponent } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const Structure = defineComponent({
  selector: 'structure-view',
  setup(context) {
    return { visible: context.signal(true), items: context.signal([{ id: 1 }]) };
  },
});`;
    await writeFile(
      join(directory, 'structure.html'),
      '<template each="item of items"><span>{{ item.id }}</span></template>',
    );
    await assert.rejects(compileViews(source, file), /each requires a key attribute/);
    await writeFile(
      join(directory, 'structure.html'),
      '<template when="visible"><template each="item of items" key="item.id"><span>{{ item.id }}</span></template></template>',
    );
    await assert.rejects(compileViews(source, file), /Nested when\/each\/slot/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('compiled when, each and slot templates render and update', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.jcc-structure-'));
  try {
    const innerFile = join(directory, 'inner-panel.ts');
    const innerSource = `import { defineComponent } from '@xiaobaibaifqy/jingchuanchu-app/application';
export const InnerPanel = defineComponent({
  selector: 'inner-panel',
  setup() {
    return {};
  },
});`;
    await writeFile(
      join(directory, 'inner-panel.html'),
      '<div><slot name="actions"><b>fallback</b></slot></div>',
    );
    await writeFile(innerFile, (await compileViews(innerSource, innerFile))!.code);

    let members:
      | {
          label: { (): string; set(next: string): void };
          hide(): void;
          show(): void;
          reverse(): void;
        }
      | undefined;
    const outerFile = join(directory, 'outer-view.ts');
    const outerSource = `import { defineComponent } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { InnerPanel } from './inner-panel.js';
export const OuterView = defineComponent({
  selector: 'outer-view',
  components: [InnerPanel],
  setup(context) {
    const visible = context.signal(true);
    const label = context.signal('ready');
    const items = context.signal([
      { id: 1, name: 'one' },
      { id: 2, name: 'two' },
    ]);
    const captured = {
      label,
      hide: () => visible.set(false),
      show: () => visible.set(true),
      reverse: () =>
        items.update((list) => [...list].reverse()),
    };
    (globalThis as { __outerMembers?: unknown }).__outerMembers = captured;
    return {
      visible,
      label,
      items,
      press: () => label.set('pressed'),
      hide: captured.hide,
      show: captured.show,
      reverse: captured.reverse,
    };
  },
});`;
    await writeFile(
      join(directory, 'outer-view.html'),
      `<section>
  <template when="visible"><p class="status">{{ label }}</p></template>
  <ul><template each="item of items" key="item.id"><li>{{ item.name }}</li></template></ul>
  <inner-panel><template slot="actions"><button @click="press()">{{ label }}</button></template></inner-panel>
</section>`,
    );
    const compiledOuter = (await compileViews(outerSource, outerFile))!;
    await writeFile(outerFile, compiledOuter.code);

    const outerModule = (await import(`${pathToFileURL(outerFile).href}?v=${Date.now()}`)) as {
      OuterView: ComponentDefinition<any, any, any, any>;
    };
    const window = new Window();
    const document = window.document as unknown as Document;
    const host = document.createElement('div');
    document.body.append(host);
    const instance = mountComponent(host, outerModule.OuterView, {
      owner: new Owner(),
      onError(error) {
        throw error;
      },
    });
    members = (globalThis as { __outerMembers?: typeof members }).__outerMembers;
    const items = () => [...host.querySelectorAll('li')].map((node) => node.textContent);
    assert.equal(host.querySelector('.status')!.textContent, 'ready');
    assert.deepEqual(items(), ['one', 'two']);
    assert.equal(host.querySelector('button')!.textContent, 'ready');
    assert.equal(host.querySelector('b'), null);

    members!.hide();
    await settle();
    assert.equal(host.querySelector('.status'), null);
    members!.show();
    await settle();
    assert.equal(host.querySelector('.status')!.textContent, 'ready');

    members!.reverse();
    await settle();
    assert.deepEqual(items(), ['two', 'one']);

    host.querySelector('button')!.dispatchEvent(new window.Event('click') as unknown as Event);
    await settle();
    assert.equal(host.querySelector('.status')!.textContent, 'pressed');
    assert.equal(host.querySelector('button')!.textContent, 'pressed');
    instance.dispose();
  } finally {
    delete (globalThis as { __outerMembers?: unknown }).__outerMembers;
    await rm(directory, { recursive: true, force: true });
  }
});
