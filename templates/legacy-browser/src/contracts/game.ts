export interface MovementInput {
  readonly x: number;
  readonly y: number;
}
export type GameCommand =
  | { readonly type: 'toggle-pause' }
  | { readonly type: 'move-to'; readonly x: number; readonly y: number };
export interface GameSnapshot {
  readonly status: 'running' | 'paused' | 'stopped' | 'disposed';
  readonly error: string | null;
}
