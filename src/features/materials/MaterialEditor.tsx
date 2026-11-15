import { useState } from 'react';
import {
  DownloadSimpleIcon,
  FloppyDiskIcon,
  PlusIcon,
  TrashIcon,
  ArrowUpRightIcon,
} from '@phosphor-icons/react';
import { LabDialog as Dialog, Segment, downloadText } from '../../shared/ui';
import { Select } from '../../shared/Select';
import { saveMaterial, type Material, type MaterialFolder } from './repository';
import { MarkdownView } from './MarkdownView';
import { PriorityMark } from './PriorityMark';
import { ideaMarkdown } from './export';
import {
  evidenceSummary,
  formatFolder,
  folderFormat,
  formatLabels,
  statusLabels,
  priorityLabels,
  sourceLabels,
  safeSourceUrl,
  type Evidence,
  type IdeaFormat,
  type IdeaStatus,
  type IdeaPriority,
} from './idea-model';

export function MaterialEditor({
  material,
  folders,
  folderId,
  close,
  notify,
}: {
  material?: Material;
  folders: MaterialFolder[];
  folderId: string;
  close: () => void;
  notify: (message: string) => void;
}) {
  const initialFormat = material?.format ?? folderFormat(folderId);
  const [title, setTitle] = useState(material?.title ?? '');
  const [body, setBody] = useState(material?.body ?? '');
  const [folder, setFolder] = useState(material?.folderId ?? folderId);
  const [format, setFormat] = useState<IdeaFormat>(initialFormat);
  const [status, setStatus] = useState<IdeaStatus>(material?.status ?? 'new');
  const [priority, setPriority] = useState<IdeaPriority>(material?.priority ?? 'normal');
  const [evidence, setEvidence] = useState<Evidence[]>(material?.evidence ?? []);
  const [draft, setDraft] = useState({ source: 'telegram', kind: 'comment', text: '', url: '' });
  const [mode, setMode] = useState(material ? 'preview' : 'edit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const summary = evidenceSummary(evidence);
  const dirty =
    title !== (material?.title ?? '') ||
    body !== (material?.body ?? '') ||
    folder !== (material?.folderId ?? folderId) ||
    format !== initialFormat ||
    status !== (material?.status ?? 'new') ||
    priority !== (material?.priority ?? 'normal') ||
    JSON.stringify(evidence) !== JSON.stringify(material?.evidence ?? []) ||
    !!draft.text ||
    !!draft.url;
  const requestClose = () => {
    if (saving) return;
    if (dirty) setDiscard(true);
    else close();
  };
  const current = (): Material => ({
    ...material,
    id: material?.id ?? crypto.randomUUID(),
    title,
    body,
    folderId: folder,
    format,
    status,
    priority,
    evidence,
    source: material?.source ?? 'manual',
    favorite: material?.favorite ?? false,
    createdAt: material?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: material?.revision ?? 0,
  });
  async function save() {
    if (saving) return;
    if (draft.text.trim() || draft.url.trim()) {
      setError('Сначала добавьте основание или очистите его поля.');
      setMode('sources');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await saveMaterial(current(), material?.revision);
      close();
      notify('Идея сохранена');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить идею');
    } finally {
      setSaving(false);
    }
  }
  function addEvidence() {
    if (!draft.text.trim()) {
      setError('Добавьте текст комментария или публикации.');
      return;
    }
    if (draft.url && !safeSourceUrl(draft.url)) {
      setError('Нужна полная ссылка, начинающаяся с https:// или http://.');
      return;
    }
    if (
      evidence.some(
        (item) =>
          item.source === draft.source &&
          item.kind === draft.kind &&
          item.text === draft.text.trim() &&
          (item.url ?? '') === draft.url.trim(),
      )
    ) {
      setError('Это основание уже добавлено.');
      return;
    }
    setEvidence((old) => [
      ...old,
      {
        id: crypto.randomUUID(),
        source: draft.source as Evidence['source'],
        kind: draft.kind as Evidence['kind'],
        text: draft.text.trim(),
        url: draft.url.trim() || undefined,
      },
    ]);
    setDraft({ ...draft, text: '', url: '' });
    setError('');
  }
  return (
    <Dialog title={material ? 'Идея' : 'Новая идея'} close={requestClose} className="mp-editor">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            void save();
          }
        }}
      >
        <input
          className="mi-title"
          autoFocus={!material}
          aria-label="Название идеи"
          placeholder="О чём снять видео или написать пост?"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={200}
        />
        <div className="mi-metadata">
          <label>
            Формат
            <Select
              label="Формат идеи"
              value={format}
              options={Object.entries(formatLabels).map(([value, label]) => ({ value, label }))}
              onChange={(value) => {
                setFormat(value as IdeaFormat);
                if (['inbox', 'video-ideas', 'post-ideas'].includes(folder))
                  setFolder(formatFolder(value as IdeaFormat));
              }}
            />
          </label>
          <label>
            Папка
            <Select
              label="Папка идеи"
              value={folder}
              onChange={setFolder}
              options={folders.map((item) => ({ value: item.id, label: item.title }))}
            />
          </label>
          <label>
            Статус
            <Select
              label="Статус идеи"
              value={status}
              onChange={(value) => setStatus(value as IdeaStatus)}
              options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))}
            />
          </label>
          <label>
            Приоритет
            <Select
              label="Приоритет идеи"
              renderOption={(option) => <PriorityMark value={option.value as IdeaPriority} />}
              value={priority}
              onChange={(value) => setPriority(value as IdeaPriority)}
              options={Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))}
            />
          </label>
        </div>
        <div className="mi-tabs">
          <Segment
            label="Содержимое идеи"
            size="sm"
            value={mode}
            onChange={setMode}
            values={[
              { id: 'preview', label: 'Идея' },
              { id: 'sources', label: `Основания · ${evidence.length}` },
              { id: 'edit', label: 'Markdown' },
            ]}
          />
        </div>
        {mode === 'edit' ? (
          <textarea
            className="mp-editor-body"
            aria-label="Описание идеи"
            placeholder="Суть идеи и какой вопрос аудитории она раскрывает…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            spellCheck={false}
          />
        ) : mode === 'preview' ? (
          <div className="mp-editor-preview">
            {body ? (
              <MarkdownView body={body} />
            ) : (
              <p className="mp-muted">Описание пока не добавлено.</p>
            )}
            <div className="mi-summary">
              <span>{summary.comments} комментариев</span>
              <span>{summary.mentions} упоминаний</span>
              <span title="Единично — есть основание. Повторяется — от 3 оснований. Часто — от 6 оснований.">
                {summary.label}
              </span>
            </div>
          </div>
        ) : (
          <div className="mi-sources">
            {evidence.length ? (
              <ol>
                {evidence.map((item) => (
                  <li key={item.id}>
                    <div className="mi-source-head">
                      <span>
                        {sourceLabels[item.source]} ·{' '}
                        {item.kind === 'comment' ? 'Комментарий' : 'Публикация'}
                      </span>
                      <button
                        type="button"
                        className="ec-icon"
                        aria-label={`Удалить основание ${item.id}`}
                        onClick={() =>
                          setEvidence((old) => old.filter((entry) => entry.id !== item.id))
                        }
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                    <blockquote>{item.text}</blockquote>
                    {safeSourceUrl(item.url) && (
                      <a href={safeSourceUrl(item.url)!} target="_blank" rel="noopener noreferrer">
                        Открыть источник <ArrowUpRightIcon size={14} />
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mp-muted">
                Здесь будут исходные вопросы, споры и публикации, из которых появилась идея.
              </p>
            )}
            <fieldset className="mi-evidence-form">
              <legend>Добавить основание</legend>
              <div className="mi-evidence-controls">
                <Select
                  label="Площадка основания"
                  value={draft.source}
                  onChange={(source) => setDraft({ ...draft, source })}
                  options={[
                    { value: 'telegram', label: 'Telegram' },
                    { value: 'tiktok', label: 'TikTok' },
                  ]}
                />
                <Select
                  label="Тип основания"
                  value={draft.kind}
                  onChange={(kind) => setDraft({ ...draft, kind })}
                  options={[
                    { value: 'comment', label: 'Комментарий' },
                    { value: 'post', label: 'Публикация' },
                  ]}
                />
              </div>
              <textarea
                aria-label="Текст основания"
                placeholder="Исходная реплика или фрагмент публикации"
                value={draft.text}
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              />
              <input
                type="url"
                aria-label="Ссылка на источник"
                placeholder="Ссылка на публикацию или комментарий"
                value={draft.url}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              />
              <button type="button" className="ec-button" onClick={addEvidence}>
                <PlusIcon size={16} />
                Добавить основание
              </button>
            </fieldset>
          </div>
        )}
        {error && (
          <p className="mp-error" role="alert">
            {error}
          </p>
        )}
        {discard && (
          <div className="mp-discard" role="alert">
            <span>Есть несохранённые изменения.</span>
            <button type="button" className="ec-button" onClick={() => setDiscard(false)}>
              Продолжить редактирование
            </button>
            <button type="button" className="ec-button" onClick={close}>
              Закрыть без сохранения
            </button>
          </div>
        )}
        <div className="mp-editor-footer">
          <span>
            {saving
              ? 'Сохраняем…'
              : dirty
                ? 'Есть изменения'
                : material
                  ? 'Сохранено'
                  : 'Новая идея'}
          </span>
          <button
            type="button"
            className="ec-button"
            onClick={() =>
              downloadText(
                `${(title || 'idea').replace(/[<>:"/\\|?*]/g, '-')}.md`,
                ideaMarkdown(current()),
              )
            }
          >
            <DownloadSimpleIcon size={17} />
            Скачать
          </button>
          <button type="submit" className="ec-button ec-white" disabled={saving || !title.trim()}>
            <FloppyDiskIcon size={17} />
            Сохранить
          </button>
        </div>
      </form>
    </Dialog>
  );
}
