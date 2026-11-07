import { computed, defineStore } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { LEVELS } from './levels.js';

export interface StoredProgress {
  readonly nickname: string;
  readonly highScore: number;
  readonly unlocked: readonly string[];
  readonly completed: readonly string[];
}

export const GameStore = defineStore({
  name: 'game-session',
  setup(context) {
    const nickname = context.signal('旅人');
    const highScore = context.signal(0);
    const unlocked = context.signal<readonly string[]>([LEVELS[0]!.id]);
    const completed = context.signal<readonly string[]>([]);
    const lastScore = context.signal(0);
    const lastLevel = context.signal(LEVELS[0]!.id);
    const best = computed(() => highScore());
    return {
      state: { nickname, highScore, unlocked, completed, lastScore, lastLevel },
      getters: { best },
      actions: {
        setNickname(next: string) {
          nickname.set(next.trim().slice(0, 12) || '旅人');
        },
        recordResult(levelId: string, score: number) {
          lastScore.set(score);
          lastLevel.set(levelId);
          highScore.update((previous) => Math.max(previous, score));
          completed.update((list) => (list.includes(levelId) ? list : [...list, levelId]));
          const index = LEVELS.findIndex((level) => level.id === levelId);
          const next = index >= 0 ? LEVELS[index + 1] : undefined;
          if (next) unlocked.update((list) => (list.includes(next.id) ? list : [...list, next.id]));
        },
        hydrate(progress: StoredProgress) {
          nickname.set(progress.nickname);
          highScore.set(progress.highScore);
          unlocked.set([...progress.unlocked]);
          completed.set([...progress.completed]);
        },
        resetProgress() {
          highScore.set(0);
          unlocked.set([LEVELS[0]!.id]);
          completed.set([]);
          lastScore.set(0);
          lastLevel.set(LEVELS[0]!.id);
        },
      },
    };
  },
});
