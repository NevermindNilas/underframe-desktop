// Footer: credits, data/app versions, upstream data notice, external links.
import { h, render } from './dom.js';
import { fmtDate } from '../format.js';

export const LINKS = {
  underframe: 'https://www.underframe.site',
  discord: 'https://discord.gg/SNFv5KFQgR',
};

export function mountFooter(root, app) {
  const link = (label, url) => h('a', {
    href: url, class: 'ext-link',
    onClick: e => { e.preventDefault(); app.actions.openExternal(url); },
  }, label);

  return (state, prev) => {
    if (state.manifest === prev?.manifest && state.appInfo === prev?.appInfo && state.upstream === prev?.upstream) return;
    const m = state.manifest;
    const info = state.appInfo;
    const up = state.upstream;
    render(root,
      h('p', { class: 'credit' },
        'Damage engine and game data by ', link('Underframe (underframe.site)', LINKS.underframe),
        ', used with permission. Not affiliated with Digital Extremes.'),
      h('p', { class: 'versions' },
        m ? h('span', { title: m.fetchedAt ? `Fetched ${fmtDate(m.fetchedAt)}` : null }, `Data ${m.dataVersion ?? '?'}${m.fetchedAt ? ` · ${fmtDate(m.fetchedAt)}` : ''}`) : null,
        info ? h('span', null, `App ${info.version}`) : null,
        link('Discord', LINKS.discord),
        up?.outdated ? h('span', { class: 'outdated', role: 'status' }, 'Newer Underframe data is available; update the app to get it.') : null));
  };
}
