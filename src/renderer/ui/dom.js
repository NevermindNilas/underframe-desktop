// Tiny DOM helpers. No templating, no innerHTML with data.

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'indeterminate', 'open']);

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

/** h('button', {class: 'x', onClick}, 'Label') */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v != null && v !== false) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

/** Replace all children of `el`. */
export function render(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

/** Set an input's value unless the user is typing in it. */
export function syncValue(input, value) {
  const v = value == null ? '' : String(value);
  if (document.activeElement !== input && input.value !== v) input.value = v;
}

let uid = 0;
export const nextId = prefix => `${prefix}-${++uid}`;

/** Move focus between `selector` items inside `root` with ArrowUp/ArrowDown/Home/End. */
export function arrowNav(root, selector) {
  root.addEventListener('keydown', e => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...root.querySelectorAll(selector)].filter(x => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    if (i < 0 && !root.contains(document.activeElement)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[next].focus();
  });
}
