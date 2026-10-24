// React glue: read the controller's store, window and element sizes, media queries, the layout class and the
// gallery's grid window (virtualisation).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
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

export { CARD_RATIO, layoutFor, slotSizeFor, gridWindow } from './layout.js';

/** Width and height of an element (ResizeObserver), as a callback ref. */
export function useElementSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef(null);
  const ref = useCallback(el => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const read = () => setSize(s => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
    read();
    observer.current = new ResizeObserver(read);
    observer.current.observe(el);
  }, []);
  return [ref, size];
}

/** Follow a scroll element's scroll position and height (for gridWindow). */
export function useScrollState(el) {
  const [state, setState] = useState({ scrollTop: 0, viewport: 0 });
  useLayoutEffect(() => {
    if (!el) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      setState(s => (s.scrollTop === el.scrollTop && s.viewport === el.clientHeight ? s : { scrollTop: el.scrollTop, viewport: el.clientHeight }));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [el]);
  return state;
}

/** Height of an element (ResizeObserver), as a callback ref like useElementWidth. */
export function useElementHeight() {
  const [height, setHeight] = useState(0);
  const observer = useRef(null);
  const ref = useCallback(el => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setHeight(el.offsetHeight);
    observer.current = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.current.observe(el);
  }, []);
  return [ref, height];
}

/** Calls fn after `ms` without a new `value` (debounced effect). */
export function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

