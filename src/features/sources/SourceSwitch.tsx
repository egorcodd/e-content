import { CheckIcon } from '@phosphor-icons/react';

export function SourceSwitch({
  checked,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className="sp-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span>{checked && <CheckIcon size={10} weight="bold" />}</span>
    </button>
  );
}
