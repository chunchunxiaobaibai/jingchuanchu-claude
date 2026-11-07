export interface AppState {
  readonly status: 'running' | 'paused' | 'stopped' | 'disposed';
  readonly error: string | null;
}
export interface AppCommands {
  togglePause: undefined;
  moveTo: { x: number; y: number };
}
export interface AppInput {
  readonly x: number;
  readonly y: number;
}
