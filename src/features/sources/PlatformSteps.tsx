import { useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowSquareOutIcon,
  CheckIcon,
  BroadcastIcon,
  ArticleIcon,
  PencilSimpleIcon,
  PlayCircleIcon,
  PlusIcon,
  TrashIcon,
  UserSquareIcon,
  type Icon,
} from '@phosphor-icons/react';
import { Segment } from '../../shared/ui';
import { SourceSwitch } from './SourceSwitch';
import { ConnectorStatus } from './ConnectorStatus';
import './platform-steps.css';
import type { ConnectedAccount } from './connections';
import type { TikTokConnectionState } from './tiktok-contracts';
import { TikTokSelection } from './TikTokConnection';
import {
  kindNames,
  parseSource,
  platformNames,
  plural,
  type AnalysisSource,
  type Platform,
  type SourceKind,
} from './model';
import { saveSource } from './repository';

const kindIcons: Record<SourceKind, Icon> = {
  channel: BroadcastIcon,
  publication: ArticleIcon,
  profile: UserSquareIcon,
  video: PlayCircleIcon,
};
const formats: Record<
  Platform,
  { kind: SourceKind; title: string; example: string; note: string; Icon: Icon }[]
> = {
  telegram: [
    {
      kind: 'channel',
      title: 'Канал',
      example: 't.me/channel',
      note: 'Все публикации за период',
      Icon: kindIcons.channel,
    },
    {
      kind: 'publication',
      title: 'Публикация',
      example: 't.me/channel/123',
      note: 'Один пост и его обсуждение',
      Icon: kindIcons.publication,
    },
  ],
  tiktok: [
    {
      kind: 'profile',
      title: 'Профиль',
      example: '@name',
      note: 'Ролики профиля за период',
      Icon: kindIcons.profile,
    },
    {
      kind: 'video',
      title: 'Видео',
      example: 'tiktok.com/@name/video/…',
      note: 'Один ролик и комментарии',
      Icon: kindIcons.video,
    },
  ],
};

function SourcesStep({
  platform,
  sources,
  edit,
  remove,
  notify,
}: {
  platform: Platform;
  sources: AnalysisSource[];
  edit: (source: AnalysisSource) => void;
  remove: (source: AnalysisSource) => void;
  notify: (text: string) => void;
}) {
  const reduced = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [purpose, setPurpose] = useState<AnalysisSource['purpose']>('inspiration');
  const [example, setExample] = useState(formats[platform][0].example);
  const [error, setError] = useState('');
  let detected: ReturnType<typeof parseSource> | null = null;
  let problem = '';
  try {
    if (url.trim()) detected = parseSource(url, platform);
  } catch (error) {
    problem = error instanceof Error ? error.message : '';
  }
  const list = sources
    .filter((source) => source.platform === platform)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  function run(callback: () => void) {
    try {
      callback();
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить источник.');
    }
  }
  return (
    <div className="dk-sources">
      <div className="dk-formats" role="group" aria-label="Форматы источника">
        {formats[platform].map((format) => (
          <button
            key={format.kind}
            type="button"
            className="dk-format"
            data-detected={detected?.kind === format.kind}
            onClick={() => {
              setExample(format.example);
              input.current?.focus();
            }}
          >
            {detected?.kind === format.kind && (
              <motion.span
                layoutId={`dk-format-${platform}`}
                className="dk-format-frame"
                transition={{ type: 'spring', bounce: 0.2, duration: reduced ? 0 : 0.5 }}
              />
            )}
            <span className="dk-format-glyph">
              <format.Icon size={24} weight="regular" />
            </span>
            <span className="dk-format-copy">
              <strong>{format.title}</strong>
              <small>{format.note}</small>
              <code>{format.example}</code>
            </span>
            {detected?.kind === format.kind && <CheckIcon size={14} className="dk-format-check" />}
          </button>
        ))}
      </div>
      <form
        className="dk-add"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => {
            const parsed = parseSource(url, platform);
            saveSource({
              id: crypto.randomUUID(),
              platform,
              kind: parsed.kind,
              url: parsed.url,
              title: parsed.suggestedTitle,
              purpose,
              accountId: null,
              enabled: true,
              createdAt: new Date().toISOString(),
            });
            setUrl('');
            notify('Источник добавлен');
          });
        }}
      >
        <label className="dk-link" data-state={detected ? 'ok' : problem ? 'bad' : 'empty'}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={detected?.kind ?? 'link'}
              className="dk-link-icon"
              initial={reduced ? false : { scale: 0.4, opacity: 0, rotate: -30 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', bounce: 0.35, duration: reduced ? 0 : 0.45 }}
            >
              {detected ? (
                (() => {
                  const Icon = kindIcons[detected.kind];
                  return <Icon size={17} />;
                })()
              ) : (
                <PlusIcon size={17} />
              )}
            </motion.span>
          </AnimatePresence>
          <input
            ref={input}
            aria-label={`Ссылка на источник ${platformNames[platform]}`}
            value={url}
            maxLength={2048}
            autoComplete="off"
            spellCheck={false}
            placeholder={example}
            onChange={(event) => {
              setUrl(event.target.value);
              setError('');
            }}
          />
        </label>
        <Segment
          size="sm"
          label="Назначение нового источника"
          value={purpose}
          onChange={(value) => setPurpose(value as AnalysisSource['purpose'])}
          values={[
            { id: 'inspiration', label: 'Поиск идей' },
            { id: 'own', label: 'Мой контент' },
          ]}
        />
        <button className="ec-button ec-white" type="submit" disabled={!detected}>
          Добавить
        </button>
      </form>
      {(error || problem) && (
        <p className="dk-feedback" data-error="true" role="alert">
          {error || problem}
        </p>
      )}
      <ul className="dk-list" aria-label={`Источники ${platformNames[platform]}`}>
        <AnimatePresence initial={false}>
          {list.map((source) => {
            const Icon = kindIcons[source.kind];
            return (
              <motion.li
                key={source.id}
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, transition: { duration: reduced ? 0 : 0.2 } }}
                transition={{ type: 'spring', bounce: 0.15, duration: reduced ? 0 : 0.45 }}
                className="dk-row"
                data-enabled={source.enabled}
              >
                <span className="dk-row-icon">
                  <Icon size={22} weight="regular" />
                </span>
                <div className="dk-row-copy">
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.title}
                    <ArrowSquareOutIcon size={13} />
                  </a>
                  <small>
                    {kindNames[source.kind]} ·{' '}
                    {source.purpose === 'own' ? 'Мой контент' : 'Поиск идей'}
                  </small>
                </div>
                <SourceSwitch
                  checked={source.enabled}
                  label={`Анализировать ${source.title}`}
                  onChange={() => run(() => saveSource({ ...source, enabled: !source.enabled }))}
                />
                <button
                  className="ec-icon"
                  aria-label={`Настроить ${source.title}`}
                  onClick={() => edit(source)}
                >
                  <PencilSimpleIcon size={16} />
                </button>
                <button
                  className="ec-icon sp-delete"
                  aria-label={`Удалить источник ${source.title}`}
                  onClick={() => remove(source)}
                >
                  <TrashIcon size={16} />
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {!list.length && <li className="dk-list-empty">Пока пусто — добавьте первую ссылку.</li>}
      </ul>
    </div>
  );
}

export function PlatformSteps({
  platform,
  step,
  setStep,
  accounts,
  sources,
  edit,
  remove,
  notify,
  accountPanel,
  connection,
  tiktokComments,
}: {
  platform: Platform;
  step: number;
  setStep: (step: number) => void;
  accounts: ConnectedAccount[];
  sources: AnalysisSource[];
  edit: (source: AnalysisSource) => void;
  remove: (source: AnalysisSource) => void;
  notify: (text: string) => void;
  accountPanel: ReactNode;
  connection?: TikTokConnectionState;
  tiktokComments: { enabled: boolean; replies: boolean; runLimit: number };
}) {
  const reduced = useReducedMotion();
  const own = sources.filter((source) => source.platform === platform);
  const enabled = own.filter((source) => source.enabled).length;
  const list = accounts.filter((account) => account.platform === platform);
  const connected = list.find((account) => account.status === 'connected');
  const steps = [
    {
      title:
        platform === 'tiktok' && connection?.authentication === 'public' ? 'Профиль' : 'Аккаунт',
      done: platform === 'tiktok' ? connection?.phase === 'connected' : !!connected,
      summary: (
        <ConnectorStatus
          platform={platform}
          accounts={accounts}
          connectedLabel={connected?.displayName}
          connection={connection}
        />
      ),
      body: accountPanel,
    },
    {
      title:
        platform === 'tiktok'
          ? connection?.transport === 'native'
            ? 'Ролики для цеха'
            : 'Ролики'
          : 'Источники',
      done: own.length > 0,
      summary:
        platform === 'tiktok'
          ? connection?.account
            ? connection.transport === 'native'
              ? null
              : `Последние ${connection.selection.latest}`
            : 'Не выбраны'
          : own.length
            ? `${own.length} ${plural(own.length, 'источник', 'источника', 'источников')} · ${enabled} в сборе`
            : 'Пусто',
      body:
        platform === 'tiktok' ? (
          <TikTokSelection
            commentsEnabled={tiktokComments.enabled}
            includeReplies={tiktokComments.replies}
            runCommentLimit={tiktokComments.runLimit}
          />
        ) : (
          <SourcesStep
            platform={platform}
            sources={sources}
            edit={edit}
            remove={remove}
            notify={notify}
          />
        ),
    },
  ];
  return (
    <ol className="dk-rail" aria-label={`Настройка ${platformNames[platform]}`}>
      {steps.map((item, index) => (
        <li
          key={item.title}
          className="dk-step"
          data-state={step === index ? 'open' : item.done ? 'done' : 'idle'}
        >
          <span className="dk-bar" aria-hidden="true" />
          <button
            className="dk-step-head"
            aria-expanded={step === index}
            onClick={() => setStep(index)}
          >
            <span className="dk-step-title">{item.title}</span>
            <span className="dk-step-meta">{item.summary}</span>
          </button>
          <AnimatePresence initial={false}>
            {step === index && (
              <motion.div
                className="dk-step-body"
                initial={reduced ? false : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="dk-step-inner">{item.body}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </li>
      ))}
    </ol>
  );
}
