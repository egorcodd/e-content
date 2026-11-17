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
import { WorkshopSources } from '../sources/WorkshopSources';
import { useCollectionRun } from '../collection/useCollectionRun';

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
const workspaceSteps: Record<string, readonly string[]> = {
  telegram: ['Доступ к каналам', 'Публикации за период', 'Сохранение без повторов', 'telegram.md'],
  tiktok: ['Публичные ролики', 'Комментарии и ответы', 'Сохранение исходных реплик', 'tiktok.md'],
  comments: [
    'Обсуждения публикаций',
    'Ответы и вложенные ветки',
    'Исходные реплики и ссылки',
    'comments.md',
  ],
  collector: ['Объединение записей', 'Проверка дат', 'Канонические ID и ссылки', 'inbox.md'],
  ideas: [
    'Вопросы аудитории',
    'Объединение одинаковых вопросов',
    'Основания из источников',
    'ideas.md',
  ],
  materials: [
    'Идеи без заданного формата',
    'Основания и ссылки',
    'Сохранение подборки',
    'materials.md',
  ],
};

export function Workshop({
  notify,
  presentation = 'gallery',
  onReady,
  enabled = true,
  openMaterial,
  openSources,
  openAnalytics,
}: {
  notify: (s: string) => void;
  presentation?: 'gallery' | 'workspace';
  onReady?: () => void;
  enabled?: boolean;
  openMaterial?: (id: string) => void;
  openSources?: (platform: 'telegram' | 'tiktok') => void;
  openAnalytics?: () => void;
}) {
  const workspace = presentation === 'workspace';
  const collection = useCollectionRun(workspace);
  const [version, setVersion] = useState<'chain' | 'hub'>(workspace ? 'hub' : 'chain');
  const items = version === 'hub' ? hubStations : stations;
  const [batch, setBatch] = useState<WorkshopTransfer[]>([]);
  const [batchArrivals, setBatchArrivals] = useState<WorkshopArrival[]>([]);
  const [receivedFrom, setReceivedFrom] = useState<string[]>([]);
  const receivedCount = receivedFrom.length;
  const [surface, setSurface] = useState<SurfaceStyle>('smoke');
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState(false);
  const [step, setStep] = useState(-1);
  const [active, setActive] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [halted, setHalted] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [stationSteps, setStationSteps] = useState<Record<string, number>>({});
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
  const baseStation = items.find((s) => s.id === selected);
  const station =
    baseStation && workspace
      ? { ...baseStation, steps: workspaceSteps[baseStation.id] ?? baseStation.steps }
      : baseStation;
  const observed = useRef<{ id: string; done: string[]; status: string } | null>(null);
  const deliveryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(deliveryTimer.current), []);
  useEffect(() => {
    if (!workspace) return;
    const real = collection.run;
    if (!real) return;
    const previous = observed.current;
    const newlyDone =
      previous?.id === real.id
        ? real.done.filter((id) => !previous.done.includes(id) && id !== 'orchestrator')
        : [];
    observed.current = { id: real.id, done: real.done, status: real.status };
    setDone(real.done);
    setStationSteps(real.steps);
    setEvents(real.events);
    setRunning(real.status === 'running');
    setActive(real.status === 'running' ? real.active : null);
    activeRef.current = real.status === 'running' ? real.active : null;
    setStep(real.active ? (real.steps[real.active] ?? 0) : -1);
    setHalted(real.status !== 'running' && real.status !== 'completed' ? real.active : null);
    setReceivedFrom(real.done.filter((id) => id !== 'orchestrator'));
    if (
      panelVisible.current &&
      followRun.current &&
      (real.active || real.done.includes('orchestrator'))
    )
      setSelected(real.active ?? 'orchestrator');
    if (newlyDone.length) {
      const deliveries: WorkshopTransfer[] = newlyDone
        .filter((id) => items.some((item) => item.id === id))
        .map((from) => ({
          from: from as WorkshopTransfer['from'],
          to: 'orchestrator',
          startedAt: performance.now(),
          duration: 1100,
        }));
      setBatch(deliveries);
      clearTimeout(deliveryTimer.current);
      deliveryTimer.current = setTimeout(() => {
        setBatch([]);
        setBatchArrivals(deliveries.map((edge) => ({ ...edge, receivedAt: performance.now() })));
      }, 1100);
    }
    if (previous?.id === real.id && previous.status === 'running' && real.status !== 'running')
      notify(real.status === 'completed' ? 'Сбор завершён' : (real.error ?? 'Сбор остановлен'));
  }, [workspace, collection.run]);
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
    if (workspace) {
      void collection
        .cancel()
        .catch((error) =>
          notify(error instanceof Error ? error.message : 'Не удалось остановить сбор.'),
        );
      return;
    }
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
    if (workspace) {
      try {
        await collection.start(all ? 'cycle' : (selected ?? 'cycle'));
        setCycle(all);
        panelVisible.current = true;
        followRun.current = true;
        if (!selected) setSelected(all ? 'orchestrator' : 'telegram');
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Не удалось запустить сбор.');
      }
      return;
    }
    const coreOnly = selected === 'orchestrator' && halted === 'orchestrator' && !all;
    if (version === 'hub' && selected === 'orchestrator' && !coreOnly) all = true;
    if (all) {
      previous.current = document.activeElement as HTMLElement;
      if (!selected) focusPanel();
    }
    stop();
    panelVisible.current = true;
    followRun.current = true;
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
  const partialRun = workspace && collection.run?.status === 'partial';
  for (const s of items) {
    states[s.id] =
      (partialRun && s.id === 'orchestrator') ||
      (workspace && collection.run?.failures?.[s.id] && active !== s.id)
        ? 'pause'
        : done.includes(s.id)
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
  const corePartial = partialRun && selected === 'orchestrator';
  const panelIssue =
    workspace &&
    (collection.error ||
      (selected &&
        (collection.run?.failures?.[selected] ||
          (selected === 'orchestrator' && collection.run?.error))));
  const reportEvents = events.filter((event) => event !== panelIssue);
  const panelSources = Object.entries(collection.run?.sources ?? {}).filter(([, source]) =>
    selected === 'tiktok'
      ? source.platform === 'tiktok'
      : corePartial && source.status !== 'completed',
  );
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
    if (
      (all && done.length > 0) ||
      (selected && done.includes(selected)) ||
      (workspace &&
        (selected === 'telegram' || selected === 'tiktok') &&
        !!collection.run &&
        collection.run.counts.posts + collection.run.counts.comments > 0)
    )
      setRepeat(all);
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
            disabled={workspace && (collection.loading || collection.pending)}
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
            {workspace && collection.run && (
              <div className="wg-real-counts" role="status">
                <span>
                  Публикации <b>{collection.run.counts.posts}</b>
                </span>
                <span>
                  Комментарии <b>{collection.run.counts.comments}</b>
                </span>
                <span>
                  Идеи <b>{collection.run.counts.ideas}</b>
                </span>
              </div>
            )}
            {panelIssue && (
              <p className="wg-real-error" data-partial={partialRun || undefined} role="status">
                {panelIssue}
              </p>
            )}
            {workspace && openSources && (station.id === 'telegram' || station.id === 'tiktok') && (
              <WorkshopSources
                platform={station.id}
                open={() => {
                  close();
                  openSources(station.id as 'telegram' | 'tiktok');
                }}
              />
            )}
            {workspace &&
              panelSources.map(([id, source]) => (
                <div className="wg-configured-sources" key={id}>
                  <div>
                    <FileTextIcon size={15} />
                    <span>{source.platform === 'tiktok' ? 'Сбор TikTok' : 'Сбор Telegram'}</span>
                  </div>
                  <ul>
                    {source.videos && (
                      <li>
                        Пройдено роликов: {source.videos.processed} из {source.videos.selected}
                      </li>
                    )}
                    {source.failedRequest && (
                      <li>
                        Остановка на этапе «
                        {
                          {
                            profile: 'профиль',
                            videos: 'список роликов',
                            video: 'данные ролика',
                            comments: 'комментарии',
                            replies: 'ответы',
                          }[source.failedRequest.stage]
                        }
                        »
                        {source.failedRequest.videoNumber &&
                          ` · ролик ${source.failedRequest.videoNumber}`}
                        {source.failedRequest.upstreamStatus &&
                          ` · HTTP ${source.failedRequest.upstreamStatus}`}
                      </li>
                    )}
                    <li>Сохранено комментариев: {source.comments}</li>
                    {source.status === 'completed' &&
                      source.stopCode === 'TIKTOK_PER_VIDEO_LIMIT' &&
                      source.limits && (
                        <li>
                          Лимит {source.limits.commentsPerVideo} комментариев достигнут на{' '}
                          {source.limits.limitedVideos} роликах
                        </li>
                      )}
                    {source.receivedComments !== undefined &&
                      source.receivedComments !== source.comments && (
                        <li>Получено до фильтрации: {source.receivedComments}</li>
                      )}
                    {source.expectedComments !== undefined && (
                      <li>Счётчик TikTok: {source.expectedComments}</li>
                    )}
                  </ul>
                  <a className="ec-text" href={source.url} target="_blank" rel="noreferrer">
                    Открыть источник
                    <ArrowRightIcon size={14} />
                  </a>
                </div>
              ))}
            <div className="wg-panel-source">
              <FileTextIcon size={16} />
              {station.steps.at(-1)}
              <StatusBadge
                kind={panelState}
                label={
                  corePartial
                    ? 'Частичный результат'
                    : panelState === 'done'
                      ? 'Готово'
                      : panelState === 'run'
                        ? transfer
                          ? 'Передача файла'
                          : 'В работе'
                        : panelState === 'pause'
                          ? workspace && collection.run?.failures?.[station.id]
                            ? 'Нужно внимание'
                            : 'Пауза'
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
              {workspace && station.id === 'analytics' && openAnalytics ? (
                <button
                  className="ec-button ec-white"
                  onClick={() => {
                    close();
                    openAnalytics();
                  }}
                >
                  Открыть аналитику
                </button>
              ) : (
                <button
                  className={'ec-button ec-white ' + (running ? 'is-running' : '')}
                  disabled={
                    (running && !panelControlsRun) ||
                    (workspace &&
                      (collection.loading || collection.pending || station.id === 'analytics'))
                  }
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
                  {workspace && station.id === 'analytics'
                    ? 'Пока недоступно'
                    : running && !panelControlsRun
                      ? 'Обработка продолжается'
                      : panelControlsRun
                        ? cycle
                          ? 'Остановить цикл'
                          : 'Остановить'
                        : panelState === 'done' || corePartial
                          ? 'Запустить заново'
                          : panelState === 'pause'
                            ? workspace
                              ? station.id === 'telegram' || station.id === 'tiktok'
                                ? 'Запустить заново'
                                : 'Обработать сохранённое'
                              : 'Продолжить участок'
                            : station.id === 'orchestrator'
                              ? 'Запустить весь цикл'
                              : 'Запустить участок'}
                </button>
              )}
              <AnimatePresence>
                {(panelState === 'done' ||
                  (workspace &&
                    collection.run &&
                    collection.run.status !== 'running' &&
                    collection.run.counts.posts + collection.run.counts.comments > 0)) && (
                  <motion.button
                    className="ec-button ec-glass"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    onClick={async () => {
                      if (workspace && collection.run) {
                        const link = document.createElement('a');
                        link.href = `/api/collection/runs/${collection.run.id}/export.md`;
                        link.download = `${Object.values(collection.run.sources ?? {}).some((source) => source.platform === 'tiktok') ? 'e-content' : 'telegram'}-${collection.run.id}.md`;
                        document.body.append(link);
                        link.click();
                        link.remove();
                      } else
                        downloadText(
                          'e-content-report.md',
                          '# e-content\n\n' + events.map((event) => '- ' + event).join('\n'),
                        );
                    }}
                  >
                    <DownloadSimpleIcon size={16} className="ec-ico-drop" />
                    {workspace ? 'Скачать отчёт' : 'Скачать Markdown'}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            {reportEvents.length > 0 && (
              <div className="wg-events">
                <h4>{workspace ? 'Отчёты запуска' : 'Материалы'}</h4>
                <AnimatePresence initial={false}>
                  {reportEvents.map((event) => (
                    <motion.div
                      key={event}
                      layout
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }}
                    >
                      <FileTextIcon size={15} />
                      {event}
                      {workspace && event === collection.run?.error ? (
                        <StatusIcon kind="err" size={13} />
                      ) : (
                        <CheckIcon size={13} weight="bold" />
                      )}
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
