import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { LogoMark } from '../../shared/ui';
import { ConnectorStatus } from './ConnectorAccount';
import { ConnectorObject } from './ConnectorObject';
import { connectorCatalog } from './connector-catalog';
import type { ConnectedAccount } from './connections';
import { plural, type AnalysisSource, type Platform } from './model';

type Point = { x: number; y: number };
type Geometry = {
  w: number;
  h: number;
  /** platform object scale and core scale; CSS reads them as --s / --cs */
  s: number;
  cs: number;
  core: Point;
  ports: Record<Platform, Point>;
};
type Anchor = { start: Point; rest: Point; port: Point };

const spring = { type: 'spring', stiffness: 260, damping: 24 } as const;

function measure(w: number, h: number): Geometry {
  const s = w > 980 ? 1 : w > 700 ? 0.8 : w > 460 ? 0.62 : 0.46;
  const cs = Math.max(s, 0.62);
  const core = { x: w / 2, y: h * 0.43 };
  // sockets sit on the side corners of the 112px core plates
  return {
    w,
    h,
    s,
    cs,
    core,
    ports: {
      telegram: { x: core.x - 79 * cs, y: core.y + 22 * cs },
      tiktok: { x: core.x + 79 * cs, y: core.y + 22 * cs },
    },
  };
}
function anchors(platform: Platform, g: Geometry): Anchor {
  const side = platform === 'telegram' ? -1 : 1;
  const object = { x: g.w / 2 + side * g.w * 0.33, y: g.core.y };
  // inner corner of the platform pad (see .dk-platform / .dk-pad)
  const start = { x: object.x - side * 90 * g.s, y: object.y - 12.8 + 38.4 * g.s };
  const port = g.ports[platform];
  // unplugged jack lies on the floor between the platform and the core
  const rest = { x: start.x + (port.x - start.x) * 0.42, y: g.h * 0.78 };
  return { start, rest, port };
}

/** Cable from a platform to its jack; the jack can be dragged into the core socket. */
function Cable({
  platform,
  anchor,
  active,
  core,
  select,
}: {
  platform: Platform;
  anchor: Anchor;
  active: boolean;
  core: Point;
  select: (platform: Platform | 'all') => void;
}) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const slack = useMotionValue(active ? 0 : 1);
  const target = (plugged: boolean) =>
    plugged
      ? { x: anchor.port.x - anchor.rest.x, y: anchor.port.y - anchor.rest.y }
      : { x: 0, y: 0 };
  function settle(plugged: boolean, instant = false) {
    const to = target(plugged);
    const options = instant || reduced ? { duration: 0 } : spring;
    animate(x, to.x, options);
    animate(y, to.y, options);
    animate(slack, plugged ? 0 : 1, instant || reduced ? { duration: 0 } : { duration: 0.7 });
  }
  const first = useRef(true);
  useEffect(() => {
    settle(active, first.current);
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, anchor.port.x, anchor.port.y, anchor.rest.x, anchor.rest.y]);
  const path = useTransform([x, y, slack], ([dx, dy, s]: number[]) => {
    const a = anchor.start;
    const b = { x: anchor.rest.x + dx, y: anchor.rest.y + dy };
    const sag = 18 + 46 * s;
    const pull = (b.x - a.x) * 0.38;
    return `M${a.x} ${a.y}C${a.x + pull} ${a.y + sag} ${b.x - pull} ${b.y + sag * 0.6} ${b.x} ${b.y}`;
  });
  const Icon = connectorCatalog.find((item) => item.id === platform)!.Icon;
  return (
    <>
      <svg className="dk-cable" data-platform={platform} data-active={active} aria-hidden="true">
        <motion.path className="dk-cable-line" d={path} />
        <motion.path className="dk-cable-flow" d={path} />
      </svg>
      <motion.span
        className="dk-jack"
        data-platform={platform}
        data-active={active}
        aria-hidden="true"
        style={{ left: anchor.rest.x, top: anchor.rest.y, x, y }}
        drag
        dragMomentum={false}
        dragElastic={0}
        whileDrag={{ scale: 1.12 }}
        onDragStart={() => animate(slack, 0.45, { duration: 0.3 })}
        onDragEnd={() => {
          const at = { x: anchor.rest.x + x.get(), y: anchor.rest.y + y.get() };
          const near = Math.hypot(at.x - core.x, at.y - core.y) < 110;
          const next =
            near || (active && Math.hypot(x.get() - target(true).x, y.get() - target(true).y) < 60);
          settle(next);
          if (next !== active) select(next ? platform : 'all');
        }}
        onTap={() => select(active ? 'all' : platform)}
      >
        <Icon size={13} weight="bold" />
      </motion.span>
    </>
  );
}

export function DockStage({
  platform,
  select,
  sources,
  accounts,
  loading,
  unavailable,
}: {
  platform: string;
  select: (platform: Platform | 'all') => void;
  sources: AnalysisSource[];
  accounts: ConnectedAccount[];
  loading: boolean;
  unavailable: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const element = box.current!;
    const update = () => setGeometry(measure(element.clientWidth, element.clientHeight));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const active = platform === 'telegram' || platform === 'tiktok' ? platform : null;
  const ActiveIcon = connectorCatalog.find((item) => item.id === active)?.Icon;
  return (
    <section className="dk-stage" data-active={active ?? 'none'} aria-label="Выбор площадки">
      <div
        className="dk-floor"
        ref={box}
        style={geometry ? ({ '--s': geometry.s, '--cs': geometry.cs } as CSSProperties) : undefined}
      >
        {geometry &&
          connectorCatalog.map((item) => {
            const anchor = anchors(item.id, geometry);
            const count = sources.filter((source) => source.platform === item.id);
            return (
              <div key={item.id}>
                <button
                  className="dk-platform"
                  data-platform={item.id}
                  aria-pressed={active === item.id}
                  aria-label={`Настроить ${item.title}`}
                  style={{ left: item.id === 'telegram' ? '17%' : '83%', top: geometry.core.y }}
                  onClick={() => select(active === item.id ? 'all' : item.id)}
                >
                  <span className="dk-pad" />
                  <ConnectorObject platform={item.id} />
                </button>
                <div
                  className="dk-platform-label"
                  style={{
                    left: item.id === 'telegram' ? '17%' : '83%',
                    top: geometry.core.y - 12.8 + 96 * geometry.s,
                  }}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {count.length} {plural(count.length, 'источник', 'источника', 'источников')} ·{' '}
                    {count.filter((source) => source.enabled).length} в сборе
                  </span>
                  <ConnectorStatus
                    platform={item.id}
                    accounts={accounts}
                    loading={loading}
                    unavailable={unavailable}
                  />
                </div>
                <Cable
                  platform={item.id}
                  anchor={anchor}
                  active={active === item.id}
                  core={geometry.core}
                  select={select}
                />
              </div>
            );
          })}
        <div
          className="dk-core"
          style={geometry ? { left: geometry.core.x, top: geometry.core.y } : undefined}
          aria-hidden="true"
        >
          <span className="dk-core-glow" />
          <span className="dk-plate" />
          <span className="dk-plate" />
          <span className="dk-plate" />
          {geometry &&
            connectorCatalog.map((item) => (
              <span
                key={item.id}
                className="dk-socket"
                data-platform={item.id}
                data-active={active === item.id}
                style={{
                  left: item.id === 'telegram' ? -79 : 79,
                  top: 22,
                }}
              />
            ))}
          <span className="dk-core-mark">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={active ?? 'core'}
                initial={reduced ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
                transition={{ duration: reduced ? 0 : 0.35 }}
              >
                {ActiveIcon ? <ActiveIcon size={22} /> : <LogoMark size={20} />}
              </motion.span>
            </AnimatePresence>
          </span>
        </div>
        <div
          className="dk-core-label"
          style={
            geometry
              ? { left: geometry.core.x, top: geometry.core.y + 78 * geometry.cs }
              : undefined
          }
          aria-hidden="true"
        >
          <strong>Ядро</strong>
          <span>{active ? 'Площадка в настройке' : 'Ждёт площадку'}</span>
        </div>
      </div>
      <p className="dk-hint" aria-live="polite">
        {active
          ? `${active === 'telegram' ? 'Telegram' : 'TikTok'} в разъёме. Отсоедините штекер или выберите другую площадку.`
          : 'Протяните штекер площадки к ядру или нажмите на площадку.'}
      </p>
    </section>
  );
}
