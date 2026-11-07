import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AssetContext } from './asset-types.js';
import { defineAssetGroup } from './assets.js';
import type {
  AnyThemeDefinition,
  ThemeAsset,
  ThemeAssets,
  ThemeDefinition,
  ThemeImageLease,
  ThemeImageOptions,
  ThemeService,
  ThemeServiceOptions,
  ThemeTokenValue,
  ThemeTokens,
} from './theme-types.js';

export class ThemeError extends Error {
  constructor(
    readonly key: string,
    readonly operation: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Theme ${key}: ${operation} failed${detail}`, { cause });
    this.name = 'ThemeError';
  }
}

function freezeAsset(asset: ThemeAsset): ThemeAsset {
  if (asset.kind === 'atlas-region')
    return Object.freeze({ ...asset, frame: Object.freeze({ ...asset.frame }) });
  return Object.freeze({ ...asset });
}

export function defineTheme<
  const T extends Record<string, ThemeTokenValue>,
  const A extends Record<string, ThemeAsset>,
>(options: {
  name: string;
  tokens: T;
  assets: A;
}): ThemeDefinition<
  { readonly [K in keyof T]: ThemeTokenValue },
  { readonly [K in keyof A]: ThemeAsset }
> {
  if (!options.name) throw new Error('Theme requires a name');
  const assets: Record<string, ThemeAsset> = {};
  for (const [key, asset] of Object.entries(options.assets)) assets[key] = freezeAsset(asset);
  return Object.freeze({
    name: options.name,
    tokens: Object.freeze({ ...options.tokens }),
    assets: Object.freeze(assets),
  }) as ThemeDefinition<
    { readonly [K in keyof T]: ThemeTokenValue },
    { readonly [K in keyof A]: ThemeAsset }
  >;
}

export function extendTheme<T extends ThemeTokens, A extends ThemeAssets>(
  base: ThemeDefinition<T, A>,
  override: { name: string; tokens?: Partial<T>; assets?: Partial<A> },
): ThemeDefinition<T, A> {
  for (const key of Object.keys(override.assets ?? {}))
    if (!Object.hasOwn(base.assets, key))
      throw new ThemeError(key, 'override', new Error('Unknown theme asset key'));
  for (const key of Object.keys(override.tokens ?? {}))
    if (!Object.hasOwn(base.tokens, key))
      throw new ThemeError(key, 'override', new Error('Unknown theme token'));
  const assets: Record<string, ThemeAsset> = {};
  for (const [key, asset] of Object.entries({ ...base.assets, ...(override.assets ?? {}) }))
    assets[key] = freezeAsset(asset);
  return Object.freeze({
    name: override.name,
    tokens: Object.freeze({ ...base.tokens, ...(override.tokens ?? {}) }) as T,
    assets: Object.freeze(assets) as A,
    base,
  });
}

function chain(theme: AnyThemeDefinition): AnyThemeDefinition[] {
  const result: AnyThemeDefinition[] = [];
  let current: AnyThemeDefinition | undefined = theme;
  while (current) {
    result.push(current);
    current = current.base;
  }
  return result;
}

function findAsset(
  theme: AnyThemeDefinition,
  key: string,
): { theme: AnyThemeDefinition; asset: ThemeAsset } | undefined {
  for (const definition of chain(theme)) {
    const asset = definition.assets[key];
    if (asset) return { theme: definition, asset };
  }
  return undefined;
}

export function createThemeService(
  theme: AnyThemeDefinition,
  options: ThemeServiceOptions,
): ThemeService {
  const definitions = chain(theme);

  const candidates = (key: string): Array<{ theme: AnyThemeDefinition; asset: ThemeAsset }> => {
    const result: Array<{ theme: AnyThemeDefinition; asset: ThemeAsset }> = [];
    for (const definition of definitions) {
      const asset = definition.assets[key];
      if (!asset) continue;
      const duplicate = result.some(
        (item) =>
          item.asset.src === asset.src &&
          item.asset.kind === asset.kind &&
          (asset.kind !== 'atlas-region' ||
            (item.asset.kind === 'atlas-region' &&
              item.asset.frame.x === asset.frame.x &&
              item.asset.frame.y === asset.frame.y &&
              item.asset.frame.width === asset.frame.width &&
              item.asset.frame.height === asset.frame.height)),
      );
      if (!duplicate) result.push({ theme: definition, asset });
    }
    return result;
  };

  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };

  return {
    theme,
    tokens: theme.tokens,
    token(name) {
      if (!Object.hasOwn(theme.tokens, name))
        throw new ThemeError(name, 'token', new Error('Unknown theme token'));
      return theme.tokens[name];
    },
    has(key) {
      return findAsset(theme, key) !== undefined;
    },
    asset(key) {
      const found = findAsset(theme, key);
      if (!found) throw new ThemeError(key, 'resolve', new Error('Unknown theme asset'));
      return found.asset;
    },
    url(key) {
      const found = findAsset(theme, key);
      if (!found) throw new ThemeError(key, 'resolve', new Error('Unknown theme asset'));
      return found.asset.src;
    },
    async loadImage(key: string, imageOptions: ThemeImageOptions = {}): Promise<ThemeImageLease> {
      const list = candidates(key);
      if (!list.length) throw new ThemeError(key, 'load', new Error('Unknown theme asset'));
      let lastError: unknown;
      for (let index = 0; index < list.length; index++) {
        const { theme: source, asset } = list[index]!;
        try {
          const group = defineAssetGroup({
            name: `theme:${source.name}:${key}`,
            entries: [{ key: 'image', kind: 'image', src: asset.src }],
          });
          const lease = await options.assets.load(group, {
            ...(imageOptions.signal ? { signal: imageOptions.signal } : {}),
          });
          const release = (): void => lease.release();
          imageOptions.scope?.own(release);
          return Object.freeze({
            key,
            image: lease.get('image'),
            frame: asset.kind === 'atlas-region' ? asset.frame : undefined,
            release,
          });
        } catch (error) {
          lastError = error;
          if (imageOptions.signal?.aborted) throw error;
          if (index + 1 < list.length) {
            try {
              options.onFallback?.(error, key);
            } catch (handlerError) {
              report(handlerError);
            }
            continue;
          }
        }
      }
      const failure = new ThemeError(key, 'load', lastError);
      report(failure);
      throw failure;
    },
    applyTokens(element: Element): Cleanup {
      const style = (element as Element & { style: CSSStyleDeclaration }).style;
      const previous: Array<[string, string]> = [];
      for (const [name, value] of Object.entries(theme.tokens)) {
        const property = `--jcc-${name}`;
        previous.push([property, style.getPropertyValue(property)]);
        style.setProperty(property, String(value));
      }
      return () => {
        for (const [property, value] of previous.reverse()) {
          if (value) style.setProperty(property, value);
          else style.removeProperty(property);
        }
      };
    },
  };
}
