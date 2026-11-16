import { useId, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { CaretDownIcon } from '@phosphor-icons/react';

export function SettingsDisclosure({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const reduced = useReducedMotion();
  return (
    <div className="source-disclosure" data-open={open}>
      <button
        type="button"
        className="source-disclosure-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span>
          <strong>{title}</strong>
          {summary && <small>{summary}</small>}
        </span>
        <CaretDownIcon size={16} />
      </button>
      <motion.div
        id={id}
        className="source-disclosure-body"
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
        inert={!open}
        aria-hidden={!open}
      >
        <div className="source-disclosure-content">{children}</div>
      </motion.div>
    </div>
  );
}
