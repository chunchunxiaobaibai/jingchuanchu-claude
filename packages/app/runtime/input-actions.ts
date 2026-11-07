import type { Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';

export interface AxisDefinition {
  readonly negative?: readonly string[];
  readonly positive?: readonly string[];
}

export interface ButtonDefinition {
  readonly keys?: readonly string[];
  readonly pointer?: boolean;
}

export interface ActionDefinition<
  A extends Record<string, AxisDefinition> = Record<string, AxisDefinition>,
  B extends Record<string, ButtonDefinition> = Record<string, ButtonDefinition>,
> {
  readonly axes: A;
  readonly buttons: B;
  readonly preventDefault: readonly string[];
}

export function defineActions<
  const A extends Record<string, AxisDefinition> = Record<never, never>,
  const B extends Record<string, ButtonDefinition> = Record<never, never>,
>(options: { axes?: A; buttons?: B; preventDefault?: readonly string[] }): ActionDefinition<A, B> {
  return Object.freeze({
    axes: Object.freeze({ ...(options.axes ?? ({} as A)) }),
    buttons: Object.freeze({ ...(options.buttons ?? ({} as B)) }),
    preventDefault: Object.freeze([...(options.preventDefault ?? [])]),
  });
}

export interface ButtonState {
  readonly pressed: boolean;
  readonly released: boolean;
  readonly down: boolean;
}

export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly down: boolean;
}

export interface ActionSnapshot<
  A extends Record<string, AxisDefinition> = Record<string, AxisDefinition>,
  B extends Record<string, ButtonDefinition> = Record<string, ButtonDefinition>,
> {
  readonly axes: { readonly [K in keyof A]: number };
  readonly buttons: { readonly [K in keyof B]: ButtonState };
  readonly pointer: PointerState | undefined;
}

export interface InputActionsOptions {
  readonly keyboardTarget?: EventTarget;
  readonly pointerTarget?: Element;
  readonly ownerDocument?: Document;
  readonly scope?: Scope;
}

export interface InputActions<
  A extends Record<string, AxisDefinition> = Record<string, AxisDefinition>,
  B extends Record<string, ButtonDefinition> = Record<string, ButtonDefinition>,
> {
  read(): ActionSnapshot<A, B>;
  setPaused(paused: boolean): void;
  setVirtualButton(name: keyof B & string, down: boolean): void;
  setVirtualAxis(name: keyof A & string, value: number): void;
  clear(): void;
  dispose(): void;
}

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element !== 'object') return false;
  const tag = element.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true
  );
}

export function createInputActions<
  A extends Record<string, AxisDefinition>,
  B extends Record<string, ButtonDefinition>,
>(definition: ActionDefinition<A, B>, options: InputActionsOptions = {}): InputActions<A, B> {
  const document = options.ownerDocument ?? options.pointerTarget?.ownerDocument;
  const view = document?.defaultView;
  const keyboardTarget = options.keyboardTarget ?? document ?? view;
  const pointerTarget = options.pointerTarget;
  const down = new Set<string>();
  const pressed = new Set<string>();
  const released = new Set<string>();
  const virtualDown = new Map<string, boolean>();
  const virtualPressed = new Set<string>();
  const virtualReleased = new Set<string>();
  const virtualAxes = new Map<string, number>();
  let pointerDown = false;
  let pointerPressed = false;
  let pointerReleased = false;
  let pointerX = 0;
  let pointerY = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let deltaX = 0;
  let deltaY = 0;
  let paused = false;
  let composing = false;
  let disposed = false;
  const cleanups: Cleanup[] = [];

  const listen = (
    target: EventTarget | null | undefined,
    type: string,
    listener: (event: Event) => void,
  ) => {
    if (!target) return;
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };

  const clear = (releaseEdges = false): void => {
    if (releaseEdges) for (const code of down) released.add(code);
    down.clear();
    pressed.clear();
    if (!releaseEdges) released.clear();
    virtualDown.clear();
    virtualPressed.clear();
    virtualReleased.clear();
    virtualAxes.clear();
    if (pointerDown || pointerPressed) pointerReleased = true;
    pointerDown = false;
    pointerPressed = false;
    deltaX = 0;
    deltaY = 0;
  };

  const onKeyDown = (event: Event): void => {
    if (paused || disposed) return;
    const keyboard = event as KeyboardEvent;
    if (keyboard.isComposing || keyboard.keyCode === 229 || composing) return;
    if (isEditable(event.target)) return;
    if (definition.preventDefault.includes(keyboard.code)) event.preventDefault();
    if (keyboard.repeat) return;
    if (!down.has(keyboard.code)) {
      down.add(keyboard.code);
      pressed.add(keyboard.code);
    }
  };
  const onKeyUp = (event: Event): void => {
    if (disposed) return;
    const keyboard = event as KeyboardEvent;
    if (definition.preventDefault.includes(keyboard.code)) event.preventDefault();
    if (down.delete(keyboard.code)) released.add(keyboard.code);
  };
  const onCompositionStart = (): void => {
    composing = true;
  };
  const onCompositionEnd = (): void => {
    composing = false;
  };
  const onBlur = (): void => {
    clear(true);
  };
  const onVisibility = (): void => {
    if (document?.visibilityState === 'hidden') clear(true);
  };
  const onFocusIn = (event: Event): void => {
    if (isEditable(event.target)) clear(true);
  };

  listen(keyboardTarget, 'keydown', onKeyDown);
  listen(keyboardTarget, 'keyup', onKeyUp);
  listen(keyboardTarget, 'compositionstart', onCompositionStart);
  listen(keyboardTarget, 'compositionend', onCompositionEnd);
  listen(view ?? keyboardTarget, 'blur', onBlur);
  listen(document, 'visibilitychange', onVisibility);
  listen(document, 'focusin', onFocusIn);

  const updatePointer = (event: Event): void => {
    const pointer = event as PointerEvent;
    pointerX = pointer.clientX;
    pointerY = pointer.clientY;
    deltaX += pointerX - lastPointerX;
    deltaY += pointerY - lastPointerY;
    lastPointerX = pointerX;
    lastPointerY = pointerY;
  };
  if (pointerTarget) {
    listen(pointerTarget, 'pointerdown', (event) => {
      if (paused || disposed) return;
      const pointer = event as PointerEvent;
      if (!pointer.isPrimary || pointer.button !== 0) return;
      updatePointer(event);
      pointerDown = true;
      pointerPressed = true;
      try {
        pointerTarget.setPointerCapture?.(pointer.pointerId);
      } catch {
        // Capture is best-effort; the host may be detached.
      }
      event.preventDefault();
    });
    listen(pointerTarget, 'pointermove', (event) => {
      if (paused || disposed) return;
      updatePointer(event);
    });
    const release = (event: Event): void => {
      if (pointerDown) pointerReleased = true;
      pointerDown = false;
      updatePointer(event);
    };
    listen(pointerTarget, 'pointerup', release);
    listen(pointerTarget, 'pointercancel', release);
    listen(pointerTarget, 'lostpointercapture', release);
  }

  const inputActions: InputActions<A, B> = {
    read() {
      const axes = {} as { [K in keyof A]: number };
      for (const [name, axis] of Object.entries(definition.axes) as Array<
        [keyof A & string, AxisDefinition]
      >) {
        let value = 0;
        for (const code of axis.positive ?? []) if (down.has(code)) value += 1;
        for (const code of axis.negative ?? []) if (down.has(code)) value -= 1;
        value += virtualAxes.get(name) ?? 0;
        axes[name] = Math.max(-1, Math.min(1, value));
      }
      const buttons = {} as { [K in keyof B]: ButtonState };
      for (const [name, button] of Object.entries(definition.buttons) as Array<
        [keyof B & string, ButtonDefinition]
      >) {
        const pointerMapped = button.pointer === true;
        const downNow =
          (button.keys ?? []).some((code) => down.has(code)) ||
          virtualDown.get(name) === true ||
          (pointerMapped && pointerDown);
        const pressedNow =
          (button.keys ?? []).some((code) => pressed.has(code)) ||
          virtualPressed.has(name) ||
          (pointerMapped && pointerPressed);
        const releasedNow =
          (button.keys ?? []).some((code) => released.has(code)) ||
          virtualReleased.has(name) ||
          (pointerMapped && pointerReleased);
        buttons[name] = Object.freeze({
          down: downNow,
          pressed: pressedNow,
          released: releasedNow,
        });
      }
      const snapshot = Object.freeze({
        axes: Object.freeze(axes),
        buttons: Object.freeze(buttons),
        pointer:
          pointerTarget === undefined
            ? undefined
            : Object.freeze({
                x: pointerX,
                y: pointerY,
                deltaX,
                deltaY,
                down: pointerDown,
              }),
      });
      pressed.clear();
      released.clear();
      virtualPressed.clear();
      virtualReleased.clear();
      deltaX = 0;
      deltaY = 0;
      pointerPressed = false;
      pointerReleased = false;
      return snapshot;
    },
    setPaused(next) {
      paused = next;
      if (next) clear(true);
    },
    setVirtualButton(name, isDown) {
      if (paused || disposed) return;
      if (isDown) {
        if (!virtualDown.get(name)) virtualPressed.add(name);
        virtualDown.set(name, true);
      } else {
        if (virtualDown.get(name)) virtualReleased.add(name);
        virtualDown.delete(name);
      }
    },
    setVirtualAxis(name, value) {
      if (paused || disposed) return;
      virtualAxes.set(name, Math.max(-1, Math.min(1, value)));
    },
    clear() {
      clear(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear(true);
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
  options.scope?.own(() => inputActions.dispose());
  return inputActions;
}
