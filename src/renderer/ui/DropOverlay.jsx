// Screenshot import by drop and paste (docs/arsenal-spec.md 7.1): a full-window overlay while an image file is
// dragged over the window, and Ctrl+V of an image inside a text field (outside text fields the shortcut reads the
// clipboard through the main process). Our own mod and arcane drags are ignored.
import { useEffect, useRef, useState } from 'react';
import { Body1, Subtitle1, makeStyles, tokens } from '@fluentui/react-components';
import { ImageRegular, ProhibitedRegular } from '@fluentui/react-icons';
import { store } from '../controller.js';
import { importFromBlob } from '../ocr-import.js';

const useStyles = makeStyles({
  overlay: {
    position: 'fixed',
    inset: '8px',
    zIndex: 900,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingVerticalM,
    border: `3px dashed ${tokens.colorBrandStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorNeutralBackgroundAlpha2,
    backdropFilter: 'blur(6px)',
    color: tokens.colorNeutralForeground1,
    pointerEvents: 'none',
  },
  refused: { borderColor: tokens.colorStatusDangerBorder1 },
  icon: { fontSize: '48px' },
});

const isFileDrag = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
const imageItem = e => [...(e.dataTransfer?.items ?? [])].some(i => i.kind === 'file' && /^image\//.test(i.type));

function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type);
}

export function DropOverlay() {
  const styles = useStyles();
  const [state, setState] = useState(null); // null | 'image' | 'other'
  const depth = useRef(0);
  useEffect(() => {
    const ready = () => store.get().phase === 'ready' && !store.get().dialog;
    const enter = e => {
      if (!isFileDrag(e) || !ready()) return;
      depth.current++;
      setState(imageItem(e) ? 'image' : 'other');
    };
    const over = e => {
      if (!isFileDrag(e) || !ready()) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = imageItem(e) ? 'copy' : 'none';
    };
    const leave = e => {
      if (!isFileDrag(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setState(null);
    };
    const drop = e => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth.current = 0;
      setState(null);
      if (!ready()) return;
      const file = [...(e.dataTransfer.files ?? [])].find(f => /^image\//.test(f.type)) ?? null;
      if (file) importFromBlob(file, 'drop');
    };
    const paste = e => {
      if (!ready() || !isTextField(document.activeElement)) return;
      const items = [...(e.clipboardData?.items ?? [])];
      const image = items.find(i => i.kind === 'file' && /^image\//.test(i.type));
      const hasText = items.some(i => i.kind === 'string' && i.type === 'text/plain');
      // In a text field a paste with text stays a normal paste.
      if (!image || hasText) return;
      e.preventDefault();
      const file = image.getAsFile();
      if (file) importFromBlob(file, 'paste');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
    };
  }, []);
  if (!state) return null;
  return (
    <div className={state === 'image' ? styles.overlay : `${styles.overlay} ${styles.refused}`} role="status">
      {state === 'image' ? <ImageRegular className={styles.icon} aria-hidden="true" /> : <ProhibitedRegular className={styles.icon} aria-hidden="true" />}
      <Subtitle1>{state === 'image' ? 'Drop a screenshot to import a build' : 'Only images can be imported'}</Subtitle1>
      {state === 'image' ? <Body1>It is read on this PC; nothing is uploaded.</Body1> : null}
    </div>
  );
}
