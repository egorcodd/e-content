import { AppError } from '../errors.ts';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : {};
export function tiktokId(value: unknown): string {
  if (typeof value === 'string' && /^\d{1,30}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new AppError(
    502,
    'TIKTOK_SCHEMA',
    'TikTok вернул некорректный идентификатор. Сбор остановлен.',
  );
}
export function counter(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}
const date = (value: unknown): string | null => {
  const n = counter(value);
  return n && n < 253402300799 ? new Date(n * 1000).toISOString() : null;
};
export type TikTokVideo = {
  id: string;
  url: string;
  text: string;
  publishedAt: string | null;
  commentCount?: number;
  metrics: { views?: number; likes?: number; forwards?: number; comments?: number };
};
export type TikTokComment = {
  id: string;
  videoId: string;
  parentId?: string;
  text: string;
  publishedAt: string | null;
  likes?: number;
  replyCount?: number;
};
export type CommentPage = {
  items: TikTokComment[];
  previews: TikTokComment[];
  cursor: string | null;
  hasMore: boolean;
  rootId?: string;
};

export function parseVideo(input: unknown, requestedId?: string): TikTokVideo {
  const item = object(input),
    author = object(item.author),
    id = tiktokId(item.id);
  if (requestedId && id !== requestedId)
    throw new AppError(
      502,
      'TIKTOK_VIDEO_MISMATCH',
      'TikTok вернул другой ролик. Сбор остановлен.',
    );
  const username =
    typeof author.uniqueId === 'string'
      ? author.uniqueId
      : typeof item.author === 'string'
        ? item.author
        : '';
  if (!/^[\w.]{2,24}$/.test(username))
    throw new AppError(502, 'TIKTOK_SCHEMA', 'Не удалось определить автора ролика.');
  const v2 = object(item.statsV2),
    v1 = object(item.stats);
  const stat = (name: string) => counter(v2[name]) ?? counter(v1[name]);
  return {
    id,
    url: `https://www.tiktok.com/@${username}/video/${id}`,
    text: typeof item.desc === 'string' ? item.desc : '',
    publishedAt: date(item.createTime),
    commentCount: stat('commentCount'),
    metrics: {
      views: stat('playCount'),
      likes: stat('diggCount'),
      forwards: stat('shareCount'),
      comments: stat('commentCount'),
    },
  };
}
export function parseVideoPage(input: unknown, id: string): TikTokVideo | null {
  const data = object(input),
    scope = object(data.__DEFAULT_SCOPE__),
    detail = object(scope['webapp.video-detail']);
  const item = object(detail.itemInfo).itemStruct ?? object(data.ItemModule)[id];
  return item ? parseVideo(item, id) : null;
}
function comment(input: unknown, videoId: string, parentId?: string): TikTokComment {
  const item = object(input);
  if (item.aweme_id !== undefined && tiktokId(item.aweme_id) !== videoId)
    throw new AppError(502, 'TIKTOK_VIDEO_MISMATCH', 'Комментарий относится к другому ролику.');
  if (typeof item.text !== 'string' || item.text.length > 50000)
    throw new AppError(502, 'TIKTOK_SCHEMA', 'Изменился формат комментариев TikTok.');
  const directParent =
    item.reply_id && String(item.reply_id) !== '0' ? tiktokId(item.reply_id) : parentId;
  return {
    id: tiktokId(item.cid),
    videoId,
    parentId: directParent,
    text: item.text,
    publishedAt: date(item.create_time),
    likes: counter(item.digg_count),
    replyCount: counter(item.reply_comment_total),
  };
}
export function parseComments(input: unknown, videoId: string, rootId?: string): CommentPage {
  const data = object(input),
    status = data.status_code ?? data.statusCode;
  if (data.captcha || data.verify_event || status === 10000 || status === 10101)
    throw new AppError(
      403,
      'TIKTOK_BLOCKED',
      'TikTok запросил проверку доступа. Полученные данные сохранены.',
    );
  if (status !== undefined && status !== 0)
    throw new AppError(
      502,
      'TIKTOK_RESPONSE',
      'TikTok отказал в выдаче комментариев. Полученные данные сохранены.',
    );
  if (!Array.isArray(data.comments) || ![true, false, 0, 1].includes(data.has_more as boolean))
    throw new AppError(
      502,
      'TIKTOK_SCHEMA',
      'TikTok не вернул подтверждённую страницу комментариев.',
    );
  const hasMore = !!data.has_more;
  const cursor = hasMore ? String(data.cursor ?? '') : null;
  if (hasMore && (!cursor || cursor === '0' || cursor === 'undefined'))
    throw new AppError(502, 'TIKTOK_CURSOR', 'TikTok не вернул следующий курсор комментариев.');
  const items = data.comments.map((item) => comment(item, videoId, rootId));
  const previews: TikTokComment[] = [];
  for (const raw of data.comments) {
    const row = object(raw);
    if (Array.isArray(row.reply_comment))
      for (const reply of row.reply_comment)
        previews.push(comment(reply, videoId, tiktokId(row.cid)));
  }
  return { items, previews, cursor, hasMore, rootId };
}
