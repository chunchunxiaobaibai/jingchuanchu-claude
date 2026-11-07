import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { ReadSignal, WritableSignal } from './reactivity.js';
import type { AnyServiceDefinition, ServiceOf } from './services.js';
import type { AnyStoreDefinition, StoreInstanceOf } from './store.js';
import type { RouteLocation } from './router/types.js';
import type { ModelTrigger, NativeModelMode, TemplateBinding } from './template.js';

export type DefaultValue<T> = T extends object ? () => T : T | (() => T);

export type InputOptions<T> =
  | { readonly required?: false; readonly default?: DefaultValue<T> }
  | { readonly required: true; readonly default?: never };

export interface InputDefinition<T> {
  readonly kind: 'input';
  readonly required: boolean;
  readonly defaultValue: (() => T) | undefined;
}

export interface OutputDefinition<T> {
  readonly kind: 'output';
}

export interface ModelDefinition<T> {
  readonly kind: 'model';
  readonly defaultValue: (() => T) | undefined;
  readonly native: NativeModelMode | undefined;
  readonly trigger: ModelTrigger | undefined;
}

export interface ModelOptions<T> {
  readonly default?: DefaultValue<T>;
  readonly native?: NativeModelMode;
  readonly trigger?: ModelTrigger;
}

export type InputMap = Readonly<Record<string, InputDefinition<unknown>>>;
export type OutputMap = Readonly<Record<string, OutputDefinition<unknown>>>;
export type ModelMap = Readonly<Record<string, ModelDefinition<unknown>>>;

export type InputValues<I extends InputMap> = {
  readonly [K in keyof I]: I[K] extends InputDefinition<infer T> ? ReadSignal<T> : never;
};

export type InputPayload<I extends InputMap> = {
  readonly [K in keyof I]: I[K] extends InputDefinition<infer T> ? T : never;
};

export type ModelValues<M extends ModelMap> = {
  readonly [K in keyof M]: M[K] extends ModelDefinition<infer T> ? WritableSignal<T> : never;
};

export type OutputValues<O extends OutputMap> = {
  [K in keyof O]: O[K] extends OutputDefinition<infer T> ? T : never;
};

type EmitArguments<T> = [T] extends [undefined | void] ? [payload?: undefined] : [payload: T];

export interface ComponentContext<I extends InputMap, O extends OutputMap, M extends ModelMap> {
  readonly inputs: InputValues<I>;
  readonly models: ModelValues<M>;
  emit<K extends keyof O & string>(name: K, ...args: EmitArguments<OutputValues<O>[K]>): void;
  own(cleanup: Cleanup): Cleanup;
  signal<T>(initial: T): WritableSignal<T>;
  element<T extends Element = HTMLElement>(ref: string): T;
  on(ref: string, event: string, listener: (event: Event) => void): Cleanup;
  useStore<D extends AnyStoreDefinition>(definition: D): StoreInstanceOf<D>;
  useService<D extends AnyServiceDefinition>(definition: D): ServiceOf<D>;
  readonly route: RouteLocation | undefined;
}

export type ComponentLifecycleContext<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  R extends SetupResult,
> = ComponentContext<I, O, M> & { readonly members: R };

export interface InputChange<I extends InputMap> {
  readonly previous: InputPayload<I>;
  readonly current: InputPayload<I>;
}

export type SetupResult = Readonly<Record<string, unknown>>;

export type ComponentHook<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  R extends SetupResult,
> = (context: ComponentLifecycleContext<I, O, M, R>) => void;

export type ComponentSetup<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  R extends SetupResult,
> = (context: ComponentContext<I, O, M>) => R;

// Heterogeneous component trees erase their contracts internally; defineComponent keeps user types.
export interface AnyComponentDefinition {
  readonly selector: string;
  readonly inputs: InputMap;
  readonly outputs: OutputMap;
  readonly models: ModelMap;
  readonly components?: readonly AnyComponentDefinition[];
  readonly setup: (context: any) => SetupResult;
  readonly onInit?: (context: any) => void;
  readonly onMount?: (context: any) => void;
  readonly onInputsChanged?: (context: any, change: any) => void;
  readonly onBeforeUpdate?: (context: any) => void;
  readonly onUpdated?: (context: any) => void;
  readonly onActivate?: (context: any) => void;
  readonly onDeactivate?: (context: any) => void;
  readonly onDestroy?: (context: any) => void;
  readonly templateUrl?: string;
  readonly styleUrl?: string;
  readonly $template?: string;
  readonly $style?: string;
  readonly $scope?: string;
  readonly $source?: string;
  readonly $bindings?: readonly TemplateBinding[];
  readonly $page?: boolean;
}

export interface ComponentInstance<P = unknown> {
  setInputs(inputs: P): void;
  activate(): void;
  deactivate(): void;
  dispose(): void;
  readonly disposed: boolean;
}

export interface ComponentBindingTarget {
  subscribeOutput(name: string, listener: (payload: unknown) => void): Cleanup;
  bindModel(name: string, write: (value: unknown) => void): ModelBinding;
}

export interface ModelBinding {
  apply(value: unknown): void;
  dispose(): void;
}

type NameConflict<I extends InputMap, M extends ModelMap> = Extract<keyof I, keyof M>;

type NoNameConflict<I extends InputMap, M extends ModelMap> = [NameConflict<I, M>] extends [never]
  ? unknown
  : { readonly 'inputs and models must not share names': never };

export interface ComponentOptions<
  I extends InputMap,
  O extends OutputMap,
  M extends ModelMap,
  R extends SetupResult,
> {
  readonly selector: string;
  readonly templateUrl?: string;
  readonly styleUrl?: string;
  readonly inputs?: I;
  readonly outputs?: O;
  readonly models?: M;
  readonly components?: readonly AnyComponentDefinition[];
  readonly setup: ComponentSetup<I, O, M, R>;
  readonly onInit?: ComponentHook<I, O, M, R>;
  readonly onMount?: ComponentHook<I, O, M, R>;
  readonly onInputsChanged?: (
    context: ComponentLifecycleContext<I, O, M, R>,
    change: InputChange<I>,
  ) => void;
  readonly onBeforeUpdate?: ComponentHook<I, O, M, R>;
  readonly onUpdated?: ComponentHook<I, O, M, R>;
  readonly onActivate?: ComponentHook<I, O, M, R>;
  readonly onDeactivate?: ComponentHook<I, O, M, R>;
  readonly onDestroy?: ComponentHook<I, O, M, R>;
  /** Compiler-owned resources. Never assembled by application code. */
  readonly $template?: string;
  readonly $style?: string;
  readonly $scope?: string;
  readonly $source?: string;
  readonly $bindings?: readonly TemplateBinding[];
  readonly $page?: boolean;
}

export interface ComponentDefinition<
  I extends InputMap = InputMap,
  O extends OutputMap = OutputMap,
  M extends ModelMap = ModelMap,
  R extends SetupResult = SetupResult,
> {
  readonly selector: string;
  readonly templateUrl?: string;
  readonly styleUrl?: string;
  readonly inputs: I;
  readonly outputs: O;
  readonly models: M;
  readonly components?: readonly AnyComponentDefinition[];
  readonly setup: ComponentSetup<I, O, M, R>;
  readonly onInit?: ComponentHook<I, O, M, R>;
  readonly onMount?: ComponentHook<I, O, M, R>;
  readonly onInputsChanged?: (
    context: ComponentLifecycleContext<I, O, M, R>,
    change: InputChange<I>,
  ) => void;
  readonly onBeforeUpdate?: ComponentHook<I, O, M, R>;
  readonly onUpdated?: ComponentHook<I, O, M, R>;
  readonly onActivate?: ComponentHook<I, O, M, R>;
  readonly onDeactivate?: ComponentHook<I, O, M, R>;
  readonly onDestroy?: ComponentHook<I, O, M, R>;
  readonly $template?: string;
  readonly $style?: string;
  readonly $scope?: string;
  readonly $source?: string;
  readonly $bindings?: readonly TemplateBinding[];
  readonly $page?: boolean;
}
