// Left column: the user's saved builds and Underframe's featured builds.
import { h, render, arrowNav } from './dom.js';
import { fmtCompact, fmtDate } from '../format.js';

const TABS = [['mine', 'My builds'], ['featured', 'Featured']];

export function mountSidebar(root, app) {
  const { actions } = app;
  const tabButtons = {};
  const panels = {};

  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Build lists' });
  for (const [key, label] of TABS) {
    tabButtons[key] = h('button', {
      class: 'tab', type: 'button', role: 'tab', id: `tab-${key}`, 'aria-controls': `tabpanel-${key}`,
      onClick: () => actions.setSidebarTab(key),
    }, label);
    tablist.append(tabButtons[key]);
  }
  tablist.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const keys = TABS.map(t => t[0]);
    const i = keys.indexOf(app.store.get().sidebarTab);
    const next = keys[(i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
    actions.setSidebarTab(next);
    tabButtons[next].focus();
  });

  // My builds
  const mineList = h('ul', { class: 'build-list', 'aria-label': 'Saved builds' });
  arrowNav(mineList, '.build-open');
  panels.mine = h('div', { class: 'tabpanel', role: 'tabpanel', id: 'tabpanel-mine', 'aria-labelledby': 'tab-mine' },
    h('button', { class: 'btn primary block', type: 'button', onClick: () => actions.newBuild(), title: 'New build (Ctrl+N)' }, '+ New build'),
    mineList);

  // Featured
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search featured builds', 'aria-label': 'Search featured builds' });
  let typeFilter = 'All';
  const typeSeg = h('div', { class: 'seg small', role: 'radiogroup', 'aria-label': 'Weapon type' });
  const typeButtons = ['All', 'Primary', 'Secondary'].map(t => {
    const b = h('button', { type: 'button', role: 'radio', class: 'seg-btn', onClick: () => { typeFilter = t; renderFeatured(); } }, t);
    typeSeg.append(b);
    return [t, b];
  });
  const featuredList = h('ul', { class: 'build-list', 'aria-label': 'Featured builds' });
  arrowNav(featuredList, '.build-open');
  search.addEventListener('input', () => renderFeatured());
  panels.featured = h('div', { class: 'tabpanel', role: 'tabpanel', id: 'tabpanel-featured', 'aria-labelledby': 'tab-featured' },
    h('p', { class: 'hint' }, 'Community builds curated on Underframe. Opening one makes an unsaved copy you can change.'),
    search, typeSeg, featuredList);

  render(root, tablist, panels.mine, panels.featured);

  function renderFeatured() {
    const { ctx } = app.store.get();
    for (const [t, b] of typeButtons) b.setAttribute('aria-checked', String(t === typeFilter));
    const q = search.value.trim().toLowerCase();
    const items = ctx.featured.filter(f =>
      (typeFilter === 'All' || f.weaponType === typeFilter) &&
      (!q || f.name.toLowerCase().includes(q) || f.weaponName.toLowerCase().includes(q) || f.tags.some(t => t.toLowerCase().includes(q))));
    render(featuredList, items.length ? items.map(f => h('li', { class: 'build-item' },
      h('button', { class: 'build-open', type: 'button', title: f.name, onClick: () => actions.openFeatured(f.key) },
        h('span', { class: 'build-name' }, f.name),
        h('span', { class: 'build-meta' }, `${f.weaponName} · ${f.weaponType}`),
        f.tags.length ? h('span', { class: 'chips' }, f.tags.map(t => h('span', { class: 'chip' }, t))) : null)))
      : h('li', { class: 'empty' }, q ? 'No featured builds match your search.' : 'No featured gun builds in this data snapshot.'));
  }

  function renderMine(state) {
    const focusKey = mineList.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const builds = [...state.savedBuilds].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    const currentId = state.build?.id;
    render(mineList, builds.length ? builds.map(b => h('li', { class: `build-item${b.id === currentId ? ' current' : ''}` },
      h('button', {
        class: 'build-open', type: 'button', 'aria-current': b.id === currentId ? 'true' : null, dataset: { focus: `open-${b.id}` },
        onClick: () => actions.openBuild(b.id), title: b.updatedAt ? `Saved ${fmtDate(b.updatedAt)}` : null,
      },
        h('span', { class: 'build-name' }, b.name || 'Untitled build'),
        h('span', { class: 'build-meta' }, b.weaponName, b.lastResult?.avgDps ? ` · ${fmtCompact(b.lastResult.avgDps)} DPS` : '')),
      h('span', { class: 'build-actions' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Rename ${b.name}`, title: 'Rename', dataset: { focus: `ren-${b.id}` }, onClick: () => actions.renameSaved(b.id) }, '✎'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Duplicate ${b.name}`, title: 'Duplicate', dataset: { focus: `dup-${b.id}` }, onClick: () => actions.duplicateSaved(b.id) }, '⧉'),
        h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': `Delete ${b.name}`, title: 'Delete', dataset: { focus: `del-${b.id}` }, onClick: () => actions.deleteSaved(b.id) }, '✕'))))
      : h('li', { class: 'empty' },
        h('p', null, 'No saved builds yet.'),
        h('p', { class: 'hint' }, 'Pick a weapon and mods, then press Save (Ctrl+S). Or start from a Featured build.')));
    if (focusKey) mineList.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
  }

  function renderTabs(tab) {
    for (const [key] of TABS) {
      const on = key === tab;
      tabButtons[key].setAttribute('aria-selected', String(on));
      tabButtons[key].tabIndex = on ? 0 : -1;
      panels[key].hidden = !on;
    }
  }

  renderFeatured();
  return (state, prev) => {
    if (state.sidebarTab !== prev?.sidebarTab) renderTabs(state.sidebarTab);
    if (state.savedBuilds !== prev?.savedBuilds || state.build?.id !== prev?.build?.id) renderMine(state);
  };
}
