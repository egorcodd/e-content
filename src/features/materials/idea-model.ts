export type IdeaFormat = 'video' | 'post' | 'undecided';
export type IdeaStatus = 'new' | 'selected' | 'in-progress' | 'published' | 'archived';
export type IdeaPriority = 'high' | 'normal' | 'low';
export type Evidence = {
  id: string;
  source: 'telegram' | 'tiktok';
  kind: 'comment' | 'post';
  text: string;
  url?: string;
  publicationId?: string;
  publishedAt?: string;
};
export type IdeaDetails = {
  format: IdeaFormat;
  status: IdeaStatus;
  priority: IdeaPriority;
  evidence: Evidence[];
};
export const formatLabels = { video: 'Видео', post: 'Пост', undecided: 'Без формата' };
export const statusLabels = {
  new: 'Новая',
  selected: 'Отобрана',
  'in-progress': 'В работе',
  published: 'Опубликована',
  archived: 'В архиве',
};
export const priorityLabels = { high: 'Высокий', normal: 'Обычный', low: 'Низкий' };
export const sourceLabels = {
  telegram: 'Telegram',
  tiktok: 'TikTok',
  manual: 'Вручную',
  workshop: 'Цех',
};
export const formatFolder = (format: IdeaFormat) =>
  format === 'video' ? 'video-ideas' : format === 'post' ? 'post-ideas' : 'inbox';
export const folderFormat = (id: string): IdeaFormat =>
  id === 'video-ideas' ? 'video' : id === 'post-ideas' ? 'post' : 'undecided';
export function evidenceForSource(evidence: Evidence[], source: string) {
  return source === 'all' ? evidence : evidence.filter((item) => item.source === source);
}
export function ideaDetails(value: Partial<IdeaDetails>): IdeaDetails {
  return {
    format: value.format && value.format in formatLabels ? value.format : 'undecided',
    status: value.status && value.status in statusLabels ? value.status : 'new',
    priority: value.priority && value.priority in priorityLabels ? value.priority : 'normal',
    evidence: value.evidence ?? [],
  };
}
export function evidenceSummary(evidence: Evidence[]) {
  const unique = [...new Map(evidence.map((item) => [`${item.source}:${item.id}`, item])).values()];
  const publications = new Set(
    unique
      .map((item) => {
        if (item.publicationId) return `${item.source}:${item.publicationId}`;
        const valid = safeSourceUrl(item.url);
        if (!valid) return null;
        const url = new URL(valid);
        url.search = '';
        url.hash = '';
        return url.href;
      })
      .filter(Boolean),
  ).size;
  const mentions = unique.length;
  const level = mentions >= 6 ? 'high' : mentions >= 3 ? 'medium' : mentions ? 'low' : 'unknown';
  return {
    comments: unique.filter((item) => item.kind === 'comment').length,
    mentions,
    publications,
    level,
    label: { high: 'Часто', medium: 'Повторяется', low: 'Единично', unknown: 'Нет оснований' }[
      level
    ],
  };
}
export function safeSourceUrl(value?: string) {
  try {
    const url = new URL(value ?? '');
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
