import { priorityLabels, type IdeaPriority } from './idea-model';
export function PriorityMark({ value }: { value: IdeaPriority }) {
  return (
    <span className={`mi-priority-mark mi-priority-mark-${value}`}>
      <span className="mi-priority-gauge" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{priorityLabels[value]}</span>
    </span>
  );
}
