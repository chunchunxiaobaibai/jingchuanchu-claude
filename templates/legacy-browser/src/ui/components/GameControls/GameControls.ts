import { defineView } from '@xiaobaibaifqy/jingchuanchu-app';
import type { AppState, AppCommands } from '../../../contracts/application.js';

export const GameControls = defineView<AppState, AppCommands>({
  selector: 'game-controls',
  text: {
    pause: (context) => (context.state.status === 'paused' ? '继续' : '暂停'),
    status: (context) =>
      context.state.error ??
      { running: '运行中', paused: '已暂停', stopped: '已停止', disposed: '已结束' }[
        context.state.status
      ],
  },
  attributes: { disabled: (context) => !['running', 'paused'].includes(context.state.status) },
  actions: { pause: (context) => context.commands.send('togglePause', undefined) },
});
