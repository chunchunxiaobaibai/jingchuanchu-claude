import { defineComponent, input, output } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { IconButton } from '../../../components/icon-button/icon-button.js';

export const PlayHud = defineComponent({
  selector: 'play-hud',
  components: [IconButton],
  inputs: {
    score: input<number>({ default: 0 }),
    time: input<number>({ default: 0 }),
    paused: input<boolean>({ default: false }),
    started: input<boolean>({ default: false }),
    pauseUrl: input<string>({ default: '' }),
  },
  outputs: {
    pause: output<undefined>(),
    restart: output<undefined>(),
  },
  setup(context) {
    return {
      score: context.inputs.score,
      time: context.inputs.time,
      paused: context.inputs.paused,
      started: context.inputs.started,
      pauseUrl: context.inputs.pauseUrl,
      togglePause: () => context.emit('pause'),
      restart: () => context.emit('restart'),
    };
  },
});
