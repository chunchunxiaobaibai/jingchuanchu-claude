import type { CancellationSignal, Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';

export type AssetKind = 'image' | 'atlas' | 'audio' | 'json';

export interface ImageAssetEntry {
  readonly key: string;
  readonly kind: 'image';
  readonly src: string;
  readonly optional?: boolean;
}

export interface AtlasAssetEntry {
  readonly key: string;
  readonly kind: 'atlas';
  readonly src: string;
  readonly optional?: boolean;
}

export interface AudioAssetEntry {
  readonly key: string;
  readonly kind: 'audio';
  readonly src: string;
  readonly optional?: boolean;
}

export interface JsonAssetEntry<T = unknown> {
  readonly key: string;
  readonly kind: 'json';
  readonly src: string;
  readonly decoder: (value: unknown) => T;
  readonly optional?: boolean;
}

export type AssetEntry = ImageAssetEntry | AtlasAssetEntry | AudioAssetEntry | JsonAssetEntry;

export interface AssetGroupDefinition<E extends readonly AssetEntry[] = readonly AssetEntry[]> {
  readonly name: string;
  readonly entries: E;
}

export interface AssetAdapters {
  image(url: string, signal: CancellationSignal): Promise<unknown>;
  atlas(url: string, signal: CancellationSignal): Promise<unknown>;
  audio(url: string, signal: CancellationSignal): Promise<unknown>;
  json(url: string, signal: CancellationSignal): Promise<unknown>;
}

export type AssetLoadStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'cancelled';

export interface AssetProgress {
  readonly status: AssetLoadStatus;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly pending: number;
}

export interface AssetGroupLease<E extends readonly AssetEntry[] = readonly AssetEntry[]> {
  readonly status: 'ready';
  readonly progress: AssetProgress;
  readonly failures: Readonly<Record<string, Error>>;
  get<K extends E[number]['key']>(key: K): unknown;
  has(key: string): boolean;
  release(): void;
}

export interface AssetLoadOptions {
  readonly signal?: CancellationSignal;
  readonly onProgress?: (progress: AssetProgress) => void;
  readonly scope?: Scope;
}

export interface AssetContextOptions {
  readonly adapters: AssetAdapters;
  readonly concurrency?: number;
}

export interface AssetContext<E extends readonly AssetEntry[] = readonly AssetEntry[]> {
  load(group: AssetGroupDefinition<E>, options?: AssetLoadOptions): Promise<AssetGroupLease<E>>;
  dispose(): void;
}

export type AssetScopeCleanup = Cleanup;
