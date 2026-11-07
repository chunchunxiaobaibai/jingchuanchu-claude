import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AnyComponentDefinition } from '../component-types.js';

export type PreloadStrategy = 'none' | 'intent' | 'idle';

export interface RouteTargetObject {
  readonly name: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly hash?: string;
}

export type RouteTarget = string | RouteTargetObject;

export interface RouteLocation {
  readonly name?: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly hash: string;
}

export interface RoutePrepareContext {
  readonly location: RouteLocation;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly hash: string;
}

export type RoutePrepare = (
  context: RoutePrepareContext,
) => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;

export interface RouteGuardContext {
  readonly from: RouteLocation | undefined;
  readonly to: RouteLocation;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly metas: readonly Readonly<Record<string, unknown>>[];
  readonly signal: { readonly aborted: boolean; throwIfAborted(): void };
}

export type GuardResult =
  | { readonly type: 'allow' }
  | { readonly type: 'deny'; readonly reason?: string }
  | { readonly type: 'redirect'; readonly target: RouteTarget };

export type RouteGuard = (context: RouteGuardContext) => GuardResult | Promise<GuardResult>;

export interface RouteDefinition {
  readonly name: string;
  readonly path: string;
  readonly page?: AnyComponentDefinition;
  readonly loadPage?: () => Promise<AnyComponentDefinition>;
  readonly children?: readonly RouteDefinition[];
  readonly redirect?: RouteTarget;
  readonly guards?: readonly RouteGuard[];
  readonly beforeLeave?: readonly RouteGuard[];
  readonly prepare?: RoutePrepare;
  readonly preload?: PreloadStrategy;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly reuse?: boolean;
}

export interface RouteRecord {
  readonly name: string;
  readonly path: string;
  readonly fullPath: string;
  readonly page?: AnyComponentDefinition;
  readonly loadPage?: () => Promise<AnyComponentDefinition>;
  readonly children: readonly RouteRecord[];
  readonly redirect?: RouteTarget;
  readonly guards: readonly RouteGuard[];
  readonly beforeLeave: readonly RouteGuard[];
  readonly prepare?: RoutePrepare;
  readonly preload: PreloadStrategy;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly reuse: boolean;
  readonly parent?: RouteRecord;
}

export interface RouteTable {
  readonly routes: readonly RouteRecord[];
  readonly fallback?: RouteTarget;
}

export interface RouteMatch {
  readonly record: RouteRecord;
  readonly chain: readonly RouteRecord[];
  readonly location: RouteLocation;
}

export interface HistoryLocation {
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly hash: string;
}

export type HistoryEventKind = 'push' | 'replace' | 'pop';

export interface HistoryDriver {
  readonly mode?: 'hash' | 'history';
  readonly location: HistoryLocation;
  push(path: string): void;
  replace(path: string): void;
  back(): void;
  subscribe(listener: (location: HistoryLocation, kind: HistoryEventKind) => void): Cleanup;
}

export type RouteNavigationStatus = 'committed' | 'cancelled' | 'denied' | 'redirected' | 'failed';

export interface RouteNavigationResult {
  readonly status: RouteNavigationStatus;
  readonly from?: RouteLocation;
  readonly to?: RouteLocation;
  readonly reason?: unknown;
}
