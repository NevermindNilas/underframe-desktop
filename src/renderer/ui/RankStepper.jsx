// Horizontal rank stepper: [−] R5/5 [+]. The value is the single Tab stop (role="spinbutton");
// the buttons are 28x28 mouse targets. Up/Right +1, Down/Left −1, Home 0, End max, PageUp/PageDown ±3.
import { Button, Caption1, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { AddRegular, SubtractRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  root: { display: 'inline-flex', alignItems: 'center', gap: '2px' },
  step: { minWidth: '28px', width: '28px', height: '28px', padding: 0 },
  value: {
    display: 'inline-flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: '2px',
    minWidth: '56px',
    height: '28px',
    lineHeight: '28px',
    paddingLeft: tokens.spacingHorizontalXS,
    paddingRight: tokens.spacingHorizontalXS,
    borderRadius: tokens.borderRadiusMedium,
    fontVariantNumeric: 'tabular-nums',
    cursor: 'default',
    userSelect: 'none',
    outline: 'none',
    ':focus-visible': {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '0px',
      boxShadow: `0 0 0 ${tokens.strokeWidthThin} ${tokens.colorStrokeFocus1} inset`,
    },
  },
  max: { color: tokens.colorNeutralForeground3 },
  of: { color: tokens.colorNeutralForeground3 },
});

const clamp = (v, max) => Math.min(max, Math.max(0, v));

export function RankStepper({ value, max, label, onChange, focusId, className, disabled = false }) {
  const styles = useStyles();
  const set = v => {
    const next = clamp(v, max);
    if (next !== value) onChange(next);
  };
  const onKeyDown = e => {
    const keys = {
      ArrowUp: value + 1, ArrowRight: value + 1, ArrowDown: value - 1, ArrowLeft: value - 1,
      Home: 0, End: max, PageUp: value + 3, PageDown: value - 3,
    };
    if (e.key in keys) {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) set(keys[e.key]);
    }
  };
  return (
    <span className={mergeClasses(styles.root, className)}>
      <Button
        className={styles.step}
        size="small"
        appearance="subtle"
        icon={<SubtractRegular />}
        tabIndex={-1}
        aria-label={`Lower ${label}`}
        disabled={disabled || value <= 0}
        onClick={() => set(value - 1)}
      />
      <span
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`rank ${value} of ${max}`}
        aria-disabled={disabled || undefined}
        className={styles.value}
        data-focus-id={focusId}
        onKeyDown={onKeyDown}
      >
        <Caption1>R{value}</Caption1>
        <Caption1 className={styles.of}>/{max}</Caption1>
        {value === max ? <Caption1 className={styles.max}>max</Caption1> : null}
      </span>
      <Button
        className={styles.step}
        size="small"
        appearance="subtle"
        icon={<AddRegular />}
        tabIndex={-1}
        aria-label={`Raise ${label}`}
        disabled={disabled || value >= max}
        onClick={() => set(value + 1)}
      />
    </span>
  );
}
