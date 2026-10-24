// Screen-reader announcement of a finished result: once per completed result, after 1 s without edits.
import { useEffect, useRef } from 'react';
import { useAnnounce } from '@fluentui/react-components';
import { store } from '../controller.js';
import { useApp } from '../hooks.js';
import { resultDelta } from '../model.js';
import { fmtInt, fmtNum } from '../format.js';

export function announcementFor(summary, previous) {
  const delta = resultDelta(summary.avgDps, previous?.avgDps);
  const change = delta == null ? '' : `, ${delta > 0 ? 'up' : 'down'} ${fmtNum(Math.abs(delta) * 100, 1)} percent`;
  return `Average DPS ${fmtInt(summary.avgDps)}${change}`;
}

export function Announcer() {
  const { announce } = useAnnounce();
  const seq = useApp(s => s.sim.seq);
  const lastEdit = useRef(0);
  const announced = useRef(0);
  useEffect(() => store.subscribe((s, prev) => {
    if (s.build !== prev.build) lastEdit.current = performance.now();
  }), []);
  useEffect(() => {
    if (!seq || seq === announced.current) return undefined;
    const wait = Math.max(0, 1000 - (performance.now() - lastEdit.current));
    const t = setTimeout(() => {
      const { sim } = store.get();
      if (sim.seq !== seq || !sim.summary?.ok) return;
      announced.current = seq;
      announce(announcementFor(sim.summary, sim.prev), { polite: true });
    }, wait);
    return () => clearTimeout(t);
  }, [seq, announce]);
  return null;
}
