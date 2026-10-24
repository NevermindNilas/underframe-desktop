// Notes: an auto-growing textarea that is part of the build (dirty tracking and undo, never re-simulates).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card, CardHeader, Field, Subtitle2, Textarea, makeStyles, tokens } from '@fluentui/react-components';
import { actions, store } from '../controller.js';
import { useApp } from '../hooks.js';

const MAX_NOTES = 10_000;
const COUNTER_FROM = 9_000;

const useStyles = makeStyles({
  card: { gap: tokens.spacingVerticalM },
  textarea: { width: '100%', '& textarea': { maxHeight: '480px', minHeight: '96px' } },
  counter: { color: tokens.colorNeutralForeground2, fontVariantNumeric: 'tabular-nums' },
});

export function NotesCard({ bare = false }) {
  const styles = useStyles();
  const notes = useApp(s => s.build.notes ?? '');
  const epoch = useApp(s => s.editorEpoch);
  const [value, setValue] = useState(notes);
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  // Focused, the field keeps its own text; another build opening replaces it at once (see NameInput).
  useEffect(() => { if (!focused) setValue(notes); }, [notes, focused]);
  useEffect(() => { setValue(store.get().build?.notes ?? ''); }, [epoch]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(480, Math.max(96, el.scrollHeight + 2))}px`;
  }, [value]);
  return (
    <Card appearance={bare ? 'subtle' : 'filled'} className={styles.card} style={bare ? { padding: 0, backgroundColor: 'transparent' } : undefined}>
      <CardHeader header={<Subtitle2 as="h2" id="notes-heading">Notes</Subtitle2>} />

      <Field
        hint={value.length >= COUNTER_FROM ? <span className={styles.counter}>{value.length.toLocaleString()} of {MAX_NOTES.toLocaleString()} characters</span> : undefined}
      >
        <Textarea
          ref={ref}
          aria-labelledby="notes-heading"
          className={styles.textarea}
          resize="vertical"
          maxLength={MAX_NOTES}
          value={value}
          placeholder="Add notes about this build, like the rotation or which enemies it's for."
          onFocus={() => setFocused(true)}
          onChange={(_e, d) => {
            setValue(d.value);
            actions.setNotes(d.value);
          }}
          onBlur={() => {
            setFocused(false);
            actions.endTextEdit();
          }}
        />
      </Field>
    </Card>
  );
}

