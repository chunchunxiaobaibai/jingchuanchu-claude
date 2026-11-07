import { Scope, type Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { snapshot, type ReadonlyData } from '../state.js';
import {
  configSignal,
  effect,
  markReadSignal,
  signal as createSignal,
  type ReadSignal,
  type WritableSignal,
} from './reactivity.js';
import { scheduleRender } from './scheduler.js';
import { mountTemplate, type TemplateHandle } from './template.js';
import type { AnyStoreDefinition } from './store.js';
import type { AnyServiceDefinition } from './services.js';
import type { RouteLocation } from './router/types.js';
import { Owner } from './component-owner.js';
import type {
  AnyComponentDefinition,
  ComponentBindingTarget,
  ComponentContext,
  ComponentDefinition,
  ComponentHook,
  ComponentInstance,
  ComponentLifecycleContext,
  DefaultValue,
  InputDefinition,
  InputMap,
  InputOptions,
  InputPayload,
  ModelDefinition,
  ModelMap,
  ModelOptions,
  OutputDefinition,
  OutputMap,
  SetupResult,
} from './component-types.js';

function defaultValueFactory<T>(value: DefaultValue<T> | undefined): (() => T) | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'function') return value as () => T;
  return () => value as T;
}

export function input<T>(options: InputOptions<T> = {}): InputDefinition<T> {
  const required = options.required === true;
  const value = 'default' in options ? options.default : undefined;
  return Object.freeze({
    kind: 'input' as const,
    required,
    defaultValue: defaultValueFactory(value),
  });
}

export function output<T>(): OutputDefinition<T> {
  return Object.freeze({ kind: 'output' as const });
}

export function model<T>(options: ModelOptions<T> = {}): ModelDefinition<T> {
  return Object.freeze({
    kind: 'model' as const,
    defaultValue: defaultValueFactory(options.default),
    native: options.native,
    trigger: options.trigger,
  });
}

type NoNameConflict<I extends InputMap, M extends ModelMap> = [Extract<keyof I, keyof M>] extends [
  never,
]
  ? unknown
  : { readonly 'inputs and models must not share names': never };

export function defineComponent<
  I extends InputMap = Record<never, never>,
  O extends OutputMap = Record<never, never>,
  M extends ModelMap = Record<never, never>,
  R extends SetupResult = SetupResult,
>(
  definition: import('./component-types.js').ComponentOptions<I, O, M, R> & NoNameConflict<I, M>,
): ComponentDefinition<I, O, M, R> {
  const inputs = definition.inputs ?? ({} as I);
  const outputs = definition.outputs ?? ({} as O);
  const models = definition.models ?? ({} as M);
  for (const name of Object.keys(inputs))
    if (Object.hasOwn(models, name))
      throw new Error(`Component ${definition.selector}: ${name} cannot be both input and model`);
  for (const [name, descriptor] of Object.entries(inputs))
    if (descriptor.kind !== 'input')
      throw new Error(`Component ${definition.selector}: invalid input ${name}`);
  for (const [name, descriptor] of Object.entries(outputs))
    if (descriptor.kind !== 'output')
      throw new Error(`Component ${definition.selector}: invalid output ${name}`);
  for (const [name, descriptor] of Object.entries(models))
    if (descriptor.kind !== 'model')
      throw new Error(`Component ${definition.selector}: invalid model ${name}`);
  return Object.freeze({ ...definition, inputs, outputs, models }) as ComponentDefinition<
    I,
    O,
    M,
    R
  >;
}

export function definePage<
  I extends InputMap = Record<never, never>,
  O extends OutputMap = Record<never, never>,
  M extends ModelMap = Record<never, never>,
  R extends SetupResult = SetupResult,
>(
  definition: import('./component-types.js').ComponentOptions<I, O, M, R> & NoNameConflict<I, M>,
): ComponentDefinition<I, O, M, R> {
  return Object.freeze({ ...defineComponent(definition), $page: true });
}

export class ComponentError extends Error {
  constructor(
    readonly source: string,
    readonly lifecycle: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Component ${source}: ${lifecycle} failed${detail}`, { cause });
    this.name = 'ComponentError';
  }
}

export interface ComponentEnvironment {
  readonly owner: Owner;
  onError(error: unknown): void;
  readonly route?: RouteLocation;
}

export type MountedComponent<P> = ComponentInstance<P> & ComponentBindingTarget;

type RuntimeDefinition = ComponentDefinition<InputMap, OutputMap, ModelMap, SetupResult>;
type RuntimeContext = ComponentContext<InputMap, OutputMap, ModelMap>;
type RuntimeLifecycleContext = ComponentLifecycleContext<
  InputMap,
  OutputMap,
  ModelMap,
  SetupResult
>;
type RuntimeHook = ComponentHook<InputMap, OutputMap, ModelMap, SetupResult>;

const managed = new WeakSet<Element>();
const selectorPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

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

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

export function mountComponent<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  R extends SetupResult,
>(
  host: Element,
  definition: ComponentDefinition<I, O, M, R>,
  environment: ComponentEnvironment,
  initialInputs?: InputPayload<I>,
): MountedComponent<InputPayload<I>> {
  return mountErased(
    host,
    definition as unknown as RuntimeDefinition,
    environment,
    initialInputs as Record<string, unknown> | undefined,
  ) as unknown as MountedComponent<InputPayload<I>>;
}

function mountErased(
  host: Element,
  definition: RuntimeDefinition,
  environment: ComponentEnvironment,
  initialInputs?: Record<string, unknown>,
  slots?: Readonly<Record<string, readonly Node[]>>,
): MountedComponent<Record<string, unknown>> {
  const source = definition.$source ?? definition.selector;
  if (managed.has(host))
    throw new ComponentError(source, 'mount', new Error('Component host is already mounted'));
  if (!selectorPattern.test(definition.selector))
    throw new ComponentError(
      source,
      'mount',
      new Error(`Component selector must be a custom element tag: ${definition.selector}`),
    );

  const ownedOwner = environment.owner.createChild();
  const original = [...host.childNodes];
  const inputSignals: Record<string, WritableSignal<unknown>> = {};
  const inputReads: Record<string, ReadSignal<unknown>> = {};
  const modelSignals: Record<string, WritableSignal<unknown>> = {};
  interface ModelCell {
    readonly signal: WritableSignal<unknown>;
    setExternal(write: ((value: unknown) => void) | undefined): void;
    apply(value: unknown): void;
  }
  const modelCells: Record<string, ModelCell> = {};
  const children: Array<{ host: Element; instance: MountedComponent<Record<string, unknown>> }> =
    [];
  const outputListeners = new Map<string, Set<(payload: unknown) => void>>();
  const ownedNodes: Node[] = [];
  let members: SetupResult | undefined;
  let hookContext: RuntimeLifecycleContext | undefined;
  let ownedElements: Element[] = [];
  let pendingInputs: Record<string, unknown> | undefined;
  let templateHandle: TemplateHandle | undefined;
  let mounted = false;
  let closed = false;
  let active = true;
  let queued = false;

  managed.add(host);

  function currentInputs(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const name of Object.keys(inputSignals)) values[name] = inputSignals[name]!();
    return values;
  }

  function createModelCell(descriptor: ModelDefinition<unknown>): ModelCell {
    const local = createSignal(descriptor.defaultValue?.());
    let external: ((value: unknown) => void) | undefined;
    const signal = Object.assign(
      markReadSignal(() => local()),
      {
        set(value: unknown) {
          if (external) external(value);
          else local.set(value);
        },
        update(reduce: (previous: unknown) => unknown) {
          signal.set(reduce(local()));
        },
      },
    ) as WritableSignal<unknown>;
    if (descriptor.native || descriptor.trigger) {
      const config: { native?: typeof descriptor.native; trigger?: typeof descriptor.trigger } = {};
      if (descriptor.native) config.native = descriptor.native;
      if (descriptor.trigger) config.trigger = descriptor.trigger;
      Object.defineProperty(signal, '__jccModel', { value: Object.freeze(config) });
    }
    return {
      signal,
      setExternal(write) {
        external = write;
      },
      apply(value) {
        local.set(value);
      },
    };
  }

  function ownElement(ref: string): Element {
    if (!mounted) throw new Error('Component nodes are unavailable before mount');
    const matches = ownElements().filter((node) => node.getAttribute('data-ref') === ref);
    if (matches.length !== 1)
      throw new Error(`Expected one data-ref="${ref}", found ${matches.length}`);
    return matches[0]!;
  }

  function emit(name: string, payload: unknown): void {
    if (closed) return;
    if (!Object.hasOwn(definition.outputs, name))
      throw new ComponentError(source, `emit:${name}`, new Error(`Unknown output: ${name}`));
    for (const listener of [...(outputListeners.get(name) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        environment.onError(new ComponentError(source, `emit:${name}`, error));
      }
    }
    const view = host.ownerDocument.defaultView as
      (Window & { CustomEvent?: typeof CustomEvent }) | null;
    const CustomEventClass = view?.CustomEvent ?? globalThis.CustomEvent;
    if (CustomEventClass) {
      const names = new Set([name]);
      const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      if (kebab !== name) names.add(kebab);
      for (const eventName of names)
        host.dispatchEvent(new CustomEventClass(eventName, { detail: payload }));
    }
  }

  const setupContext = {
    inputs: inputReads,
    models: modelSignals,
    emit: (name: string, payload: unknown) => emit(name, payload),
    own: (cleanup: Cleanup) => ownedOwner.own(cleanup),
    signal: createSignal,
    element<T extends Element = HTMLElement>(ref: string): T {
      return ownElement(ref) as T;
    },
    on(ref: string, event: string, listener: (value: Event) => void): Cleanup {
      const node = ownElement(ref);
      const wrapped = (value: Event): void => {
        if (closed || !active) return;
        try {
          listener(value);
        } catch (error) {
          environment.onError(new ComponentError(source, `event:${ref}:${event}`, error));
        }
      };
      node.addEventListener(event, wrapped);
      return ownedOwner.own(() => node.removeEventListener(event, wrapped));
    },
    useStore: (definition: AnyStoreDefinition) => ownedOwner.useStore(definition),
    useService: (definition: AnyServiceDefinition) => ownedOwner.useService(definition),
    route: environment.route,
  } as RuntimeContext;

  function invokeHook(name: string, hook: RuntimeHook | undefined): void {
    if (!hook) return;
    if (!hookContext)
      throw new ComponentError(source, name, new Error('Lifecycle context is unavailable'));
    try {
      const result = hook(hookContext) as unknown;
      if (isThenable(result)) {
        void Promise.resolve(result).catch((error) =>
          environment.onError(new ComponentError(source, name, error)),
        );
        throw new Error('Lifecycle hooks must be synchronous');
      }
    } catch (error) {
      throw error instanceof ComponentError ? error : new ComponentError(source, name, error);
    }
  }

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

  function createSlots(): Readonly<Record<string, readonly Node[]>> | undefined {
    if (!templateHandle) return undefined;
    const projected: Record<string, Node[]> = {};
    for (const binding of definition.$bindings ?? []) {
      if (binding.kind !== 'slot') continue;
      const handle = templateHandle.createSlot(binding.name);
      if (handle) projected[binding.name] = handle.nodes;
    }
    return Object.keys(projected).length ? projected : undefined;
  }

  function insertSlots(projected?: Readonly<Record<string, readonly Node[]>>): void {
    for (const target of ownedElements.filter((element) => element.localName === 'slot')) {
      const name = target.getAttribute('name') ?? 'default';
      const nodes = projected?.[name];
      const replacement = nodes && nodes.length ? [...nodes] : [...target.childNodes];
      target.replaceWith(...replacement);
    }
  }

  function mountChildrenIn(root: Element): Array<() => void> {
    const disposers: Array<() => void> = [];
    const instances = new Map<Element, MountedComponent<Record<string, unknown>>>();
    const definitions = new Map(
      (definition.components ?? []).map((child) => [child.selector, child] as const),
    );
    const walk = (node: Element): void => {
      for (const child of node.children) {
        const childDefinition = definitions.get(child.localName);
        if (childDefinition) {
          const instance = mountErased(
            child,
            childDefinition as unknown as RuntimeDefinition,
            environment,
            collectChildInputs(child),
            createSlots(),
          );
          instances.set(child, instance);
          disposers.push(() => instance.dispose());
        } else {
          walk(child);
        }
      }
    };
    walk(root);
    if (instances.size) {
      const scope = new Scope();
      bindChildInputs(instances, scope);
      disposers.push(() => scope.dispose());
    }
    return disposers;
  }

  function collectChildInputs(element: Element): Record<string, unknown> | undefined {
    const values: Record<string, unknown> = {};
    let found = false;
    for (const binding of definition.$bindings ?? []) {
      if (binding.kind !== 'component-input') continue;
      if (!element.hasAttribute(`data-jcc-input-${binding.id}`)) continue;
      const inputName = binding.name.replace(/-([a-z])/g, (_match, letter: string) =>
        letter.toUpperCase(),
      );
      values[inputName] = binding.read(members!);
      found = true;
    }
    return found ? values : undefined;
  }

  function bindChildInputs(
    instances: Map<Element, MountedComponent<Record<string, unknown>>>,
    scope: Scope,
  ): void {
    for (const [element, instance] of instances) {
      for (const binding of definition.$bindings ?? []) {
        if (binding.kind !== 'component-input') continue;
        if (!element.hasAttribute(`data-jcc-input-${binding.id}`)) continue;
        const inputName = binding.name.replace(/-([a-z])/g, (_match, letter: string) =>
          letter.toUpperCase(),
        );
        effect(() => {
          if (closed || instance.disposed) return;
          try {
            instance.setInputs({ [inputName]: binding.read(members!) });
          } catch (error) {
            environment.onError(new ComponentError(source, `input:${inputName}`, error));
          }
        }, scope);
      }
    }
  }

  function buildView(): void {
    const document = host.ownerDocument;
    const template = document.createElement('template');
    template.innerHTML = definition.$template ?? '';
    ownedNodes.push(...template.content.childNodes);
    host.replaceChildren(template.content);
    if (definition.$style) {
      const style = document.createElement('style');
      style.textContent = definition.$style;
      host.prepend(style);
      ownedNodes.unshift(style);
    }
    ownedElements = ownElements();
    if (definition.$scope)
      for (const element of ownedElements) element.setAttribute(definition.$scope, '');
    if (definition.$bindings?.length) {
      templateHandle = mountTemplate(
        host,
        definition.$bindings,
        (error) => environment.onError(new ComponentError(source, 'template', error)),
        (root) => mountChildrenIn(root),
        () => members!,
        definition.$scope,
      );
    }
    insertSlots(slots);
    for (const child of definition.components ?? []) {
      for (const node of ownedElements.filter((element) => element.localName === child.selector))
        children.push({
          host: node,
          instance: mountErased(
            node as Element,
            child as unknown as RuntimeDefinition,
            environment,
            collectChildInputs(node),
            createSlots(),
          ) as MountedComponent<Record<string, unknown>>,
        });
    }
    if (children.length) {
      const inputScope = new Scope();
      bindChildInputs(
        new Map(children.map((child) => [child.host, child.instance] as const)),
        inputScope,
      );
      ownedOwner.own(() => inputScope.dispose());
    }
    if (templateHandle) {
      let first = true;
      effect(() => {
        if (closed) return;
        try {
          const changed = templateHandle!.read(members!);
          if (first) {
            first = false;
            templateHandle!.apply();
            return;
          }
          if (!changed) return;
          invokeHook('onBeforeUpdate', definition.onBeforeUpdate);
          templateHandle!.apply();
          invokeHook('onUpdated', definition.onUpdated);
        } catch (error) {
          const failure =
            error instanceof ComponentError ? error : new ComponentError(source, 'template', error);
          if (first) throw failure;
          environment.onError(failure);
        }
      }, ownedOwner.scope);
    }
    for (const binding of definition.$bindings ?? []) {
      if (binding.kind !== 'component-model') continue;
      const element = host.querySelector(`[data-jcc-model-${binding.id}]`);
      const child = element ? children.find((item) => item.host === element) : undefined;
      if (!child)
        throw new ComponentError(
          source,
          'model',
          new Error(`Component model binding ${binding.model} requires a child component host`),
        );
      const connection = child.instance.bindModel(binding.model, (value) =>
        binding.write(members!, value),
      );
      ownedOwner.own(() => connection.dispose());
      effect(() => {
        if (closed) return;
        try {
          connection.apply(binding.read(members!));
        } catch (error) {
          environment.onError(new ComponentError(source, 'model', error));
        }
      }, ownedOwner.scope);
    }
  }

  function request(): void {
    if (closed || !active || queued || !mounted) return;
    queued = true;
    // Use the owner's scheduler for isolation; fall back to the legacy global if absent
    const ownerScheduler = environment.owner.scheduler;
    if (ownerScheduler) {
      ownerScheduler.scheduleRender(renderTask);
    } else {
      scheduleRender(renderTask);
    }
  }

  function renderTask(): void {
    queued = false;
    if (closed || !active) return;
    try {
      flushInputs();
    } catch (error) {
      environment.onError(error);
    }
  }

  function flushInputs(): void {
    if (pendingInputs === undefined) return;
    const next = pendingInputs;
    pendingInputs = undefined;
    const previous = Object.freeze({ ...currentInputs() }) as ReadonlyData<Record<string, unknown>>;
    for (const [name, value] of Object.entries(next)) {
      const target = inputSignals[name];
      if (target) target.set(value);
    }
    const current = Object.freeze({ ...currentInputs() }) as ReadonlyData<Record<string, unknown>>;
    if (same(previous, current)) return;
    if (definition.onInputsChanged) {
      try {
        definition.onInputsChanged(hookContext!, {
          previous: previous as never,
          current: current as never,
        });
      } catch (error) {
        environment.onError(new ComponentError(source, 'onInputsChanged', error));
      }
    }
  }

  function dispose(): void {
    if (closed) return;
    closed = true;
    const errors: unknown[] = [];
    for (const child of [...children].reverse()) {
      try {
        child.instance.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      if (members !== undefined) invokeHook('onDestroy', definition.onDestroy);
    } catch (error) {
      errors.push(error);
    }
    try {
      templateHandle?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      ownedOwner.dispose();
    } catch (error) {
      errors.push(error);
    }
    for (const node of ownedNodes) if (node.parentNode === host) host.removeChild(node);
    host.append(...original);
    managed.delete(host);
    mounted = false;
    if (errors.length) throw new AggregateError(errors, `Component ${source}: cleanup failed`);
  }

  const instance: MountedComponent<Record<string, unknown>> = {
    setInputs(next) {
      if (closed) throw new ComponentError(source, 'setInputs', new Error('Component is disposed'));
      const base = pendingInputs ?? currentInputs();
      const merged = { ...base, ...next };
      if (same(base, merged)) return;
      pendingInputs = merged;
      request();
    },
    activate() {
      if (closed)
        throw new ComponentError(source, 'onActivate', new Error('Component is disposed'));
      if (active) return;
      active = true;
      for (const child of children) child.instance.activate();
      invokeHook('onActivate', definition.onActivate);
      request();
    },
    deactivate() {
      if (closed || !active) return;
      active = false;
      for (const child of children) child.instance.deactivate();
      invokeHook('onDeactivate', definition.onDeactivate);
    },
    dispose,
    get disposed() {
      return closed;
    },
    subscribeOutput(name, listener) {
      if (closed)
        throw new ComponentError(source, `output:${name}`, new Error('Component is disposed'));
      if (!Object.hasOwn(definition.outputs, name))
        throw new ComponentError(source, `output:${name}`, new Error(`Unknown output: ${name}`));
      let bucket = outputListeners.get(name);
      if (!bucket) {
        bucket = new Set();
        outputListeners.set(name, bucket);
      }
      bucket.add(listener);
      const off = (): void => {
        bucket!.delete(listener);
      };
      ownedOwner.own(off);
      return off;
    },
    bindModel(name, write) {
      if (closed)
        throw new ComponentError(source, `model:${name}`, new Error('Component is disposed'));
      const cell = modelCells[name];
      if (!cell)
        throw new ComponentError(source, `model:${name}`, new Error(`Unknown model: ${name}`));
      cell.setExternal(write);
      return {
        apply(value: unknown) {
          cell.apply(value);
        },
        dispose() {
          cell.setExternal(undefined);
        },
      };
    },
  };

  try {
    for (const [name, descriptor] of Object.entries(definition.inputs)) {
      const provided =
        initialInputs !== undefined && Object.hasOwn(initialInputs, name)
          ? initialInputs[name]
          : undefined;
      const value = provided !== undefined ? provided : descriptor.defaultValue?.();
      if (descriptor.required && value === undefined)
        throw new ComponentError(source, 'input', new Error(`Missing required input: ${name}`));
      const item = configSignal(value);
      inputSignals[name] = item;
      inputReads[name] = markReadSignal(() => item());
    }
    Object.freeze(inputReads);
    for (const [name, descriptor] of Object.entries(definition.models)) {
      const cell = createModelCell(descriptor);
      modelCells[name] = cell;
      modelSignals[name] = cell.signal;
    }
    Object.freeze(modelSignals);
    const created = definition.setup(setupContext as never) as SetupResult;
    if (!created || typeof created !== 'object')
      throw new Error('setup must return an object of template members');
    members = Object.freeze(created);
    hookContext = { ...setupContext, members } as RuntimeLifecycleContext;
    invokeHook('onInit', definition.onInit);
    buildView();
    mounted = true;
    invokeHook('onMount', definition.onMount);
    return instance;
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Component ${source}: mount failed and cleanup failed`,
      );
    }
    throw error instanceof ComponentError ? error : new ComponentError(source, 'mount', error);
  }
}

export type {
  AnyComponentDefinition,
  ComponentBindingTarget,
  ComponentContext,
  ComponentDefinition,
  ComponentInstance,
  ComponentLifecycleContext,
  ComponentOptions,
  ComponentSetup,
  DefaultValue,
  InputChange,
  InputDefinition,
  InputMap,
  InputOptions,
  InputPayload,
  InputValues,
  ModelBinding,
  ModelDefinition,
  ModelMap,
  ModelOptions,
  ModelValues,
  OutputDefinition,
  OutputMap,
  OutputValues,
  SetupResult,
} from './component-types.js';
export { Owner, OwnerError } from './component-owner.js';
