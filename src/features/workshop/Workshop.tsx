import { Component, lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  CaretDownIcon,
  CheckIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  PlayIcon,
  StopIcon,
  XIcon,
} from '@phosphor-icons/react';
import {
  AnimatedNumber,
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
import { LocalApiError } from '../collection/api';
import { AiIdeas } from '../collection/AiIdeas';
import type { SourceProgress } from '../collection/contracts';
import { SiteLink } from '../../app/navigation';

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
const runCounters = [
  ['posts', 'Публикации'],
  ['comments', 'Комментарии'],
  ['ideas', 'Идеи'],
] as const;
const workspaceSteps: Record<string, readonly string[]> = {
  telegram: ['Доступ к каналам', 'Публикации за период', 'Сохранение без повторов', 'telegram.md'],
  tiktok: ['Публичные ролики', 'Комментарии и ответы', 'Сохранение данных', 'Отчёт сбора'],
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

function tiktokNotice(source?: SourceProgress) {
  if (source?.stopCode?.startsWith('APIFY_') && source.reason) return source.reason;
  switch (source?.stopCode) {
    case 'TIKTOK_SAMPLE_PAUSED':
      return 'TikTok временно приостановил выдачу.';
    case 'TIKTOK_SAVED_SAMPLE':
      return 'TikTok отложил обновление. Использована доступная выборка.';
    case 'TIKTOK_SAMPLE_TIME':
      return 'Время обновления истекло. Непрочитанные страницы остались в очереди.';
    case 'TIKTOK_BLOCKED':
      return source.reason?.startsWith('TikTok ограничил доступ') ||
        source.reason?.startsWith('TikTok запросил проверку')
        ? 'TikTok ограничил доступ к данным.'
        : 'TikTok ограничил запросы.';
    case 'TIKTOK_TIMEOUT':
    case 'TIKTOK_UNAVAILABLE':
      return 'TikTok временно недоступен.';
    case 'TIKTOK_LOGIN_REQUIRED':
    case 'TIKTOK_AGE_REQUIRED':
      return 'TikTok ограничил доступ к комментариям.';
    case 'TIKTOK_TOTAL_COMMENT_LIMIT':
      return 'Достигнут общий лимит комментариев.';
    case 'TIKTOK_TOTAL_VIDEO_LIMIT':
      return 'Достигнут общий лимит публикаций.';
    case 'REQUEST_BUDGET':
      return 'Достигнут общий лимит запросов.';
    case 'TIKTOK_VIDEO_LIST_INCOMPLETE':
      return 'TikTok выдал часть списка роликов.';
    case 'TIKTOK_REPLIES_INCOMPLETE':
      return 'TikTok выдал часть ответов.';
    case 'TIKTOK_DEFERRED':
    case 'TIKTOK_RETRY_EXHAUSTED':
      return 'TikTok не вернул часть комментариев. Место остановки сохранено.';
    case 'TIKTOK_RETRY_TOO_LATE':
      return 'Ожидание TikTok превышает сутки. Место остановки сохранено.';
    case 'TIKTOK_DEFERRED_REPLIES':
      return 'Оставшиеся ответы цех проверит при следующем запуске.';
    case 'TIKTOK_COMMENTS_EMPTY':
      return 'TikTok не выдал комментарии к одному из роликов.';
    default:
      return source?.status === 'limited'
        ? 'Собрана часть данных TikTok.'
        : 'TikTok не выдал все данные.';
  }
}

function RunReports({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="wg-events">
      <button type="button" className="wg-events-toggle" aria-expanded={open} aria-controls={bodyId}
        onClick={() => setOpen(value => !value)}>
        Отчёты запуска<CaretDownIcon size={15} aria-hidden="true" />
      </button>
      <div id={bodyId} className="wg-events-body" inert={!open}>
        <div>{children}</div>
      </div>
    </div>
  );
}

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
  const [repeat, setRepeat] = useState<{
    all: boolean;
    stationId: string | null;
    scope: string;
  } | null>(null);
  const pendingRepeat = useRef<typeof repeat>(null);
  const [actionIssue, setActionIssue] = useState<{
    scope: string;
    message: string;
    settings?: boolean;
  } | null>(null);
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
    if (!real) {
      if (observed.current) {
        observed.current = null;
        clearTimeout(deliveryTimer.current);
        setDone([]); setEvents([]); setStationSteps({}); setReceivedFrom([]);
        setActive(null); activeRef.current = null; setStep(-1); setRunning(false);
        setHalted(null); setBatch([]); setBatchArrivals([]); setTransfer(null); setArrival(null);
      }
      return;
    }
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
    if (previous?.id === real.id && previous.status === 'running' && real.status !== 'running') {
      const messages = {
        completed: 'Сбор завершён',
        partial: 'Сбор завершён частично',
        cancelled: 'Сбор остановлен',
        failed: 'Не удалось завершить сбор',
        interrupted: 'Сбор прерван',
      };
      notify(messages[real.status]);
    }
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
  function stop(scope = 'toolbar') {
    if (workspace) {
      setActionIssue(null);
      void collection.cancel().catch((error) =>
        setActionIssue({
          scope,
          message: error instanceof LocalApiError ? error.message : 'Не удалось остановить сбор.',
        }),
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
    setActionIssue(null);
    panelVisible.current = false;
    followRun.current = false;
    setSelected(null);
    previous.current?.focus({ preventScroll: true });
  }
  function choose(id: string) {
    setActionIssue(null);
    panelVisible.current = true;
    followRun.current = false;
    previous.current = document.activeElement as HTMLElement;
    setSelected(id);
    focusPanel();
  }
  const panelOpen = !!selected;
  const canResumeTikTok = workspace && collection.run?.canResumeTikTok === true && !running;
  const resumesTikTok = (all: boolean, stationId: string | null) =>
    canResumeTikTok && !all && stationId === 'tiktok' && collection.run?.ideaMode === undefined;
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
  async function run(all: boolean, stationId: string | null, scope: string, threadsOnly = false) {
    if (workspace) {
      setActionIssue(null);
      try {
        if (resumesTikTok(all, stationId)) await collection.resumeTikTok();
        else await collection.start(all ? 'cycle' : (stationId ?? 'cycle'), threadsOnly);
        setCycle(all);
        panelVisible.current = true;
        followRun.current = true;
        if (!selected) setSelected(all ? 'orchestrator' : 'telegram');
      } catch (error) {
        setActionIssue({
          scope,
          message: error instanceof LocalApiError ? error.message : 'Не удалось запустить сбор.',
          settings:
            error instanceof LocalApiError &&
            ['NO_SOURCES', 'PLAN_BLOCKED', 'CONFIGURATION'].includes(error.code),
        });
      }
      return;
    }
    const coreOnly = stationId === 'orchestrator' && halted === 'orchestrator' && !all;
    if (version === 'hub' && stationId === 'orchestrator' && !coreOnly) all = true;
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
    const nodes = coreOnly ? [] : all ? stations : stations.filter((s) => s.id === stationId);
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
  const tikTokSources = Object.values(collection.run?.sources ?? {}).filter(source => source.platform === 'tiktok');
  const emptyTikTokPause = workspace && collection.run?.status === 'completed' &&
    tikTokSources.some(source => source.stopCode === 'TIKTOK_SAMPLE_PAUSED') &&
    tikTokSources.every(source => source.comments === 0);
  const emptyCycle = emptyTikTokPause && collection.run?.skipped.includes('ideas') &&
    collection.run?.skipped.includes('analytics') && collection.run?.skipped.includes('telegram');
  const emptyPanel = (selected === 'tiktok' && emptyTikTokPause) || (selected === 'orchestrator' && emptyCycle);
  for (const s of items) {
    states[s.id] =
      (emptyTikTokPause && (s.id === 'tiktok' || s.id === 'comments' && collection.run?.skipped.includes('telegram'))) ||
      (emptyCycle && s.id === 'orchestrator') ||
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
  const tiktokFailure = collection.run?.failures?.tiktok;
  const panelError =
    selected &&
    (collection.run?.failures?.[selected] ||
      (selected === 'orchestrator' && collection.run?.error));
  const panelSources = Object.entries(collection.run?.sources ?? {}).filter(([, source]) => {
    if (selected === 'tiktok') return source.platform === 'tiktok';
    if (selected !== 'orchestrator') return false;
    if (emptyCycle && source.platform === 'tiktok') return true;
    if (corePartial) return source.status !== 'completed';
    return (
      collection.run?.status === 'running' &&
      source.platform === 'tiktok' &&
      source.status === 'reading' &&
      !!source.retry
    );
  });
  const deferredTikTok = panelSources.some(
    ([, source]) =>
      source.platform === 'tiktok' &&
      source.status === 'limited' &&
      ['TIKTOK_DEFERRED', 'TIKTOK_RETRY_EXHAUSTED', 'TIKTOK_RETRY_TOO_LATE'].includes(
        source.stopCode ?? '',
      ),
  );
  const tiktokProblem =
    workspace &&
    tiktokFailure &&
    (selected === 'tiktok' || (corePartial && !collection.run?.failures?.telegram));
  const issueSource = panelSources.find(([, source]) =>
    source.platform === 'tiktok' && !['completed', 'reading'].includes(source.status))?.[1];
  const emptyApifyResult = !!tiktokProblem && issueSource?.stopCode?.startsWith('APIFY_') &&
    !issueSource.receivedComments;
  const panelIssue =
    workspace &&
    (collection.error ||
      (tiktokProblem
        ? tiktokNotice(issueSource)
        : panelError));
  const currentRun = collection.run;
  const runHasRecords = !!currentRun && currentRun.counts.posts + currentRun.counts.comments > 0;
  const reportEvents = events.filter((event) => event !== panelError && event !== tiktokFailure);
  const tiktokCommentRequest =
    selected === 'tiktok' &&
    panelSources.some(([, source]) =>
      ['comments', 'replies'].includes(source.failedRequest?.stage ?? ''),
    );
  const panelStep =
    selected && done.includes(selected)
      ? (station?.steps.length ?? 0)
      : tiktokCommentRequest
        ? 1
        : selected === active
          ? step
          : selected
            ? (stationSteps[selected] ?? -1)
            : -1;
  const panelRunning = panelState === 'run';
  const panelRetry =
    workspace &&
    currentRun?.status === 'running' &&
    panelSources.some(([, source]) => source.status === 'reading' && source.retry);
  const tiktokCommentsSaved =
    selected === 'tiktok' && panelSources.some(([, source]) => source.comments > 0);
  const panelControlsRun = running && (panelRunning || panelRetry || (followRun.current && cycle));
  const requestRun = (all: boolean, scope = selected ?? 'toolbar') => {
    if (running || repeat || (workspace && (collection.loading || collection.pending))) return;
    const stationId = scope === 'toolbar' ? null : selected;
    if (resumesTikTok(all, stationId)) {
      void run(all, stationId, scope);
      return;
    }
    if (workspace && (stationId === 'tiktok' || stationId === 'telegram' || all)) {
      void run(all, stationId, scope);
      return;
    }
    if (
      (all && done.length > 0) ||
      (stationId && done.includes(stationId)) ||
      (workspace && (stationId === 'telegram' || stationId === 'tiktok') && runHasRecords)
    )
      setRepeat({ all, stationId, scope });
    else void run(all, stationId, scope);
  };
  const showActionIssue = (scope: string) =>
    actionIssue?.scope === scope && (
      <div className="wg-action-error" role="alert">
        <span>{actionIssue.message}</span>
        {actionIssue.settings && openSources && (
          <button
            className="ec-text"
            onClick={() => {
              close();
              openSources(scope === 'telegram' ? 'telegram' : 'tiktok');
            }}
          >
            Настроить источники
          </button>
        )}
      </div>
    );
  const reportRows = (
      <AnimatePresence initial={false}>
        {[...new Set(reportEvents)].map((event) => (
          <motion.div
            key={event}
            className="wg-event-row"
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
  );
  const panelReport = reportEvents.length > 0 && (workspace
    ? <RunReports key={selected + (currentRun?.id ?? '')}>{reportRows}</RunReports>
    : <div className="wg-events"><h4>Материалы</h4>{reportRows}</div>
  );
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
            onClick={() => (running ? stop() : requestRun(true, 'toolbar'))}
          >
            {running ? <StopIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
            {workspace && collection.pending
              ? running
                ? 'Останавливаем…'
                : 'Запускаем…'
              : running
                ? 'Остановить цикл'
                : 'Запустить весь цикл'}
          </button>
        </div>
      </div>
      {showActionIssue('toolbar')}
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
            <div className="wg-panel-scroll">
              <div className="wg-panel-title">
                <span className="wg-panel-icon">
                  <station.Icon size={24} weight="duotone" />
                </span>
                <div>
                  <h3>{station.name}</h3>
                  <small>{station.sub}</small>
                </div>
              </div>
              {workspace && currentRun && station.id !== 'tiktok' && (
                <div key={currentRun.id} className="wg-real-counts" role="status">
                  {currentRun.previousTikTokRun && <small>Последний основной сбор</small>}
                  {runCounters.map(([key, label]) => {
                    const value = (currentRun.previousTikTokRun?.counts ?? currentRun.counts)[key];
                    return (
                      <span key={key}>
                        {label}{' '}
                        <b>
                          <span className="sr-only">{value}</span>
                          <span aria-hidden="true">
                            <AnimatedNumber value={value} duration={0.45} animateOnMount={false} />
                          </span>
                        </b>
                      </span>
                    );
                  })}
                  {station.id === 'orchestrator' && currentRun.aiCostUsd !== undefined && (
                    <div className="wg-analysis-cost" title="Расчёт по тарифу модели OpenAI за этот запуск">
                      <span>Расход OpenAI за запуск</span>
                      <strong>{currentRun.aiCostUsd > 0 ? '≈ ' : ''}{currentRun.aiCostUsd.toLocaleString('ru-RU', {
                        style: 'currency', currency: 'USD', minimumFractionDigits: 2,
                        maximumFractionDigits: currentRun.aiCostUsd > 0 && currentRun.aiCostUsd < 0.01 ? 5 : 2,
                      })}</strong>
                    </div>
                  )}
                </div>
              )}
              {panelIssue && (
                <motion.p
                  key={panelIssue}
                  initial={reduced ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduced ? 0 : 0.18 }}
                  className="wg-real-error"
                  data-partial={(partialRun && !emptyApifyResult && !collection.error) || undefined}
                  role="status"
                >
                  <span>{panelIssue}</span>
                  {tiktokProblem && !emptyApifyResult && !deferredTikTok && runHasRecords && !collection.error && (
                    <span>Собранные данные сохранены.</span>
                  )}
                </motion.p>
              )}
              {workspace &&
                openSources &&
                (station.id === 'telegram' || station.id === 'tiktok') && (
                  <WorkshopSources
                    platform={station.id}
                    open={() => {
                      close();
                      openSources(station.id as 'telegram' | 'tiktok');
                    }}
                  />
                )}
              {workspace &&
                panelSources.map(([id, source]) => source.provider === 'apify' ? (
                  <section className="wg-sample" key={id} aria-label="Выборка TikTok">
                    <header>
                      <h4>Выборка TikTok</h4>
                      <a href={source.url} target="_blank" rel="noreferrer" aria-label="Открыть источник TikTok">Источник ↗</a>
                    </header>
                    <dl>
                      <div><dt>Выбрано роликов</dt><dd>{source.videos?.selected ?? '—'}</dd></div>
                      <div><dt>Получено реплик</dt><dd>{(source.receivedComments ?? 0).toLocaleString('ru-RU')}</dd></div>
                      <div><dt>После отбора</dt><dd>{source.comments.toLocaleString('ru-RU')}</dd></div>
                      {source.sampleVideos !== undefined && source.comments > 0 && (
                        <div><dt>Роликов в отборе</dt><dd>{source.sampleVideos}</dd></div>
                      )}
                    </dl>
                    {source.status === 'completed' && source.comments === 0 && (
                      <p role="status">{source.receivedComments
                        ? 'Новых реплик для разбора по этим настройкам нет.'
                        : 'В выборке нет комментариев.'}</p>
                    )}
                  </section>
                ) : (
                  <div className="wg-configured-sources" key={id}>
                    <div>
                      <FileTextIcon size={15} />
                      <span>{source.platform === 'tiktok' ? 'Сбор TikTok' : 'Сбор Telegram'}</span>
                    </div>
                    <ul>
                      {source.threads ? (
                        <li>
                          Дочитано веток: {source.threads.completed} из {source.threads.selected}
                        </li>
                      ) : (
                        source.videos && source.stopCode === 'TIKTOK_SAMPLE_PAUSED' && source.comments === 0 ? (
                          <li>Роликов в выборке: {source.videos.selected}</li>
                        ) : source.videos && (
                          <li>
                            {source.platform === 'tiktok' && currentRun?.tiktokCollectionVersion
                              ? 'Основные комментарии по роликам'
                              : source.platform === 'tiktok' && (deferredTikTok || source.retry)
                              ? 'Ролики с завершённым сбором'
                              : 'Пройдено роликов'}
                            : {source.videos.processed} из {source.videos.selected}
                          </li>
                        )
                      )}
                      {source.platform === 'tiktok' && currentRun?.tiktokCollectionVersion &&
                        !currentRun.threadsOnly && currentRun.status === 'running' &&
                        source.status === 'reading' && source.videos && source.videos.selected > 0 &&
                        source.videos.processed === source.videos.selected &&
                        collection.pendingTikTokThreads !== null && collection.pendingTikTokThreads > 0 && (
                          <li>Веток с ответами в очереди профиля: {collection.pendingTikTokThreads}</li>
                        )}
                      {source.backlogVideos ? (
                        <li>Из предыдущих запусков: {source.backlogVideos} рол.</li>
                      ) : null}
                      <li>
                        {currentRun?.threadsOnly
                          ? 'Добавлено комментариев'
                          : 'Сохранено комментариев'}
                        : {source.comments}
                      </li>
                      {currentRun?.threadsOnly && (
                        <li>Идей с новыми основаниями: {currentRun.counts.ideas}</li>
                      )}
                      {!!source.reusedComments && <li>Из предыдущих сборов: {source.reusedComments}</li>}
                      {source.platform === 'tiktok' && currentRun?.followUp && (
                        <li role="status">
                          {{manual: [source.failedRequest?.responseIssue === 'access'
                            ? 'TikTok отклонил запрос публичного сборщика.'
                            : source.stopCode === 'TIKTOK_SAMPLE_PAUSED'
                            ? source.failedRequest?.videoNumber
                              ? `TikTok приостановил выдачу при чтении ролика №${source.failedRequest.videoNumber}.`
                              : 'TikTok приостановил выдачу комментариев.' :
                            source.stopCode === 'TIKTOK_SAMPLE_TIME' ? 'Прошло пять минут.' : '',
                            'Место чтения сохранено до следующего запуска.'].filter(Boolean).join(' '), queued: 'Дочитывание запланировано', reading: 'Дочитываем обсуждения',
                            complete: 'Дочитывание завершено', limited: 'Дочитывание завершено частично'}[currentRun.followUp.state]}
                          {currentRun.followUp.state === 'queued' && ' · ' + new Date(currentRun.followUp.at).toLocaleTimeString('ru-RU')}
                          {currentRun.followUp.state === 'limited' && currentRun.followUp.reason && ' · ' + currentRun.followUp.reason}
                        </li>
                      )}
                      {!!source.sampleVideos && <li>Роликов с комментариями в выборке: {source.sampleVideos}</li>}
                      {source.platform === 'tiktok' && currentRun?.aiUsage && currentRun.followUp &&
                        currentRun.followUp.sample < currentRun.counts.comments &&
                        <li>К моменту разбора сохранено реплик: {currentRun.followUp.sample}. Позже добавлено ещё {currentRun.counts.comments - currentRun.followUp.sample}.</li>}
                      {source.notices?.some(notice => notice.code === 'TIKTOK_SAVED_CATALOG') &&
                        <li>Использован последний сохранённый список роликов профиля.</li>}
                      {source.status === 'limited' &&
                        source.stopCode === 'TIKTOK_SAMPLE_TIME' && !currentRun?.followUp && <li>Непрочитанные страницы оставлены в очереди.</li>}
                      {!currentRun?.followUp && source.status === 'completed' &&
                        source.stopCode === 'TIKTOK_DEFERRED_REPLIES' && (
                          <li>Оставшиеся ответы цех проверит при следующем запуске.</li>
                        )}
                      {source.retry && source.status === 'reading' && (
                        <li role="status">
                          {(source.failedRequest?.responseIssue || source.retry.scope === 'discussions') && (
                            <>
                              {source.failedRequest?.responseIssue === 'access'
                                ? 'TikTok отклонил запрос публичного сборщика.'
                                : source.failedRequest?.responseIssue === 'empty'
                                ? 'TikTok вернул пустой ответ на запрос страницы.'
                                : source.failedRequest?.responseIssue === 'limited'
                                  ? 'TikTok временно ограничил частоту запросов.'
                                  : source.failedRequest?.responseIssue === 'overloaded'
                                    ? 'TikTok сообщил о перегрузке.'
                                    : 'TikTok временно не выдаёт комментарии к нескольким роликам.'}
                              <br />
                            </>
                          )}
                          Следующая попытка автоматически в{' '}
                          <time dateTime={source.retry.at}>
                            {new Date(source.retry.at).toLocaleTimeString('ru-RU', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </time>
                        </li>
                      )}
                      {source.status === 'completed' &&
                        source.stopCode === 'TIKTOK_PER_VIDEO_LIMIT' &&
                        source.limits && (
                          <li>
                            Лимит {source.limits.commentsPerVideo} комментариев достигнут на{' '}
                            {source.limits.limitedVideos} роликах
                          </li>
                        )}
                    </ul>
                    <a className="ec-text" href={source.url} target="_blank" rel="noreferrer">
                      Открыть источник
                      <ArrowRightIcon size={14} />
                    </a>
                  </div>
                ))}
              {workspace &&
                (panelRetry || deferredTikTok) &&
                currentRun &&
                currentRun.counts.ideas > 0 && (
                  <SiteLink
                    className="ec-text wg-available-ideas"
                    href="/materials?folder=video-ideas"
                  >
                    Открыть идеи видео
                  </SiteLink>
                )}
              <div className="wg-panel-source">
                <FileTextIcon size={16} />
                {workspace && station.id === 'tiktok' ? 'Отчёт TikTok' : workspace && station.id === 'orchestrator' ? 'Отчёт запуска' : station.steps.at(-1)}
                <StatusBadge
                  kind={panelRetry ? 'pause' : panelState}
                  label={
                    emptyApifyResult && station.id === 'tiktok'
                      ? 'Комментарии не получены'
                      : emptyPanel
                      ? 'Чтение комментариев приостановлено'
                      : panelRetry
                      ? 'Ожидание TikTok'
                      : corePartial
                        ? 'Частичный результат'
                        : panelState === 'done'
                          ? 'Готово'
                          : panelState === 'run'
                            ? transfer
                              ? 'Передача файла'
                              : 'В работе'
                            : panelState === 'pause'
                              ? workspace && tiktokProblem
                                ? runHasRecords
                                  ? 'Частичный результат'
                                  : 'Сбор не завершён'
                                : 'Пауза'
                              : 'Ожидает запуска'
                  }
                />
              </div>
              <ol className="wg-steps" aria-live="polite">
                {station.steps.map((label, i) => {
                  const commentsPaused = selected === 'tiktok' && emptyTikTokPause && i === 1;
                  const finished = panelStep > i && !commentsPaused;
                  const current = commentsPaused || panelStep === i && !finished;
                  const kind: StatusKind = finished
                    ? 'done'
                    : current
                      ? panelRunning && !panelRetry
                        ? 'run'
                        : 'pause'
                      : 'wait';
                  return (
                    <li key={label} className={finished ? 'is-done' : current ? 'is-current' : ''}>
                      <span className="wg-step-icon">
                        <StatusIcon kind={kind} size={18} key={kind} />
                      </span>
                      <div>
                        {label}
                        <small>
                          {commentsPaused
                            ? 'TikTok приостановил выдачу'
                            : finished
                            ? 'Завершено'
                            : current && panelRetry
                              ? 'Ждём следующей попытки'
                              : current && panelRunning
                                ? 'Выполняется…'
                                : current
                                  ? tiktokProblem && tiktokCommentsSaved
                                    ? 'Собрано частично'
                                    : 'Не завершено'
                                  : 'Ожидание'}
                        </small>
                      </div>
                      {current && panelRunning && !panelRetry && (
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
              {workspace && panelReport}
            </div>
            <div className="wg-panel-actions">
              {showActionIssue(station.id)}
              {workspace && (station.id === 'ideas' || station.id === 'tiktok') &&
                currentRun && !currentRun.ideaMode && currentRun.status !== 'running' && currentRun.counts.comments > 0 &&
                Object.values(currentRun.sources ?? {}).some(source => source.platform === 'tiktok') &&
                <AiIdeas key={currentRun.id} runId={currentRun.id} />}
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
                      ? stop(station.id)
                      : requestRun(station.id === 'orchestrator' && (workspace || halted !== station.id))
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
                        : resumesTikTok(false, station.id)
                          ? 'Продолжить сбор'
                          : workspace && station.id === 'orchestrator'
                            ? 'Запустить весь цикл'
                          : workspace && (station.id === 'tiktok' || station.id === 'telegram')
                            ? 'Собрать идеи'
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
                    runHasRecords)) && (
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
            {!workspace && panelReport}
          </motion.aside>
        )}
      </AnimatePresence>
      <AnimatePresence
        onExitComplete={() => {
          const target = pendingRepeat.current;
          pendingRepeat.current = null;
          if (target)
            requestAnimationFrame(() => void run(target.all, target.stationId, target.scope));
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
