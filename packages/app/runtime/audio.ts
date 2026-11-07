import { Cancellation, type Cleanup, type Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AssetContext } from './asset-types.js';
import { defineAssetGroup } from './assets.js';
import type { AudioDriver, AudioDriverState, AudioPlayback } from './audio-driver.js';

export type AudioGroup = 'master' | 'music' | 'effects';
export type AudioStatus = 'locked' | 'ready' | 'suspended' | 'failed' | 'disposed';

export interface AudioCatalog<
  M extends Record<string, string> = Record<string, string>,
  E extends Record<string, string> = Record<string, string>,
> {
  readonly name: string;
  readonly music: M;
  readonly effects: E;
}

export function defineAudio<
  const M extends Record<string, string> = Record<never, never>,
  const E extends Record<string, string> = Record<never, never>,
>(options: { name?: string; music?: M; effects?: E }): AudioCatalog<M, E> {
  return Object.freeze({
    name: options.name ?? 'audio',
    music: Object.freeze({ ...(options.music ?? ({} as M)) }),
    effects: Object.freeze({ ...(options.effects ?? ({} as E)) }),
  });
}

export class AudioError extends Error {
  constructor(
    readonly key: string | undefined,
    readonly operation: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Audio${key ? ` ${key}` : ''}: ${operation} failed${detail}`, { cause });
    this.name = 'AudioError';
  }
}

export type AudioPlayResult =
  | { readonly status: 'playing'; readonly handle: AudioPlayback }
  | { readonly status: 'blocked' }
  | { readonly status: 'dropped' }
  | { readonly status: 'failed'; readonly error: AudioError };

export interface AudioVolumes {
  readonly master: number;
  readonly music: number;
  readonly effects: number;
  readonly muted: boolean;
}

export interface AudioPlayOptions {
  readonly loop?: boolean;
  readonly scope?: Scope;
}

export interface AudioServiceOptions<
  M extends Record<string, string>,
  E extends Record<string, string>,
> {
  readonly audio: AudioCatalog<M, E>;
  readonly assets: AssetContext;
  readonly driver: AudioDriver;
  readonly scope?: Scope;
  readonly ownsDriver?: boolean;
  readonly maxConcurrentEffects?: number;
  readonly onError?: (error: unknown) => void;
}

export interface AudioService<
  M extends Record<string, string> = Record<string, string>,
  E extends Record<string, string> = Record<string, string>,
> {
  readonly status: AudioStatus;
  readonly volumes: AudioVolumes;
  readonly muted: boolean;
  unlock(): Promise<boolean>;
  playMusic(key: keyof M & string, options?: AudioPlayOptions): Promise<AudioPlayResult>;
  playEffect(key: keyof E & string, options?: AudioPlayOptions): Promise<AudioPlayResult>;
  pauseMusic(): void;
  resumeMusic(): void;
  setVolume(group: AudioGroup, value: number): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function createAudioService<
  M extends Record<string, string>,
  E extends Record<string, string>,
>(options: AudioServiceOptions<M, E>): AudioService<M, E> {
  const driver = options.driver;
  const maxEffects = Math.max(1, options.maxConcurrentEffects ?? 8);
  let status: AudioStatus = driver.state;
  let master = 1;
  let musicVolume = 1;
  let effectsVolume = 1;
  let muted = false;
  let musicPaused = false;
  let disposed = false;
  let musicGeneration = 0;
  let music: AudioPlayback | undefined;
  const effects = new Set<AudioPlayback>();
  const cleanups: Cleanup[] = [];
  const appHolds: Array<{ release(): void }> = [];
  const decodedCache = new WeakMap<object, Promise<unknown>>();
  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };
  const effective = (group: 'music' | 'effects'): number => {
    if (muted) return 0;
    return clampVolume((group === 'music' ? musicVolume : effectsVolume) * master);
  };
  const applyVolumes = (): void => {
    music?.setVolume(effective('music'));
    for (const handle of effects) handle.setVolume(effective('effects'));
  };
  const decode = async (key: string, raw: unknown): Promise<unknown> => {
    if (raw === null || typeof raw !== 'object') return raw;
    const cached = decodedCache.get(raw as object);
    if (cached) return cached;
    const cancellation = new Cancellation();
    const pending = driver.decode(raw, cancellation).finally(() => cancellation.cancel());
    decodedCache.set(raw as object, pending);
    pending.catch(() => decodedCache.delete(raw as object));
    try {
      return await pending;
    } finally {
      cancellation.cancel();
      void key;
    }
  };
  const load = async (
    key: string,
    src: string,
    scope: Scope | undefined,
  ): Promise<{ status: 'ok'; raw: unknown } | { status: 'failed'; error: AudioError }> => {
    try {
      const group = defineAssetGroup({
        name: `audio:${options.audio.name}`,
        entries: [{ key: 'audio', kind: 'audio', src }],
      });
      const lease = await options.assets.load(group);
      if (scope) scope.own(() => lease.release());
      else appHolds.push(lease);
      return { status: 'ok', raw: lease.get('audio') };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof AudioError ? error : new AudioError(key, 'load', error),
      };
    }
  };
  const stopMusic = (): void => {
    if (!music) return;
    try {
      music.stop();
    } catch (error) {
      report(new AudioError(undefined, 'music:stop', error));
    }
    music = undefined;
  };
  const stopEffects = (): void => {
    for (const handle of effects) {
      try {
        handle.stop();
      } catch (error) {
        report(new AudioError(undefined, 'effect:stop', error));
      }
    }
    effects.clear();
  };

  const service: AudioService<M, E> = {
    get status() {
      return status;
    },
    get volumes() {
      return Object.freeze({ master, music: musicVolume, effects: effectsVolume, muted });
    },
    get muted() {
      return muted;
    },
    async unlock() {
      if (disposed) return false;
      if (status === 'ready') return true;
      try {
        await driver.unlock();
        status = 'ready';
        return true;
      } catch (error) {
        status = 'failed';
        report(new AudioError(undefined, 'unlock', error));
        return false;
      }
    },
    async playMusic(key, playOptions = {}) {
      if (disposed) return { status: 'failed', error: new AudioError(key, 'play', 'Disposed') };
      const generation = ++musicGeneration;
      if (status === 'locked') return { status: 'blocked' };
      const src = options.audio.music[key];
      if (!src)
        return { status: 'failed', error: new AudioError(key, 'play', 'Unknown music key') };
      const loaded = await load(key, src, playOptions.scope);
      if (generation !== musicGeneration) return { status: 'dropped' };
      if (loaded.status === 'failed') {
        report(loaded.error);
        return loaded;
      }
      try {
        const asset = await decode(key, loaded.raw);
        if (generation !== musicGeneration) return { status: 'dropped' };
        stopMusic();
        const handle = driver.play(asset, {
          group: 'music',
          volume: effective('music'),
          loop: playOptions.loop !== false,
        });
        music = handle;
        musicPaused = false;
        playOptions.scope?.own(() => {
          if (music === handle) stopMusic();
        });
        return { status: 'playing', handle };
      } catch (error) {
        const failure = new AudioError(key, 'play', error);
        report(failure);
        return { status: 'failed', error: failure };
      }
    },
    async playEffect(key, playOptions = {}) {
      if (disposed) return { status: 'failed', error: new AudioError(key, 'play', 'Disposed') };
      if (status === 'locked') return { status: 'blocked' };
      if (effects.size >= maxEffects) return { status: 'dropped' };
      const src = options.audio.effects[key];
      if (!src)
        return { status: 'failed', error: new AudioError(key, 'play', 'Unknown effect key') };
      const loaded = await load(key, src, playOptions.scope);
      if (loaded.status === 'failed') {
        report(loaded.error);
        return loaded;
      }
      try {
        const asset = await decode(key, loaded.raw);
        if (effects.size >= maxEffects) return { status: 'dropped' };
        const handle = driver.play(asset, {
          group: 'effects',
          volume: effective('effects'),
          loop: false,
        });
        effects.add(handle);
        const unsubscribe = handle.onEnded(() => {
          effects.delete(handle);
          unsubscribe();
        });
        playOptions.scope?.own(() => {
          effects.delete(handle);
          handle.stop();
        });
        return { status: 'playing', handle };
      } catch (error) {
        const failure = new AudioError(key, 'play', error);
        report(failure);
        return { status: 'failed', error: failure };
      }
    },
    pauseMusic() {
      musicPaused = true;
      music?.pause();
    },
    resumeMusic() {
      if (!musicPaused) return;
      musicPaused = false;
      music?.resume();
    },
    setVolume(group, value) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        report(new AudioError(undefined, 'volume', new Error('Volume must be between 0 and 1')));
        return;
      }
      if (group === 'master') master = value;
      else if (group === 'music') musicVolume = value;
      else effectsVolume = value;
      applyVolumes();
    },
    setMuted(next) {
      muted = next;
      applyVolumes();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      status = 'disposed';
      const errors: unknown[] = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        stopMusic();
      } catch (error) {
        errors.push(error);
      }
      try {
        stopEffects();
      } catch (error) {
        errors.push(error);
      }
      for (const lease of appHolds.splice(0).reverse()) {
        try {
          lease.release();
        } catch (error) {
          errors.push(error);
        }
      }
      if (options.ownsDriver !== false) {
        try {
          driver.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Audio cleanup failed');
    },
  };
  options.scope?.own(() => service.dispose());
  return service;
}
