import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { parsePath } from './matcher.js';
import type { HistoryDriver, HistoryEventKind, HistoryLocation } from './types.js';

export type HistoryMode = 'hash' | 'history';

export interface HistoryWindow {
  readonly location: {
    hash: string;
    pathname: string;
    search: string;
  };
  readonly history: {
    pushState(data: unknown, unused: string, url?: string): void;
    replaceState(data: unknown, unused: string, url?: string): void;
    back(): void;
  };
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

function currentLocation(window: HistoryWindow, mode: HistoryMode): HistoryLocation {
  const raw =
    mode === 'hash'
      ? window.location.hash.replace(/^#/, '') || '/'
      : `${window.location.pathname}${window.location.search}`;
  return parsePath(raw);
}

/**
 * Browser history commands update the URL without emitting; only user/browser
 * navigation is emitted so a router never re-processes its own commits.
 */
export function createBrowserHistoryDriver(
  window: HistoryWindow,
  mode: HistoryMode = 'hash',
): HistoryDriver {
  const listeners = new Set<(location: HistoryLocation, kind: HistoryEventKind) => void>();
  let ignore: string | undefined;

  const notify = (kind: HistoryEventKind): void => {
    const location = currentLocation(window, mode);
    for (const listener of [...listeners]) listener(location, kind);
  };

  const eventName = mode === 'hash' ? 'hashchange' : 'popstate';
  const onNavigate = (): void => {
    if (mode === 'hash') {
      const current = `#${window.location.hash.replace(/^#/, '')}`;
      const ignored = ignore === current;
      // Consume the suppression mark on the next hash event, matching or not,
      // so a real user navigation to a previously committed URL is not lost.
      ignore = undefined;
      if (ignored) return;
    }
    notify('pop');
  };
  window.addEventListener(eventName, onNavigate);

  return {
    mode,
    get location() {
      return currentLocation(window, mode);
    },
    push(path: string) {
      if (mode === 'hash') {
        if (window.location.hash.replace(/^#/, '') === path) return;
        ignore = `#${path}`;
        window.location.hash = path;
      } else {
        window.history.pushState(null, '', path);
      }
    },
    replace(path: string) {
      if (mode === 'hash') {
        window.history.replaceState(null, '', `#${path}`);
      } else {
        window.history.replaceState(null, '', path);
      }
    },
    back() {
      window.history.back();
    },
    subscribe(listener): Cleanup {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          window.removeEventListener(eventName, onNavigate);
        }
      };
    },
  };
}
