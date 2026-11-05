import type { ReactNode } from 'react';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function NumberInput({ value, onChange, step = 1, min, max, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <span className="num-input">
      <input
        type="number"
        value={Number.isFinite(value) ? +value.toFixed(4) : ''}
        step={step}
        min={min}
        max={max}
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
