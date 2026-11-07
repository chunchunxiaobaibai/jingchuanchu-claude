import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  GameClockError,
  TweenError,
  createGameClock,
  createTweenRunner,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

test('clock after/every follow logical advances and cancellation stops callbacks', () => {
  const scope = new Scope();
  const clock = createGameClock({ scope });
  const fired: string[] = [];
  clock.after(1, () => fired.push('once'));
  const repeat = clock.every(0.5, () => fired.push('repeat'));
  clock.advance(0.5);
  assert.deepEqual(fired, ['repeat']);
  clock.advance(0.5);
  assert.deepEqual(fired, ['repeat', 'once', 'repeat']);
  clock.advance(1.5);
  assert.equal(fired.filter((value) => value === 'repeat').length, 5);
  repeat();
  clock.advance(2);
  assert.equal(fired.filter((value) => value === 'repeat').length, 5);
  clock.after(0.2, () => fired.push('late'));
  scope.dispose();
  clock.advance(1);
  assert.equal(fired.includes('late'), false);
  assert.equal(clock.pending, 0);
});

test('clock tasks scheduled during a step start on the next step and errors keep other tasks', () => {
  const scope = new Scope();
  const errors: unknown[] = [];
  const clock = createGameClock({ scope, onError: (error) => errors.push(error) });
  const fired: string[] = [];
  clock.after(0.5, () => {
    fired.push('first');
    clock.after(0.1, () => fired.push('nested'));
  });
  clock.every(0.5, () => fired.push('tick'));
  clock.advance(1);
  assert.deepEqual(fired, ['first', 'tick', 'tick']);
  clock.advance(0.1);
  assert.deepEqual(fired, ['first', 'tick', 'tick', 'nested']);

  clock.after(0.1, () => {
    throw new Error('clock callback');
  });
  clock.after(0.1, () => fired.push('survivor'));
  clock.advance(0.1);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof GameClockError);
  assert.match(String((errors[0] as GameClockError).cause), /clock callback/);
  assert.ok(fired.includes('survivor'));

  clock.every(0.1, () => undefined);
  assert.throws(() => clock.after(0, () => undefined), /positive finite/);
  scope.dispose();
});

test('tween numbers and objects complete once, support easing and cancellation', () => {
  const scope = new Scope();
  const runner = createTweenRunner({ scope });
  const numbers: Array<{ value: number; progress: number }> = [];
  let completed = 0;
  runner.tween({
    from: 0,
    to: 10,
    duration: 2,
    easing: 'ease-in',
    onUpdate: (value, progress) => numbers.push({ value, progress }),
    onComplete: () => {
      completed += 1;
    },
  });
  runner.advance(1);
  assert.deepEqual(numbers.at(-1), { value: 2.5, progress: 0.5 });
  runner.advance(1);
  assert.deepEqual(numbers.at(-1), { value: 10, progress: 1 });
  assert.equal(completed, 1);
  runner.advance(1);
  assert.equal(completed, 1);

  const objects: Array<Readonly<Record<string, number>>> = [];
  runner.tween({
    from: { x: 0, y: 10 },
    to: { x: 10, y: 20 },
    duration: 1,
    onUpdate: (value) => objects.push(value as Readonly<Record<string, number>>),
  });
  runner.advance(0.5);
  assert.deepEqual(objects.at(-1), { x: 5, y: 15 });
  runner.advance(0.5);
  assert.deepEqual(objects.at(-1), { x: 10, y: 20 });

  let cancelledCompletions = 0;
  const cancel = runner.tween({
    from: 0,
    to: 1,
    duration: 1,
    onUpdate: () => undefined,
    onComplete: () => {
      cancelledCompletions += 1;
    },
  });
  runner.advance(0.5);
  cancel();
  runner.advance(1);
  assert.equal(cancelledCompletions, 0);
  assert.throws(
    () => runner.tween({ from: 0, to: 1, duration: 0, onUpdate: () => undefined }),
    /positive finite/,
  );
  assert.throws(
    () =>
      runner.tween({
        from: { x: 0 },
        to: { y: 1 },
        duration: 1,
        onUpdate: () => undefined,
      } as never),
    /same keys/,
  );
  scope.dispose();
});

test('tween callbacks report their source and stop after failure', () => {
  const scope = new Scope();
  const errors: unknown[] = [];
  const runner = createTweenRunner({ scope, onError: (error) => errors.push(error) });
  let updates = 0;
  runner.tween({
    from: 0,
    to: 1,
    duration: 1,
    onUpdate: () => {
      updates += 1;
      throw new Error('tween update');
    },
  });
  runner.advance(0.5);
  runner.advance(0.5);
  assert.equal(updates, 1);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof TweenError);
  assert.match(String((errors[0] as TweenError).cause), /tween update/);
  scope.dispose();
});
