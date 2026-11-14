import { useEffect, useState } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { AnimatedNumber, StatusBadge, StatusIcon, type StatusKind } from '../shared';
import { stations, type ViewProps } from './stations';

const C = 320;
const TICKS = 14;
const GAP = 3;
const SLOT = 360 / (stations.length * (TICKS + GAP));
/** Angle (deg, clockwise from 12 o'clock) of tick `t` of station `i`; t may be fractional. */
const angle = (i: number, t: number) => (i * (TICKS + GAP) + GAP / 2 + t + 0.5) * SLOT;
const polar = (a: number, r: number) => [
  C + r * Math.sin((a * Math.PI) / 180),
  C - r * Math.cos((a * Math.PI) / 180),
];

export function DialView({ selected, active, running, step, states, progress, choose }: ViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const overall = stations.reduce((sum, s) => sum + progress[s.id], 0) / stations.length;
  const focus =
    stations.find((s) => s.id === active) ??
    stations.find((s) => s.id === selected) ??
    [...stations].reverse().find((s) => progress[s.id] > 0);
  const focusIndex = focus ? stations.indexOf(focus) : -1;
  const hand = focus ? angle(focusIndex, progress[focus.id] * TICKS - 0.5) : 0;
  const handAngle = useMotionValue(hand);
  const handX = useTransform(handAngle, (a) => polar(a, 288)[0]);
  const handY = useTransform(handAngle, (a) => polar(a, 288)[1]);
  useEffect(() => {
    if (reduced) return handAngle.set(hand);
    const controls = animate(handAngle, hand, { type: 'spring', bounce: 0.2, duration: 0.8 });
    return () => controls.stop();
  }, [hand, reduced]);
  const values = Object.values(states);
  const overallKind: StatusKind = running
    ? 'run'
    : values.every((v) => v === 'done')
      ? 'done'
      : values.includes('pause')
        ? 'pause'
        : 'wait';
  return (
    <div className={'wg-dial-stage ' + (selected ? 'has-selection' : '')}>
      <div className="wg-dial">
        <svg viewBox="0 0 640 640" aria-hidden="true">
          <defs>
            <radialGradient id="wg-dial-core">
              <stop offset="0" stopColor="#1a1a1a" />
              <stop offset="1" stopColor="#0c0c0c" />
            </radialGradient>
          </defs>
          <circle cx={C} cy={C} r="172" fill="url(#wg-dial-core)" stroke="#202020" />
          {Array.from({ length: 120 }, (_, i) => {
            const [x, y] = polar(i * 3, 190);
            return <circle key={i} cx={x} cy={y} r={i % 10 ? 0.9 : 1.6} fill="#2e2e2e" />;
          })}
          {stations.map((s, i) => {
            const lit = Math.round(progress[s.id] * TICKS);
            const marked = hovered === s.id || selected === s.id;
            return (
              <g
                key={s.id}
                className={`wg-arc is-${states[s.id]} ${marked ? 'is-marked' : ''}`}
                style={{ ['--tint' as string]: s.tint }}
              >
                {Array.from({ length: TICKS }, (_, t) => {
                  const a = angle(i, t);
                  const [x1, y1] = polar(a, 212);
                  const [x2, y2] = polar(a, 252);
                  const [m1, n1] = polar(a, 264);
                  const [m2, n2] = polar(a, 272);
                  return (
                    <g key={t}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        className={
                          'wg-tick ' +
                          (t < lit ? 'is-on ' : '') +
                          (t === lit - 1 && states[s.id] === 'run' ? 'is-lead' : '')
                        }
                        style={{
                          transitionDelay: `${(t % 6) * 30}ms`,
                          opacity: 0.72 + (t / TICKS) * 0.28,
                        }}
                      />
                      <line x1={m1} y1={n1} x2={m2} y2={n2} className="wg-tick-mark" />
                    </g>
                  );
                })}
              </g>
            );
          })}
          <motion.circle
            cx={handX}
            cy={handY}
            r="4.5"
            className={'wg-hand ' + (focus ? 'is-' + states[focus.id] : '')}
          />
        </svg>
        <div className="wg-dial-center" aria-live="polite">
          <span className="wg-dial-caption">{focus ? focus.name : 'Цикл'}</span>
          <AnimatedNumber
            className="wg-dial-value"
            value={Math.round((focus ? progress[focus.id] : overall) * 100)}
            format={(n) => Math.round(n) + '%'}
            duration={0.8}
          />
          <span className="wg-dial-step">
            {focus && active === focus.id && step >= 0 && step < focus.steps.length
              ? focus.steps[step]
              : focus
                ? focus.sub
                : 'Выберите участок или запустите цикл'}
          </span>
          <StatusBadge kind={overallKind} key={overallKind} />
        </div>
        {stations.map((s, i) => {
          const a = angle(i, (TICKS - 1) / 2);
          const sin = Math.sin((a * Math.PI) / 180);
          const cos = Math.cos((a * Math.PI) / 180);
          const r = 50 * (300 / 320);
          return (
            <button
              type="button"
              key={s.id}
              className={`wg-dial-label ${selected === s.id ? 'wg-selected' : ''} ${active === s.id ? 'wg-active' : ''}`}
              style={{
                left: `${50 + sin * r}%`,
                top: `${50 - cos * r}%`,
                translate: `${sin > 0.3 ? '0%' : sin < -0.3 ? '-100%' : '-50%'} ${cos > 0.3 ? '-100%' : cos < -0.3 ? '0%' : '-50%'}`,
                ['--tint' as string]: s.tint,
              }}
              aria-label={`Открыть участок ${s.name}`}
              aria-expanded={selected === s.id}
              onClick={() => choose(s.id)}
              onPointerEnter={() => setHovered(s.id)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(s.id)}
              onBlur={() => setHovered(null)}
            >
              <s.Icon size={18} weight="duotone" />
              <span>
                <strong>{s.name}</strong>
                <small>{s.sub}</small>
              </span>
              <StatusIcon kind={states[s.id]} size={14} key={states[s.id]} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
