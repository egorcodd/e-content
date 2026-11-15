import { useState } from 'react';
import {
  ChatCircleTextIcon,
  FileTextIcon,
  ChartLineUpIcon,
  SlidersHorizontalIcon,
  CheckIcon,
} from '@phosphor-icons/react';
import { Segment } from '../../shared/ui';
import { saveCollectionSettings } from './repository';
import type { CollectionSettings } from './model';

export function SourceSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className="sp-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    >
      <span>{checked && <CheckIcon size={10} weight="bold" />}</span>
    </button>
  );
}
export function CollectionForm({
  settings,
  notify,
}: {
  settings: CollectionSettings;
  notify: (text: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  return (
    <aside className="sp-collection ec-glow" aria-label="Параметры сбора">
      <div className="sp-section-title">
        <SlidersHorizontalIcon size={20} />
        <h2>Параметры сбора</h2>
      </div>
      <form
        className="sp-form"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            saveCollectionSettings(draft);
            setError('');
            notify('Параметры сбора сохранены');
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Не удалось сохранить параметры.');
          }
        }}
      >
        <div className="sp-form-field">
          <span>За какой период</span>
          <Segment
            label="Период сбора"
            value={draft.period}
            onChange={(value) =>
              setDraft({ ...draft, period: value as CollectionSettings['period'] })
            }
            values={[
              { id: '7', label: '7 дней' },
              { id: '30', label: '30 дней' },
              { id: '90', label: '90 дней' },
            ]}
          />
        </div>
        <fieldset className="sp-data-types">
          <legend>Что собираем</legend>
          {(
            [
              ['comments', 'Комментарии', 'Вопросы и ветки ответов', ChatCircleTextIcon],
              ['publications', 'Публикации', 'Тексты постов и описания видео', FileTextIcon],
              ['metrics', 'Статистика', 'Доступные счётчики площадки', ChartLineUpIcon],
            ] as const
          ).map(([key, title, subtitle, Icon]) => (
            <div key={key} className="sp-data-row">
              <Icon size={19} />
              <div>
                <strong>{title}</strong>
                <small>{subtitle}</small>
              </div>
              <SourceSwitch
                label={`Собирать: ${title}`}
                checked={draft[key]}
                onChange={() => setDraft({ ...draft, [key]: !draft[key] })}
              />
            </div>
          ))}
        </fieldset>
        <div className="sp-limits">
          <span>Лимиты на один источник</span>
          <label>
            Публикации
            <input
              aria-label="Лимит публикаций"
              type="number"
              min={1}
              max={500}
              step={1}
              value={draft.maxPublications || ''}
              onChange={(event) =>
                setDraft({ ...draft, maxPublications: Number(event.target.value) })
              }
              required
            />
          </label>
          <label>
            Комментарии
            <input
              aria-label="Лимит комментариев"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={draft.maxComments || ''}
              onChange={(event) => setDraft({ ...draft, maxComments: Number(event.target.value) })}
              required
            />
          </label>
          <small>Сбор остановится при достижении лимита.</small>
        </div>
        {error && (
          <p className="sp-error" role="alert">
            {error}
          </p>
        )}
        <button className="ec-button" type="submit" disabled={!dirty}>
          Сохранить параметры
        </button>
      </form>
    </aside>
  );
}
