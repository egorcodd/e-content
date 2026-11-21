import { useState } from 'react';
import { Segment } from '../../shared/ui';
import { saveCollectionSettings } from './repository';
import type { CollectionSettings, RunLimits } from './model';
import { ParameterRange } from './ParameterRange';
import { SourceSwitch } from './SourceSwitch';
import { SettingsDisclosure } from './SettingsDisclosure';

type Props = { settings: CollectionSettings; runLimits: RunLimits; notify: (text: string) => void };

function DefaultsEditor({ settings, runLimits, notify }: Props) {
  const [draft, setDraft] = useState(settings);
  const [draftLimits, setDraftLimits] = useState(runLimits);
  const [error, setError] = useState('');
  const dirty = JSON.stringify([draft, draftLimits]) !== JSON.stringify([settings, runLimits]);
  const types = [
    ['comments', 'Комментарии'],
    ['publications', 'Публикации'],
    ['metrics', 'Счётчики'],
  ] as const;
  const active = types.filter(([key]) => draft[key]).length;
  return (
    <form
      className="common-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          saveCollectionSettings(draft, draftLimits);
          setError('');
          notify('Общие настройки сохранены');
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Не удалось сохранить параметры.');
        }
      }}
    >
      <div className="common-settings-base">
        <div>
          <span className="platform-setting-label">Период по умолчанию</span>
          <Segment
            label="Период сбора"
            value={draft.period}
            onChange={(period) =>
              setDraft({ ...draft, period: period as CollectionSettings['period'] })
            }
            values={['7', '30', '90', 'all'].map((id) => ({ id, label: id === 'all' ? 'За всё время' : `${id} дней` }))}
          />
        </div>
        <fieldset className="common-settings-types">
          <legend>Данные по умолчанию</legend>
          {types.map(([key, title]) => (
            <div className="platform-toggle-row" key={key}>
              <span>{title}</span>
              <SourceSwitch
                label={`По умолчанию: ${title}`}
                checked={draft[key]}
                disabled={draft[key] && active === 1}
                onChange={() => setDraft({ ...draft, [key]: !draft[key] })}
              />
            </div>
          ))}
        </fieldset>
        <div className="common-settings-limits">
          <ParameterRange
            label="Публикации на источник Telegram"
            value={draft.maxPublications}
            max={500}
            volumeBudget={draftLimits.maxPublications}
            format={(value) => (value ? `до ${value}` : 'Не собирать')}
            onChange={(maxPublications) => setDraft({ ...draft, maxPublications })}
          />
          <ParameterRange
            label="Комментарии на источник Telegram"
            value={draft.maxComments}
            max={10000}
            volumeBudget={draftLimits.maxComments}
            format={(value) => (value ? `до ${value.toLocaleString('ru')}` : 'Не собирать')}
            onChange={(maxComments) => setDraft({ ...draft, maxComments })}
          />
        </div>
      </div>
      <SettingsDisclosure title="Общий объём сбора">
        <div className="common-run-limits">
          <ParameterRange
            label="Всего публикаций"
            value={draftLimits.maxPublications}
            max={5000}
            format={(value) => (value ? `до ${value.toLocaleString('ru')}` : 'Не собирать')}
            onChange={(maxPublications) => setDraftLimits({ ...draftLimits, maxPublications })}
          />
          <ParameterRange
            label="Всего комментариев"
            value={draftLimits.maxComments}
            max={100000}
            format={(value) => (value ? `до ${value.toLocaleString('ru')}` : 'Не собирать')}
            onChange={(maxComments) => setDraftLimits({ ...draftLimits, maxComments })}
          />
        </div>
      </SettingsDisclosure>
      <div className="common-settings-actions">
        {error && (
          <p className="sp-error" role="alert">
            {error}
          </p>
        )}
        <button className="ec-button" type="submit" disabled={!dirty}>
          Сохранить параметры
        </button>
      </div>
    </form>
  );
}

export function CommonCollectionSettings(props: Props) {
  return (
    <section className="common-settings" aria-label="Общие настройки">
      <SettingsDisclosure title="Общие настройки">
        <DefaultsEditor key={JSON.stringify([props.settings, props.runLimits])} {...props} />
      </SettingsDisclosure>
    </section>
  );
}
