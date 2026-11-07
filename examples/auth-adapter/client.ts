import { defineAuthProvider } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { AuthProvider, AuthSession } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { LoginInput, RequestDriver, SessionUser } from './protocol.js';

function decodeSession(value: unknown): AuthSession<SessionUser> {
  const raw = value as { user?: { id?: unknown; displayName?: unknown; roles?: unknown } };
  if (
    !raw?.user ||
    typeof raw.user.id !== 'string' ||
    typeof raw.user.displayName !== 'string' ||
    !Array.isArray(raw.user.roles)
  )
    throw new Error('Invalid session payload from auth server');
  return {
    status: 'authenticated',
    user: {
      id: raw.user.id,
      displayName: raw.user.displayName,
      roles: raw.user.roles as string[],
    },
  };
}

export function createHttpAuthProvider(
  request: RequestDriver,
): AuthProvider<LoginInput, SessionUser> {
  return defineAuthProvider({
    async restore() {
      const response = await request({ method: 'GET', path: '/auth/session' });
      if (response.status === 401) return 'anonymous';
      if (response.status !== 200)
        throw new Error(`Session restore rejected with ${response.status}`);
      return response.body;
    },
    async login(input) {
      const response = await request({
        method: 'POST',
        path: '/auth/login',
        body: input,
      });
      if (response.status === 401) throw new Error('Invalid credentials');
      if (response.status !== 200) throw new Error(`Login rejected with ${response.status}`);
      return response.body;
    },
    async logout() {
      const response = await request({ method: 'POST', path: '/auth/logout' });
      if (response.status >= 400)
        throw new Error(`Session revocation failed with ${response.status}`);
    },
    decode(value) {
      if (value === 'anonymous') return { status: 'anonymous', user: undefined };
      return decodeSession(value);
    },
  });
}
