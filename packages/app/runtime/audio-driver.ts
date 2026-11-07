import type { CancellationSignal, Cleanup } from '@xiaobaibaifqy/jingchuanchu-core';

export type AudioDriverState = 'locked' | 'ready' | 'suspended' | 'failed' | 'disposed';

export interface AudioPlayback {
  setVolume(value: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  readonly ended: boolean;
  onEnded(listener: () => void): Cleanup;
}

export interface AudioDriver {
  readonly state: AudioDriverState;
  unlock(): Promise<void>;
  decode(raw: unknown, signal: CancellationSignal): Promise<unknown>;
  play(
    asset: unknown,
    options: { group: 'music' | 'effects'; volume: number; loop: boolean },
  ): AudioPlayback;
  suspend(): void | Promise<void>;
  resume(): void | Promise<void>;
  dispose(): void;
}
