import type { ReadonlyData } from '../state.js';
import { markReadSignal, type WritableSignal } from './reactivity.js';

export interface ModelAdapter<T> extends WritableSignal<T> {}

export function writableModel<T>(options: {
  get: () => ReadonlyData<T>;
  set: (value: T) => void;
}): ModelAdapter<T> {
  const read = markReadSignal(() => options.get());
  return Object.assign(read, {
    set: options.set,
    update(reduce: (previous: ReadonlyData<T>) => T) {
      options.set(reduce(options.get()));
    },
  });
}
