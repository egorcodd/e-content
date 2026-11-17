import { useState } from 'react';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { Segment } from '../../shared/ui';
import { ParameterRange } from './ParameterRange';
import { SourceSwitch } from './SourceSwitch';
import { SettingsDisclosure } from './SettingsDisclosure';
import { useConnections } from './connection-store';
import { resolveCollectionSettings } from './collection-policy';
import { savePlatformSettings } from './repository';
import {
  platformNames,
  type CollectionSettings,
  type Platform,
  type PlatformSettings,
  type RunLimits,
} from './model';

export function PlatformCollectionSettings({
  platform,
  settings,
  platforms,
  runLimits,
}: {
  platform: Platform;
  settings: CollectionSettings;
  platforms: PlatformSettings;
  runLimits: RunLimits;
}) {
  const [error, setError] = useState('');
  const { tiktokAccount } = useConnections();
  const native = platform === 'tiktok' && tiktokAccount?.transport === 'native';
  const own = platforms[platform];
  const { values, origins } = resolveCollectionSettings(settings, own.custom);
  const changed = Object.keys(own.custom ?? {}).filter(
    (key) => !native || !['maxPublications', 'maxComments'].includes(key),
  ).length;
  const name = platformNames[platform];
  const run = (callback: () => void) => {
    try {
      callback();
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить параметры.');
    }
  };
  const patch = (next: Partial<CollectionSettings>) =>
    run(() => savePlatformSettings(platform, { ...own, custom: { ...own.custom, ...next } }));
  const reset = (field: keyof CollectionSettings, label: string) =>
    !native && origins[field] === 'platform' ? (
      <button
        type="button"
        className="platform-setting-reset"
        aria-label={`Сбросить ${label} для ${name}`}
        title="Вернуть общее значение"
        onClick={() =>
          run(() => {
            const custom = { ...own.custom };
            delete custom[field];
            savePlatformSettings(platform, { ...own, custom });
          })
        }
      >
        <ArrowCounterClockwiseIcon size={14} />
      </button>
    ) : null;
  const types = [
    ['comments', 'Комментарии'],
    ['publications', 'Публикации'],
    ['metrics', platform === 'tiktok' ? 'Счётчики в отчёте' : 'Счётчики'],
  ] as const;
  const active = types.filter(([key]) => values[key]).length;
  const commentsEnabled =
    values.comments && (native ? runLimits.maxComments > 0 : values.maxComments > 0);
  return (
    <aside className="platform-settings" aria-label={`Параметры ${name}`}>
      <header className="platform-settings-heading">
        <div>
          <h2>{native ? 'Данные TikTok' : `Параметры ${name}`}</h2>
          {!native && (
            <small>{changed ? `Изменено полей: ${changed}` : 'Используются общие настройки'}</small>
          )}
        </div>
        {changed > 0 && (
          <button
            type="button"
            className={native ? 'platform-setting-reset' : 'ec-text'}
            aria-label={native ? 'Вернуть общие настройки TikTok' : undefined}
            title={native ? 'Вернуть общие настройки' : undefined}
            onClick={() => run(() => savePlatformSettings(platform, { ...own, custom: null }))}
          >
            {native ? <ArrowCounterClockwiseIcon size={14} aria-hidden="true" /> : 'Сбросить всё'}
          </button>
        )}
      </header>
      <div className="platform-period">
        <div className="platform-setting-label">
          <span>{native ? 'Период комментариев' : 'Период анализа'}</span>
          {reset('period', 'период')}
        </div>
        <Segment
          size="sm"
          label={`Период анализа ${name}`}
          value={values.period}
          onChange={(period) => patch({ period: period as CollectionSettings['period'] })}
          values={['7', '30', '90'].map((id) => ({ id, label: `${id} дней` }))}
        />
      </div>
      <fieldset className="platform-data-types">
        <legend>Что собирать</legend>
        {types.map(([key, title]) => (
          <div className="platform-toggle-row" key={key}>
            <span>{title}</span>
            {reset(key, title.toLocaleLowerCase('ru'))}
            <SourceSwitch
              label={`Собирать: ${title}`}
              checked={values[key]}
              disabled={values[key] && active === 1}
              onChange={() => patch({ [key]: !values[key] })}
            />
          </div>
        ))}
      </fieldset>
      {!native && (
        <div className="platform-limits" data-single={platform === 'tiktok'}>
          {platform === 'telegram' && (
            <div>
              <ParameterRange
                label="Публикации"
                value={values.maxPublications}
                max={500}
                volumeBudget={runLimits.maxPublications}
                format={(value) => (value ? `до ${value}` : 'Не собирать')}
                onChange={(maxPublications) => patch({ maxPublications })}
              />
              <div className="platform-limit-note">
                <span>На источник</span>
                {reset('maxPublications', 'лимит публикаций')}
              </div>
            </div>
          )}
          <div>
            <ParameterRange
              label="Комментарии"
              value={values.maxComments}
              max={10000}
              volumeBudget={runLimits.maxComments}
              disabled={!values.comments}
              format={(value) => (value ? `до ${value.toLocaleString('ru')}` : 'Не собирать')}
              onChange={(maxComments) => patch({ maxComments })}
            />
            <div className="platform-limit-note">
              <span>Включая ответы</span>
              {reset('maxComments', 'лимит комментариев')}
            </div>
          </div>
        </div>
      )}
      <SettingsDisclosure title="Дополнительно">
        {platform === 'telegram' ? (
          <>
            <div className="platform-toggle-row" data-disabled={!commentsEnabled}>
              <span>Ответы в обсуждениях</span>
              <SourceSwitch
                label="Собирать ответы внутри обсуждений"
                checked={platforms.telegram.threads}
                disabled={!commentsEnabled}
                onChange={() =>
                  run(() =>
                    savePlatformSettings('telegram', {
                      ...platforms.telegram,
                      threads: !platforms.telegram.threads,
                    }),
                  )
                }
              />
            </div>
            <div className="platform-toggle-row">
              <span>Пересланные публикации</span>
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
            </div>
            <ParameterRange
              label="Минимальная длина реплики"
              value={platforms.telegram.minLength}
              max={500}
              disabled={!commentsEnabled}
              format={(value) => (value ? `от ${value} симв.` : 'Любая')}
              onChange={(minLength) =>
                run(() => savePlatformSettings('telegram', { ...platforms.telegram, minLength }))
              }
            />
          </>
        ) : (
          <>
            <div className="platform-toggle-row" data-disabled={!commentsEnabled}>
              <span>Ответы на комментарии</span>
              <SourceSwitch
                label="Собирать ответы на комментарии"
                checked={platforms.tiktok.replies}
                disabled={!commentsEnabled}
                onChange={() =>
                  run(() =>
                    savePlatformSettings('tiktok', {
                      ...platforms.tiktok,
                      replies: !platforms.tiktok.replies,
                    }),
                  )
                }
              />
            </div>
            <ParameterRange
              label="Минимум лайков у комментария"
              value={platforms.tiktok.minLikes}
              max={10000}
              disabled={!commentsEnabled}
              format={(value) => (value ? `от ${value.toLocaleString('ru')}` : 'Любое')}
              onChange={(minLikes) =>
                run(() => savePlatformSettings('tiktok', { ...platforms.tiktok, minLikes }))
              }
            />
            {platforms.tiktok.order === 'recent' && (
              <button
                className="ec-text"
                onClick={() =>
                  run(() =>
                    savePlatformSettings('tiktok', { ...platforms.tiktok, order: 'platform' }),
                  )
                }
              >
                Вернуть порядок комментариев площадки
              </button>
            )}
          </>
        )}
      </SettingsDisclosure>
      {error && (
        <p className="sp-error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
