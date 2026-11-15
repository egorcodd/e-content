import type { Material } from './repository';
import {
  evidenceSummary,
  formatLabels,
  priorityLabels,
  statusLabels,
  sourceLabels,
  safeSourceUrl,
} from './idea-model';

export function ideaMarkdown(idea: Material) {
  const summary = evidenceSummary(idea.evidence);
  return [
    `# ${idea.title.replace(/[\r\n]/g, ' ')}`,
    '',
    `- Формат: ${formatLabels[idea.format]}`,
    ...(idea.origin === 'sample'
      ? ['- Происхождение: макетные данные интерфейса, не собраны из аккаунта']
      : []),
    `- Статус: ${statusLabels[idea.status]}`,
    `- Избранное: ${idea.favorite ? 'да' : 'нет'}`,
    `- Приоритет: ${priorityLabels[idea.priority]}`,
    `- Найдена: ${idea.createdAt}`,
    `- Комментариев: ${summary.comments}`,
    `- Упоминаний: ${summary.mentions}`,
    `- Публикаций с известным источником: ${summary.publications}`,
    `- Повторяемость: ${summary.label}`,
    '',
    '## Суть идеи',
    '',
    idea.body || 'Описание пока не добавлено.',
    '',
    '## Основания',
    '',
    ...(idea.evidence.length
      ? idea.evidence.flatMap((item, index) => [
          `### ${index + 1}. ${sourceLabels[item.source]} · ${item.kind === 'comment' ? 'Комментарий' : 'Публикация'}`,
          '',
          ...item.text.split('\n').map((line) => `> ${line}`),
          '',
          ...(safeSourceUrl(item.url) ? [`Источник: ${safeSourceUrl(item.url)}`, ''] : []),
          ...(item.publishedAt ? [`Дата источника: ${item.publishedAt}`, ''] : []),
        ])
      : ['Исходные реплики и публикации пока не добавлены.', '']),
  ].join('\n');
}
export const ideasMarkdown = (ideas: Material[]) =>
  `# Библиотека идей\n\nИдей: ${ideas.length}\n\n${ideas.map(ideaMarkdown).join('\n\n---\n\n')}`;
