import { bootstrapGame } from '@xiaobaibaifqy/jingchuanchu-app';
import { GameApp } from '../ui/components/GameApp/GameApp.js';
import { gameDefinition } from './game.js';

export async function startApplication(): Promise<void> {
  await bootstrapGame(GameApp, gameDefinition);
}
