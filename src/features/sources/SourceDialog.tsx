import { useState } from 'react';
import { TelegramLogoIcon, TiktokLogoIcon } from '@phosphor-icons/react';
import { LabDialog, Segment } from '../../shared/ui';
import { Select } from '../../shared/Select';
import { parseSource, platformNames, type AnalysisSource, type Platform } from './model';
import { saveSource } from './repository';
import type { ConnectedAccount } from './connections';

export function SourceDialog({
  source,
  platform: initialPlatform = 'telegram',
  accounts,
  close,
  saved,
}: {
  source?: AnalysisSource;
  platform?: Platform;
  accounts: ConnectedAccount[];
  close: () => void;
  saved: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>(source?.platform ?? initialPlatform);
  const [url, setUrl] = useState(source?.url ?? '');
  const [title, setTitle] = useState(source?.title ?? '');
  const [purpose, setPurpose] = useState(source?.purpose ?? 'inspiration');
  const [accountId, setAccountId] = useState(source?.accountId ?? 'none');
  const [error, setError] = useState('');
  const choices = accounts.filter(
    (account) => account.platform === platform && account.status === 'connected',
  );
  return (
    <LabDialog
      title={source ? 'Настроить источник' : 'Добавить источник'}
      close={close}
      className="sources-dialog"
    >
      <form
        className="sp-form"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const parsed = parseSource(url, platform);
            saveSource({
              id: source?.id ?? crypto.randomUUID(),
              platform,
              kind: parsed.kind,
              url: parsed.url,
              title: title.trim() || parsed.suggestedTitle,
              purpose,
              accountId: accountId === 'none' ? null : accountId,
              enabled: source?.enabled ?? true,
              createdAt: source?.createdAt ?? new Date().toISOString(),
            });
            saved();
            close();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Не удалось добавить источник.');
          }
        }}
      >
        <Segment
          label="Площадка источника"
          value={platform}
          onChange={(value) => {
            setPlatform(value as Platform);
            setUrl('');
            setAccountId('none');
            setError('');
          }}
          values={[
            { id: 'telegram', label: 'Telegram', icon: <TelegramLogoIcon size={18} /> },
            { id: 'tiktok', label: 'TikTok', icon: <TiktokLogoIcon size={18} /> },
          ]}
        />
        <label>
          Ссылка или @имя
          <input
            autoFocus
            aria-label="Ссылка источника"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError('');
            }}
            placeholder={
              platform === 'telegram'
                ? 't.me/channel или t.me/channel/123'
                : 'tiktok.com/@name/video/…'
            }
            required
            maxLength={2048}
            autoComplete="off"
          />
        </label>
        <label>
          Название
          <input
            aria-label="Название источника"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Можно оставить имя канала или профиля"
            maxLength={100}
          />
        </label>
        <div className="sp-form-field">
          <span>Для чего анализируем</span>
          <Segment
            label="Назначение источника"
            value={purpose}
            onChange={(value) => setPurpose(value as AnalysisSource['purpose'])}
            values={[
              { id: 'own', label: 'Мой контент' },
              { id: 'inspiration', label: 'Поиск идей' },
            ]}
          />
        </div>
        <div className="sp-form-field">
          <span>Аккаунт для доступа</span>
          <Select
            label="Аккаунт источника"
            value={accountId}
            onChange={setAccountId}
            options={[
              { value: 'none', label: 'Выбрать позже' },
              ...choices.map((account) => ({ value: account.id, label: account.displayName })),
              ...(accountId !== 'none' && !choices.some((account) => account.id === accountId)
                ? [{ value: accountId, label: 'Аккаунт недоступен' }]
                : []),
            ]}
          />
          <small>
            {choices.length
              ? 'Аккаунт используется только для доступа к выбранному источнику.'
              : `Источник сохранится. Аккаунт ${platformNames[platform]} можно подключить позже.`}
          </small>
        </div>
        {error && (
          <p className="sp-error" role="alert">
            {error}
          </p>
        )}
        <div className="ec-dialog-actions">
          <button type="button" className="ec-button" onClick={close}>
            Отмена
          </button>
          <button type="submit" className="ec-button ec-white">
            {source ? 'Сохранить' : 'Добавить источник'}
          </button>
        </div>
      </form>
    </LabDialog>
  );
}
