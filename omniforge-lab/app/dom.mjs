// Tiny DOM helpers shared by every page module. No app state, no imports: safe for any module to depend on.
export const $ = selector => document.querySelector(selector);

export const asArray = value => (Array.isArray(value) ? value : []);

export const make = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = String(content);
  return node;
};

export const one = (parent, tag, className, content) => {
  const node = make(tag, className, content);
  parent.append(node);
  return node;
};

export function fillSelect(select, options, selected, placeholder) {
  select.replaceChildren();
  if (placeholder) { const option = make('option', '', placeholder); option.value = ''; select.append(option); }
  for (const { value, label } of options) { const option = make('option', '', label); option.value = value; select.append(option); }
  select.value = selected || '';
}

// Call before a container is rebuilt; the returned function refocuses the rebuilt
// control with the same data-focus-key.
export const keepFocus = container => {
  const key = container.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  return () => {
    if (key) [...container.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === key)?.focus();
  };
};
