import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import { mountComponent, type MountedComponent } from '../component.js';
import { Owner } from '../component-owner.js';
import type { Router, RouterCommitContext } from './router.js';
import type { RouteLocation, RouteTarget } from './types.js';

export interface RouterOutletOptions {
  readonly onError?: (error: unknown) => void;
}

export interface RouterOutlet {
  readonly pageOwner: Owner | undefined;
  readonly route: RouteLocation | undefined;
  commit(context: RouterCommitContext): void;
  dispose(): void;
}

export function createRouterOutlet(
  host: Element,
  owner: Owner,
  options: RouterOutletOptions = {},
): RouterOutlet {
  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };
  let pageHost: Element | undefined;
  let page: MountedComponent<Record<string, unknown>> | undefined;
  let pageOwner: Owner | undefined;
  let route: RouteLocation | undefined;
  let closed = false;

  return {
    get pageOwner() {
      return pageOwner;
    },
    get route() {
      return route;
    },
    commit(context) {
      if (closed) throw new Error('Router outlet is disposed');
      if (context.signal.aborted) return;
      const nextOwner = owner.createChild();
      const document = host.ownerDocument;
      const nextHost = document.createElement('router-page');
      nextHost.setAttribute('style', 'display:contents');
      let nextPage: MountedComponent<Record<string, unknown>>;
      try {
        nextPage = mountComponent(
          nextHost,
          context.page,
          { owner: nextOwner, onError: report, route: context.match.location },
          context.inputs as Record<string, unknown>,
        );
      } catch (error) {
        try {
          nextOwner.dispose();
        } catch (cleanupError) {
          report(new AggregateError([error, cleanupError], 'Page mount and cleanup failed'));
        }
        throw error;
      }
      if (context.signal.aborted) {
        try {
          nextPage.dispose();
        } catch (error) {
          report(error);
        }
        try {
          nextOwner.dispose();
        } catch (error) {
          report(error);
        }
        return;
      }

      const previousHost = pageHost;
      const previousPage = page;
      const previousOwner = pageOwner;
      pageHost = nextHost;
      page = nextPage;
      pageOwner = nextOwner;
      route = context.match.location;
      if (previousHost) host.replaceChild(nextHost, previousHost);
      else host.append(nextHost);

      const errors: unknown[] = [];
      if (previousPage)
        try {
          previousPage.dispose();
        } catch (error) {
          errors.push(error);
        }
      if (previousOwner)
        try {
          previousOwner.dispose();
        } catch (error) {
          errors.push(error);
        }
      if (errors.length) report(new AggregateError(errors, 'Page cleanup failed'));
    },
    dispose() {
      if (closed) return;
      closed = true;
      const errors: unknown[] = [];
      if (page)
        try {
          page.dispose();
        } catch (error) {
          errors.push(error);
        }
      if (pageOwner)
        try {
          pageOwner.dispose();
        } catch (error) {
          errors.push(error);
        }
      pageHost?.remove();
      page = undefined;
      pageOwner = undefined;
      pageHost = undefined;
      route = undefined;
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Router outlet cleanup failed');
    },
  };
}

export interface RouteLinkOptions {
  readonly replace?: boolean;
}

export function bindRouteLink(
  element: Element,
  router: Router,
  target: RouteTarget,
  options: RouteLinkOptions = {},
): Cleanup {
  const path = router.resolve(target);
  element.setAttribute('href', router.mode === 'hash' ? `#${path}` : path);
  const listener = (event: Event): void => {
    const mouse = event as MouseEvent;
    if (
      mouse.defaultPrevented ||
      mouse.button !== 0 ||
      mouse.metaKey ||
      mouse.ctrlKey ||
      mouse.shiftKey ||
      mouse.altKey
    )
      return;
    event.preventDefault();
    void (options.replace ? router.replace(target) : router.push(target));
  };
  const intent = (): void => {
    void router.preload(target, { strategy: 'intent' }).catch(() => {});
  };
  element.addEventListener('click', listener);
  element.addEventListener('focus', intent);
  element.addEventListener('pointerenter', intent);
  return () => {
    element.removeEventListener('click', listener);
    element.removeEventListener('focus', intent);
    element.removeEventListener('pointerenter', intent);
  };
}
