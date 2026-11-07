import { defineComponent, input, output } from '@xiaobaibaifqy/jingchuanchu-app/application';

export const IconButton = defineComponent({
  selector: 'icon-button',
  inputs: { label: input<string>({ default: '按钮' }) },
  outputs: { press: output<undefined>() },
  setup(context) {
    return {
      label: context.inputs.label,
      press: () => context.emit('press'),
    };
  },
});
