import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import {
  createInputActions,
  createViewport,
  defineActions,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { ViewportDriver } from '@xiaobaibaifqy/jingchuanchu-app/application';

function canvas(rect: { left: number; top: number; width: number; height: number }) {
  const window = new Window();
  const document = window.document as unknown as Document;
  const element = document.createElement('canvas') as HTMLCanvasElement;
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() {},
    }) as DOMRect;
  document.body.append(element);
  return { window, document, element };
}

test('viewport keeps logical coordinates stable across CSS sizes and pixel ratios', () => {
  const created = canvas({ left: 10, top: 20, width: 800, height: 600 });
  const listeners = new Set<
    (value: { width: number; height: number; pixelRatio: number }) => void
  >();
  let cleanups = 0;
  let geometry = { width: 800, height: 600, pixelRatio: 2 };
  const driver: ViewportDriver = {
    read: () => geometry,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        cleanups += 1;
      };
    },
  };
  const scope = new Scope();
  const viewport = createViewport({
    canvas: created.element,
    width: 400,
    height: 300,
    scope,
    driver,
  });
  assert.equal(viewport.scale, 2);
  assert.equal(viewport.pixelRatio, 2);
  assert.equal(viewport.displayWidth, 800);
  assert.equal(viewport.displayHeight, 600);
  assert.equal(viewport.bufferWidth, 800);
  assert.equal(viewport.bufferHeight, 600);
  assert.equal(created.element.width, 800);

  const point = viewport.toGamePoint({ clientX: 410, clientY: 320 });
  assert.deepEqual(
    { x: point.x, y: point.y, inside: point.inside },
    { x: 200, y: 150, inside: true },
  );
  assert.equal(viewport.toGamePoint({ clientX: 5, clientY: 5 }).inside, false);

  geometry = { width: 400, height: 600, pixelRatio: 1 };
  created.element.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      width: 400,
      height: 300,
      right: 410,
      bottom: 320,
      x: 10,
      y: 20,
      toJSON() {},
    }) as DOMRect;
  assert.equal(viewport.resize(), true);
  assert.equal(viewport.scale, 1);
  assert.equal(viewport.displayWidth, 400);
  assert.equal(viewport.displayHeight, 300);
  const resized = viewport.toGamePoint({ clientX: 210, clientY: 170 });
  assert.deepEqual({ x: resized.x, y: resized.y }, { x: 200, y: 150 });
  assert.equal(viewport.resize(), false);
  created.element.width = 1;
  assert.equal(viewport.resize(), false);
  assert.equal(viewport.bufferWidth, 400);
  assert.equal(created.element.width, 1);

  const world = viewport.toWorldPoint(
    { clientX: 210, clientY: 170 },
    { screenToWorld: (value) => ({ x: value.x * 2, y: value.y * 2 }) },
  );
  assert.deepEqual({ x: world.x, y: world.y }, { x: 400, y: 300 });

  viewport.dispose();
  scope.dispose();
  assert.equal(cleanups, 1);
  assert.equal(listeners.size, 0);
  assert.throws(
    () =>
      createViewport({
        canvas: created.element,
        width: 10,
        height: 10,
        fit: 'cover' as never,
        driver,
      }),
    /Unsupported viewport fit/,
  );
});

test('keyboard actions keep down state, consume edges once and respect editable or IME input', () => {
  const { window, document } = canvas({ left: 0, top: 0, width: 100, height: 100 });
  const scope = new Scope();
  const actions = createInputActions(
    defineActions({
      axes: { moveX: { negative: ['ArrowLeft'], positive: ['ArrowRight'] } },
      buttons: { jump: { keys: ['Space'] } },
      preventDefault: ['Space'],
    }),
    { keyboardTarget: document, ownerDocument: document, scope },
  );
  const press = (type: string, code: string, options: Record<string, unknown> = {}) =>
    document.dispatchEvent(
      new window.KeyboardEvent(type, {
        code,
        bubbles: true,
        cancelable: true,
        ...options,
      }) as unknown as Event,
    );
  assert.equal(press('keydown', 'Space'), false);
  assert.equal(actions.read().axes.moveX, 0);
  assert.equal(actions.read().buttons.jump.pressed, false);
  press('keyup', 'Space');

  press('keydown', 'ArrowRight');
  let snapshot = actions.read();
  assert.equal(snapshot.axes.moveX, 1);
  assert.equal(actions.read().axes.moveX, 1);

  press('keydown', 'Space');
  assert.equal(actions.read().buttons.jump.pressed, true);
  assert.equal(actions.read().buttons.jump.pressed, false);
  assert.equal(actions.read().buttons.jump.down, true);
  press('keyup', 'Space');
  assert.equal(actions.read().buttons.jump.released, true);
  assert.equal(actions.read().buttons.jump.released, false);
  press('keyup', 'ArrowRight');

  const input = document.createElement('input');
  document.body.append(input);
  input.dispatchEvent(
    new window.KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }) as unknown as Event,
  );
  snapshot = actions.read();
  assert.equal(snapshot.axes.moveX, 0);
  press('keydown', 'ArrowLeft');
  assert.equal(actions.read().axes.moveX, -1);
  press('keyup', 'ArrowLeft');

  press('keydown', 'ArrowRight');
  document.dispatchEvent(new window.Event('compositionstart') as unknown as Event);
  const composing = new window.KeyboardEvent('keydown', {
    code: 'ArrowLeft',
    bubbles: true,
  });
  Object.defineProperty(composing, 'isComposing', { value: true });
  document.dispatchEvent(composing as unknown as Event);
  assert.equal(actions.read().axes.moveX, 1);
  document.dispatchEvent(new window.Event('compositionend') as unknown as Event);
  actions.clear();
  assert.equal(actions.read().axes.moveX, 0);
  scope.dispose();
});

test('pointer, virtual controls, pause, blur and visibility share one action state', () => {
  const { window, document } = canvas({ left: 0, top: 0, width: 200, height: 100 });
  const host = document.createElement('div');
  document.body.append(host);
  const scope = new Scope();
  const actions = createInputActions(
    defineActions({
      axes: { moveX: { negative: ['ArrowLeft'], positive: ['ArrowRight'] } },
      buttons: { jump: { keys: ['Space'] }, primary: { pointer: true } },
    }),
    { keyboardTarget: document, pointerTarget: host, ownerDocument: document, scope },
  );
  const pointerEvent = (type: string, values: Record<string, unknown>) =>
    host.dispatchEvent(
      Object.assign(
        new window.Event(type, { bubbles: true, cancelable: true }),
        values,
      ) as unknown as Event,
    );
  pointerEvent('pointerdown', {
    clientX: 30,
    clientY: 40,
    isPrimary: true,
    button: 0,
    pointerId: 1,
  });
  let snapshot = actions.read();
  assert.equal(snapshot.buttons.primary.pressed, true);
  assert.equal(snapshot.pointer!.down, true);
  assert.deepEqual([snapshot.pointer!.x, snapshot.pointer!.y], [30, 40]);
  pointerEvent('pointermove', { clientX: 40, clientY: 45 });
  snapshot = actions.read();
  assert.deepEqual([snapshot.pointer!.deltaX, snapshot.pointer!.deltaY], [10, 5]);
  pointerEvent('pointerup', { clientX: 40, clientY: 45 });
  snapshot = actions.read();
  assert.equal(snapshot.buttons.primary.released, true);
  assert.equal(snapshot.pointer!.down, false);

  actions.setVirtualAxis('moveX', -1);
  actions.setVirtualButton('jump', true);
  snapshot = actions.read();
  assert.equal(snapshot.axes.moveX, -1);
  assert.equal(snapshot.buttons.jump.pressed, true);
  actions.setVirtualButton('jump', false);
  assert.equal(actions.read().buttons.jump.released, true);
  actions.setVirtualAxis('moveX', 0);

  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }) as unknown as Event,
  );
  assert.equal(actions.read().axes.moveX, 1);
  actions.setPaused(true);
  assert.equal(actions.read().axes.moveX, 0);
  actions.setPaused(false);
  assert.equal(actions.read().axes.moveX, 0);

  const input = document.createElement('input');
  document.body.append(input);
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }) as unknown as Event,
  );
  assert.equal(actions.read().axes.moveX, -1);
  input.dispatchEvent(new window.Event('focusin', { bubbles: true }) as unknown as Event);
  assert.equal(actions.read().axes.moveX, 0);

  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }) as unknown as Event,
  );
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event);
  assert.equal(actions.read().axes.moveX, 0);
  scope.dispose();
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }) as unknown as Event,
  );
  assert.equal(actions.read().axes.moveX, 0);
});
