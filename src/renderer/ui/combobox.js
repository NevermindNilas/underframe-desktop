// Searchable, grouped single-select combobox (ARIA 1.2 combobox + listbox pattern).
import { h, nextId, syncValue } from './dom.js';

/**
 * @param {object} o
 * @param {string} o.label                visible label
 * @param {(query: string) => Array<{label: string, items: Array<{value: string, label: string, hint?: string}>}>} o.groups
 * @param {(value: string) => void} o.onPick
 * @param {string} [o.placeholder]
 * @returns {{ el: HTMLElement, setValue(label: string): void, input: HTMLInputElement }}
 */
export function createCombobox({ label, groups, onPick, placeholder = '' }) {
  const id = nextId('combo');
  const input = h('input', {
    id: `${id}-input`, class: 'input combo-input', type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
    'aria-expanded': 'false', 'aria-controls': `${id}-list`, 'aria-autocomplete': 'list', placeholder,
  });
  const list = h('ul', { id: `${id}-list`, class: 'combo-list', role: 'listbox', 'aria-label': label });
  const pop = h('div', { class: 'combo-pop', hidden: true }, list);
  const el = h('div', { class: 'field combo' },
    h('label', { class: 'field-label', for: input.id }, label),
    h('div', { class: 'combo-wrap' }, input, h('span', { class: 'combo-caret', 'aria-hidden': 'true' }, '▾'), pop));

  let current = '';
  let options = [];
  let active = -1;

  function setActive(i) {
    options[active]?.classList.remove('active');
    active = i;
    const opt = options[active];
    if (opt) {
      opt.classList.add('active');
      input.setAttribute('aria-activedescendant', opt.id);
      opt.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function fill(query) {
    list.replaceChildren();
    options = [];
    let n = 0;
    for (const g of groups(query)) {
      if (!g.items.length) continue;
      const gid = `${id}-g${n++}`;
      const ul = h('ul', { role: 'group', 'aria-labelledby': gid, class: 'combo-group' });
      for (const item of g.items) {
        const opt = h('li', {
          id: `${id}-o${options.length}`, role: 'option', class: 'combo-option', 'aria-selected': String(item.label === current),
          dataset: { value: item.value },
        }, h('span', { class: 'combo-option-label' }, item.label), item.hint ? h('span', { class: 'combo-option-hint' }, item.hint) : null);
        opt.addEventListener('mousedown', e => e.preventDefault());
        opt.addEventListener('click', () => pick(opt));
        options.push(opt);
        ul.append(opt);
      }
      list.append(h('li', { role: 'presentation' }, h('div', { id: gid, class: 'combo-group-label' }, g.label), ul));
    }
    if (!options.length) list.append(h('li', { role: 'presentation', class: 'combo-empty' }, 'No matches'));
    const q = query.trim().toLowerCase();
    const labelOf = o => o.querySelector('.combo-option-label').textContent.toLowerCase();
    let best = q ? options.findIndex(o => labelOf(o) === q) : -1;
    if (best < 0 && q) best = options.findIndex(o => labelOf(o).startsWith(q));
    if (best < 0) best = options.findIndex(o => o.getAttribute('aria-selected') === 'true');
    setActive(best >= 0 ? best : options.length ? 0 : -1);
  }

  function open(query = '') {
    fill(query);
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close(restore = true) {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (restore) input.value = current;
  }

  function pick(opt) {
    if (!opt) return;
    current = opt.querySelector('.combo-option-label').textContent;
    close(true);
    onPick(opt.dataset.value);
  }

  input.addEventListener('focus', () => input.select());
  input.addEventListener('click', () => { if (pop.hidden) open(''); });
  input.addEventListener('input', () => open(input.value));
  input.addEventListener('blur', () => close(true));
  input.addEventListener('keydown', e => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (pop.hidden) open('');
        else setActive(Math.min(options.length - 1, active + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!pop.hidden) setActive(Math.max(0, active - 1));
        break;
      case 'PageDown':
        if (!pop.hidden) { e.preventDefault(); setActive(Math.min(options.length - 1, active + 10)); }
        break;
      case 'PageUp':
        if (!pop.hidden) { e.preventDefault(); setActive(Math.max(0, active - 10)); }
        break;
      case 'Enter':
        if (!pop.hidden) { e.preventDefault(); pick(options[active]); }
        break;
      case 'Escape':
        if (!pop.hidden) { e.preventDefault(); e.stopPropagation(); close(true); }
        break;
      case 'Tab':
        close(true);
        break;
    }
  });

  return {
    el,
    input,
    setValue(labelText) {
      current = labelText ?? '';
      if (pop.hidden) syncValue(input, current);
    },
  };
}
