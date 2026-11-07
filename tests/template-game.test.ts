import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Owner } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { PlayScene } from '../templates/browser/src/pages/play/play-scene.js';
import { GameStore } from '../templates/browser/src/game/session/game-store.js';

test('reference template keeps the application profile, structure and playable scene', async () => {
  const structure = spawnSync(
    process.execPath,
    [
      '--conditions=source',
      resolve('templates/browser/scripts/check-project.mjs'),
      'templates/browser',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(structure.status, 0, structure.stderr);
  const config = JSON.parse(
    await readFile(resolve('templates/browser/jingchuanchu.json'), 'utf8'),
  ) as { schemaVersion?: number; profile?: string };
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.profile, 'application');
  assert.equal(typeof PlayScene.setup, 'function');

  const store = new Owner().useStore(GameStore);
  store.actions.recordResult('one', 30);
  assert.equal(store.state.highScore(), 30);
  assert.deepEqual(store.state.unlocked(), ['one', 'two']);
});
