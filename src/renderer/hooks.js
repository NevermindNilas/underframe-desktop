// React glue: read the controller's store, window and element sizes, media queries.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store, derived } from './controller.js';

/** Subscribe to a slice of app state. The selector must return state values (stable references). */
export function useApp(selector) {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

/** Derived values for the current build (stats, enemy, partial-simulation map, sim key). */
export function useDerived() {
  useApp(s => s.build);
  useApp(s => s.ctx);
  return derived();
}

function subscribeResize(fn) {
  window.addEventListener('resize', fn);
  return () => window.removeEventListener('resize', fn);
}

export function useWindowSize() {
  const width = useSyncExternalStore(subscribeResize, () => window.innerWidth);
  const height = useSyncExternalStore(subscribeResize, () => window.innerHeight);
  return { width, height };
}

export function useMediaQuery(query) {
  const subscribe = fn => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', fn);
    return () => mql.removeEventListener('change', fn);
  };
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/**
 * Width of an element, tracked with a ResizeObserver (container-query style layout). Returns a callback
 * ref, so it also follows an element that mounts later (inside a drawer that opens).
 */
export function useElementWidth() {
  const [width, setWidth] = useState(0);
  const observer = useRef(null);
  const ref = useCallback(el => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    observer.current = new ResizeObserver(entries => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width));
    });
    observer.current.observe(el);
  }, []);
  return [ref, width];
}

/** True once `active` has stayed true for `ms` (so fast work never flashes an indicator). */
export function useDelayedFlag(active, ms) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return undefined;
    }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return active && shown;
}

/** Whether the window has focus (title text dims while it does not, as in Windows apps). */
export function useWindowFocused() {
  const subscribe = fn => {
    window.addEventListener('focus', fn);
    window.addEventListener('blur', fn);
    return () => {
      window.removeEventListener('focus', fn);
      window.removeEventListener('blur', fn);
    };
  };
  return useSyncExternalStore(subscribe, () => document.hasFocus());
}

/**
 * Window layout class from the UX spec 2.2, by width in CSS px. Below 1100 (only reachable by zooming in,
 * e.g. 200% on a 1920x1080 window: WCAG 1.4.4 / 1.4.10) the columns stack in one scroll area: the result
 * card first, then the editor, then the result tabs, so nothing is pushed off-screen.
 * `compactHeight` (under 800 px): the compare drawer sits under the editor only, so it never squeezes
 * the results column.
 */
export function layoutFor(width, height = 900) {
  const compactHeight = height < 800;
  if (width >= 1680) return { library: 'inline', libraryWidth: 300, resultsWidth: 440, gutter: 24, stacked: false, compactHeight };
  if (width >= 1280) return { library: 'inline', libraryWidth: 264, resultsWidth: 380, gutter: 24, stacked: false, compactHeight };
  if (width >= 1100) return { library: 'overlay', libraryWidth: 300, resultsWidth: 360, gutter: 16, stacked: false, compactHeight };
  return { library: 'overlay', libraryWidth: Math.min(300, Math.max(240, width - 48)), resultsWidth: null, gutter: 12, stacked: true, compactHeight };
}
