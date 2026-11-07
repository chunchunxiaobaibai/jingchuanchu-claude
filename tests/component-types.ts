import {
  defineComponent,
  input,
  model,
  output,
  computed,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  ComponentContext,
  ComponentDefinition,
  InputDefinition,
  ModelDefinition,
  OutputDefinition,
  ReadSignal,
  WritableSignal,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

const NicknameEditor = defineComponent({
  selector: 'nickname-editor',
  inputs: { label: input<string>({ default: '昵称' }) },
  outputs: { save: output<string>() },
  models: { value: model<string>({ default: '' }) },
  setup(context) {
    const valid = computed(() => context.models.value().trim().length > 0);
    const label: string = context.inputs.label();
    const value: string = context.models.value();
    context.models.value.set('next');
    // @ts-expect-error Input signals are read-only.
    context.inputs.label.set('x');
    // @ts-expect-error Emit payload follows the declared output.
    context.emit('save', 1);
    // @ts-expect-error Unknown output names are rejected.
    context.emit('missing', 'x');
    return {
      label,
      value,
      valid,
      save: () => context.emit('save', value),
    };
  },
});

const inferredContext: ComponentContext<
  { label: InputDefinition<string> },
  { save: OutputDefinition<string> },
  { value: ModelDefinition<string> }
> = {} as Parameters<typeof NicknameEditor.setup>[0];
const inferredLabel: ReadSignal<string> = inferredContext.inputs.label;
const inferredValue: WritableSignal<string> = inferredContext.models.value;
void inferredLabel;
void inferredValue;

type NicknameMembers = ReturnType<typeof NicknameEditor.setup>;

const EditorSession: ComponentDefinition<
  { label: InputDefinition<string> },
  { save: OutputDefinition<string> },
  { value: ModelDefinition<string> },
  NicknameMembers
> = NicknameEditor;
void EditorSession;

const RequiredInput = defineComponent({
  selector: 'required-input',
  inputs: { count: input<number>({ required: true }) },
  setup(context) {
    const count: number = context.inputs.count();
    return { count };
  },
});
void RequiredInput;

const ObjectDefault = defineComponent({
  selector: 'object-default',
  inputs: { point: input<{ x: number }>({ default: () => ({ x: 0 }) }) },
  setup() {
    return {};
  },
});
void ObjectDefault;

// @ts-expect-error Object defaults must use a factory.
input<{ x: number }>({ default: { x: 1 } });
// @ts-expect-error A required input cannot also declare a default.
input<string>({ required: true, default: 'x' });

const EmptyComponent = defineComponent({
  selector: 'empty-component',
  setup: () => ({ ready: true }),
});
const emptyResult: { readonly ready: boolean } = { ready: true } as ReturnType<
  typeof EmptyComponent.setup
>;
void emptyResult;

const Closable = defineComponent({
  selector: 'closable-panel',
  outputs: { close: output<void>() },
  setup(context) {
    context.emit('close');
    return {};
  },
});
void Closable;

// @ts-expect-error Inputs and models cannot share a name.
defineComponent({
  selector: 'conflicting-names',
  inputs: { value: input<string>() },
  models: { value: model<string>() },
  setup() {
    return {};
  },
});

export { NicknameEditor, EditorSession };
