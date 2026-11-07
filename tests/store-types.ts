import { computed, defineStore } from '@xiaobaibaifqy/jingchuanchu-app/application';
import type { ReadonlyData, StoreInstanceOf } from '@xiaobaibaifqy/jingchuanchu-app/application';

const CounterStore = defineStore({
  name: 'counter',
  setup(context) {
    const count = context.signal(0);
    return {
      state: { count },
      getters: { doubled: computed(() => count() * 2) },
      actions: {
        add(amount: number) {
          count.update((value) => value + amount);
          return count();
        },
      },
    };
  },
});

const store = {} as StoreInstanceOf<typeof CounterStore>;
const count: ReadonlyData<number> = store.state.count();
const doubled: ReadonlyData<number> = store.getters.doubled();
const added: number = store.actions.add(1);
void count;
void doubled;
void added;

// @ts-expect-error State signals are read-only.
store.state.count.set(1);
// @ts-expect-error State members cannot be replaced.
store.state.count = () => 1;
// @ts-expect-error Action payloads keep their types.
store.actions.add('wrong');
// @ts-expect-error Unknown actions are rejected.
store.actions.missing();
// @ts-expect-error Unknown state fields are rejected.
store.state.missing();
// @ts-expect-error Instance-level state mutation is rejected.
store.state.count.update((value) => value + 1);
