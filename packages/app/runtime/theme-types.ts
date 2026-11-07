import type { CancellationSignal, Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AssetContext } from './asset-types.js';

export interface ThemeFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ThemeImageAsset {
  readonly kind: 'image';
  readonly src: string;
}

export interface ThemeAtlasRegionAsset {
  readonly kind: 'atlas-region';
  readonly src: string;
  readonly frame: ThemeFrame;
}

export type ThemeAsset = ThemeImageAsset | ThemeAtlasRegionAsset;
export type ThemeTokenValue = string | number;
export type ThemeTokens = Readonly<Record<string, ThemeTokenValue>>;
export type ThemeAssets = Readonly<Record<string, ThemeAsset>>;

export interface ThemeDefinition<
  T extends ThemeTokens = ThemeTokens,
  A extends ThemeAssets = ThemeAssets,
> {
  readonly name: string;
  readonly tokens: T;
  readonly assets: A;
  readonly base?: AnyThemeDefinition;
}

export type AnyThemeDefinition = ThemeDefinition<any, any>;

export interface ThemeServiceOptions {
  readonly assets: AssetContext;
  readonly onFallback?: (error: unknown, key: string) => void;
  readonly onError?: (error: unknown) => void;
}

export interface ThemeImageOptions {
  readonly signal?: CancellationSignal;
  readonly scope?: Scope;
}

export interface ThemeImageLease {
  readonly key: string;
  readonly image: unknown;
  readonly frame: ThemeFrame | undefined;
  release(): void;
}

export interface ThemeService {
  readonly theme: AnyThemeDefinition;
  readonly tokens: ThemeTokens;
  token(name: string): ThemeTokenValue;
  has(key: string): boolean;
  url(key: string): string;
  asset(key: string): ThemeAsset;
  loadImage(key: string, options?: ThemeImageOptions): Promise<ThemeImageLease>;
  applyTokens(element: Element): Cleanup;
}
