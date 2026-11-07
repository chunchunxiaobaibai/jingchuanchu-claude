export type NativeModelMode = 'text' | 'number' | 'boolean' | 'multiple';
export type ModelTrigger = 'input' | 'change';

export interface TemplateTextBinding {
  readonly kind: 'text';
  readonly id: number;
  readonly textIndex: number;
  readonly block?: number;
  read(scope: Record<string, unknown>): string;
}

export interface TemplateAttributeBinding {
  readonly kind: 'attribute';
  readonly id: number;
  readonly name: string;
  readonly block?: number;
  read(scope: Record<string, unknown>): unknown;
}

export interface TemplateEventBinding {
  readonly kind: 'event';
  readonly id: number;
  readonly name: string;
  readonly block?: number;
  run(scope: Record<string, unknown>, event: Event): void;
}

export interface TemplateNativeModelBinding {
  readonly kind: 'native-model';
  readonly id: number;
  readonly name: string;
  readonly block?: number;
  read(scope: Record<string, unknown>): unknown;
  write(scope: Record<string, unknown>, value: unknown): void;
  config?(
    scope: Record<string, unknown>,
  ): { native?: NativeModelMode; trigger?: ModelTrigger } | undefined;
}

export interface TemplateComponentModelBinding {
  readonly kind: 'component-model';
  readonly id: number;
  readonly model: string;
  readonly block?: number;
  read(scope: Record<string, unknown>): unknown;
  write(scope: Record<string, unknown>, value: unknown): void;
}

export interface TemplateComponentInputBinding {
  readonly kind: 'component-input';
  readonly id: number;
  readonly name: string;
  readonly block?: number;
  read(scope: Record<string, unknown>): unknown;
}

export interface TemplateWhenBinding {
  readonly kind: 'when';
  readonly id: number;
  condition(scope: Record<string, unknown>): unknown;
}

export interface TemplateEachBinding {
  readonly kind: 'each';
  readonly id: number;
  readonly item: string;
  readonly index?: string;
  source(scope: Record<string, unknown>): readonly unknown[];
  key(scope: Record<string, unknown>): unknown;
}

export interface TemplateSlotBinding {
  readonly kind: 'slot';
  readonly id: number;
  readonly name: string;
}

export type TemplateBinding =
  | TemplateTextBinding
  | TemplateAttributeBinding
  | TemplateEventBinding
  | TemplateNativeModelBinding
  | TemplateComponentModelBinding
  | TemplateComponentInputBinding
  | TemplateWhenBinding
  | TemplateEachBinding
  | TemplateSlotBinding;

export interface TemplateSlotHandle {
  readonly nodes: Node[];
  dispose(): void;
}

export interface TemplateHandle {
  read(scope: Record<string, unknown>): boolean;
  apply(): void;
  createSlot(name: string): TemplateSlotHandle | undefined;
  dispose(): void;
}

type Scope = Record<string, unknown>;
type ContentBinding =
  | TemplateTextBinding
  | TemplateAttributeBinding
  | TemplateEventBinding
  | TemplateNativeModelBinding
  | TemplateComponentModelBinding
  | TemplateComponentInputBinding;

const booleanProperties = new Set([
  'checked',
  'selected',
  'disabled',
  'readonly',
  'required',
  'multiple',
  'hidden',
  'open',
]);

function propertyName(name: string): string {
  return name === 'readonly' ? 'readOnly' : name;
}

function classValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter(Boolean).join(' ');
  if (typeof value === 'object')
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(' ');
  return String(value);
}

function writeAttribute(element: Element, name: string, value: unknown): void {
  if (name === 'class') {
    const text = classValue(value);
    if (text) element.setAttribute('class', text);
    else element.removeAttribute('class');
    return;
  }
  const property = propertyName(name);
  if (booleanProperties.has(name.toLowerCase()) && property in element) {
    (element as unknown as Record<string, unknown>)[property] = Boolean(value);
    return;
  }
  if (name.toLowerCase() === 'value' && 'value' in element) {
    (element as unknown as Record<string, unknown>).value =
      value === null || value === undefined ? '' : String(value);
    return;
  }
  if (value === false || value === null || value === undefined) {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, value === true ? '' : String(value));
}

function findMarker(root: ParentNode, prefix: string, id: number): Element | undefined {
  return root.querySelector(`[${prefix}-${id}]`) ?? undefined;
}

const NO_UPDATE = Symbol('no-update');

function inferMode(element: Element): NativeModelMode {
  if (element.localName === 'select' && element.hasAttribute('multiple')) return 'multiple';
  if (element.localName === 'input') {
    const type = element.getAttribute('type')?.toLowerCase();
    if (type === 'checkbox') return 'boolean';
    if (type === 'number' || type === 'range') return 'number';
  }
  return 'text';
}

function inferTrigger(element: Element, mode: NativeModelMode): ModelTrigger {
  if (mode === 'boolean' || mode === 'multiple') return 'change';
  if (element.localName === 'select') return 'change';
  return 'input';
}

function readElementValue(element: Element, mode: NativeModelMode): unknown | typeof NO_UPDATE {
  if (mode === 'boolean') return (element as HTMLInputElement).checked;
  if (mode === 'multiple')
    return Array.from(element.querySelectorAll('option'))
      .filter((option) => (option as HTMLOptionElement).selected)
      .map((option) => (option as HTMLOptionElement).value);
  const text = (element as HTMLInputElement).value;
  if (mode === 'number') {
    if (!text.trim()) return NO_UPDATE;
    const value = Number(text);
    return Number.isNaN(value) ? NO_UPDATE : value;
  }
  return text;
}

function writeElementValue(
  element: Element,
  mode: NativeModelMode,
  value: unknown,
  composing: boolean,
): void {
  if (mode === 'boolean') {
    const next = Boolean(value);
    if ((element as HTMLInputElement).checked !== next)
      (element as HTMLInputElement).checked = next;
    return;
  }
  if (mode === 'multiple') {
    const selected = new Set(Array.isArray(value) ? value.map(String) : []);
    for (const option of (element as HTMLSelectElement).options)
      option.selected = selected.has(option.value);
    return;
  }
  if (composing) return;
  const next = value === null || value === undefined ? '' : String(value);
  if ((element as HTMLInputElement).value !== next) (element as HTMLInputElement).value = next;
}

interface Group {
  read(scope: Scope): boolean;
  apply(): void;
  dispose(): void;
}

function createGroup(
  root: ParentNode,
  bindings: readonly ContentBinding[],
  onError: (error: unknown) => void,
): Group {
  const cleanups: Array<() => void> = [];
  const textTargets = new Map<number, { element: Element; index: number }>();
  const attributeTargets = new Map<number, { element: Element; name: string }>();
  interface NativeState {
    element: Element;
    binding: TemplateNativeModelBinding;
    mode: NativeModelMode;
    trigger: ModelTrigger;
    composing: boolean;
    ready: boolean;
  }
  const nativeModels = new Map<number, NativeState>();
  const pending = new Array<unknown>(bindings.length);
  const marker = Symbol('unapplied');
  const applied = new Array<unknown>(bindings.length).fill(marker);
  const skipped = new Set<number>();
  let scope: Scope = {};

  for (let index = 0; index < bindings.length; index++) {
    const binding = bindings[index]!;
    if (binding.kind === 'text') {
      const element = findMarker(root, 'data-jcc-text', binding.id);
      if (element) textTargets.set(index, { element, index: binding.textIndex });
      else skipped.add(index);
    } else if (binding.kind === 'attribute') {
      const element = findMarker(root, 'data-jcc-attr', binding.id);
      if (element) attributeTargets.set(index, { element, name: binding.name });
      else skipped.add(index);
    } else if (binding.kind === 'native-model') {
      const element = findMarker(root, 'data-jcc-model', binding.id);
      if (element)
        nativeModels.set(index, {
          element,
          binding,
          mode: 'text',
          trigger: 'input',
          composing: false,
          ready: false,
        });
      else skipped.add(index);
    } else if (binding.kind === 'event') {
      const element = findMarker(root, 'data-jcc-on', binding.id);
      if (!element) {
        skipped.add(index);
        continue;
      }
      const listener = (event: Event): void => {
        try {
          binding.run(scope, event);
        } catch (error) {
          onError(error);
        }
      };
      element.addEventListener(binding.name, listener);
      cleanups.push(() => element.removeEventListener(binding.name, listener));
    } else {
      skipped.add(index);
    }
  }

  function activateModel(state: NativeState): void {
    if (state.ready) return;
    state.ready = true;
    const config = state.binding.config?.(scope);
    state.mode = config?.native ?? inferMode(state.element);
    state.trigger = config?.trigger ?? inferTrigger(state.element, state.mode);
    const commit = (): void => {
      if (state.composing) return;
      const value = readElementValue(state.element, state.mode);
      if (value === NO_UPDATE) return;
      try {
        state.binding.write(scope, value);
      } catch (error) {
        onError(error);
      }
    };
    state.element.addEventListener(state.trigger, commit);
    cleanups.push(() => state.element.removeEventListener(state.trigger, commit));
    if (state.mode === 'text' || state.mode === 'number') {
      const start = (): void => {
        state.composing = true;
      };
      const end = (): void => {
        state.composing = false;
        commit();
      };
      state.element.addEventListener('compositionstart', start);
      state.element.addEventListener('compositionend', end);
      cleanups.push(
        () => state.element.removeEventListener('compositionstart', start),
        () => state.element.removeEventListener('compositionend', end),
      );
    }
  }

  function read(current: Scope): boolean {
    scope = current;
    let changed = false;
    for (let index = 0; index < bindings.length; index++) {
      if (skipped.has(index)) continue;
      const binding = bindings[index]!;
      if (
        binding.kind !== 'text' &&
        binding.kind !== 'attribute' &&
        binding.kind !== 'native-model'
      )
        continue;
      if (binding.kind === 'native-model') activateModel(nativeModels.get(index)!);
      const value = binding.read(scope);
      pending[index] = value;
      if (!Object.is(applied[index], value)) changed = true;
    }
    return changed;
  }

  function apply(): void {
    for (let index = 0; index < bindings.length; index++) {
      if (skipped.has(index)) continue;
      const binding = bindings[index]!;
      if (Object.is(applied[index], pending[index])) continue;
      applied[index] = pending[index];
      if (binding.kind === 'text') {
        const target = textTargets.get(index)!;
        const node = target.element.childNodes[target.index];
        if (node) node.textContent = String(pending[index] ?? '');
        else
          target.element.append(
            target.element.ownerDocument.createTextNode(String(pending[index] ?? '')),
          );
      } else if (binding.kind === 'attribute') {
        const target = attributeTargets.get(index)!;
        writeAttribute(target.element, target.name, pending[index]);
      } else if (binding.kind === 'native-model') {
        const state = nativeModels.get(index)!;
        writeElementValue(state.element, state.mode, pending[index], state.composing);
      }
    }
  }

  return {
    read,
    apply,
    dispose() {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
}

interface BlockContainer {
  readonly element: Element;
  readonly group: Group;
  readonly disposers: Array<() => void>;
}

interface WhenState {
  readonly binding: TemplateWhenBinding;
  readonly anchor: Comment;
  readonly template: HTMLTemplateElement;
  active: BlockContainer | undefined;
  pending?: unknown;
  scope: Scope;
}

interface ItemState extends BlockContainer {
  key: unknown;
  item: unknown;
  index: number;
  scope: Scope;
}

interface EachState {
  readonly binding: TemplateEachBinding;
  readonly anchor: Comment;
  readonly template: HTMLTemplateElement;
  list?: Element;
  items: Map<unknown, ItemState>;
  order: unknown[];
  pending: Array<{ key: unknown; item: unknown; index: number; scope: Scope }>;
  scope: Scope;
}

interface SlotState {
  readonly binding: TemplateSlotBinding;
  readonly template: HTMLTemplateElement;
  readonly clones: BlockContainer[];
}

function findTemplate(root: ParentNode, prefix: string, id: number): HTMLTemplateElement {
  const element = root.querySelector(`[${prefix}-${id}]`);
  if (!element || element.localName !== 'template')
    throw new Error(`Template marker ${prefix}-${id} is missing`);
  return element as unknown as HTMLTemplateElement;
}

/**
 * Moves only rows outside the longest run that kept its previous relative order, walking
 * backwards so each moved row lands before its already-placed successor.
 */
function placeItems(
  list: Element,
  ordered: readonly ItemState[],
  previous: readonly unknown[],
): void {
  const oldIndex = new Map(previous.map((key, index) => [key, index]));
  const stable = longestIncreasing(ordered.map((item) => oldIndex.get(item.key) ?? -1));
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (stable[i]) continue;
    const element = ordered[i]!.element,
      anchor = ordered[i + 1]?.element ?? null;
    if (element.nextSibling !== anchor) list.insertBefore(element, anchor);
  }
}

/** Marks one longest strictly increasing subsequence, ignoring negative entries. */
function longestIncreasing(values: readonly number[]): Uint8Array {
  const tails: number[] = [];
  const previous = new Int32Array(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (value < 0) continue;
    let low = 0,
      high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]!]! < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[i] = tails[low - 1]!;
    tails[low] = i;
  }
  const marked = new Uint8Array(values.length);
  for (let i = tails.at(-1) ?? -1; i >= 0; i = previous[i]!) marked[i] = 1;
  return marked;
}

export function mountTemplate(
  host: Element,
  bindings: readonly TemplateBinding[],
  onError: (error: unknown) => void,
  mountChildren?: (root: Element) => Array<() => void>,
  getScope?: () => Scope,
  scopeAttribute?: string,
): TemplateHandle {
  const document = host.ownerDocument;
  const applyScope = (root: ParentNode): void => {
    if (!scopeAttribute) return;
    if ('setAttribute' in root) (root as Element).setAttribute(scopeAttribute, '');
    for (const element of root.querySelectorAll('*')) element.setAttribute(scopeAttribute, '');
  };
  const contentBindings = bindings.filter(
    (binding): binding is ContentBinding =>
      binding.kind === 'text' ||
      binding.kind === 'attribute' ||
      binding.kind === 'event' ||
      binding.kind === 'native-model' ||
      binding.kind === 'component-model' ||
      binding.kind === 'component-input',
  );
  const rootBindings = contentBindings.filter((binding) => binding.block === undefined);
  const bindingsFor = (block: number): ContentBinding[] =>
    contentBindings.filter((binding) => binding.block === block);
  const groupFor = (root: ParentNode, block: number | undefined): Group =>
    createGroup(root, block === undefined ? rootBindings : bindingsFor(block), onError);

  const rootGroup = groupFor(host, undefined);
  let rootScope: Scope = {};

  const whenStates: WhenState[] = [];
  const eachStates: EachState[] = [];
  const slotStates: SlotState[] = [];

  function detachTemplate(template: HTMLTemplateElement): Comment {
    const anchor = document.createComment('jcc-block');
    const parent = template.parentNode;
    if (!parent) throw new Error('Template block requires a parent node');
    parent.insertBefore(anchor, template);
    template.remove();
    return anchor;
  }

  function createContainer(anchor: Comment, content: DocumentFragment): Element {
    const container = document.createElement('jcc-block');
    container.setAttribute('style', 'display:contents');
    anchor.parentNode!.insertBefore(container, anchor);
    container.append(content.cloneNode(true));
    applyScope(container);
    return container;
  }

  for (const binding of bindings) {
    if (binding.kind === 'when') {
      const template = findTemplate(host, 'data-jcc-when', binding.id);
      whenStates.push({
        binding,
        template,
        anchor: detachTemplate(template),
        active: undefined,
        scope: {},
      });
    } else if (binding.kind === 'each') {
      const template = findTemplate(host, 'data-jcc-each', binding.id);
      eachStates.push({
        binding,
        template,
        anchor: detachTemplate(template),
        items: new Map(),
        order: [],
        pending: [],
        scope: {},
      });
    } else if (binding.kind === 'slot') {
      slotStates.push({
        binding,
        template: findTemplate(host, 'data-jcc-slot-content', binding.id),
        clones: [],
      });
    }
  }

  function disposeBlock(container: BlockContainer | undefined): void {
    if (!container) return;
    for (const dispose of [...container.disposers].reverse()) dispose();
    container.group.dispose();
    container.element.remove();
  }

  function read(scope: Scope): boolean {
    rootScope = scope;
    let changed = rootGroup.read(scope);

    for (const state of whenStates) {
      state.scope = scope;
      const value = state.binding.condition(scope);
      if (!Object.is(value, state.pending)) changed = true;
      state.pending = value;
      if (state.active) changed = state.active.group.read(scope) || changed;
    }
    for (const state of eachStates) {
      state.scope = scope;
      const source = state.binding.source(scope) ?? [];
      const pending: EachState['pending'] = [];
      const seen = new Set<unknown>();
      for (let index = 0; index < source.length; index++) {
        const item = source[index];
        const itemScope = Object.create(scope) as Scope;
        itemScope[state.binding.item] = item;
        itemScope[state.binding.index ?? 'index'] = index;
        const key = state.binding.key(itemScope);
        if (seen.has(key)) throw new Error('Duplicate key in each template');
        seen.add(key);
        pending.push({ key, item, index, scope: itemScope });
        const existing = state.items.get(key);
        if (existing) {
          existing.item = item;
          existing.index = index;
          existing.scope = itemScope;
          changed = existing.group.read(itemScope) || changed;
        } else {
          changed = true;
        }
      }
      if (pending.length !== state.order.length) changed = true;
      else if (pending.some((item, index) => !Object.is(item.key, state.order[index])))
        changed = true;
      for (const key of state.items.keys()) if (!seen.has(key)) changed = true;
      state.pending = pending;
    }
    for (const state of slotStates)
      for (const clone of state.clones) changed = clone.group.read(scope) || changed;
    return changed;
  }

  function apply(): void {
    rootGroup.apply();
    for (const state of whenStates) {
      if (state.pending) {
        if (!state.active) {
          const container = createContainer(state.anchor, state.template.content);
          const group = groupFor(container, state.binding.id);
          group.read(state.scope);
          group.apply();
          const disposers = mountChildren?.(container) ?? [];
          state.active = { element: container, group, disposers };
        } else {
          state.active.group.apply();
        }
      } else if (state.active) {
        disposeBlock(state.active);
        state.active = undefined;
      }
    }
    for (const state of eachStates) {
      if (!state.list) {
        state.list = document.createElement('jcc-list');
        state.list.setAttribute('style', 'display:contents');
        state.anchor.parentNode!.insertBefore(state.list, state.anchor);
      }
      const list = state.list;
      const next = new Map<unknown, ItemState>();
      const ordered: ItemState[] = [];
      for (const pending of state.pending) {
        let item = state.items.get(pending.key);
        if (!item) {
          const element = document.createElement('jcc-item');
          element.setAttribute('style', 'display:contents');
          // New rows mount next to their predecessor; placement below fixes final order.
          const predecessor = ordered.at(-1)?.element;
          list.insertBefore(element, predecessor ? predecessor.nextSibling : list.firstChild);
          element.append(state.template.content.cloneNode(true));
          applyScope(element);
          const group = groupFor(element, state.binding.id);
          group.read(pending.scope);
          group.apply();
          const disposers = mountChildren?.(element) ?? [];
          item = {
            key: pending.key,
            item: pending.item,
            index: pending.index,
            scope: pending.scope,
            element,
            group,
            disposers,
          };
        } else {
          item.group.apply();
        }
        ordered.push(item);
        next.set(pending.key, item);
      }
      placeItems(list, ordered, state.order);
      for (const [key, item] of state.items) if (!next.has(key)) disposeBlock(item);
      state.items = next;
      state.order = state.pending.map((item) => item.key);
    }
    for (const state of slotStates) for (const clone of state.clones) clone.group.apply();
  }

  function createSlot(name: string): TemplateSlotHandle | undefined {
    const state = slotStates.find((slot) => slot.binding.name === name);
    if (!state) return undefined;
    const container = document.createElement('jcc-slot');
    container.setAttribute('style', 'display:contents');
    container.append(state.template.content.cloneNode(true));
    applyScope(container);
    const group = groupFor(container, state.binding.id);
    group.read(getScope?.() ?? rootScope);
    group.apply();
    const disposers = mountChildren?.(container) ?? [];
    const clone: BlockContainer = { element: container, group, disposers };
    state.clones.push(clone);
    let disposed = false;
    return {
      nodes: [...container.childNodes],
      dispose() {
        if (disposed) return;
        disposed = true;
        const index = state.clones.indexOf(clone);
        if (index >= 0) state.clones.splice(index, 1);
        for (const dispose of [...disposers].reverse()) dispose();
        group.dispose();
        container.remove();
      },
    };
  }

  return {
    read,
    apply,
    createSlot,
    dispose() {
      rootGroup.dispose();
      for (const state of whenStates) disposeBlock(state.active);
      for (const state of eachStates) {
        for (const item of state.items.values()) disposeBlock(item);
        state.items.clear();
        state.list?.remove();
      }
      for (const state of slotStates)
        for (const clone of state.clones.splice(0)) {
          for (const dispose of [...clone.disposers].reverse()) dispose();
          clone.group.dispose();
          clone.element.remove();
        }
    },
  };
}
