import type { CSSProperties } from 'react';
import './parameter-range.css';

const budgetWarningStart = 0.8;

export function ParameterRange({
  label,
  value,
  min = 0,
  max,
  step = 1,
  disabled = false,
  volumeBudget,
  format = (value) => value.toLocaleString('ru'),
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
  volumeBudget?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const share = (Math.min(max, Math.max(min, value)) - min) / (max - min);
  const budgetShare =
    volumeBudget === undefined
      ? 0
      : volumeBudget > 0
        ? Math.min(1, Math.max(0, value) / volumeBudget)
        : value > 0
          ? 1
          : 0;
  const warning = disabled
    ? 0
    : Math.max(0, (budgetShare - budgetWarningStart) / (1 - budgetWarningStart)) * 100;
  return (
    <label
      className="source-range"
      data-disabled={disabled}
      style={{ '--range-warning': `${warning}%` } as CSSProperties}
    >
      <span className="source-range-heading">
        <span>{label}</span>
        <output>{format(value)}</output>
      </span>
      <span className="source-range-rail">
        <span className="source-range-ticks" aria-hidden="true">
          {Array.from({ length: 36 }, (_, index) => (
            <i
              key={index}
              data-on={share > 0 && index / 35 <= share}
              data-major={index % 5 === 0}
            />
          ))}
        </span>
        <input
          className="source-range-input"
          type="range"
          aria-label={label}
          aria-valuetext={format(value)}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
      <span className="source-range-ends" aria-hidden="true">
        <span>{min.toLocaleString('ru')}</span>
        <span>{max.toLocaleString('ru')}</span>
      </span>
    </label>
  );
}
