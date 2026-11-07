import {
  createLocalStorageAdapter,
  createSaveService,
  defineSave,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { StoredProgress } from './game-store.js';

export interface StoredSettings {
  readonly nickname: string;
  readonly volume: number;
  readonly muted: boolean;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error('Invalid string list');
  return [...value];
}

export const ProgressSave = defineSave<StoredProgress, StoredProgress>({
  key: 'progress',
  version: 1,
  select(state) {
    return {
      nickname: state.nickname,
      highScore: state.highScore,
      unlocked: [...state.unlocked],
      completed: [...state.completed],
    };
  },
  parse(value) {
    const data = value as Partial<StoredProgress>;
    if (
      !data ||
      typeof data.nickname !== 'string' ||
      typeof data.highScore !== 'number' ||
      !Number.isFinite(data.highScore)
    )
      throw new Error('Invalid saved progress');
    return {
      nickname: data.nickname,
      highScore: Math.max(0, data.highScore),
      unlocked: stringList(data.unlocked),
      completed: stringList(data.completed),
    };
  },
});

export const SettingsSave = defineSave<StoredSettings, StoredSettings>({
  key: 'settings',
  version: 1,
  select(state) {
    return { nickname: state.nickname, volume: state.volume, muted: state.muted };
  },
  parse(value) {
    const data = value as Partial<StoredSettings>;
    if (
      !data ||
      typeof data.nickname !== 'string' ||
      typeof data.volume !== 'number' ||
      typeof data.muted !== 'boolean' ||
      !Number.isFinite(data.volume)
    )
      throw new Error('Invalid saved settings');
    return {
      nickname: data.nickname,
      volume: Math.max(0, Math.min(1, data.volume)),
      muted: data.muted,
    };
  },
});

const storage = createLocalStorageAdapter();
export const ProgressStore = createSaveService(ProgressSave, {
  storage,
  namespace: 'anonymous',
});
export const SettingsStore = createSaveService(SettingsSave, {
  storage,
  namespace: 'anonymous',
});
