import { ArrowDownRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react';
import { percent } from './chart-model';
export function MetricDelta({ value, suffix }: { value: number; suffix: string }) {
  const up = value >= 0;
  return (
    <span className={`ag-delta ${up ? 'is-up' : 'is-down'}`}>
      <span className="ag-delta-badge">
        {up ? (
          <ArrowUpRightIcon size={12} weight="bold" />
        ) : (
          <ArrowDownRightIcon size={12} weight="bold" />
        )}
        {percent(Math.abs(value))}
      </span>
      <span className="ag-delta-suffix">{suffix}</span>
    </span>
  );
}
