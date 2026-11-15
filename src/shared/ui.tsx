import { useEffect, useId, useRef, type ReactNode } from 'react';
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { ArrowUpRightIcon, XIcon } from '@phosphor-icons/react';

export function LogoMark({ variant = 'cut', size = 32 }: { variant?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className="ec-mark"
    >
      {variant === 'cut' ? (
        <>
          <path d="M31 10H19a10 10 0 0 0 0 20h12" stroke="currentColor" strokeWidth="6" />
          <path d="M9 20h20" stroke="currentColor" strokeWidth="6" />
          <path d="M29 7h6v6h-6z" fill="currentColor" />
          <path d="M31 17h6v6h-6z" fill="var(--bg)" />
        </>
      ) : variant === 'fold' ? (
        <>
          <path d="M7 8h27l-6 6H7V8Zm0 10h21l-6 6H7v-6Zm0 10h27l-6 6H7v-6Z" fill="currentColor" />
          <path d="m28 14 6-6v6l-6 6v-6Zm-6 10 6-6v6l-6 6v-6Z" fill="currentColor" opacity=".35" />
        </>
      ) : (
        <>
          {[
            [7, 7],
            [16, 7],
            [25, 7],
            [7, 16],
            [16, 16],
            [7, 25],
            [16, 25],
            [25, 25],
          ].map(([x, y], i) => (
            <rect
              key={i}
              x={x}
              y={y}
              width="7"
              height="7"
              rx=".8"
              fill="currentColor"
              opacity={i === 4 ? 0.5 : 1}
            />
          ))}
        </>
      )}
    </svg>
  );
}

export function ThinkingGlyph({ active = false, size = 20 }: { active?: boolean; size?: number }) {
  return (
    <span
      className={'thinking-glyph ' + (active ? 'is-running' : '')}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="thinking-halo" />
      <span className="thinking-pixels">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

/** Pressed-state button group; the active pill slides between options. */
export function Segment({
  label,
  values,
  value,
  onChange,
  size,
  className = '',
}: {
  label: string;
  values: { id: string; label: string; icon?: ReactNode }[];
  value: string;
  onChange: (id: string) => void;
  size?: 'sm';
  className?: string;
}) {
  const pill = useId();
  return (
    <div
      className={`ec-segment ${size ? 'ec-segment-' + size : ''} ${className}`}
      role="group"
      aria-label={label}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const current = values.findIndex((v) => v.id === value);
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? values.length - 1
              : (current + (e.key === 'ArrowLeft' ? -1 : 1) + values.length) % values.length;
        onChange(values[next].id);
        e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}
    >
      {values.map((v) => (
        <button
          type="button"
          key={v.id}
          onClick={() => onChange(v.id)}
          aria-pressed={value === v.id}
        >
          {value === v.id && (
            <motion.span
              layoutId={pill}
              className="ec-segment-pill"
              transition={{ type: 'spring', bounce: 0.18, duration: 0.5 }}
            />
          )}
          <span className="ec-segment-label">
            {v.icon}
            {v.label}
          </span>
        </button>
      ))}
    </div>
  );
}

export function LabDialog({
  title,
  close,
  children,
  className = '',
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <motion.dialog
      ref={ref}
      initial={reduced ? false : { opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: reduced ? 0 : 0.22 }}
      className={`ec-dialog ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="ec-dialog-head">
        <h3>{title}</h3>
        <button className="ec-icon" onClick={close} aria-label="Закрыть диалог">
          <XIcon size={20} />
        </button>
      </div>
      {children}
    </motion.dialog>
  );
}

export function SectionHeading({
  number,
  title,
  id,
  children,
}: {
  number: string;
  title: string;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <div className="ec-section-heading" id={id}>
      <div>
        <span className="ec-section-number">{number}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function downloadText(name: string, text: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const numberFormat = new Intl.NumberFormat('ru-RU');
/** Counts up from 0 the first time it scrolls into view, then tweens between values. */
export function AnimatedNumber({
  value,
  format = (n) => numberFormat.format(Math.round(n)),
  className,
  duration = 1.1,
  delay = 0,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: '-40px' });
  const reduced = useReducedMotion();
  const current = useMotionValue(0);
  const text = useTransform(current, format);
  useEffect(() => {
    if (!seen) return;
    if (reduced) return current.set(value);
    const controls = animate(current, value, { duration, delay, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [seen, value, reduced]);
  return (
    <motion.span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </motion.span>
  );
}

/** Fades and lifts children in once, when they enter the viewport. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Arrow that leaves top-right and re-enters from bottom-left while the parent is hovered. */
export function ArrowSwap({ size = 16 }: { size?: number }) {
  return (
    <span className="ec-arrow-swap" style={{ width: size, height: size }} aria-hidden="true">
      <ArrowUpRightIcon size={size} />
      <ArrowUpRightIcon size={size} />
    </span>
  );
}

export type StatusKind = 'wait' | 'run' | 'done' | 'pause' | 'err';
export const statusLabels: Record<StatusKind, string> = {
  wait: 'Ожидание',
  run: 'В работе',
  done: 'Готово',
  pause: 'Пауза',
  err: 'Ошибка',
};
/** Status glyph with its own motion per state; colour comes from .ec-st-{kind}. */
export function StatusIcon({ kind, size = 16 }: { kind: StatusKind; size?: number }) {
  return (
    <svg
      className={`ec-status-icon ec-st-${kind}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {kind === 'wait' && (
        <>
          <circle className="si-orbit" cx="8" cy="8" r="6.25" />
          <circle className="si-core" cx="8" cy="8" r="2" />
        </>
      )}
      {kind === 'run' && (
        <>
          <circle className="si-track" cx="8" cy="8" r="6.25" />
          <circle className="si-arc" cx="8" cy="8" r="6.25" pathLength="100" />
          <circle className="si-core" cx="8" cy="8" r="1.7" />
        </>
      )}
      {kind === 'done' && (
        <>
          <circle className="si-ripple" cx="8" cy="8" r="6.25" />
          <circle className="si-disc" cx="8" cy="8" r="6.25" />
          <path className="si-check" d="M5.1 8.3l2 2 3.9-4.3" pathLength="10" />
        </>
      )}
      {kind === 'pause' && (
        <>
          <circle className="si-track" cx="8" cy="8" r="6.25" />
          <rect className="si-bar" x="5.5" y="5" width="1.7" height="6" rx=".85" />
          <rect className="si-bar" x="8.8" y="5" width="1.7" height="6" rx=".85" />
        </>
      )}
      {kind === 'err' && (
        <>
          <circle className="si-disc" cx="8" cy="8" r="6.25" />
          <path className="si-mark" d="M8 4.9v3.6" />
          <circle className="si-dot" cx="8" cy="11.1" r=".95" />
        </>
      )}
    </svg>
  );
}
export function StatusBadge({
  kind,
  label = statusLabels[kind],
  className = '',
}: {
  kind: StatusKind;
  label?: ReactNode;
  className?: string;
}) {
  return (
    <span className={`ec-status ec-st-${kind} ${className}`}>
      <StatusIcon kind={kind} size={15} />
      <span className="ec-status-label">{label}</span>
    </span>
  );
}
