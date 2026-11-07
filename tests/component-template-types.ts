import type {
  TemplateAttributeBinding,
  TemplateBinding,
  TemplateEventBinding,
  TemplateTextBinding,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

const text: TemplateTextBinding = {
  kind: 'text',
  id: 0,
  textIndex: 0,
  read: (scope) => String(scope.label ?? ''),
};
const attribute: TemplateAttributeBinding = {
  kind: 'attribute',
  id: 1,
  name: 'disabled',
  read: (scope) => Boolean(scope.disabled),
};
const event: TemplateEventBinding = {
  kind: 'event',
  id: 2,
  name: 'click',
  run(scope, value) {
    const handler = scope.save;
    if (typeof handler === 'function') (handler as (event: Event) => void)(value);
  },
};
const bindings: readonly TemplateBinding[] = [text, attribute, event];
void bindings;

// @ts-expect-error Text bindings must read a value.
const missingRead: TemplateBinding = { kind: 'text', id: 0, textIndex: 0 };
// @ts-expect-error Attribute bindings require a name.
const missingName: TemplateBinding = { kind: 'attribute', id: 1, read: () => '' };
// @ts-expect-error Unknown binding kinds are rejected.
const unknownKind: TemplateBinding = { kind: 'other', id: 0 };
void missingRead;
void missingName;
void unknownKind;
