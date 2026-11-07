import type { Cleanup, Scope } from '@xiaobaibaifqy/jingchuanchu-core';
import type { Point } from '@xiaobaibaifqy/jingchuanchu-renderer-2d';

export interface ViewportGeometry {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface ViewportDriver {
  read(): ViewportGeometry;
  subscribe(listener: (geometry: ViewportGeometry) => void): Cleanup;
}

export interface GameViewportOptions {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly fit?: 'contain';
  readonly maxPixelRatio?: number;
  readonly scope?: Scope;
  readonly driver?: ViewportDriver;
}

export interface GamePoint extends Point {
  readonly inside: boolean;
}

export interface GameViewport {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly pixelRatio: number;
  readonly bufferWidth: number;
  readonly bufferHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  resize(geometry?: ViewportGeometry): boolean;
  toGamePoint(event: { readonly clientX: number; readonly clientY: number }): GamePoint;
  toWorldPoint(
    event: { readonly clientX: number; readonly clientY: number },
    camera: { screenToWorld(point: Point): Point },
  ): GamePoint;
  dispose(): void;
}

function defaultDriver(canvas: HTMLCanvasElement): ViewportDriver {
  const document = canvas.ownerDocument;
  const view = document.defaultView;
  const target = canvas.parentElement ?? canvas;
  const read = (): ViewportGeometry => ({
    width: target.clientWidth || canvas.clientWidth || canvas.width,
    height: target.clientHeight || canvas.clientHeight || canvas.height,
    pixelRatio: view?.devicePixelRatio ?? 1,
  });
  return {
    read,
    subscribe(listener) {
      const cleanups: Cleanup[] = [];
      const ResizeObserverConstructor =
        typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver;
      if (ResizeObserverConstructor) {
        const observer = new ResizeObserverConstructor(() => listener(read()));
        observer.observe(target);
        cleanups.push(() => observer.disconnect());
      }
      if (view) {
        const notify = (): void => listener(read());
        view.addEventListener('resize', notify);
        cleanups.push(() => view.removeEventListener('resize', notify));
      }
      return () => {
        for (const cleanup of cleanups.reverse()) cleanup();
      };
    },
  };
}

export function createViewport(options: GameViewportOptions): GameViewport {
  if (options.fit !== undefined && options.fit !== 'contain')
    throw new Error(`Unsupported viewport fit: ${String(options.fit)}`);
  if (![options.width, options.height].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Viewport logical dimensions must be positive');
  const maxRatio = Math.min(2, options.maxPixelRatio ?? 2);
  const canvas = options.canvas;
  const driver = options.driver ?? defaultDriver(canvas);
  let width = options.width;
  let height = options.height;
  let pixelRatio = 1;
  let scale = 1;
  let bufferWidth = 0;
  let bufferHeight = 0;
  let displayWidth = 0;
  let displayHeight = 0;
  let disposed = false;

  const apply = (geometry: ViewportGeometry): boolean => {
    if (disposed) return false;
    const ratio = Math.max(0.1, Math.min(maxRatio, geometry.pixelRatio || 1));
    const availableWidth = geometry.width > 0 ? geometry.width : width;
    const availableHeight = geometry.height > 0 ? geometry.height : height;
    const nextScale = Math.min(availableWidth / width, availableHeight / height);
    const nextDisplayWidth = width * nextScale;
    const nextDisplayHeight = height * nextScale;
    const nextBufferWidth = Math.round(width * ratio);
    const nextBufferHeight = Math.round(height * ratio);
    const changed =
      ratio !== pixelRatio ||
      scale !== nextScale ||
      bufferWidth !== nextBufferWidth ||
      bufferHeight !== nextBufferHeight ||
      displayWidth !== nextDisplayWidth ||
      displayHeight !== nextDisplayHeight;
    if (!changed) return false;
    pixelRatio = ratio;
    scale = nextScale;
    bufferWidth = nextBufferWidth;
    bufferHeight = nextBufferHeight;
    displayWidth = nextDisplayWidth;
    displayHeight = nextDisplayHeight;
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    return true;
  };

  const initial = driver.read();
  apply(initial);
  const unsubscribe = driver.subscribe((geometry) => {
    apply(geometry);
  });
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
  };
  options.scope?.own(stop);
  options.scope?.own(() => {
    disposed = true;
  });

  const toGamePoint = (event: {
    readonly clientX: number;
    readonly clientY: number;
  }): GamePoint => {
    const rect = canvas.getBoundingClientRect();
    const inside =
      rect.width > 0 &&
      rect.height > 0 &&
      event.clientX >= rect.left &&
      event.clientX <= rect.left + rect.width &&
      event.clientY >= rect.top &&
      event.clientY <= rect.top + rect.height;
    if (!rect.width || !rect.height) return { x: 0, y: 0, inside: false };
    return {
      x: ((event.clientX - rect.left) * width) / rect.width,
      y: ((event.clientY - rect.top) * height) / rect.height,
      inside,
    };
  };

  return {
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get scale() {
      return scale;
    },
    get pixelRatio() {
      return pixelRatio;
    },
    get bufferWidth() {
      return bufferWidth;
    },
    get bufferHeight() {
      return bufferHeight;
    },
    get displayWidth() {
      return displayWidth;
    },
    get displayHeight() {
      return displayHeight;
    },
    resize(geometry = driver.read()) {
      return apply(geometry);
    },
    toGamePoint,
    toWorldPoint(event, camera) {
      const point = toGamePoint(event);
      const world = camera.screenToWorld({ x: point.x, y: point.y });
      return { x: world.x, y: world.y, inside: point.inside };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
    },
  };
}
