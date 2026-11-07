import {
  Cancellation,
  Scope,
  type CancellationSignal,
  type Cleanup,
} from '@xiaobaibaifqy/jingchuanchu-core';
import { snapshot, type CommandSender, type ReadonlyData, type StateReader } from './state.js';

export interface ViewReadContext<S, P, L> {
  readonly state: ReadonlyData<S>;
  readonly inputs: ReadonlyData<P>;
  readonly local: ReadonlyData<L>;
}
export interface ViewContext<S, C extends object, P, L> extends ViewReadContext<S, P, L> {
  readonly commands: CommandSender<C>;
  readonly signal: CancellationSignal;
  setLocal(reduce: (previous: ReadonlyData<L>) => L): void;
  element<T extends Element = HTMLElement>(ref: string): T;
  on(ref: string, event: string, listener: (event: Event) => void): void;
  own(cleanup: Cleanup): Cleanup;
}
export type ViewHook<S, C extends object, P, L> = (context: ViewContext<S, C, P, L>) => void;
// Heterogeneous component graphs erase types internally; defineView/viewInputs keep user contracts typed.
export type AnyView = ViewDefinition<any, any, any, any>;
export interface ViewInput {
  readonly view: AnyView;
  readonly value: unknown;
  readonly ref?: string;
}
export interface ViewDefinition<
  S,
  C extends object,
  P = Record<string, never>,
  L = Record<string, never>,
> {
  readonly selector: string;
  readonly templateUrl?: string;
  readonly styleUrl?: string;
  readonly components?: readonly AnyView[];
  readonly initialInputs?: () => P;
  readonly local?: () => L;
  readonly text?: Record<string, (context: ViewReadContext<S, P, L>) => unknown>;
  readonly attributes?: Record<
    string,
    (context: ViewReadContext<S, P, L>) => string | number | boolean | null | undefined
  >;
  readonly actions?: Record<string, (context: ViewContext<S, C, P, L>, event: Event) => void>;
  readonly childInputs?: (context: ViewReadContext<S, P, L>) => readonly ViewInput[];
  readonly onInit?: ViewHook<S, C, P, L>;
  readonly onMount?: ViewHook<S, C, P, L>;
  readonly onInputsChanged?: (
    context: ViewContext<S, C, P, L>,
    change: { previous: ReadonlyData<P>; current: ReadonlyData<P> },
  ) => void;
  readonly onBeforeUpdate?: ViewHook<S, C, P, L>;
  readonly onUpdated?: ViewHook<S, C, P, L>;
  readonly onActivate?: ViewHook<S, C, P, L>;
  readonly onDeactivate?: ViewHook<S, C, P, L>;
  readonly onDestroy?: ViewHook<S, C, P, L>;
  /** Compiler-owned resources. Never assembled by application code. */
  readonly $template?: string;
  readonly $style?: string;
  readonly $scope?: string;
  readonly $source?: string;
}
/** @deprecated 下一版本起改用 `@xiaobaibaifqy/jingchuanchu-app/application` 的 `defineComponent`；旧行为不变，移除时间由发布任务决定。 见 docs/development/migrating-to-application.md。 */
export function defineView<
  S,
  C extends object,
  P = Record<string, never>,
  L = Record<string, never>,
>(definition: ViewDefinition<S, C, P, L>): ViewDefinition<S, C, P, L> {
  return Object.freeze(definition);
}
/** @deprecated 改用 `defineComponent` 的 `inputs` 与模板 `:input-name` 传值。 见 docs/development/migrating-to-application.md。 */
export function viewInputs<S, C extends object, P, L>(
  view: ViewDefinition<S, C, P, L>,
  value: NoInfer<P>,
  ref?: string,
): ViewInput {
  return { view, value, ...(ref === undefined ? {} : { ref }) };
}
/** @deprecated 新组件模型报告 `ComponentError`。 见 docs/development/migrating-to-application.md。 */
export class ViewError extends Error {
  constructor(
    readonly source: string,
    readonly lifecycle: string,
    cause: unknown,
  ) {
    super(`View ${source}: ${lifecycle} failed`, { cause });
    this.name = 'ViewError';
  }
}
export interface ViewInstance<P> {
  setInputs(inputs: P): void;
  activate(): void;
  deactivate(): void;
  dispose(): void;
}
interface Environment<S, C extends object> {
  state: StateReader<S>;
  commands: CommandSender<C>;
  onError(error: unknown): void;
}
interface Binding {
  read(): unknown;
  write(value: unknown): void;
  value: unknown;
}
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}
const managedViews = new WeakSet<Element>();
/** @deprecated 改用 application 入口的 `mountComponent`，或由 `mountApplication` 挂载。 见 docs/development/migrating-to-application.md。 */
export function mountView<S, C extends object, P, L>(
  host: Element,
  definition: ViewDefinition<S, C, P, L>,
  environment: Environment<S, C>,
  initialInputs?: P,
): ViewInstance<P> {
  return mountComponent(host, definition, environment, initialInputs);
}
interface UpdateTree<S> {
  request(): void;
  state?: ReadonlyData<S>;
}
function mountComponent<S, C extends object, P, L>(
  host: Element,
  definition: ViewDefinition<S, C, P, L>,
  environment: Environment<S, C>,
  initialInputs?: P,
  tree?: UpdateTree<S>,
): ViewInstance<P> {
  if (managedViews.has(host)) throw new Error('View host is already mounted');
  const scope = new Scope(),
    cancellation = new Cancellation();
  const source = definition.$source ?? definition.selector;
  const original = [...host.childNodes];
  const children: Array<{ host: Element; view: AnyView; instance: ViewInstance<unknown> }> = [];
  const bindings: Binding[] = [];
  let inputs = snapshot(initialInputs ?? definition.initialInputs?.() ?? ({} as P));
  let local = snapshot(definition.local?.() ?? ({} as L));
  managedViews.add(host);
  let pendingInputs: ReadonlyData<P> | undefined;
  let mounted = false,
    closed = false,
    active = true,
    queued = false,
    dirtyBeforeMount = false;
  let ownedNodes: Node[] = [];
  const updateTree: UpdateTree<S> = tree ?? { request };
  function invoke(name: keyof ViewDefinition<S, C, P, L>, fn: (() => void) | undefined): void {
    if (!fn) return;
    try {
      const result = fn() as unknown;
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch((error) =>
          environment.onError(new ViewError(source, String(name), error)),
        );
        throw new Error('Lifecycle hooks must be synchronous');
      }
    } catch (error) {
      throw new ViewError(source, String(name), error);
    }
  }
  function request(): void {
    if (tree) {
      tree.request();
      return;
    }
    if (closed || !active || queued) return;
    if (!mounted) {
      dirtyBeforeMount = true;
      return;
    }
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (closed || !active) return;
      try {
        updateTree.state = environment.state.value;
        update();
      } catch (error) {
        environment.onError(error);
      } finally {
        delete updateTree.state;
      }
    });
  }
  function ownElement(ref: string): Element {
    if (!mounted) throw new Error('View nodes are unavailable before onMount');
    const matches = ownElements().filter((node) => node.getAttribute('data-ref') === ref);
    if (matches.length !== 1)
      throw new Error(`Expected one data-ref="${ref}", found ${matches.length}`);
    return matches[0]!;
  }
  const context: ViewContext<S, C, P, L> = {
    get state() {
      return updateTree.state ?? environment.state.value;
    },
    get inputs() {
      return inputs;
    },
    get local() {
      return local;
    },
    commands: environment.commands,
    signal: cancellation,
    setLocal(reduce) {
      if (closed) throw new Error('View is disposed');
      const next = reduce(local);
      if (Object.is(next, local)) return;
      local = snapshot(next);
      request();
    },
    element: <T extends Element>(ref: string) => ownElement(ref) as T,
    on(ref, event, listener) {
      const node = ownElement(ref);
      const wrapped = (value: Event): void => {
        if (closed || !active) return;
        try {
          listener(value);
        } catch (error) {
          environment.onError(new ViewError(source, `event:${ref}:${event}`, error));
        }
      };
      node.addEventListener(event, wrapped);
      scope.own(() => node.removeEventListener(event, wrapped));
    },
    own: (cleanup) => scope.own(cleanup),
  };
  function ownElements(): Element[] {
    const result: Element[] = [];
    const selectors = new Set((definition.components ?? []).map((child) => child.selector));
    const walk = (node: Element): void => {
      result.push(node);
      if (selectors.has(node.localName)) return;
      for (const child of node.children) walk(child);
    };
    for (const node of host.children) walk(node);
    return result;
  }
  function childValues(): readonly ViewInput[] {
    return definition.childInputs?.(context) ?? [];
  }
  function valueFor(child: AnyView, node: Element, values: readonly ViewInput[]): unknown {
    return (
      values.find(
        (binding) =>
          binding.view === child &&
          (binding.ref === undefined || binding.ref === node.getAttribute('data-ref')),
      )?.value ??
      child.initialInputs?.() ??
      {}
    );
  }
  function update(): void {
    if (pendingInputs !== undefined) {
      const previous = inputs;
      inputs = pendingInputs;
      pendingInputs = undefined;
      if (!same(previous, inputs))
        invoke('onInputsChanged', () =>
          definition.onInputsChanged?.(context, { previous, current: inputs }),
        );
    }
    const changes = bindings
      .map((binding) => ({ binding, value: binding.read() }))
      .filter((item) => !Object.is(item.binding.value, item.value));
    const values = childValues();
    if (changes.length)
      invoke(
        'onBeforeUpdate',
        definition.onBeforeUpdate && (() => definition.onBeforeUpdate!(context)),
      );
    for (const { binding, value } of changes) {
      binding.write(value);
      binding.value = value;
    }
    // Children flush synchronously within this batch; hook-induced writes schedule the next batch.
    for (const child of children)
      (child.instance as InternalView).stageInputs(valueFor(child.view, child.host, values));
    for (const child of children) (child.instance as InternalView).flush();
    if (changes.length)
      invoke('onUpdated', definition.onUpdated && (() => definition.onUpdated!(context)));
  }
  function dispose(): void {
    if (closed) return;
    closed = true;
    const errors: unknown[] = [];
    for (const action of [
      ...children
        .slice()
        .reverse()
        .map((child) => () => child.instance.dispose()),
      () => invoke('onDestroy', definition.onDestroy && (() => definition.onDestroy!(context))),
      () => cancellation.cancel(),
      () => scope.dispose(),
    ])
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    for (const node of ownedNodes) if (node.parentNode === host) host.removeChild(node);
    host.append(...original);
    managedViews.delete(host);
    if (errors.length) throw new AggregateError(errors, `View ${source}: cleanup failed`);
  }
  const instance: InternalView<P> = {
    setInputs(next) {
      if (instance.stageInputs(next)) request();
    },
    stageInputs(next) {
      if (closed) throw new Error('View is disposed');
      if (same(pendingInputs ?? inputs, next)) return false;
      pendingInputs = snapshot(next);
      return true;
    },
    activate() {
      if (closed) throw new Error('View is disposed');
      if (active) return;
      active = true;
      children.forEach((child) => child.instance.activate());
      invoke('onActivate', definition.onActivate && (() => definition.onActivate!(context)));
      request();
    },
    deactivate() {
      if (closed || !active) return;
      active = false;
      children.forEach((child) => child.instance.deactivate());
      invoke('onDeactivate', definition.onDeactivate && (() => definition.onDeactivate!(context)));
    },
    flush() {
      if (active && !closed) {
        queued = false;
        update();
      }
    },
    dispose,
  };
  try {
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(definition.selector))
      throw new Error('Component selector must be a custom element tag');
    const selectors = (definition.components ?? []).map((child) => child.selector);
    if (new Set(selectors).size !== selectors.length)
      throw new Error('Duplicate child component selector');
    if (definition.$template === undefined)
      throw new Error('Missing compiled template; configure jingchuanchu Vite plugin');
    invoke('onInit', definition.onInit && (() => definition.onInit!(context)));
    const template = host.ownerDocument.createElement('template');
    template.innerHTML = definition.$template;
    ownedNodes = [...template.content.childNodes];
    host.replaceChildren(template.content);
    const elements = ownElements();
    if (definition.$scope) for (const node of elements) node.setAttribute(definition.$scope, '');
    if (definition.$style) {
      const style = host.ownerDocument.createElement('style');
      style.textContent = definition.$style;
      host.prepend(style);
      ownedNodes.unshift(style);
    }
    const values = childValues();
    for (const child of definition.components ?? [])
      for (const node of elements.filter((node) => node.localName === child.selector)) {
        const childInstance = mountComponent(
          node,
          child,
          environment,
          valueFor(child, node, values),
          updateTree,
        );
        children.push({ host: node, view: child, instance: childInstance });
      }
    for (const node of elements)
      for (const attr of [...node.attributes]) {
        if (attr.name === 'data-text') {
          const read = definition.text?.[attr.value];
          if (!read) throw new Error(`Unknown text binding: ${attr.value}`);
          if (node.children.length) throw new Error('Text bindings cannot replace child elements');
          bindings.push({
            read: () => String(read(context) ?? ''),
            write: (value) => {
              node.textContent = value as string;
            },
            value: undefined,
          });
        } else if (attr.name.startsWith('data-attr-')) {
          const name = attr.name.slice(10),
            read = definition.attributes?.[attr.value];
          if (!read || /^on|^style$|^srcdoc$/i.test(name))
            throw new Error(`Invalid attribute binding: ${attr.value}`);
          bindings.push({
            read: () => read(context),
            write: (value) => {
              if (value === false || value === null || value === undefined)
                node.removeAttribute(name);
              else node.setAttribute(name, value === true ? '' : String(value));
            },
            value: undefined,
          });
        } else if (attr.name.startsWith('data-on-')) {
          const action = definition.actions?.[attr.value];
          if (!action) throw new Error(`Unknown action: ${attr.value}`);
          const listener = (event: Event) => {
            if (active && !closed) {
              try {
                action(context, event);
              } catch (error) {
                environment.onError(new ViewError(source, `action:${attr.value}`, error));
              }
            }
          };
          node.addEventListener(attr.name.slice(8), listener);
          scope.own(() => node.removeEventListener(attr.name.slice(8), listener));
        }
      }
    for (const binding of bindings) {
      binding.value = binding.read();
      binding.write(binding.value);
    }
    if (!tree) environment.state.subscribe(request, scope);
    mounted = true;
    invoke('onMount', definition.onMount && (() => definition.onMount!(context)));
    if (dirtyBeforeMount) {
      dirtyBeforeMount = false;
      request();
    }
    return instance;
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `View ${source}: mount failed`);
    }
    throw error instanceof ViewError ? error : new ViewError(source, 'mount', error);
  }
}
interface InternalView<P = unknown> extends ViewInstance<P> {
  flush(): void;
  stageInputs(next: P): boolean;
}
