import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * Numeric input. By default every keystroke that parses is committed. With `commitOnBlur`, the value
 * is committed (clamped to min/max) only on blur or Enter — for fields where intermediate values do
 * damage or expensive work (bed size, latitude: typing "12" must not pass through "1").
 */
export function NumberInput({ value, onChange, step = 1, min, max, suffix, commitOnBlur, label }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; commitOnBlur?: boolean; label?: string;
}) {
  const shown = Number.isFinite(value) ? String(+value.toFixed(4)) : '';
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const commit = () => {
    const v = parseFloat(text);
    if (!Number.isFinite(v)) return setText(shown);
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (c !== value) onChange(c);
    setText(String(+c.toFixed(4)));
  };
  if (commitOnBlur)
    return (
      <span className="num-input">
        <input
          type="number" inputMode="decimal" value={text} step={step} min={min} max={max} aria-label={label}
          onFocus={() => (focused.current = true)}
          onBlur={() => { focused.current = false; commit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onChange={(e) => setText(e.target.value)}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </span>
    );
  return (
    <span className="num-input">
      <input
        type="number"
        value={shown}
        step={step}
        min={min}
        max={max}
        aria-label={label}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

export function Status({ tone, children }: { tone: 'good' | 'warning' | 'serious' | 'critical' | 'info'; children: ReactNode }) {
  const icon = { good: '✓', warning: '!', serious: '!', critical: '✕', info: 'i' }[tone];
  return (
    <span className={`status status-${tone}`}>
      <span className="status-icon" aria-hidden="true">{icon}</span>
      {children}
    </span>
  );
}
