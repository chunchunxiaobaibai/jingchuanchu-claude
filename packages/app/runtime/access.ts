import type { Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';
import type { AuthService } from './auth.js';
import type { GuardResult, RouteGuard, RouteGuardContext, RouteTarget } from './router/types.js';

export interface AccessRequirement {
  readonly session: 'required';
  readonly all?: readonly string[];
  readonly any?: readonly string[];
}

export type AccessDeclaration = 'public' | AccessRequirement;

export interface AccessPolicy {
  readonly roles: Readonly<Record<string, readonly string[]>>;
  readonly permissions: readonly string[];
}

export function defineAccess(roles: Readonly<Record<string, readonly string[]>>): AccessPolicy {
  const permissions = new Set<string>();
  for (const values of Object.values(roles))
    for (const permission of values) permissions.add(permission);
  return Object.freeze({
    roles: Object.freeze(
      Object.fromEntries(
        Object.entries(roles).map(([role, values]) => [role, Object.freeze([...values])]),
      ),
    ),
    permissions: Object.freeze([...permissions]),
  });
}

export const defineAccessPolicy = defineAccess;

export interface AccessServiceOptions<U> {
  readonly auth: AuthService<any, U>;
  readonly policy: AccessPolicy;
  readonly rolesOf?: (user: U) => readonly string[];
  readonly permissionsOf?: (user: U) => readonly string[];
  readonly loginTarget?: RouteTarget;
  readonly forbiddenTarget?: RouteTarget;
  readonly onError?: (error: unknown) => void;
}

export interface AccessService {
  readonly policy: AccessPolicy;
  can(permission: string): boolean;
  canAll(permissions: readonly string[]): boolean;
  canAny(permissions: readonly string[]): boolean;
  check(requirement: AccessRequirement | undefined): Promise<GuardResult>;
  guard(): RouteGuard;
  subscribe(listener: () => void): Cleanup;
  dispose(): void;
}

function isRequirement(value: unknown): value is AccessRequirement {
  return (
    !!value && typeof value === 'object' && (value as AccessRequirement).session === 'required'
  );
}

export function createAccessService<U>(options: AccessServiceOptions<U>): AccessService {
  const known = new Set(options.policy.permissions);
  const rolesOf =
    options.rolesOf ?? ((user: U) => (user as { roles?: readonly string[] }).roles ?? []);
  const permissionsOf =
    options.permissionsOf ??
    ((user: U) => (user as { permissions?: readonly string[] }).permissions ?? []);
  const listeners = new Set<() => void>();
  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };

  const permissionSet = (): Set<string> | undefined => {
    if (options.auth.status !== 'authenticated') return undefined;
    const user = options.auth.session?.user;
    if (user === undefined) return undefined;
    const permissions = new Set(permissionsOf(user));
    for (const role of rolesOf(user))
      for (const permission of options.policy.roles[role] ?? []) permissions.add(permission);
    return permissions;
  };

  const allowed = (permission: string): boolean => {
    const permissions = permissionSet();
    if (!permissions) return false;
    if (known.size && !known.has(permission)) return false;
    return permissions.has(permission);
  };

  const service: AccessService = {
    policy: options.policy,
    can: allowed,
    canAll: (permissions) => permissions.every(allowed),
    canAny: (permissions) => permissions.length === 0 || permissions.some(allowed),
    async check(requirement) {
      if (!requirement) return { type: 'allow' };
      if (options.auth.status === 'unknown' || options.auth.status === 'restoring') {
        try {
          await options.auth.ensureSession();
        } catch (error) {
          report(error);
          return { type: 'deny', reason: 'session-failed' };
        }
      }
      if (options.auth.status !== 'authenticated') {
        if (options.auth.status === 'anonymous' && options.loginTarget !== undefined)
          return { type: 'redirect', target: options.loginTarget };
        return {
          type: 'deny',
          reason: options.auth.status === 'anonymous' ? 'anonymous' : 'session-failed',
        };
      }
      const all = [...(requirement.all ?? [])];
      const any = [...(requirement.any ?? [])];
      const unknown = [...all, ...any].find(
        (permission) => known.size > 0 && !known.has(permission),
      );
      if (unknown !== undefined) return { type: 'deny', reason: `unknown-permission:${unknown}` };
      if (all.length && !all.every(allowed)) {
        if (options.forbiddenTarget !== undefined)
          return { type: 'redirect', target: options.forbiddenTarget };
        return { type: 'deny', reason: 'forbidden' };
      }
      if (any.length && !any.some(allowed)) {
        if (options.forbiddenTarget !== undefined)
          return { type: 'redirect', target: options.forbiddenTarget };
        return { type: 'deny', reason: 'forbidden' };
      }
      return { type: 'allow' };
    },
    guard() {
      const guard: RouteGuard = async (context: RouteGuardContext) => {
        for (const meta of context.metas) {
          const declaration = meta.access;
          if (declaration === undefined || declaration === 'public') continue;
          if (!isRequirement(declaration)) return { type: 'deny', reason: 'invalid-access' };
          const result = await service.check(declaration);
          if (result.type !== 'allow') return result;
        }
        return { type: 'allow' };
      };
      return guard;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      unsubscribe();
    },
  };

  const unsubscribe = options.auth.onIdentityChange(() => {
    for (const listener of [...listeners]) listener();
  });
  return service;
}

export function createAccessGuard(access: AccessService): RouteGuard {
  return access.guard();
}
