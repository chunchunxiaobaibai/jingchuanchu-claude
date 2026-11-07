import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const APPLICATION_PROFILE = 'application';
export const LEGACY_PROFILE = 'legacy-v0.4';

export const DEFAULT_PATHS = Object.freeze({
  app: 'src/app',
  pages: 'src/pages',
  game: 'src/game',
  components: 'src/components',
  themes: 'src/themes',
  account: 'src/account',
});

const presets = new Set(['core', 'singleplayer', 'client', 'server']);
const styles = new Set(['css', 'less']);

export class ProjectConfigError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = 'ProjectConfigError';
    this.file = file;
  }
}

export async function readProjectConfig(root) {
  const configPath = join(resolve(root), 'jingchuanchu.json');
  let raw;
  try {
    raw = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT')
      return {
        profile: LEGACY_PROFILE,
        preset: 'singleplayer',
        style: 'css',
        paths: undefined,
        raw: {},
        configPath,
        root: resolve(root),
      };
    throw new ProjectConfigError(configPath, error.message);
  }
  if (raw.schemaVersion === undefined) {
    const preset = raw.preset ?? 'singleplayer';
    const style = raw.style ?? 'css';
    if (!presets.has(preset)) throw new ProjectConfigError(configPath, `Unknown preset: ${preset}`);
    if (!styles.has(style)) throw new ProjectConfigError(configPath, `Unknown style: ${style}`);
    return {
      profile: LEGACY_PROFILE,
      preset,
      style,
      paths: undefined,
      raw,
      configPath,
      root: resolve(root),
    };
  }
  if (raw.schemaVersion !== 2)
    throw new ProjectConfigError(
      configPath,
      `Unsupported schemaVersion: ${String(raw.schemaVersion)}`,
    );
  if (raw.profile !== APPLICATION_PROFILE)
    throw new ProjectConfigError(
      configPath,
      `schemaVersion 2 requires profile "application", found ${String(raw.profile)}`,
    );
  if (!presets.has(raw.preset))
    throw new ProjectConfigError(configPath, `Unknown preset: ${String(raw.preset)}`);
  if (!styles.has(raw.style))
    throw new ProjectConfigError(configPath, `Unknown style: ${String(raw.style)}`);
  if (
    raw.paths !== undefined &&
    (!raw.paths || typeof raw.paths !== 'object' || Array.isArray(raw.paths))
  )
    throw new ProjectConfigError(configPath, 'paths must be an object');
  const paths = { ...DEFAULT_PATHS };
  for (const [key, value] of Object.entries(raw.paths ?? {})) {
    if (!Object.hasOwn(DEFAULT_PATHS, key))
      throw new ProjectConfigError(configPath, `Unknown path key: ${key}`);
    if (typeof value !== 'string' || !value.trim())
      throw new ProjectConfigError(configPath, `Path ${key} must be a non-empty string`);
    const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
    const relativePath = relative(resolve(root), absolute);
    if (relativePath.startsWith('..') || isAbsolute(relativePath) || relativePath === '')
      throw new ProjectConfigError(
        configPath,
        `Path ${key} must point inside the project: ${value}`,
      );
    paths[key] = relativePath.split('\\').join('/');
  }
  for (const [key, value] of Object.entries(paths)) {
    const absolute = resolve(root, value);
    const relativePath = relative(resolve(root), absolute);
    if (relativePath.startsWith('..') || isAbsolute(relativePath))
      throw new ProjectConfigError(
        configPath,
        `Path ${key} must point inside the project: ${value}`,
      );
  }
  return {
    profile: APPLICATION_PROFILE,
    schemaVersion: 2,
    preset: raw.preset,
    style: raw.style,
    paths,
    raw,
    configPath,
    root: resolve(root),
  };
}
