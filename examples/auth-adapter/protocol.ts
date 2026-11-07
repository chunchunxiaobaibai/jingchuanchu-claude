export interface AuthRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface AuthResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export type RequestDriver = (request: AuthRequest) => Promise<AuthResponse>;

export interface SessionUser {
  readonly id: string;
  readonly displayName: string;
  readonly roles: readonly string[];
}

export interface LoginInput {
  readonly username: string;
  readonly password: string;
}
