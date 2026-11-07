export interface LevelDefinition {
  readonly id: string;
  readonly title: string;
  readonly duration: number;
  readonly coinCount: number;
  readonly seed: number;
}

export const LEVELS: readonly LevelDefinition[] = Object.freeze([
  Object.freeze({ id: 'one', title: '第一关 · 河岸', duration: 30, coinCount: 5, seed: 1 }),
  Object.freeze({ id: 'two', title: '第二关 · 石桥', duration: 45, coinCount: 7, seed: 2 }),
  Object.freeze({ id: 'three', title: '第三关 · 镜湖', duration: 60, coinCount: 9, seed: 3 }),
]);

export function findLevel(id: string): LevelDefinition | undefined {
  return LEVELS.find((level) => level.id === id);
}
