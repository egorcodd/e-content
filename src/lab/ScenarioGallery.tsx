import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  PlugsConnectedIcon,
  PlayIcon,
  StopIcon,
  TelegramLogoIcon,
  TiktokLogoIcon,
} from '@phosphor-icons/react';
import {
  downloadText,
  SectionHeading,
  Segment,
  StatusBadge,
  StatusIcon,
  type StatusKind,
} from '../shared/ui';
import { waitForStage } from '../features/workshop/workflow';
import './scenario-gallery.css';

type Scenario = 'empty' | 'success' | 'failure';
type Phase = 'empty' | 'ready' | 'collect' | 'analyze' | 'save' | 'done' | 'partial' | 'stopped';
type Source = { kind: StatusKind; detail: string };
type Snapshot = {
  phase: Phase;
  telegram: Source;
  tiktok: Source;
  result: 'none' | 'partial' | 'full';
  retry: boolean;
};
const scenarios = [
  { id: 'empty', label: 'Первый запуск' },
  { id: 'success', label: 'Успешный цикл' },
  { id: 'failure', label: 'Сбой источника' },
];
const connected: Source = { kind: 'wait', detail: 'Подключён · готов к сбору' };
function initial(scenario: Scenario): Snapshot {
  const source: Source =
    scenario === 'empty' ? { kind: 'wait', detail: 'Не подключён' } : connected;
  return {
    phase: scenario === 'empty' ? 'empty' : 'ready',
    telegram: source,
    tiktok: source,
    result: 'none',
    retry: false,
  };
}
const phaseLabels: Record<Phase, string> = {
  empty: 'Нет данных',
  ready: 'Готов к запуску',
  collect: 'Сбор данных',
  analyze: 'Анализ материалов',
  save: 'Сохранение файлов',
  done: 'Цикл завершён',
  partial: 'Частичный результат',
  stopped: 'Цикл остановлен',
};

export function ScenarioGallery() {
  const [scenario, setScenario] = useState<Scenario>('empty');
  const [state, setState] = useState<Snapshot>(() => initial('empty'));
  const controller = useRef<AbortController | null>(null);
  const reducedMotion = useReducedMotion();
  useEffect(() => () => controller.current?.abort(), []);
  const busy = ['collect', 'analyze', 'save'].includes(state.phase);
  const hasResult = state.result !== 'none';
  const partial = state.result === 'partial';
  const failed = state.tiktok.kind === 'err';
  const status: StatusKind = busy
    ? 'run'
    : state.phase === 'done'
      ? 'done'
      : state.phase === 'partial' || state.phase === 'stopped'
        ? 'pause'
        : 'wait';

  function select(id: string) {
    controller.current?.abort();
    setScenario(id as Scenario);
    setState(initial(id as Scenario));
  }
  function stop() {
    controller.current?.abort();
    setState((current) => ({
      ...current,
      phase: 'stopped',
      telegram:
        current.telegram.kind === 'run'
          ? { kind: 'pause', detail: 'Сбор остановлен' }
          : current.telegram,
      tiktok:
        current.tiktok.kind === 'run'
          ? { kind: 'pause', detail: 'Сбор остановлен' }
          : current.tiktok,
    }));
  }
  async function run(retry = false) {
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    const pause = async (ms: number) => {
      await waitForStage(ms, task.signal);
      return !task.signal.aborted;
    };
    const shouldFail = scenario === 'failure' && !retry;
    const working: Source = {
      kind: 'run',
      detail: retry ? 'Повторное подключение…' : 'Получаем материалы…',
    };
    setState((current) => ({
      ...current,
      phase: 'collect',
      retry,
      result: retry ? current.result : 'none',
      telegram: retry ? current.telegram : working,
      tiktok: working,
    }));
    if (!(await pause(850))) return;
    if (!retry)
      setState((current) => ({
        ...current,
        telegram: { kind: 'done', detail: '4 канала · 24 комментария' },
      }));
    if (!(await pause(800))) return;
    setState((current) => ({
      ...current,
      phase: 'analyze',
      tiktok: shouldFail
        ? { kind: 'err', detail: 'Источник не ответил · тайм-аут' }
        : { kind: 'done', detail: '12 роликов · данные получены' },
    }));
    if (!(await pause(1100))) return;
    setState((current) => ({ ...current, phase: 'save' }));
    if (!(await pause(850))) return;
    setState((current) => ({
      ...current,
      phase: shouldFail ? 'partial' : 'done',
      result: shouldFail ? 'partial' : 'full',
    }));
  }
  function exportResult() {
    downloadText(
      'scenario-report.md',
      `# Отчёт e-content\n\nРезультат: ${partial ? 'частичный' : 'полный'}.\n\n- Telegram: 4 канала, 24 комментария\n- TikTok: ${partial ? 'недоступен, данные отсутствуют' : '12 роликов'}\n- Идеи: ${partial ? 5 : 8}\n`,
    );
  }
  const stages = [
    {
      title: state.retry ? 'Повторный сбор' : 'Сбор',
      detail: state.retry ? 'Только TikTok' : 'Telegram и TikTok',
    },
    { title: 'Анализ', detail: failed ? 'Материалы Telegram' : 'Комментарии и темы' },
    { title: 'Сохранение', detail: 'Отчёт в Markdown' },
  ];
  const activeStage = ['collect', 'analyze', 'save'].indexOf(state.phase);
  const descriptions: Record<Scenario, string> = {
    empty: 'Подключите источники, чтобы собрать первые материалы.',
    success: 'Оба источника передают данные. Цех собирает идеи и сохраняет отчёт.',
    failure: 'TikTok не отвечает. Цех сохраняет результат Telegram и предлагает повторить сбор.',
  };

  return (
    <section id="scenarios" className="ec-section">
      <SectionHeading number="05" title="Состояния и сценарии" />
      <div className="sg-switcher">
        <Segment label="Сценарий работы" values={scenarios} value={scenario} onChange={select} />
        <button className="ec-button ec-ghost" onClick={() => select(scenario)}>
          <ArrowClockwiseIcon size={17} />
          Сбросить
        </button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={scenario}
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.18 }}
          className="sg-workspace"
          data-phase={state.phase}
          data-result={state.result}
          aria-label="Ход сценария"
        >
          <div className="sg-topline">
            <div>
              <h3>{scenarios.find((item) => item.id === scenario)?.label}</h3>
              <p>{descriptions[scenario]}</p>
            </div>
            <StatusBadge kind={status} label={phaseLabels[state.phase]} />
          </div>
          <div className="sg-body">
            <div className="sg-process">
              <div className="sg-sources">
                {(['telegram', 'tiktok'] as const).map((id) => {
                  const source = state[id];
                  const Icon = id === 'telegram' ? TelegramLogoIcon : TiktokLogoIcon;
                  return (
                    <div className="sg-source" key={id} data-source={id}>
                      <span className="sg-source-icon">
                        <Icon size={25} />
                      </span>
                      <div>
                        <strong>{id === 'telegram' ? 'Telegram' : 'TikTok'}</strong>
                        <span>{source.detail}</span>
                      </div>
                      <StatusIcon kind={source.kind} size={18} />
                    </div>
                  );
                })}
              </div>
              <ol className="sg-stages" aria-label="Этапы цикла">
                {stages.map((stage, index) => {
                  const done = (hasResult && !busy) || activeStage > index;
                  const kind: StatusKind =
                    activeStage === index
                      ? 'run'
                      : done
                        ? index === 0 && failed
                          ? 'pause'
                          : 'done'
                        : 'wait';
                  return (
                    <li key={index} data-active={activeStage === index}>
                      <div className="sg-stage-marker">
                        <StatusIcon kind={kind} size={19} />
                      </div>
                      <div>
                        <strong>{stage.title}</strong>
                        <span>{stage.detail}</span>
                      </div>
                      {index < 2 && <ArrowRightIcon className="sg-stage-arrow" size={18} />}
                    </li>
                  );
                })}
              </ol>
              <div className="sg-actions">
                {state.phase === 'empty' ? (
                  <button
                    className="ec-button ec-white"
                    onClick={() => setState(initial('success'))}
                  >
                    <PlugsConnectedIcon size={18} />
                    Подключить источники
                  </button>
                ) : busy ? (
                  <button className="ec-button" onClick={stop}>
                    <StopIcon size={17} />
                    Остановить
                  </button>
                ) : state.phase === 'partial' || (state.phase === 'stopped' && partial) ? (
                  <button className="ec-button ec-white" onClick={() => void run(true)}>
                    <ArrowClockwiseIcon size={17} />
                    Повторить только TikTok
                  </button>
                ) : (
                  <button className="ec-button ec-white" onClick={() => void run()}>
                    <PlayIcon size={17} weight="fill" />
                    {state.phase === 'done' ? 'Проиграть ещё раз' : 'Запустить цикл'}
                  </button>
                )}
                {busy && (
                  <span>
                    {state.retry ? 'Telegram сохранён, обновляем TikTok' : 'Обработка материалов'}
                  </span>
                )}
              </div>
            </div>
            <div className="sg-result">
              <div className="sg-result-heading">
                <FileTextIcon size={20} />
                <span>Результат цикла</span>
              </div>
              <motion.div
                className="sg-result-content"
                key={state.result}
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="sg-result-number">
                  {hasResult ? (partial ? '5' : '8') : '—'}
                  <span>идей собрано</span>
                </div>
                <dl className="sg-metrics">
                  <div>
                    <dt>Источники в отчёте</dt>
                    <dd>{hasResult ? (partial ? '1 из 2' : '2 из 2') : '—'}</dd>
                  </div>
                  <div>
                    <dt>Комментарии</dt>
                    <dd>{hasResult ? '24' : '—'}</dd>
                  </div>
                  <div>
                    <dt>Ролики</dt>
                    <dd>{hasResult && !partial ? '12' : '—'}</dd>
                  </div>
                </dl>
                <p>
                  {hasResult
                    ? partial
                      ? 'TikTok не включён. Данные Telegram сохранены.'
                      : 'Оба источника включены в общий отчёт.'
                    : busy
                      ? 'Отчёт появится после сохранения.'
                      : 'Материалы ещё не собраны.'}
                </p>
                <button
                  className="ec-button sg-export"
                  disabled={!hasResult || busy}
                  onClick={exportResult}
                >
                  <DownloadSimpleIcon size={17} />
                  Скачать отчёт .md
                </button>
              </motion.div>
            </div>
          </div>
          <div
            className={'sg-message' + (failed ? ' sg-message-error' : '')}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <StatusIcon kind={failed ? 'err' : status} size={18} />
            <span>
              {busy
                ? phaseLabels[state.phase] +
                  (failed
                    ? '. TikTok недоступен, продолжаем с Telegram.'
                    : state.retry
                      ? '. Повторная попытка для TikTok.'
                      : '.')
                : state.phase === 'partial'
                  ? 'TikTok не ответил. Повторная попытка дополнит отчёт, результат Telegram останется.'
                  : state.phase === 'done'
                    ? state.retry
                      ? 'TikTok восстановлен. Общий отчёт обновлён без повторного сбора Telegram.'
                      : 'Цикл завершён. Отчёт готов к скачиванию.'
                    : state.phase === 'stopped'
                      ? 'Запуск остановлен. Незавершённые этапы не сохраняются.'
                      : state.phase === 'empty'
                        ? 'Источники не подключены. Прочерк означает, что данных пока нет.'
                        : 'Источники подключены. Можно запустить сбор.'}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
