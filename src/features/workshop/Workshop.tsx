import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
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
} from '../../shared/ui';
import { stations, hubStations, orchestrator, type ViewProps } from './stations';
import { ConsoleView } from './ConsoleView';
import type { SurfaceStyle } from './IsoView';
import { connections, waitForStage, type WorkshopTransfer, type WorkshopArrival } from './workflow';
import './workshop.css';
import { preloadWorkshopScene } from './scene-loader';

const IsoView = lazy(preloadWorkshopScene);
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
  { fallback: ReactNode; children: ReactNode; onFailure?: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure?.();
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
  { id: 'contour', label: 'Контур' },
  { id: 'mesh', label: 'Сетка' },
  { id: 'smoke', label: 'Дымка' },
];

export function Workshop({
  notify,
  presentation = 'gallery',
  onReady,
}: {
  notify: (s: string) => void;
  presentation?: 'gallery' | 'workspace';
  onReady?: () => void;
}) {
  const workspace = presentation === 'workspace';
  const [version, setVersion] = useState<'chain' | 'hub'>(workspace ? 'hub' : 'chain');
  const items = version === 'hub' ? hubStations : stations;
  const [batch, setBatch] = useState<WorkshopTransfer[]>([]);
  const [batchArrivals, setBatchArrivals] = useState<WorkshopArrival[]>([]);
  const [receivedCount, setReceivedCount] = useState(0);
  const [surface, setSurface] = useState<SurfaceStyle>('smoke');
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(false);
  const [step, setStep] = useState(-1);
  const [finished, setFinished] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [halted, setHalted] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [transfer, setTransfer] = useState<WorkshopTransfer | null>(null);
  const [arrival, setArrival] = useState<WorkshopArrival | null>(null);
  const control = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const station = items.find((s) => s.id === selected);
  useEffect(() => () => control.current?.abort(), []);
  useEffect(() => {
    if (!hasWebGL()) onReady?.();
  }, [onReady]);
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
    setTransfer(null);
    setArrival(null);
    setBatch([]);
    setBatchArrivals([]);
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
    if (version === 'hub' && selected === 'orchestrator') all = true;
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
    setReceivedCount(0);
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
          await waitForStage(all ? 300 : 560, abort.signal);
        }
        if (abort.signal.aborted) return;
        setStep(node.steps.length);
        setDone((old) => [...old, node.id]);
        setEvents((old) => [`${node.name} / ${node.steps.at(-1)}`, ...old].slice(0, 7));
        if (all) {
          const edge = connections.find((connection) => connection.from === node.id);
          if (edge) {
            setActive(null);
            const duration = 850;
            setTransfer({ ...edge, startedAt: performance.now(), duration });
            await waitForStage(duration, abort.signal);
            if (abort.signal.aborted) return;
            setTransfer(null);
            setArrival({ ...edge, receivedAt: performance.now() });
          }
        }
      }
      if (version === 'hub') {
        setSelected('orchestrator');
        setActive(null);
        activeRef.current = 'orchestrator';
        setStep(-1);
        const duration = all ? 1400 : 1000;
        const deliveries: WorkshopTransfer[] = nodes.map((node) => ({
          from: node.id,
          to: 'orchestrator',
          startedAt: performance.now(),
          duration,
        }));
        setBatch(deliveries);
        await waitForStage(duration, abort.signal);
        if (abort.signal.aborted) return;
        setBatch([]);
        setBatchArrivals(
          deliveries.map((delivery) => ({
            from: delivery.from,
            to: delivery.to,
            receivedAt: performance.now(),
          })),
        );
        setReceivedCount(nodes.length);
        setActive('orchestrator');
        for (let i = 0; i < orchestrator.steps.length; i++) {
          setStep(i);
          await waitForStage(320, abort.signal);
          if (abort.signal.aborted) return;
        }
        setStep(orchestrator.steps.length);
        setDone((old) => [...old, 'orchestrator']);
        setEvents((old) => ['Ядро / workspace.md', ...old].slice(0, 8));
      }
      if (!abort.signal.aborted) {
        setFinished(true);
        notify(all ? 'Полный цикл завершён' : 'Обработка участка завершена');
      }
    } finally {
      if (control.current === abort) {
        setRunning(false);
        setActive(null);
        setTransfer(null);
        setBatch([]);
        activeRef.current = null;
        control.current = null;
      }
    }
  }
  const states: Record<string, StatusKind> = {};
  const progress: Record<string, number> = {};
  for (const s of items) {
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
  const fallback =
    version === 'chain' ? (
      <ConsoleView {...view} />
    ) : (
      <div className="wg-hub-fallback">
        {hubStations.map((s) => (
          <button key={s.id} onClick={() => choose(s.id)}>
            <s.Icon size={24} />
            <span>{s.name}</span>
            <StatusIcon kind={states[s.id]} size={15} />
          </button>
        ))}
      </div>
    );
  const panelState: StatusKind = finished
    ? 'done'
    : running
      ? 'run'
      : selected && halted === selected
        ? 'pause'
        : 'wait';
  return (
    <section id="workshop" className={`wg-section ${workspace ? 'wg-workspace' : 'ec-section'}`}>
      {!workspace && (
        <SectionHeading number="02" title="Цех">
          <div className="wg-mode-switch">
            <Segment
              label="Версия цеха"
              value={version}
              onChange={(id) => {
                stop();
                setSelected(null);
                setDone([]);
                setEvents([]);
                setFinished(false);
                setHalted(null);
                setStep(-1);
                setReceivedCount(0);
                setVersion(id as 'chain' | 'hub');
              }}
              values={[
                { id: 'chain', label: 'V1 · Цепочка' },
                { id: 'hub', label: 'V2 · Ядро' },
              ]}
            />
          </div>
        </SectionHeading>
      )}
      <div className={`ec-section-controls ${workspace ? 'wg-workspace-toolbar' : ''}`}>
        {workspace ? (
          <div className="wg-workspace-title">
            <h1>Цех агентов</h1>
            <span>8 участков</span>
          </div>
        ) : (
          <Segment
            label="Материал изометрии"
            value={surface}
            onChange={(id) => setSurface(id as SurfaceStyle)}
            values={variants}
          />
        )}
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
      <div className="wg-flow-status" role="status" aria-live="polite" aria-atomic="true">
        {batch.length > 0 ? (
          <>
            <FileTextIcon size={14} />
            <span>
              {batch.length === 1
                ? items.find((s) => s.id === batch[0].from)?.name
                : `${batch.length} результатов`}
            </span>
            <ArrowRightIcon size={14} />
            <span>Ядро</span>
          </>
        ) : (
          transfer && (
            <>
              <FileTextIcon size={14} />
              <span>{items.find((s) => s.id === transfer.from)?.name}</span>
              <ArrowRightIcon size={14} />
              <span>{items.find((s) => s.id === transfer.to)?.name}</span>
              <code>{items.find((s) => s.id === transfer.from)?.steps.at(-1)}</code>
            </>
          )
        )}
      </div>
      <span
        className="sr-only wg-arrival-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {arrival &&
          `${items.find((s) => s.id === arrival.to)?.name}: получен ${items.find((s) => s.id === arrival.from)?.steps.at(-1)}`}
      </span>
      <span className="sr-only wg-hub-receipt" role="status" aria-live="polite">
        {batchArrivals.length > 0 && `Ядро: получено результатов ${batchArrivals.length}`}
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={version}
          className={`wg-scene wg-scene-iso ${version === 'hub' ? 'wg-scene-hub' : ''} ${running ? 'wg-running' : ''}`}
          initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
          transition={{ duration: reduced ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          {hasWebGL() ? (
            <SceneBoundary fallback={fallback} onFailure={onReady}>
              <Suspense fallback={workspace ? null : <SceneLoading />}>
                <IsoView
                  {...view}
                  surface={surface}
                  transfer={transfer}
                  arrival={arrival}
                  fullCycle={cycle || (version === 'hub' && running)}
                  layout={version}
                  transfers={batch}
                  arrivals={batchArrivals}
                  receivedCount={receivedCount}
                  onReady={onReady}
                />
              </Suspense>
            </SceneBoundary>
          ) : (
            fallback
          )}
        </motion.div>
      </AnimatePresence>
      <div className="wg-mobile-nodes">
        {items.map((s) => (
          <button key={s.id} onClick={() => choose(s.id)}>
            <s.Icon size={18} weight="duotone" />
            {s.name}
            <StatusIcon kind={states[s.id]} size={14} />
          </button>
        ))}
      </div>
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
              <span>Процесс</span>
              <button className="ec-icon" aria-label="Закрыть процесс" onClick={close}>
                <XIcon size={20} />
              </button>
            </div>
            <div className="wg-panel-title">
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
                      ? transfer
                        ? 'Передача файла'
                        : 'В работе'
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
                    : station.id === 'orchestrator'
                      ? 'Запустить весь цикл'
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
                        'e-content-report.md',
                        '# e-content\n\n' + events.map((e) => '- ' + e).join('\n'),
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
          </motion.aside>
        )}
      </AnimatePresence>
    </section>
  );
}
