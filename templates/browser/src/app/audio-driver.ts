import type { AudioDriver, AudioPlayback } from '@xiaobaibaifqy/jingchuanchu-app/application';

export function createWebAudioDriver(): AudioDriver {
  let context: AudioContext | undefined;
  let state: AudioDriver['state'] = 'locked';
  const ensure = (): AudioContext => {
    if (!context) context = new AudioContext();
    return context;
  };
  return {
    get state() {
      return state;
    },
    async unlock() {
      const audio = ensure();
      await audio.resume();
      state = 'ready';
    },
    async decode(raw) {
      const audio = ensure();
      return audio.decodeAudioData(raw as ArrayBuffer);
    },
    play(asset, options): AudioPlayback {
      const audio = ensure();
      const buffer = asset as AudioBuffer;
      const gain = audio.createGain();
      gain.gain.value = options.volume;
      gain.connect(audio.destination);
      const listeners = new Set<() => void>();
      let source: AudioBufferSourceNode | undefined;
      let startedAt = 0;
      let offset = 0;
      let paused = false;
      let ended = false;
      const start = (from: number): void => {
        const node = audio.createBufferSource();
        node.buffer = buffer;
        node.loop = options.loop;
        node.connect(gain);
        node.onended = () => {
          if (paused || ended) return;
          ended = true;
          for (const listener of [...listeners]) listener();
        };
        node.start(0, from);
        startedAt = audio.currentTime;
        offset = from;
        source = node;
      };
      start(0);
      return {
        setVolume(value) {
          gain.gain.value = value;
        },
        pause() {
          if (paused || ended || !source) return;
          offset = (offset + (audio.currentTime - startedAt)) % buffer.duration;
          paused = true;
          try {
            source.stop();
          } catch {
            // The source may already have ended.
          }
          source.disconnect();
        },
        resume() {
          if (!paused || ended) return;
          paused = false;
          start(offset);
        },
        stop() {
          if (ended) return;
          ended = true;
          try {
            source?.stop();
          } catch {
            // Already stopped.
          }
          source?.disconnect();
          gain.disconnect();
          for (const listener of [...listeners]) listener();
        },
        get ended() {
          return ended;
        },
        onEnded(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    },
    suspend() {
      void context?.suspend();
      if (state === 'ready') state = 'suspended';
    },
    resume() {
      void context?.resume();
      if (state === 'suspended') state = 'ready';
    },
    dispose() {
      state = 'disposed';
      void context?.close();
      context = undefined;
    },
  };
}
