import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  AudioError,
  createAssetContext,
  createAudioService,
  defineAudio,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { AudioDriver, AudioPlayback } from '@xiaobaibaifqy/jingchuanchu-app/application';

function fakeAudio(locked = true) {
  const counts = { unlock: 0, decode: 0, play: 0, dispose: 0 };
  const plays: Array<{
    asset: unknown;
    options: { group: string; volume: number; loop: boolean };
    playback: AudioPlayback & {
      volume: number;
      pauses: number;
      resumes: number;
      stops: number;
      finish(): void;
    };
  }> = [];
  let state: 'locked' | 'ready' | 'disposed' = locked ? 'locked' : 'ready';
  const driver: AudioDriver = {
    get state() {
      return state;
    },
    async unlock() {
      counts.unlock += 1;
      state = 'ready';
    },
    async decode(raw) {
      counts.decode += 1;
      return { decoded: raw };
    },
    play(asset, options) {
      counts.play += 1;
      const listeners = new Set<() => void>();
      const playback = {
        volume: options.volume,
        pauses: 0,
        resumes: 0,
        stops: 0,
        ended: false,
        setVolume(value: number) {
          playback.volume = value;
        },
        pause() {
          playback.pauses += 1;
        },
        resume() {
          playback.resumes += 1;
        },
        stop() {
          playback.stops += 1;
          playback.ended = true;
          for (const listener of [...listeners]) listener();
        },
        onEnded(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        finish() {
          playback.ended = true;
          for (const listener of [...listeners]) listener();
        },
      };
      plays.push({ asset, options, playback });
      return playback;
    },
    suspend() {},
    resume() {},
    dispose() {
      counts.dispose += 1;
      state = 'disposed';
    },
  };
  return { driver, counts, plays };
}

function assetContext(failing: (url: string) => boolean = () => false) {
  const calls: string[] = [];
  const context = createAssetContext({
    adapters: {
      image: async (url) => ({ url }),
      atlas: async (url) => ({ url }),
      audio: async (url) => {
        calls.push(url);
        if (failing(url)) throw new Error(`cannot load ${url}`);
        return { src: url };
      },
      json: async (url) => ({ url }),
    },
  });
  return { calls, context };
}

const catalog = defineAudio({
  name: 'test',
  music: { theme: '/theme.mp3' },
  effects: {
    click: '/click.mp3',
    duplicate: '/click.mp3',
    third: '/third.mp3',
    bad: '/bad.mp3',
  },
});

test('audio unlocks before playback and reports locked, volume and failure states', async () => {
  const driver = fakeAudio(true);
  const assets = assetContext((url) => url === '/bad.mp3');
  const service = createAudioService({
    audio: catalog,
    assets: assets.context,
    driver: driver.driver,
  });
  assert.equal(service.status, 'locked');
  const blocked = await service.playEffect('click');
  assert.equal(blocked.status, 'blocked');
  assert.equal(driver.counts.decode, 0);
  assert.equal(await service.unlock(), true);
  assert.equal(service.status, 'ready');
  const playing = await service.playEffect('click');
  assert.equal(playing.status, 'playing');
  service.setVolume('master', 0.5);
  assert.equal(driver.plays[0]!.playback.volume, 0.5);
  service.setVolume('effects', 0.5);
  assert.equal(driver.plays[0]!.playback.volume, 0.25);
  service.setMuted(true);
  assert.equal(driver.plays[0]!.playback.volume, 0);
  service.setMuted(false);
  assert.equal(driver.plays[0]!.playback.volume, 0.25);
  service.setVolume('master', 2);
  assert.equal(service.volumes.master, 0.5);
  const failed = await service.playEffect('bad');
  assert.equal(failed.status, 'failed');
  assert.ok(failed.status === 'failed' && failed.error instanceof AudioError);
  assert.equal(failed.status === 'failed' && failed.error.key, 'bad');
  const unknown = await service.playEffect('missing' as never);
  assert.equal(unknown.status, 'failed');
  service.dispose();
  assert.equal(driver.counts.dispose, 1);
  assets.context.dispose();
});

test('music is a single track, effects dedupe decode and honor the concurrency limit', async () => {
  const driver = fakeAudio(false);
  const assets = assetContext();
  const service = createAudioService({
    audio: catalog,
    assets: assets.context,
    driver: driver.driver,
    maxConcurrentEffects: 2,
  });
  const first = await service.playMusic('theme');
  const second = await service.playMusic('theme');
  assert.equal(first.status, 'playing');
  assert.equal(second.status, 'playing');
  assert.equal((first as { handle: AudioPlayback }).handle.ended, true);
  assert.equal(driver.counts.decode, 1);

  const effect = await service.playEffect('click');
  assert.equal(effect.status, 'playing');
  const duplicate = await service.playEffect('duplicate');
  assert.equal(duplicate.status, 'playing');
  assert.equal(driver.counts.decode, 2);
  const third = await service.playEffect('third');
  assert.equal(third.status, 'dropped');
  (effect as { handle: AudioPlayback }).handle.stop();
  const after = await service.playEffect('click');
  assert.equal(after.status, 'playing');
  service.dispose();
  assets.context.dispose();
});

test('page scopes release their own sounds without stopping other owners', async () => {
  const driver = fakeAudio(false);
  const assets = assetContext();
  const service = createAudioService({
    audio: catalog,
    assets: assets.context,
    driver: driver.driver,
  });
  const pageOne = new Scope();
  const pageTwo = new Scope();
  const music = await service.playMusic('theme', { scope: pageOne });
  const effect = await service.playEffect('click', { scope: pageTwo });
  assert.equal(music.status, 'playing');
  assert.equal(effect.status, 'playing');
  pageOne.dispose();
  assert.equal(driver.plays[0]!.playback.stops, 1);
  assert.equal(driver.plays[1]!.playback.stops, 0);
  pageTwo.dispose();
  assert.equal(driver.plays[1]!.playback.stops, 1);
  service.dispose();
  assets.context.dispose();
});

test('manual mute survives pause and resume, and ownership controls driver disposal', async () => {
  const driver = fakeAudio(false);
  const assets = assetContext();
  const service = createAudioService({
    audio: catalog,
    assets: assets.context,
    driver: driver.driver,
  });
  const music = await service.playMusic('theme');
  const handle = (music as { handle: AudioPlayback }).handle;
  service.pauseMusic();
  assert.equal((handle as unknown as { pauses: number }).pauses, 1);
  service.setMuted(true);
  service.resumeMusic();
  assert.equal((handle as unknown as { resumes: number }).resumes, 1);
  assert.equal((handle as unknown as { volume: number }).volume, 0);
  service.setMuted(false);
  assert.equal((handle as unknown as { volume: number }).volume, 1);
  service.dispose();
  assert.equal(driver.counts.dispose, 1);
  assert.equal((handle as unknown as { stops: number }).stops, 1);

  const sharedDriver = fakeAudio(false);
  const sharedAssets = assetContext();
  const shared = createAudioService({
    audio: catalog,
    assets: sharedAssets.context,
    driver: sharedDriver.driver,
    ownsDriver: false,
  });
  shared.dispose();
  assert.equal(sharedDriver.counts.dispose, 0);
  sharedAssets.context.dispose();
});
