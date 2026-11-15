import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CaretDownIcon, CheckIcon } from '@phosphor-icons/react';
import './select.css';

type Option = { value: string; label: string };
/** Select-only combobox. Focus stays on the trigger while its listbox is open. */
export function Select({
  label,
  value,
  options,
  onChange,
  className = '',
  renderOption,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
  renderOption?: (option: Option) => ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 200,
    above: false,
    height: 260,
  });
  const reduced = useReducedMotion();
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  function show() {
    setActive(selected);
    setOpen(true);
  }
  function choose(index: number) {
    onChange(options[index].value);
    setOpen(false);
  }
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const desired = Math.min(options.length * 44 + 12, 260);
      const below = Math.max(0, window.innerHeight - rect.bottom - 20);
      const spaceAbove = Math.max(0, rect.top - 20);
      const above = below < desired && spaceAbove > below;
      const height = Math.min(desired, above ? spaceAbove : below);
      const width = Math.min(Math.max(rect.width, 210), window.innerWidth - 24);
      setPosition({
        top: above ? rect.top - 8 : rect.bottom + 8,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        width,
        above,
        height,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={`ec-dropdown ${className}`}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            setOpen(false);
            return;
          }
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            if (open) choose(active);
            else show();
            return;
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (!open) {
              show();
              if (event.key === 'Home') setActive(0);
              if (event.key === 'End') setActive(options.length - 1);
              return;
            }
            setActive(
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : (active + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length,
            );
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const next = options.findIndex(
              (option, index) =>
                index > active &&
                option.label.toLocaleLowerCase('ru').startsWith(event.key.toLocaleLowerCase('ru')),
            );
            const index =
              next >= 0
                ? next
                : options.findIndex((option) =>
                    option.label
                      .toLocaleLowerCase('ru')
                      .startsWith(event.key.toLocaleLowerCase('ru')),
                  );
            if (index >= 0) {
              if (!open) setOpen(true);
              setActive(index);
            }
          }
        }}
      >
        <span>
          {options[selected] && renderOption
            ? renderOption(options[selected])
            : options[selected]?.label}
        </span>
        <CaretDownIcon size={17} aria-hidden="true" />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <div
              className="ec-dropdown-position"
              style={{
                top: position.top,
                left: position.left,
                width: position.width,
                transform: position.above ? 'translateY(-100%)' : undefined,
              }}
            >
              <motion.div
                ref={popup}
                id={id}
                role="listbox"
                aria-label={label}
                className="ec-dropdown-list"
                style={{
                  maxHeight: position.height,
                  transformOrigin: position.above ? 'bottom' : 'top',
                }}
                initial={reduced ? false : { opacity: 0, y: position.above ? 5 : -5, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.18 }}
              >
                {options.map((option, index) => (
                  <div
                    key={option.value}
                    id={`${id}-${index}`}
                    role="option"
                    aria-selected={value === option.value}
                    data-active={active === index}
                    onPointerMove={() => setActive(index)}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(index)}
                  >
                    <span>{renderOption ? renderOption(option) : option.label}</span>
                    {value === option.value && <CheckIcon size={17} aria-hidden="true" />}
                  </div>
                ))}
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        trigger.current?.closest('dialog') ?? document.body,
      )}
    </>
  );
}
