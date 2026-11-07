import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { Engine, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import { SceneManager } from '@xiaobaibaifqy/jingchuanchu-core/scenes';
import {
  Owner,
  createAssetContext,
  createGameClock,
  createSaveService,
  createThemeService,
  createMemoryStorage,
  createTweenRunner,
  mountComponent,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  ActionSnapshot,
  ComponentDefinition,
  ComponentEnvironment,
  GameSceneContext,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import { Position2D } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';
import {
  PlayScene,
  ArcadeCoin,
  ArcadePlayer,
} from '../templates/browser/src/pages/play/play-scene.js';
import { compileViews } from '../packages/tooling/compiler.mjs';
import { GameStore } from '../templates/browser/src/game/session/game-store.js';
import { ProgressSave, SettingsSave } from '../templates/browser/src/game/session/save.js';
import { DefaultTheme } from '../templates/browser/src/themes/default/default-theme.js';
import { ForestTheme } from '../templates/browser/src/themes/forest/forest-theme.js';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function compileFixture(root: string, source: string, target: string): Promise<void> {
  const targetPath = join(root, target);
  const sourcePath = join(process.cwd(), 'templates/browser', source);
  const html = await readFile(sourcePath.replace(/\.ts$/, '.html'), 'utf8');
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath.replace(/\.ts$/, '.html'), html);
  const compiled = await compileViews(await readFile(sourcePath, 'utf8'), targetPath);
  assert.ok(compiled);
  await writeFile(targetPath, compiled.code);
}

async function compiledHud(): Promise<{
  Hud: ComponentDefinition;
  dispose(): Promise<void>;
}> {
  const root = await mkdtemp(join(process.cwd(), '.jcc-reference-'));
  await compileFixture(
    root,
    'src/components/icon-button/icon-button.ts',
    'src/components/icon-button/icon-button.ts',
  );
  await compileFixture(root, 'src/pages/play/hud/hud.ts', 'src/pages/play/hud/hud.ts');
  const module = (await import(
    `${pathToFileURL(join(root, 'src/pages/play/hud/hud.ts')).href}?v=${Date.now()}`
  )) as { PlayHud: ComponentDefinition };
  return {
    Hud: module.PlayHud,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

async function runScene(duration = 30, coinCount = 3) {
  const engine = new Engine({ tickRate: 10, maxSteps: 20 });
  const manager = new SceneManager(engine);
  const clock = createGameClock();
  const tweens = createTweenRunner();
  let actions: ActionSnapshot = { axes: {}, buttons: {}, pointer: undefined };
  const calls = {
    scores: [] as number[],
    times: [] as number[],
    coins: 0,
    completed: [] as number[],
  };
  const props = {
    levelId: 'one',
    seed: 1,
    duration,
    coinCount,
    onScore(score: number) {
      calls.scores.push(score);
    },
    onTime(seconds: number) {
      calls.times.push(seconds);
    },
    onCoin() {
      calls.coins += 1;
    },
    onComplete(score: number) {
      calls.completed.push(score);
    },
  };
  await manager.switchTo({
    id: 'reference',
    setup(sceneContext) {
      const context: GameSceneContext<typeof props> = {
        engine,
        world: engine.world,
        scope: sceneContext.scope,
        signal: sceneContext.signal,
        clock,
        tweens,
        get actions() {
          return actions;
        },
        props,
        assets: undefined,
        theme: undefined,
        create: sceneContext.create,
        addSystem: sceneContext.addSystem,
        setResource: sceneContext.setResource,
        getResource: sceneContext.getResource,
        useStore() {
          throw new Error('Scene test does not use stores');
        },
        useService() {
          throw new Error('Scene test does not use services');
        },
      };
      PlayScene.setup(context);
    },
  });
  engine.addSystem({
    id: 'feedback',
    order: -100,
    update({ delta }) {
      clock.advance(delta);
      tweens.advance(delta);
    },
  });
  engine.start();
  return {
    engine,
    manager,
    clock,
    calls,
    setActions(next: ActionSnapshot) {
      actions = next;
    },
    player() {
      const [entity] = engine.world.query(ArcadePlayer);
      assert.ok(entity);
      return engine.world.require(entity!, Position2D);
    },
  };
}

test('reference play scene moves, pauses and collects coins without stacking entities', async () => {
  const scene = await runScene(30, 3);
  const start = { ...scene.player() };
  scene.setActions({
    axes: { moveX: 1, moveY: 0 },
    buttons: {},
    pointer: undefined,
  });
  scene.engine.advance(1);
  assert.ok(scene.player().x > start.x);
  scene.manager.pause();
  const pausedX = scene.player().x;
  scene.engine.advance(1);
  assert.equal(scene.player().x, pausedX);
  scene.manager.resume();

  const [coin] = scene.engine.world.query(Position2D, ArcadeCoin);
  assert.ok(coin);
  const coinPosition = scene.engine.world.require(coin!, Position2D);
  scene.setActions({ axes: { moveX: 0, moveY: 0 }, buttons: {}, pointer: undefined });
  const playerEntity = [...scene.engine.world.query(ArcadePlayer)][0]!;
  scene.engine.world.set(playerEntity, Position2D, { x: coinPosition.x, y: coinPosition.y });
  scene.engine.advance(0.1);
  assert.equal(scene.calls.scores.at(-1), 10);
  assert.equal(scene.calls.coins, 1);
  assert.equal(scene.engine.world.isAlive(coin!), false);

  scene.manager.dispose();
  assert.equal(scene.engine.world.size, 0);
  scene.engine.dispose();
});

test('reference play scene completes once when the timer expires', async () => {
  const scene = await runScene(0.3, 0);
  scene.engine.advance(0.3);
  assert.deepEqual(scene.calls.completed, [0]);
  assert.equal(scene.calls.times.at(-1), 0);
  scene.engine.advance(1);
  assert.deepEqual(scene.calls.completed, [0]);
  scene.manager.dispose();
  scene.engine.dispose();
});

test('shared game store tracks high scores, unlocks levels and hydrates progress', () => {
  const application = new Owner();
  const store = application.useStore(GameStore);
  assert.deepEqual(store.state.unlocked(), ['one']);
  store.actions.recordResult('one', 40);
  assert.equal(store.state.highScore(), 40);
  assert.deepEqual(store.state.unlocked(), ['one', 'two']);
  assert.deepEqual(store.state.completed(), ['one']);
  store.actions.recordResult('one', 20);
  assert.equal(store.state.highScore(), 40);
  store.actions.setNickname('  小川  ');
  assert.equal(store.state.nickname(), '小川');
  store.actions.hydrate({
    nickname: '旧档',
    highScore: 99,
    unlocked: ['one', 'two', 'three'],
    completed: ['one', 'two'],
  });
  assert.equal(store.state.nickname(), '旧档');
  assert.equal(store.state.highScore(), 99);
  assert.deepEqual(store.state.unlocked(), ['one', 'two', 'three']);
  assert.notStrictEqual(new Owner().useStore(GameStore), store);
});

test('reference save definitions whitelist progress and preferences', async () => {
  const storage = createMemoryStorage();
  const progress = createSaveService(ProgressSave, { storage, namespace: 'anonymous' });
  const settings = createSaveService(SettingsSave, { storage, namespace: 'anonymous' });
  const state = {
    nickname: '小川',
    highScore: 42,
    unlocked: ['one', 'two'],
    completed: ['one'],
    lastScore: 10,
    lastLevel: 'two',
  };
  assert.equal((await progress.save(ProgressSave.select(state))).status, 'saved');
  const stored = JSON.parse(storage.values.get('anonymous:progress')!) as {
    data: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(stored.data).sort(), [
    'completed',
    'highScore',
    'nickname',
    'unlocked',
  ]);
  assert.equal(
    (await settings.save({ nickname: '小川', volume: 0.4, muted: true })).status,
    'saved',
  );
  assert.deepEqual(await progress.load(), {
    status: 'ok',
    data: {
      nickname: '小川',
      highScore: 42,
      unlocked: ['one', 'two'],
      completed: ['one'],
    },
  });
  assert.deepEqual(await settings.load(), {
    status: 'ok',
    data: { nickname: '小川', volume: 0.4, muted: true },
  });
});

test('default and forest themes resolve DOM and Canvas coins through one key map', async () => {
  const created: string[] = [];
  const assets = createAssetContext({
    adapters: {
      async image(url) {
        created.push(url);
        return { url };
      },
      async atlas(url) {
        return { url };
      },
      async audio(url) {
        return { url };
      },
      async json(url) {
        return { url };
      },
    },
  });
  const defaultService = createThemeService(DefaultTheme, { assets });
  const forestService = createThemeService(ForestTheme, { assets });
  assert.notEqual(defaultService.url('game.coin'), forestService.url('game.coin'));
  const defaultCoin = await defaultService.loadImage('game.coin');
  const forestCoin = await forestService.loadImage('game.coin');
  assert.deepEqual(defaultCoin.frame, { x: 0, y: 0, width: 16, height: 16 });
  assert.equal(forestCoin.frame, undefined);
  assert.equal(created.length, 2);
  defaultCoin.release();
  forestCoin.release();
  assets.dispose();
});

test('play HUD forwards pause/restart outputs and renders its paused panel', async () => {
  const compiled = await compiledHud();
  try {
    const window = new Window();
    const document = window.document as unknown as Document;
    const host = document.createElement('div');
    document.body.append(host);
    const environment: ComponentEnvironment = {
      owner: new Owner(),
      onError(error) {
        throw error;
      },
    };
    const instance = mountComponent(host, compiled.Hud, environment, {
      score: 30,
      time: 12,
      paused: false,
      started: true,
      pauseUrl: '/pause.svg',
    });
    const outputs: string[] = [];
    instance.subscribeOutput('pause', () => outputs.push('pause'));
    instance.subscribeOutput('restart', () => outputs.push('restart'));
    assert.match(host.textContent!, /30/);
    assert.match(host.textContent!, /12/);
    assert.equal(host.querySelector('img')!.getAttribute('src'), '/pause.svg');
    (host.querySelector('.icon-button') as HTMLElement).dispatchEvent(
      new window.Event('click', { bubbles: true }) as unknown as Event,
    );
    const buttons = [...host.querySelectorAll('button')];
    buttons[1]!.dispatchEvent(new window.Event('click', { bubbles: true }) as unknown as Event);
    assert.deepEqual(outputs, ['pause', 'restart']);
    instance.setInputs({
      score: 30,
      time: 12,
      paused: true,
      started: true,
      pauseUrl: '/pause.svg',
    });
    await settle();
    assert.ok(host.querySelector('.pause-panel'));
    instance.dispose();
  } finally {
    await compiled.dispose();
  }
});
