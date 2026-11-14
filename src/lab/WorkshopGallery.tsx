import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  PlayIcon,
  StopIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  downloadText,
  SectionHeading,
  Segment,
  StatusBadge,
  StatusIcon,
  type StatusKind,
} from './shared';
import { stations, type ViewProps } from './workshop/stations';
import { ConsoleView } from './workshop/ConsoleView';
import { DialView } from './workshop/DialView';
import './workshop-gallery.css';

const IsoView = lazy(() => import('./workshop/IsoView'));
let webgl: boolean | undefined;
function hasWebGL() {
  if (webgl === undefined) {
    try {
      webgl = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
/** Anything thrown while building the 3D scene drops the user onto the console view. */
class SceneBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function SceneLoading() {
  return (
    <div className="wg-loading" role="status">
      <span className="wg-loading-tiles" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      Собираю сцену…
    </div>
  );
}

const variants = [
  { id: 'iso', label: 'Изометрия' },
  { id: 'console', label: 'Пульт' },
  { id: 'dial', label: 'Циферблат' },
];

export function WorkshopGallery({ notify }: { notify: (s: string) => void }) {
  const [variant, setVariant] = useState('iso');
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(false);
  const [step, setStep] = useState(-1);
  const [finished, setFinished] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [halted, setHalted] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const control = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const station = stations.find((s) => s.id === selected);
  useEffect(() => () => control.current?.abort(), []);
  // a late frame (heavy 3D scene) must not pull focus out of a control the user already chose
  const focusPanel = () =>
    requestAnimationFrame(() => {
      if (!panel.current?.contains(document.activeElement))
        panel.current?.focus({ preventScroll: true });
    });
  function stop() {
    control.current?.abort();
    control.current = null;
    if (activeRef.current) setHalted(activeRef.current);
    activeRef.current = null;
    setRunning(false);
    setActive(null);
  }
  function close() {
    stop();
    setSelected(null);
    previous.current?.focus({ preventScroll: true });
  }
  function choose(id: string) {
    stop();
    previous.current = document.activeElement as HTMLElement;
    setSelected(id);
    setCycle(false);
    setStep(-1);
    setFinished(false);
    setDone([]);
    setHalted(null);
    setEvents([]);
    focusPanel();
  }
  const panelOpen = !!selected;
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen]);
  async function run(all: boolean) {
    if (all) {
      previous.current = document.activeElement as HTMLElement;
      if (!selected) focusPanel();
    }
    stop();
    const abort = new AbortController();
    control.current = abort;
    setRunning(true);
    setCycle(all);
    setFinished(false);
    setDone([]);
    setHalted(null);
    setEvents([]);
    const nodes = all ? stations : stations.filter((s) => s.id === selected);
    if (!nodes.length) {
      setRunning(false);
      return;
    }
    try {
      for (const node of nodes) {
        if (abort.signal.aborted) return;
        setSelected(node.id);
        setActive(node.id);
        activeRef.current = node.id;
        for (let i = 0; i < node.steps.length; i++) {
          if (abort.signal.aborted) return;
          setStep(i);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, all ? 300 : 560);
            abort.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        }
        if (abort.signal.aborted) return;
        setStep(node.steps.length);
        setDone((old) => [...old, node.id]);
        setEvents((old) => [`${node.name} / ${node.steps.at(-1)}`, ...old].slice(0, 7));
      }
      if (!abort.signal.aborted) {
        setFinished(true);
        notify(all ? 'Демонстрация полного цикла завершена' : 'Демонстрация участка завершена');
      }
    } finally {
      if (control.current === abort) {
        setRunning(false);
        setActive(null);
        activeRef.current = null;
        control.current = null;
      }
    }
  }
  const states: Record<string, StatusKind> = {};
  const progress: Record<string, number> = {};
  for (const s of stations) {
    states[s.id] = done.includes(s.id)
      ? 'done'
      : active === s.id
        ? 'run'
        : halted === s.id
          ? 'pause'
          : 'wait';
    progress[s.id] = done.includes(s.id)
      ? 1
      : active === s.id || halted === s.id
        ? Math.max(0, Math.min(1, (step + (active === s.id ? 0.5 : 0)) / s.steps.length))
        : 0;
  }
  const view: ViewProps = { selected, active, running, step, states, progress, choose };
  const panelState: StatusKind = finished
    ? 'done'
    : running
      ? 'run'
      : selected && halted === selected
        ? 'pause'
        : 'wait';
  return (
    <section id="workshop" className="ec-section wg-section">
      <SectionHeading number="02" title="Цех">
        <span className="ec-demo">Демо</span>
      </SectionHeading>
      <div className="ec-section-controls">
        <Segment
          label="Вариант цеха"
          value={variant}
          onChange={(id) => {
            stop();
            setSelected(null);
            setVariant(id);
          }}
          values={variants}
        />
        <div className="ec-actions">
          <button className="ec-icon" onClick={close} aria-label="Вернуть общий вид">
            <ArrowCounterClockwiseIcon size={18} />
          </button>
          <button
            className={'ec-button ec-white ' + (running ? 'is-running' : '')}
            onClick={() => (running ? stop() : void run(true))}
          >
            {running ? <StopIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
            {running ? 'Остановить цикл' : 'Запустить весь цикл'}
          </button>
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={variant}
          className={`wg-scene wg-scene-${variant} ${running ? 'wg-running' : ''}`}
          initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
          transition={{ duration: reduced ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          {variant === 'iso' ? (
            hasWebGL() ? (
              <SceneBoundary fallback={<ConsoleView {...view} />}>
                <Suspense fallback={<SceneLoading />}>
                  <IsoView {...view} />
                </Suspense>
              </SceneBoundary>
            ) : (
              <ConsoleView {...view} />
            )
          ) : variant === 'console' ? (
            <ConsoleView {...view} />
          ) : (
            <DialView {...view} />
          )}
        </motion.div>
      </AnimatePresence>
      {variant !== 'console' && (
        <div className="wg-mobile-nodes">
          {stations.map((s) => (
            <button
              key={s.id}
              onClick={() => choose(s.id)}
              style={{ ['--tint' as string]: s.tint }}
            >
              <s.Icon size={18} weight="duotone" />
              {s.name}
              <StatusIcon kind={states[s.id]} size={14} />
            </button>
          ))}
        </div>
      )}
      <AnimatePresence>
        {station && (
          <motion.aside
            id="wg-process"
            role="region"
            tabIndex={-1}
            ref={panel}
            aria-label={`Процесс ${station.name}`}
            className="wg-process-panel"
            initial={{ x: 48, opacity: 0, scale: 0.98 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: 48, opacity: 0, scale: 0.98 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', bounce: 0.12, duration: 0.5 }}
          >
            <div className="wg-panel-top">
              <span>Процесс / Демо</span>
              <button className="ec-icon" aria-label="Закрыть процесс" onClick={close}>
                <XIcon size={20} />
              </button>
            </div>
            <div className="wg-panel-title" style={{ ['--tint' as string]: station.tint }}>
              <span className="wg-panel-icon">
                <station.Icon size={24} weight="duotone" />
              </span>
              <div>
                <h3>{station.name}</h3>
                <small>{station.sub}</small>
              </div>
            </div>
            <div className="wg-panel-source">
              <FileTextIcon size={16} />
              {station.steps.at(-1)}
              <StatusBadge
                kind={panelState}
                label={
                  panelState === 'done'
                    ? 'Готово'
                    : panelState === 'run'
                      ? 'В работе'
                      : panelState === 'pause'
                        ? 'Пауза'
                        : 'Ожидает запуска'
                }
              />
            </div>
            <ol className="wg-steps" aria-live="polite">
              {station.steps.map((label, i) => {
                const kind: StatusKind =
                  step > i ? 'done' : step === i ? (running ? 'run' : 'pause') : 'wait';
                return (
                  <li key={label} className={step > i ? 'is-done' : step === i ? 'is-current' : ''}>
                    <span className="wg-step-icon">
                      <StatusIcon kind={kind} size={18} key={kind} />
                    </span>
                    <div>
                      {label}
                      <small>
                        {step > i
                          ? 'Завершено'
                          : step === i && running
                            ? 'Выполняется…'
                            : step === i
                              ? 'Остановлено'
                              : 'Ожидание'}
                      </small>
                    </div>
                    {step === i && running && (
                      <motion.i
                        className="wg-step-scan"
                        layoutId="wg-step-scan"
                        transition={{ type: 'spring', bounce: 0.1, duration: 0.28 }}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
            <div className="wg-panel-actions">
              <button
                className={'ec-button ec-white ' + (running ? 'is-running' : '')}
                onClick={() => (running ? stop() : void run(cycle))}
              >
                {running ? (
                  <StopIcon size={14} weight="fill" />
                ) : (
                  <PlayIcon size={14} weight="fill" />
                )}
                {running
                  ? cycle
                    ? 'Остановить цикл'
                    : 'Остановить'
                  : cycle
                    ? 'Повторить цикл'
                    : 'Запустить участок'}
              </button>
              <AnimatePresence>
                {finished && (
                  <motion.button
                    className="ec-button ec-glass"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    onClick={() =>
                      downloadText(
                        'e-content-example.md',
                        '# e-content\n\nДемонстрационный цикл дизайн-системы.\n\n' +
                          events.map((e) => '- ' + e).join('\n'),
                      )
                    }
                  >
                    <DownloadSimpleIcon size={16} className="ec-ico-drop" />
                    Скачать Markdown
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            {events.length > 0 && (
              <div className="wg-events">
                <h4>Материалы</h4>
                <AnimatePresence initial={false}>
                  {events.map((event) => (
                    <motion.div
                      key={event}
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }}
                    >
                      <FileTextIcon size={15} />
                      {event}
                      <CheckIcon size={13} weight="bold" />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
            <div className="wg-panel-bottom">
              <span className="wg-demo-dot" />
              Демонстрационный процесс
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </section>
  );
}
