import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion, useInView } from 'motion/react';
import { evidenceSummary, type Evidence } from './idea-model';
import { dailyMentions } from './activity';

const countLabel = (count: number, forms: [string, string, string]) =>
  `${count} ${forms[count % 10 === 1 && count % 100 !== 11 ? 0 : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 1 : 2]}`;
const mentionLabel = (count: number) =>
  countLabel(count, ['упоминание', 'упоминания', 'упоминаний']);
const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const publicationLabel = (count: number) =>
  `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'публикация' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'публикации' : 'публикаций'}`;
export function IdeaSignal({
  evidence,
  title,
  dates,
  scale,
}: {
  evidence: Evidence[];
  title: string;
  dates: string[];
  scale: number;
}) {
  const summary = evidenceSummary(evidence);
  const activity = dailyMentions(evidence, dates);
  const days = activity.days;
  const [open, setOpen] = useState(false);
  const [activeDay, setActiveDay] = useState(13);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const inView = useInView(trigger, { once: true, amount: 0.3 });
  const id = useId();
  const reduced = useReducedMotion();
  const points = days.map((day, index) => ({
    x: 14 + (index / 13) * 105,
    y: 24 - (day.count / scale) * 21,
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const area = `${line} L119,24 L14,24 Z`;
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(rect.left, innerWidth - 274)),
      top: rect.bottom + 210 > innerHeight ? Math.max(12, rect.top - 200) : rect.bottom + 10,
    });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="mi-frequency"
        aria-label={`Повторяемость: ${title}`}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') setOpen(true);
        }}
        onPointerLeave={() => setOpen(false)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.querySelector('svg')!.getBoundingClientRect();
          setActiveDay(
            Math.max(
              0,
              Math.min(
                13,
                Math.round(
                  ((event.clientX - rect.left - (rect.width * 14) / 120) /
                    ((rect.width * 105) / 120)) *
                    13,
                ),
              ),
            ),
          );
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setOpen(true);
            setActiveDay((day) =>
              Math.max(0, Math.min(13, day + (event.key === 'ArrowLeft' ? -1 : 1))),
            );
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <svg className="mi-frequency-chart" viewBox="0 0 120 36" aria-hidden="true">
          <defs>
            <linearGradient id={`activity-${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="#62a987" stopOpacity=".2" />
              <stop offset="1" stopColor="#62a987" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="mi-activity-grid" d="M14 3H119 M14 13.5H119 M14 24H119" />
          <text className="mi-activity-axis" x="0" y="7">
            {scale}
          </text>
          <text className="mi-activity-axis" x="0" y="26">
            0
          </text>
          {activity.hasDates ? (
            <>
              <motion.path
                fill={`url(#activity-${id})`}
                initial={false}
                animate={{ d: area, opacity: inView ? 1 : 0 }}
                transition={{ duration: reduced ? 0 : 0.35 }}
              />
              <motion.path
                className="mi-activity-line"
                initial={reduced ? false : { d: line, pathLength: 0 }}
                animate={{ d: line, pathLength: inView ? 1 : 0 }}
                transition={{ duration: reduced ? 0 : 0.55, ease: 'easeOut' }}
              />
              {open && (
                <>
                  <path className="mi-activity-cursor" d={`M${points[activeDay].x} 2V24`} />
                  <circle cx={points[activeDay].x} cy={points[activeDay].y} r="2" fill="#c7e0d1" />
                </>
              )}
            </>
          ) : (
            <text className="mi-activity-empty" x="66" y="16" textAnchor="middle">
              {summary.mentions ? 'Нет дат' : 'Нет оснований'}
            </text>
          )}
          <text className="mi-activity-axis" x="14" y="35">
            {shortDate(dates[0])}
          </text>
          <text className="mi-activity-axis" x="119" y="35" textAnchor="end">
            {shortDate(dates[13])}
          </text>
        </svg>
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              id={id}
              className="mi-frequency-tooltip"
              role="tooltip"
              style={position}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.15 }}
            >
              <strong>
                {activity.hasDates
                  ? `${mentionLabel(activity.total)} за 14 дней`
                  : 'Нет дат для графика'}
              </strong>
              <span>
                {shortDate(dates[0])} — {shortDate(dates[13])} · общая шкала 0–{scale} в день
              </span>
              {activity.hasDates && (
                <span>
                  {new Intl.DateTimeFormat('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    timeZone: 'Europe/Moscow',
                  }).format(new Date(`${days[activeDay].date}T12:00:00Z`))}{' '}
                  · {mentionLabel(days[activeDay].count)}
                </span>
              )}
              <div className="mi-tooltip-chart" aria-hidden="true">
                {days.map((day, index) => (
                  <i
                    key={day.date}
                    data-active={activeDay === index}
                    style={{ height: `${2 + (day.count / scale) * 32}px` }}
                  />
                ))}
              </div>
              <small>
                В основе:{' '}
                {countLabel(summary.comments, ['комментарий', 'комментария', 'комментариев'])}
                {summary.mentions > summary.comments && (
                  <>
                    {' '}
                    и{' '}
                    {countLabel(summary.mentions - summary.comments, [
                      'фрагмент публикации',
                      'фрагмента публикаций',
                      'фрагментов публикаций',
                    ])}
                  </>
                )}
              </small>
              {summary.mentions !== activity.total && (
                <small>За всё время: {mentionLabel(summary.mentions)}</small>
              )}
              <small>
                {summary.label} · {publicationLabel(summary.publications)}
              </small>
              {!!activity.undated && (
                <small>Без даты: {activity.undated}. Они не включены в график.</small>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
