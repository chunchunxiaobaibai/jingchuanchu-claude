import {
  Cancellation,
  type CancellationSignal,
  type Cleanup,
} from '@xiaobaibaifqy/jingchuanchu-core';

export type AuthSessionState = 'unknown' | 'restoring' | 'anonymous' | 'authenticated' | 'failed';

export interface AuthSession<U> {
  readonly status: 'anonymous' | 'authenticated';
  readonly user: U | undefined;
}

export interface AuthProvider<L = unknown, U = unknown> {
  restore(signal: CancellationSignal): Promise<unknown>;
  login(input: L, signal: CancellationSignal): Promise<unknown>;
  logout(signal: CancellationSignal): Promise<void>;
  decode(value: unknown): AuthSession<U>;
}

export function defineAuthProvider<L, U>(provider: AuthProvider<L, U>): AuthProvider<L, U> {
  return Object.freeze(provider);
}

export class AuthError extends Error {
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Auth ${operation} failed${detail}`, { cause });
    this.name = 'AuthError';
  }
}

export type AuthLoginResult<U> =
  | {
      readonly status: 'authenticated' | 'anonymous';
      readonly session: AuthSession<U>;
    }
  | { readonly status: 'failed'; readonly error: AuthError }
  | { readonly status: 'cancelled' };

export type AuthLogoutResult =
  | { readonly status: 'logged-out' }
  | { readonly status: 'failed'; readonly error: AuthError }
  | { readonly status: 'cancelled' };

export interface AuthServiceOptions<L, U> {
  readonly provider: AuthProvider<L, U>;
  readonly onError?: (error: unknown) => void;
}

export interface AuthService<L = unknown, U = unknown> {
  readonly status: AuthSessionState;
  readonly session: AuthSession<U> | undefined;
  readonly generation: number;
  ensureSession(): Promise<AuthSession<U>>;
  login(input: L): Promise<AuthLoginResult<U>>;
  logout(): Promise<AuthLogoutResult>;
  subscribe(listener: (session: AuthSession<U> | undefined) => void): Cleanup;
  onIdentityChange(
    listener: (session: AuthSession<U> | undefined, generation: number) => void,
  ): Cleanup;
  dispose(): void;
}

interface IdentityToken {
  readonly generation: number;
  readonly signal: Cancellation;
}

export function createAuthService<L, U>(options: AuthServiceOptions<L, U>): AuthService<L, U> {
  let status: AuthSessionState = 'unknown';
  let session: AuthSession<U> | undefined;
  let generation = 0;
  let identity: IdentityToken | undefined;
  let restorePromise: Promise<AuthSession<U>> | undefined;
  let lastRestoreError: unknown;
  let disposed = false;
  const sessionListeners = new Set<(session: AuthSession<U> | undefined) => void>();
  const identityListeners = new Set<
    (session: AuthSession<U> | undefined, generation: number) => void
  >();
  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch (handlerError) {
      console.error(handlerError);
    }
  };
  const notify = (): void => {
    for (const listener of [...sessionListeners]) listener(session);
  };
  const setSession = (next: AuthSession<U> | undefined, identityChange: boolean): void => {
    session = next;
    status = next?.status ?? 'anonymous';
    notify();
    if (identityChange)
      for (const listener of [...identityListeners]) listener(session, generation);
  };
  const beginIdentity = (): IdentityToken => {
    generation += 1;
    identity?.signal.cancel(new AuthError('identity', 'Session replaced'));
    const signal = new Cancellation();
    identity = { generation, signal };
    return { generation, signal };
  };
  const decode = (value: unknown): AuthSession<U> => {
    const decoded = options.provider.decode(value);
    if (!decoded || (decoded.status !== 'anonymous' && decoded.status !== 'authenticated'))
      throw new Error('Provider returned an invalid auth session');
    return Object.freeze({
      status: decoded.status,
      user: decoded.user,
    });
  };

  const ensureSession = (): Promise<AuthSession<U>> => {
    if (disposed)
      return Promise.reject(new AuthError('restore', new Error('Auth service is disposed')));
    if (status === 'authenticated' || status === 'anonymous') return Promise.resolve(session!);
    if (status === 'restoring' && restorePromise) return restorePromise;
    if (status === 'failed') return Promise.reject(new AuthError('restore', lastRestoreError));
    status = 'restoring';
    notify();
    const token = beginIdentity();
    let promise!: Promise<AuthSession<U>>;
    promise = (async (): Promise<AuthSession<U>> => {
      try {
        const raw = await options.provider.restore(token.signal);
        token.signal.throwIfAborted();
        const decoded = decode(raw);
        if (token.generation !== generation)
          throw new AuthError('restore', new Error('Session superseded'));
        setSession(decoded, false);
        return decoded;
      } catch (error) {
        if (token.generation !== generation || disposed) throw new AuthError('restore', error);
        status = 'failed';
        lastRestoreError = error;
        session = undefined;
        notify();
        report(new AuthError('restore', error));
        throw error instanceof AuthError ? error : new AuthError('restore', error);
      } finally {
        if (restorePromise === promise) restorePromise = undefined;
      }
    })();
    restorePromise = promise;
    return promise;
  };

  const service: AuthService<L, U> = {
    get status() {
      return status;
    },
    get session() {
      return session;
    },
    get generation() {
      return generation;
    },
    ensureSession,
    async login(input) {
      if (disposed) return { status: 'failed', error: new AuthError('login', 'Disposed') };
      const token = beginIdentity();
      try {
        const raw = await options.provider.login(input, token.signal);
        token.signal.throwIfAborted();
        const decoded = decode(raw);
        if (token.generation !== generation) return { status: 'cancelled' };
        lastRestoreError = undefined;
        setSession(decoded, decoded.status === 'authenticated');
        return { status: decoded.status, session: decoded };
      } catch (error) {
        if (token.generation !== generation || disposed) return { status: 'cancelled' };
        report(new AuthError('login', error));
        return {
          status: 'failed',
          error: error instanceof AuthError ? error : new AuthError('login', error),
        };
      }
    },
    async logout() {
      if (disposed) return { status: 'failed', error: new AuthError('logout', 'Disposed') };
      const token = beginIdentity();
      setSession(undefined, true);
      try {
        await options.provider.logout(token.signal);
        return { status: 'logged-out' };
      } catch (error) {
        if (token.generation !== generation || disposed) return { status: 'cancelled' };
        report(new AuthError('logout', error));
        return {
          status: 'failed',
          error: error instanceof AuthError ? error : new AuthError('logout', error),
        };
      }
    },
    subscribe(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    onIdentityChange(listener) {
      identityListeners.add(listener);
      return () => identityListeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      identity?.signal.cancel(new AuthError('dispose', 'Auth service disposed'));
      identity = undefined;
      sessionListeners.clear();
      identityListeners.clear();
    },
  };
  return service;
}
