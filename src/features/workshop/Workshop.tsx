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
  LabDialog,
  type StatusKind,
} from '../../shared/ui';
import { stations, hubStations, orchestrator, type ViewProps } from './stations';
import { ConsoleView } from './ConsoleView';
import type { SurfaceStyle } from './IsoView';
import { connections, waitForStage, type WorkshopTransfer, type WorkshopArrival } from './workflow';
import './workshop.css';
import { preloadWorkshopScene } from './scene-loader';
import { readWorkshopMemory, writeWorkshopMemory } from './workspace-cache';
import { readMaterial, saveRunArtifact } from '../materials/repository';
import { WorkshopSources } from '../sources/WorkshopSources';

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
  enabled = true,
  openMaterial,
  openSources,
}: {
  notify: (s: string) => void;
  presentation?: 'gallery' | 'workspace';
  onReady?: () => void;
  enabled?: boolean;
  openMaterial?: (id: string) => void;
  openSources?: (platform: 'telegram' | 'tiktok') => void;
}) {
  const workspace = presentation === 'workspace';
  const memory = useRef(workspace ? readWorkshopMemory() : null).current;
  const [version, setVersion] = useState<'chain' | 'hub'>(workspace ? 'hub' : 'chain');
  const items = version === 'hub' ? hubStations : stations;
  const [batch, setBatch] = useState<WorkshopTransfer[]>([]);
  const [batchArrivals, setBatchArrivals] = useState<WorkshopArrival[]>([]);
  const [receivedFrom, setReceivedFrom] = useState<string[]>(memory?.received ?? []);
  const receivedCount = receivedFrom.length;
  const [surface, setSurface] = useState<SurfaceStyle>('smoke');
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(false);
  const [step, setStep] = useState(-1);
  const [active, setActive] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>(memory?.done ?? []);
  const [halted, setHalted] = useState<string | null>(memory?.interrupted ?? null);
  const [events, setEvents] = useState<string[]>(memory?.events ?? []);
  const [stationSteps, setStationSteps] = useState<Record<string, number>>(memory?.steps ?? {});
  const [resultIds, setResultIds] = useState<Record<string, string>>(memory?.resultIds ?? {});
  const [repeat, setRepeat] = useState<boolean | null>(null);
  const pendingRepeat = useRef<boolean | null>(null);
  const panelVisible = useRef(false);
  const followRun = useRef(true);
  const [transfer, setTransfer] = useState<WorkshopTransfer | null>(null);
  const [arrival, setArrival] = useState<WorkshopArrival | null>(null);
  const control = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const station = items.find((s) => s.id === selected);
  useEffect(() => {
    if (workspace)
      writeWorkshopMemory({
        done,
        events,
        steps: stationSteps,
        received: receivedFrom,
        resultIds,
        interrupted: running ? activeRef.current : halted,
      });
  }, [workspace, done, events, stationSteps, receivedFrom, resultIds, running, halted, active]);
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
    panelVisible.current = false;
    followRun.current = false;
    setSelected(null);
    previous.current?.focus({ preventScroll: true });
  }
  function choose(id: string) {
    panelVisible.current = true;
    followRun.current = false;
    previous.current = document.activeElement as HTMLElement;
    setSelected(id);
    focusPanel();
  }
  const panelOpen = !!selected;
  useEffect(() => {
    if (!enabled) {
      panelVisible.current = false;
      followRun.current = false;
      setSelected(null);
      setRepeat(null);
      pendingRepeat.current = null;
    }
  }, [enabled]);
  useEffect(() => {
    if (!panelOpen || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, enabled]);
  async function run(all: boolean) {
    const coreOnly = selected === 'orchestrator' && halted === 'orchestrator' && !all;
    if (version === 'hub' && selected === 'orchestrator' && !coreOnly) all = true;
    if (all) {
      previous.current = document.activeElement as HTMLElement;
      if (!selected) focusPanel();
    }
    stop();
    panelVisible.current = true;
    followRun.current = true;
    const runId = crypto.randomUUID();
    const abort = new AbortController();
    control.current = abort;
    setRunning(true);
    setCycle(all);

    setHalted(null);
    const nodes = coreOnly ? [] : all ? stations : stations.filter((s) => s.id === selected);
    setDone((old) =>
      old.filter((id) => id !== 'orchestrator' && !nodes.some((node) => node.id === id)),
    );
    if (!nodes.length && !coreOnly) {
      setRunning(false);
      return;
    }
    try {
      for (const node of nodes) {
        if (abort.signal.aborted) return;
        if (panelVisible.current && followRun.current) setSelected(node.id);
        setActive(node.id);
        activeRef.current = node.id;
        const resumeAt = !all && halted === node.id ? (stationSteps[node.id] ?? 0) : 0;
        for (let i = resumeAt; i < node.steps.length; i++) {
          if (abort.signal.aborted) return;
          setStep(i);
          await waitForStage(all ? 300 : 560, abort.signal);
          if (!abort.signal.aborted) setStationSteps((old) => ({ ...old, [node.id]: i + 1 }));
        }
        if (abort.signal.aborted) return;
        setStep(node.steps.length);
        if (workspace) {
          const result = await saveRunArtifact({
            id: `run-${runId}-${node.id}`,
            runId,
            stationId: node.id,
            folderId: 'reports',
            title: `${node.name} · ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`,
            source: node.id === 'telegram' || node.id === 'tiktok' ? node.id : 'workshop',
            favorite: false,
            body: `# ${node.name}\n\nФайл: ${node.steps.at(-1)}\n\n## Структура обработки\n\n${node.steps
              .slice(0, -1)
              .map((label) => `- ${label}`)
              .join(
                '\n',
              )}\n\n## Данные\n\nСетевой источник ещё не подключён. Комментарии и публикации в этот файл не загружались.\n`,
          });
          if (abort.signal.aborted) return;
          setResultIds((old) => ({ ...old, [node.id]: result.id }));
        }
        setDone((old) => [...old, node.id]);
        const event = `${node.name} / ${node.steps.at(-1)}`;
        setEvents((old) => [event, ...old.filter((item) => item !== event)].slice(0, 7));
        if (all) {
          const outgoing = connections.filter((connection) => connection.from === node.id);
          for (const edge of outgoing) {
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
        if (panelVisible.current && followRun.current) setSelected('orchestrator');
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
        setReceivedFrom((old) => [...new Set([...old, ...nodes.map((node) => node.id)])]);
        setActive('orchestrator');
        for (
          let i = coreOnly ? (stationSteps.orchestrator ?? 0) : 0;
          i < orchestrator.steps.length;
          i++
        ) {
          setStep(i);
          await waitForStage(320, abort.signal);
          if (abort.signal.aborted) return;
          setStationSteps((old) => ({ ...old, orchestrator: i + 1 }));
        }
        setStep(orchestrator.steps.length);
        if (workspace) {
          const result = await saveRunArtifact({
            id: `run-${runId}-orchestrator`,
            runId,
            stationId: 'orchestrator',
            folderId: 'reports',
            title: `Ядро · ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`,
            source: 'workshop',
            favorite: false,
            body: `# Отчёт запуска цеха\n\nЗапуск: ${runId}\n\n## Участки\n\n${nodes.map((node) => `- ${node.name}: ${node.steps.at(-1)}`).join('\n')}\n\nЭто технический отчёт обработки. Найденные идеи и их основания сохраняются отдельно в библиотеке. Сетевой сбор комментариев ещё не подключён; этот запуск не создавал идеи из источников.\n`,
          });
          if (abort.signal.aborted) return;
          setResultIds((old) => ({ ...old, orchestrator: result.id }));
        }
        setDone((old) => [...old, 'orchestrator']);
        setEvents((old) =>
          ['Ядро / workspace.md', ...old.filter((item) => item !== 'Ядро / workspace.md')].slice(
            0,
            8,
          ),
        );
      }
      if (!abort.signal.aborted) {
        notify(all ? 'Полный цикл завершён' : 'Обработка участка завершена');
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        setHalted(activeRef.current);
        notify(error instanceof Error ? error.message : 'Не удалось сохранить результат');
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
        ? Math.max(
            0,
            Math.min(
              1,
              (active === s.id ? step + 0.5 : (stationSteps[s.id] ?? 0)) / s.steps.length,
            ),
          )
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
  const panelState: StatusKind = selected ? states[selected] : 'wait';
  const panelStep =
    selected && done.includes(selected)
      ? (station?.steps.length ?? 0)
      : selected === active
        ? step
        : selected
          ? (stationSteps[selected] ?? -1)
          : -1;
  const panelRunning = panelState === 'run';
  const panelControlsRun = running && (panelRunning || (followRun.current && cycle));
  const requestRun = (all: boolean) => {
    if ((all && done.length > 0) || (selected && done.includes(selected))) setRepeat(all);
    else void run(all);
  };
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

                setHalted(null);
                setStep(-1);
                setReceivedFrom([]);
                setStationSteps({});
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
            onClick={() => (running ? stop() : requestRun(true))}
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
                  enabled={enabled}
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
            {workspace && openSources && (station.id === 'telegram' || station.id === 'tiktok') && (
              <WorkshopSources
                platform={station.id}
                open={() => {
                  close();
                  openSources(station.id as 'telegram' | 'tiktok');
                }}
              />
            )}
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
                  panelStep > i
                    ? 'done'
                    : panelStep === i
                      ? panelRunning
                        ? 'run'
                        : 'pause'
                      : 'wait';
                return (
                  <li
                    key={label}
                    className={panelStep > i ? 'is-done' : panelStep === i ? 'is-current' : ''}
                  >
                    <span className="wg-step-icon">
                      <StatusIcon kind={kind} size={18} key={kind} />
                    </span>
                    <div>
                      {label}
                      <small>
                        {panelStep > i
                          ? 'Завершено'
                          : panelStep === i && panelRunning
                            ? 'Выполняется…'
                            : panelStep === i
                              ? 'Остановлено'
                              : 'Ожидание'}
                      </small>
                    </div>
                    {panelStep === i && panelRunning && (
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
              {workspace && panelState === 'done' && station.id === 'materials' && openMaterial && (
                <button
                  className="ec-button ec-white"
                  onClick={() => {
                    close();
                    openMaterial('');
                  }}
                >
                  <FileTextIcon size={16} />
                  Открыть библиотеку идей
                </button>
              )}
              <button
                className={'ec-button ec-white ' + (running ? 'is-running' : '')}
                disabled={running && !panelControlsRun}
                onClick={() =>
                  panelControlsRun
                    ? stop()
                    : requestRun(station.id === 'orchestrator' && halted !== station.id)
                }
              >
                {panelControlsRun ? (
                  <StopIcon size={14} weight="fill" />
                ) : (
                  <PlayIcon size={14} weight="fill" />
                )}
                {running && !panelControlsRun
                  ? 'Обработка продолжается'
                  : panelControlsRun
                    ? cycle
                      ? 'Остановить цикл'
                      : 'Остановить'
                    : panelState === 'done'
                      ? 'Запустить заново'
                      : panelState === 'pause'
                        ? 'Продолжить участок'
                        : station.id === 'orchestrator'
                          ? 'Запустить весь цикл'
                          : 'Запустить участок'}
              </button>
              <AnimatePresence>
                {panelState === 'done' && (
                  <motion.button
                    className="ec-button ec-glass"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    onClick={async () => {
                      const material =
                        workspace && resultIds[station.id]
                          ? await readMaterial(resultIds[station.id])
                          : undefined;
                      downloadText(
                        workspace ? station.steps.at(-1)! : 'e-content-report.md',
                        material?.body ??
                          '# e-content\n\n' + events.map((e) => '- ' + e).join('\n'),
                      );
                    }}
                  >
                    <DownloadSimpleIcon size={16} className="ec-ico-drop" />
                    {workspace ? 'Скачать отчёт' : 'Скачать Markdown'}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            {events.length > 0 && (
              <div className="wg-events">
                <h4>{workspace ? 'Отчёты запуска' : 'Материалы'}</h4>
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
      <AnimatePresence
        onExitComplete={() => {
          const all = pendingRepeat.current;
          pendingRepeat.current = null;
          if (all !== null) requestAnimationFrame(() => void run(all));
        }}
      >
        {repeat !== null && (
          <LabDialog title="Повторить обработку" close={() => setRepeat(null)}>
            <p>
              Сохранённые материалы останутся в библиотеке. Новый запуск создаст отдельный
              результат.
            </p>
            <div className="ec-dialog-actions">
              <button className="ec-button" onClick={() => setRepeat(null)}>
                Отмена
              </button>
              <button
                className="ec-button ec-white"
                onClick={() => {
                  pendingRepeat.current = repeat;
                  setRepeat(null);
                }}
              >
                Запустить заново
              </button>
            </div>
          </LabDialog>
        )}
      </AnimatePresence>
    </section>
  );
}
