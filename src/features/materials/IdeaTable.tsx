import { useEffect, useState, Fragment } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowUpRightIcon,
  DownloadSimpleIcon,
  FolderSimpleIcon,
  StarIcon,
  TrashIcon,
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
} from '@phosphor-icons/react';
import { Select } from '../../shared/Select';
import { IdeaSignal } from './IdeaSignal';
import { PriorityMark } from './PriorityMark';
import { activityDays, activityScale, dailyMentions } from './activity';
import type { Material } from './repository';
import {
  formatLabels,
  evidenceForSource,
  sourceLabels,
  statusLabels,
  priorityLabels,
  type IdeaStatus,
  type IdeaPriority,
} from './idea-model';

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
const dayKey = (value: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date(value));
export function IdeaTable({
  materials,
  allMaterials,
  source,
  groupByDate,
  busy,
  open,
  favorite,
  update,
  move,
  download,
  remove,
}: {
  materials: Material[];
  allMaterials: Material[];
  source: string;
  groupByDate: boolean;
  busy: boolean;
  open: (idea: Material) => void;
  favorite: (idea: Material) => void;
  update: (idea: Material, patch: Partial<Pick<Material, 'status' | 'priority'>>) => void;
  move: (idea: Material) => void;
  download: (idea: Material) => void;
  remove: (idea: Material) => void;
}) {
  const reduced = useReducedMotion();
  const [today, setToday] = useState(() => dayKey(new Date().toISOString()));
  const dates = activityDays(today);
  const scale = activityScale(
    allMaterials.map((item) => evidenceForSource(item.evidence, source)),
    dates,
  );
  useEffect(() => {
    const timer = setInterval(() => setToday(dayKey(new Date().toISOString())), 60000);
    return () => clearInterval(timer);
  }, []);
  const groups = new Map<string, Material[]>();
  for (const idea of materials) {
    const key = groupByDate ? dayKey(idea.createdAt) : 'all';
    groups.set(key, [...(groups.get(key) ?? []), idea]);
  }
  return (
    <div className="mi-table-wrap">
      <table className="mi-table" aria-label="Найденные идеи">
        <thead>
          <tr>
            <th>Идея</th>
            <th>
              <span title="Уникальные комментарии и публикации за последние 14 дней. Основания без даты не включены.">
                Упоминания
              </span>
            </th>
            <th>
              <span title="Уникальные комментарии и публикации по дням за последние 14 дней. У всех идей одинаковый период и масштаб.">
                Динамика · 14 дней
              </span>
            </th>
            <th>Статус</th>
            <th>Приоритет</th>
            <th>
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <AnimatePresence initial={false} mode="wait">
          <motion.tbody
            key={String(groupByDate) + materials.map((idea) => idea.id).join('|')}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.12 }}
          >
            {[...groups].map(([key, ideas]) => (
              <Fragment key={key}>
                {groupByDate && key !== today && (
                  <tr className="mi-date-row">
                    <th colSpan={6}>
                      {dateLabel(ideas[0].createdAt)}
                      <span>{ideas.length}</span>
                    </th>
                  </tr>
                )}
                {ideas.map((idea) => {
                  const evidence = evidenceForSource(idea.evidence, source);
                  const sources = [...new Set(evidence.map((item) => sourceLabels[item.source]))];
                  const activity = dailyMentions(evidence, dates);
                  return (
                    <motion.tr className="mi-row" data-created-at={idea.createdAt} key={idea.id}>
                      <td className="mi-title-cell">
                        <div className="mi-title-layout">
                          <button
                            className="mi-favorite ec-icon"
                            disabled={busy}
                            aria-label={`Избранное: ${idea.title}`}
                            aria-pressed={idea.favorite}
                            onClick={() => favorite(idea)}
                          >
                            <StarIcon size={17} weight={idea.favorite ? 'fill' : 'regular'} />
                          </button>
                          <button
                            className="mi-open"
                            onClick={() => open(idea)}
                            aria-label={`Открыть идею ${idea.title}`}
                          >
                            <strong>
                              {idea.title}
                              <ArrowUpRightIcon size={14} />
                            </strong>
                            <span>
                              {formatLabels[idea.format]}
                              <i /> {sources.join(' + ') || sourceLabels[idea.source]}
                              {!groupByDate && dayKey(idea.createdAt) !== today && (
                                <>
                                  <i />
                                  <time dateTime={idea.createdAt}>{dateLabel(idea.createdAt)}</time>
                                </>
                              )}
                            </span>
                          </button>
                        </div>
                      </td>
                      <td className="mi-mention-cell">
                        <span className="mi-mobile-label">Упоминания</span>
                        <span>{activity.hasDates ? activity.total : '—'}</span>
                      </td>
                      <td className="mi-signal-cell">
                        <IdeaSignal
                          evidence={evidence}
                          title={idea.title}
                          dates={dates}
                          scale={scale}
                        />
                      </td>
                      <td className="mi-status-cell">
                        <Select
                          className={`mi-row-select mi-status-${idea.status}`}
                          label={`Статус: ${idea.title}`}
                          value={idea.status}
                          onChange={(value) => update(idea, { status: value as IdeaStatus })}
                          options={Object.entries(statusLabels).map(([value, label]) => ({
                            value,
                            label,
                          }))}
                        />
                      </td>
                      <td className="mi-priority-cell">
                        <Select
                          className={`mi-row-select mi-priority-${idea.priority}`}
                          label={`Приоритет: ${idea.title}`}
                          renderOption={(option) => (
                            <PriorityMark value={option.value as IdeaPriority} />
                          )}
                          value={idea.priority}
                          onChange={(value) => update(idea, { priority: value as IdeaPriority })}
                          options={Object.entries(priorityLabels).map(([value, label]) => ({
                            value,
                            label,
                          }))}
                        />
                      </td>
                      <td className="mi-row-actions">
                        <button
                          className="ec-icon"
                          aria-label={`${idea.status === 'archived' ? 'Восстановить идею' : 'Архивировать'} ${idea.title}`}
                          onClick={() =>
                            update(idea, {
                              status:
                                idea.status === 'archived'
                                  ? (idea.statusBeforeArchive ?? 'new')
                                  : 'archived',
                            })
                          }
                        >
                          {idea.status === 'archived' ? (
                            <ArrowCounterClockwiseIcon size={17} />
                          ) : (
                            <ArchiveIcon size={17} />
                          )}
                        </button>
                        <button
                          className="ec-icon"
                          aria-label={`Перенести ${idea.title}`}
                          onClick={() => move(idea)}
                        >
                          <FolderSimpleIcon size={17} />
                        </button>
                        <button
                          className="ec-icon"
                          aria-label={`Скачать ${idea.title}`}
                          onClick={() => download(idea)}
                        >
                          <DownloadSimpleIcon size={17} />
                        </button>
                        <button
                          className="ec-icon mi-delete"
                          aria-label={`Удалить ${idea.title}`}
                          onClick={() => remove(idea)}
                        >
                          <TrashIcon size={17} />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </Fragment>
            ))}
          </motion.tbody>
        </AnimatePresence>
      </table>
    </div>
  );
}
