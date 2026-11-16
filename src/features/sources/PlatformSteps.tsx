import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  ChartLineUpIcon,
  ChatCircleTextIcon,
  CheckIcon,
  FileTextIcon,
  MegaphoneSimpleIcon,
  ChatTextIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  UserCircleIcon,
} from '@phosphor-icons/react';
import { Segment } from '../../shared/ui';
import { SiteLink } from '../../app/navigation';
import { SourceSwitch } from './CollectionForm';
import { ConnectorAccount } from './ConnectorAccount';
import type { ConnectedAccount } from './connections';
import {
  kindNames,
  parseSource,
  platformNames,
  plural,
  type AnalysisSource,
  type CollectionSettings,
  type Platform,
  type PlatformSettings,
  type SourceKind,
} from './model';
import { saveCollectionSettings, savePlatformSettings, saveSource } from './repository';

const formats: Record<
  Platform,
  { kind: SourceKind; title: string; example: string; note: string; Icon: typeof PlayIcon }[]
> = {
  telegram: [
    {
      kind: 'channel',
      title: 'Канал',
      example: 't.me/channel',
      note: 'Все публикации за период',
      Icon: MegaphoneSimpleIcon,
    },
    {
      kind: 'publication',
      title: 'Публикация',
      example: 't.me/channel/123',
      note: 'Один пост и его обсуждение',
      Icon: ChatTextIcon,
    },
  ],
  tiktok: [
    {
      kind: 'profile',
      title: 'Профиль',
      example: '@name',
      note: 'Ролики профиля за период',
      Icon: UserCircleIcon,
    },
    {
      kind: 'video',
      title: 'Видео',
      example: 'tiktok.com/@name/video/…',
      note: 'Один ролик и комментарии',
      Icon: PlayIcon,
    },
  ],
};
const kindIcons = {
  channel: MegaphoneSimpleIcon,
  publication: ChatTextIcon,
  profile: UserCircleIcon,
  video: PlayIcon,
};

/** Range with a tick scale: ticks up to the value light up. */
function TickRange({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const share = (Math.min(Math.max(value, min), max) - min) / (max - min);
  return (
    <label className="dk-range">
      <span className="dk-range-head">
        <span>{label}</span>
        <output>{format(value)}</output>
      </span>
      <span className="dk-ticks" aria-hidden="true">
        {Array.from({ length: 36 }, (_, i) => (
          <i key={i} data-on={i / 35 <= share} style={{ '--i': i } as CSSProperties} />
        ))}
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function PeriodRuler({
  value,
  onChange,
}: {
  value: CollectionSettings['period'];
  onChange: (value: CollectionSettings['period']) => void;
}) {
  return (
    <div className="dk-ruler">
      <span className="dk-ruler-ticks" aria-hidden="true">
        {Array.from({ length: 90 }, (_, i) => (
          <i
            key={i}
            data-on={i < Number(value)}
            data-major={[6, 29, 89].includes(i)}
            style={{ '--i': i } as CSSProperties}
          />
        ))}
      </span>
      <div className="dk-ruler-stops" role="group" aria-label="Период сбора площадки">
        {(['7', '30', '90'] as const).map((days) => (
          <button
            key={days}
            type="button"
            data-days={days}
            aria-pressed={value === days}
            onClick={() => onChange(days)}
          >
            {days} дней
          </button>
        ))}
      </div>
    </div>
  );
}

function OptionRow({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="dk-option">
      <div className="dk-option-copy">
        <strong>{title}</strong>
        <small>{note}</small>
      </div>
      {children}
    </div>
  );
}

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
              <format.Icon size={20} weight="light" />
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
      <p className="dk-feedback" data-error={!!error} role={error ? 'alert' : undefined}>
        {error ||
          (detected
            ? `${kindNames[detected.kind]} · ${detected.url.replace('https://', '')}`
            : url.trim()
              ? problem
              : 'Вставьте ссылку — формат определится сам.')}
      </p>
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
                  <Icon size={17} />
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

function ParamsStep({
  platform,
  settings,
  platforms,
}: {
  platform: Platform;
  settings: CollectionSettings;
  platforms: PlatformSettings;
}) {
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(0);
  const own = platforms[platform];
  const current = own.custom ?? settings;
  function run(callback: () => void) {
    try {
      callback();
      setError('');
      setSaved((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить параметры.');
    }
  }
  const patch = (next: Partial<CollectionSettings>) =>
    run(() =>
      own.custom
        ? savePlatformSettings(platform, { ...own, custom: { ...own.custom, ...next } })
        : saveCollectionSettings({ ...settings, ...next }),
    );
  const types = [
    ['comments', 'Комментарии', ChatCircleTextIcon],
    ['publications', 'Публикации', FileTextIcon],
    ['metrics', 'Статистика', ChartLineUpIcon],
  ] as const;
  const active = types.filter(([key]) => current[key]).length;
  return (
    <div className="dk-params">
      <div className="dk-scope">
        <Segment
          size="sm"
          label={`Параметры ${platformNames[platform]}`}
          value={own.custom ? 'own' : 'common'}
          onChange={(value) =>
            run(() =>
              savePlatformSettings(platform, {
                ...own,
                custom: value === 'own' ? { ...settings } : null,
              }),
            )
          }
          values={[
            { id: 'common', label: 'Общие' },
            { id: 'own', label: `Только ${platformNames[platform]}` },
          ]}
        />
        <small>
          {own.custom
            ? `Свои параметры действуют только для ${platformNames[platform]}.`
            : 'Общие параметры действуют для всех площадок без собственных.'}
        </small>
        <AnimatePresence>
          {saved > 0 && !error && (
            <motion.span
              key={saved}
              className="dk-saved"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: [0, 1, 1, 0], y: 0 }}
              transition={{ duration: 1.8, times: [0, 0.1, 0.75, 1] }}
            >
              <CheckIcon size={12} weight="bold" />
              Сохранено
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="dk-params-grid">
        <div className="dk-field dk-field-wide">
          <span className="dk-field-title">Период</span>
          <PeriodRuler value={current.period} onChange={(period) => patch({ period })} />
        </div>
        <div className="dk-field">
          <span className="dk-field-title">Что собираем</span>
          <div className="dk-types">
            {types.map(([key, title, Icon]) => (
              <button
                key={key}
                type="button"
                aria-pressed={current[key]}
                aria-label={`Собирать: ${title}`}
                disabled={current[key] && active === 1}
                title={current[key] && active === 1 ? 'Нужен хотя бы один тип данных' : undefined}
                onClick={() => patch({ [key]: !current[key] })}
              >
                <Icon size={19} weight={current[key] ? 'regular' : 'light'} />
                {title}
                <span className="dk-type-led" />
              </button>
            ))}
          </div>
        </div>
        <div className="dk-field">
          <span className="dk-field-title">Лимиты на источник</span>
          <TickRange
            label="Публикации"
            value={current.maxPublications}
            min={10}
            max={500}
            step={10}
            format={(value) => `до ${value}`}
            onChange={(maxPublications) => patch({ maxPublications })}
          />
          <TickRange
            label="Комментарии"
            value={current.maxComments}
            min={100}
            max={10000}
            step={100}
            format={(value) => `до ${value.toLocaleString('ru')}`}
            onChange={(maxComments) => patch({ maxComments })}
          />
        </div>
      </div>
      <div className="dk-platform-options">
        <span className="dk-field-title">Особенности {platformNames[platform]}</span>
        {platform === 'telegram' ? (
          <>
            <OptionRow title="Ветки обсуждений" note="Ответы в чате обсуждения канала">
              <SourceSwitch
                label="Собирать ветки обсуждений"
                checked={platforms.telegram.threads}
                onChange={() =>
                  run(() =>
                    savePlatformSettings('telegram', {
                      ...platforms.telegram,
                      threads: !platforms.telegram.threads,
                    }),
                  )
                }
              />
            </OptionRow>
            <OptionRow title="Репосты" note="Публикации, пересланные из других каналов">
              <SourceSwitch
                label="Учитывать репосты"
                checked={platforms.telegram.forwards}
                onChange={() =>
                  run(() =>
                    savePlatformSettings('telegram', {
                      ...platforms.telegram,
                      forwards: !platforms.telegram.forwards,
                    }),
                  )
                }
              />
            </OptionRow>
            <TickRange
              label="Минимальная длина реплики"
              value={platforms.telegram.minLength}
              min={0}
              max={200}
              step={10}
              format={(value) =>
                value ? `от ${value} ${plural(value, 'символа', 'символов', 'символов')}` : 'любая'
              }
              onChange={(minLength) =>
                run(() => savePlatformSettings('telegram', { ...platforms.telegram, minLength }))
              }
            />
          </>
        ) : (
          <>
            <OptionRow title="Ответы на комментарии" note="Вложенные ветки под комментариями">
              <SourceSwitch
                label="Собирать ответы на комментарии"
                checked={platforms.tiktok.replies}
                onChange={() =>
                  run(() =>
                    savePlatformSettings('tiktok', {
                      ...platforms.tiktok,
                      replies: !platforms.tiktok.replies,
                    }),
                  )
                }
              />
            </OptionRow>
            <OptionRow title="Порядок выборки" note="Какие комментарии попадут в лимит первыми">
              <Segment
                size="sm"
                label="Порядок выборки комментариев"
                value={platforms.tiktok.order}
                onChange={(order) =>
                  run(() =>
                    savePlatformSettings('tiktok', {
                      ...platforms.tiktok,
                      order: order as PlatformSettings['tiktok']['order'],
                    }),
                  )
                }
                values={[
                  { id: 'top', label: 'Популярные' },
                  { id: 'recent', label: 'Новые' },
                ]}
              />
            </OptionRow>
            <TickRange
              label="Минимум лайков у комментария"
              value={platforms.tiktok.minLikes}
              min={0}
              max={1000}
              step={10}
              format={(value) =>
                value ? `от ${value} ${plural(value, 'лайка', 'лайков', 'лайков')}` : 'любое'
              }
              onChange={(minLikes) =>
                run(() => savePlatformSettings('tiktok', { ...platforms.tiktok, minLikes }))
              }
            />
          </>
        )}
      </div>
      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function PlatformSteps({
  platform,
  step,
  setStep,
  accounts,
  loading,
  unavailable,
  connect,
  disconnect,
  sources,
  settings,
  platforms,
  edit,
  remove,
  notify,
}: {
  platform: Platform;
  step: number;
  setStep: (step: number) => void;
  accounts: ConnectedAccount[];
  loading: boolean;
  unavailable: boolean;
  connect: (platform: Platform) => void;
  disconnect: (account: ConnectedAccount) => void;
  sources: AnalysisSource[];
  settings: CollectionSettings;
  platforms: PlatformSettings;
  edit: (source: AnalysisSource) => void;
  remove: (source: AnalysisSource) => void;
  notify: (text: string) => void;
}) {
  const reduced = useReducedMotion();
  const own = sources.filter((source) => source.platform === platform);
  const enabled = own.filter((source) => source.enabled).length;
  const list = accounts.filter((account) => account.platform === platform);
  const connected = list.find((account) => account.status === 'connected');
  const current = platforms[platform].custom ?? settings;
  const steps = [
    {
      title: 'Аккаунт',
      done: !!connected,
      summary: loading
        ? 'Проверяем'
        : connected
          ? connected.displayName
          : unavailable
            ? 'Не проверено'
            : list.length
              ? 'Нужно войти снова'
              : 'Не подключён',
      body: (
        <div className="dk-account">
          <p className="dk-lead">
            Аккаунт открывает доступ к каналам и публикациям. Пароль и сессия не хранятся в
            браузере.
          </p>
          <ConnectorAccount
            platform={platform}
            accounts={accounts}
            loading={loading}
            unavailable={unavailable}
            connect={connect}
            disconnect={disconnect}
          />
          <div className="dk-next">
            <button className="ec-button ec-white" onClick={() => setStep(1)}>
              К источникам
              <ArrowRightIcon size={16} />
            </button>
            <small>Без аккаунта источники тоже сохранятся.</small>
          </div>
        </div>
      ),
    },
    {
      title: 'Источники',
      done: own.length > 0,
      summary: own.length
        ? `${own.length} ${plural(own.length, 'источник', 'источника', 'источников')} · ${enabled} в сборе`
        : 'Пусто',
      body: (
        <>
          <SourcesStep
            platform={platform}
            sources={sources}
            edit={edit}
            remove={remove}
            notify={notify}
          />
          <div className="dk-next">
            <button className="ec-button" onClick={() => setStep(2)}>
              Параметры сбора
              <ArrowRightIcon size={16} />
            </button>
          </div>
        </>
      ),
    },
    {
      title: 'Параметры',
      done: enabled > 0,
      summary: `${current.period} дней · ${platforms[platform].custom ? 'свои' : 'общие'}`,
      body: <ParamsStep platform={platform} settings={settings} platforms={platforms} />,
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
      <li className="dk-step dk-final" data-ready={enabled > 0}>
        <span className="dk-final-dot" aria-hidden="true" />
        <div className="dk-step-head">
          <span className="dk-step-title">
            {enabled > 0 ? 'Готово к сбору' : 'Нет источников в сборе'}
          </span>
          <span className="dk-step-meta">
            <SiteLink href="/">
              К цеху
              <ArrowRightIcon size={14} />
            </SiteLink>
          </span>
        </div>
        <div className="dk-stats">
          <div>
            <strong>{enabled}</strong>
            <span>В сборе</span>
          </div>
          <div>
            <strong>{current.period} дн.</strong>
            <span>Период</span>
          </div>
          <div>
            <strong>{(enabled * current.maxComments).toLocaleString('ru')}</strong>
            <span>Комментариев максимум</span>
          </div>
        </div>
      </li>
    </ol>
  );
}
