// Screen-reader announcements: a finished result once per completed result (after 1 s without edits), and the
// controller's polite messages (equip, remove, pick-up, OCR steps). Scene mode also shows the latest message on
// screen, so captures can show what was announced.
import { useEffect, useRef } from 'react';
import { Caption1, makeStyles, tokens, useAnnounce } from '@fluentui/react-components';
import { store } from '../controller.js';
import { useApp } from '../hooks.js';
import { resultDelta } from '../model.js';
import { fmtInt, fmtNum } from '../format.js';
import { uf } from '../platform.js';

const useStyles = makeStyles({
  debug: {
    position: 'fixed',
    left: '50%',
    bottom: '36px',
    transform: 'translateX(-50%)',
    zIndex: 1000,
    maxWidth: '70vw',
    padding: '6px 12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackgroundInverted,
    color: tokens.colorNeutralForegroundInverted,
    boxShadow: tokens.shadow16,
    pointerEvents: 'none',
  },
});

export function announcementFor(summary, previous) {
  const delta = resultDelta(summary.avgDps, previous?.avgDps);
  const change = delta == null ? '' : `, ${delta > 0 ? 'up' : 'down'} ${fmtNum(Math.abs(delta) * 100, 1)} percent`;
  return `Average DPS ${fmtInt(summary.avgDps)}${change}`;
}

export function Announcer() {
  const styles = useStyles();
  const { announce } = useAnnounce();
  const seq = useApp(s => s.sim.seq);
  const message = useApp(s => s.announcement);
  const showDebug = useApp(s => s.showAnnouncements);
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
  useEffect(() => {
    if (message?.text) announce(message.text, { polite: true });
  }, [message, announce]);
  return uf.scenes && showDebug && message?.text ? (
    <Caption1 className={styles.debug} aria-hidden="true" data-testid="announcement-debug">Announced: {message.text}</Caption1>
  ) : null;
}
