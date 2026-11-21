import { ArrowDownRightIcon, ArrowUpRightIcon } from '@phosphor-icons/react';
import { AnimatedNumber } from '../../shared/ui';
import { percent } from './chart-model';
const absolutePercent = (value: number) => percent(Math.abs(value));
export function MetricDelta({
  value,
  suffix,
  title,
}: {
  value: number;
  suffix: string;
  title?: string;
}) {
  const direction = value > 0 ? 'is-up' : value < 0 ? 'is-down' : '';
  return (
    <span className={`ag-delta ${direction}`} title={title}>
      <span className="ag-delta-badge">
        {value > 0 && <ArrowUpRightIcon size={12} weight="bold" />}
        {value < 0 && <ArrowDownRightIcon size={12} weight="bold" />}
        <AnimatedNumber
          value={value}
          format={absolutePercent}
          duration={0.38}
          animateOnMount={false}
        />
      </span>
      <span className="ag-delta-suffix">{suffix}</span>
    </span>
  );
}
