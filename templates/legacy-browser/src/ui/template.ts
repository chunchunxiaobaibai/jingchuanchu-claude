/** Only call with a static component HTML import. Runtime text belongs in textContent. */
export function createTemplate(html: string, rootClass: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error('Component template needs an HTML root');
  root.classList.add(rootClass);
  return root;
}
export function element<T extends Element>(
  root: HTMLElement,
  selector: string,
  type: { new (...args: never[]): T },
): T {
  const found = root.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing component element: ${selector}`);
  return found;
}
