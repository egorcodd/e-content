export type Platform = 'telegram' | 'tiktok';
export type SourceKind = 'channel' | 'publication' | 'profile' | 'video';
export type AnalysisSource = {
  id: string;
  platform: Platform;
  kind: SourceKind;
  title: string;
  url: string;
  accountId: string | null;
  purpose: 'own' | 'inspiration';
  enabled: boolean;
  createdAt: string;
};
export type CollectionSettings = {
  period: '7' | '30' | '90';
  comments: boolean;
  publications: boolean;
  metrics: boolean;
  maxPublications: number;
  maxComments: number;
};
export type CollectionOverrides = Partial<CollectionSettings>;
export type CommentOrder = 'platform' | 'recent';
export type RunLimits = { maxPublications: number; maxComments: number; maxRequests: number };
/** Missing override fields keep inheriting defaults. */
export type PlatformSettings = {
  telegram: {
    custom: CollectionOverrides | null;
    threads: boolean;
    forwards: boolean;
    minLength: number;
  };
  tiktok: {
    custom: CollectionOverrides | null;
    commentsPerVideo?: number;
    replies: boolean;
    order: CommentOrder;
    minLikes: number;
  };
};
export type SourceConfiguration = {
  schemaVersion: 2;
  sources: AnalysisSource[];
  settings: CollectionSettings;
  platforms: PlatformSettings;
  runLimits: RunLimits;
};
export const platformNames = { telegram: 'Telegram', tiktok: 'TikTok' };
export const kindNames = {
  channel: 'Канал',
  publication: 'Публикация',
  profile: 'Профиль',
  video: 'Видео',
};
export const defaultSettings: CollectionSettings = {
  period: '30',
  comments: true,
  publications: true,
  metrics: false,
  maxPublications: 50,
  maxComments: 1000,
};
export const defaultPlatformSettings: PlatformSettings = {
  telegram: { custom: null, threads: true, forwards: false, minLength: 20 },
  tiktok: { custom: null, replies: true, order: 'platform', minLikes: 0 },
};
export const defaultRunLimits: RunLimits = {
  maxPublications: 500,
  maxComments: 10000,
  maxRequests: 1000,
};
export const collectionFields = [
  'period',
  'comments',
  'publications',
  'metrics',
  'maxPublications',
  'maxComments',
] as const;

export const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11
    ? one
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? few
      : many;

export function parseSource(input: string, platform: Platform) {
  let value = input.trim();
  if ((platform === 'telegram' ? /^@[a-zA-Z\d_]{3,32}$/ : /^@[a-zA-Z\d_.]{2,24}$/).test(value)) {
    value =
      platform === 'telegram'
        ? `https://t.me/${value.slice(1)}`
        : `https://www.tiktok.com/${value}`;
  }
  if (/^(?:t\.me|telegram\.me|(?:www\.|m\.|vm\.|vt\.)?tiktok\.com)\//i.test(value))
    value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Укажите ссылку на источник или @имя.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
    throw new Error('Укажите обычную ссылку на площадку.');
  const parts = url.pathname.split('/').filter(Boolean);
  const host = url.hostname.toLowerCase();
  let kind: SourceKind;
  if (platform === 'telegram') {
    if (!['t.me', 'telegram.me'].includes(host))
      throw new Error('Для Telegram нужна ссылка t.me на канал или публикацию.');
    if (parts[0] === 's') parts.shift();
    const publicChannel =
      /^[a-zA-Z][a-zA-Z\d_]{3,31}$/.test(parts[0] ?? '') &&
      !['share', 'joinchat', 'proxy', 'socks', 'login', 'addstickers', 'iv', 'boost'].includes(
        parts[0].toLowerCase(),
      );
    const privatePost =
      parts[0] === 'c' &&
      /^\d+$/.test(parts[1] ?? '') &&
      /^\d+$/.test(parts[2] ?? '') &&
      parts.length === 3;
    if (privatePost) kind = 'publication';
    else if (publicChannel && parts.length === 1) kind = 'channel';
    else if (publicChannel && parts.length === 2 && /^\d+$/.test(parts[1])) kind = 'publication';
    else throw new Error('Нужна ссылка на канал или пост. Пригласительные ссылки не подходят.');
    url = new URL(`https://t.me/${parts.join('/')}`);
  } else {
    if (
      !['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(
        host,
      )
    )
      throw new Error('Для TikTok нужна ссылка tiktok.com на профиль или видео.');
    if (
      ['vm.tiktok.com', 'vt.tiktok.com'].includes(host) &&
      parts.length === 1 &&
      /^[a-zA-Z\d]+$/.test(parts[0])
    )
      kind = 'video';
    else if (/^@[a-zA-Z\d_.]{2,24}$/.test(parts[0] ?? '') && parts.length === 1) kind = 'profile';
    else if (
      /^@[a-zA-Z\d_.]{2,24}$/.test(parts[0] ?? '') &&
      parts[1] === 'video' &&
      /^\d+$/.test(parts[2] ?? '') &&
      parts.length === 3
    )
      kind = 'video';
    else throw new Error('Нужна ссылка на профиль @имя или конкретное видео.');
    url = new URL(
      `https://${['vm.tiktok.com', 'vt.tiktok.com'].includes(host) ? host : 'www.tiktok.com'}/${parts.join('/')}`,
    );
  }
  return {
    url: url.href,
    kind,
    suggestedTitle: parts[0] === 'c' ? `Публикация ${parts[2]}` : parts[0],
  };
}

export function validateSettings(settings: CollectionSettings): CollectionSettings {
  if (!['7', '30', '90'].includes(settings.period)) throw new Error('Выберите период сбора.');
  if (
    ![settings.comments, settings.publications, settings.metrics].every(
      (value) => typeof value === 'boolean',
    ) ||
    ![settings.comments, settings.publications, settings.metrics].some(Boolean)
  )
    throw new Error('Выберите хотя бы один тип данных.');
  if (
    !Number.isInteger(settings.maxPublications) ||
    settings.maxPublications < 0 ||
    settings.maxPublications > 500
  )
    throw new Error('Лимит публикаций: от 0 до 500.');
  if (
    !Number.isInteger(settings.maxComments) ||
    settings.maxComments < 0 ||
    settings.maxComments > 10000
  )
    throw new Error('Лимит комментариев: от 0 до 10 000.');
  return Object.fromEntries(
    collectionFields.map((key) => [key, settings[key]]),
  ) as CollectionSettings;
}

export function validateOverrides(value: unknown): CollectionOverrides | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Проверьте индивидуальные параметры.');
  const result: CollectionOverrides = {};
  for (const key of collectionFields) {
    if (!Object.hasOwn(value, key)) continue;
    const field = (value as Record<string, unknown>)[key];
    const valid =
      key === 'period'
        ? ['7', '30', '90'].includes(field as string)
        : key === 'maxPublications'
          ? Number.isInteger(field) && (field as number) >= 0 && (field as number) <= 500
          : key === 'maxComments'
            ? Number.isInteger(field) && (field as number) >= 0 && (field as number) <= 10000
            : typeof field === 'boolean';
    if (!valid) throw new Error(`Недопустимое индивидуальное значение: ${key}.`);
    Object.assign(result, { [key]: field });
  }
  return result;
}

export function validateRunLimits(value: RunLimits): RunLimits {
  const ranges = { maxPublications: 5000, maxComments: 100000, maxRequests: 10000 };
  for (const key of Object.keys(ranges) as (keyof RunLimits)[]) {
    if (!Number.isInteger(value?.[key]) || value[key] < 0 || value[key] > ranges[key])
      throw new Error('Проверьте ограничения всего запуска.');
  }
  return {
    maxPublications: value.maxPublications,
    maxComments: value.maxComments,
    maxRequests: value.maxRequests,
  };
}

const whole = (value: unknown, max: number) =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
export function validatePlatformSettings(value: PlatformSettings): PlatformSettings {
  const { telegram, tiktok } = value;
  if (
    typeof telegram?.threads !== 'boolean' ||
    typeof telegram.forwards !== 'boolean' ||
    !whole(telegram.minLength, 500)
  )
    throw new Error('Проверьте параметры Telegram.');
  if (
    typeof tiktok?.replies !== 'boolean' ||
    !['platform', 'recent', 'top'].includes(tiktok.order) ||
    !whole(tiktok.minLikes, 10000) ||
    (tiktok.commentsPerVideo !== undefined &&
      (!whole(tiktok.commentsPerVideo, 10000) || tiktok.commentsPerVideo < 1))
  )
    throw new Error('Проверьте параметры TikTok.');
  return {
    telegram: {
      custom: validateOverrides(telegram.custom),
      threads: telegram.threads,
      forwards: telegram.forwards,
      minLength: telegram.minLength,
    },
    tiktok: {
      custom: validateOverrides(tiktok.custom),
      replies: tiktok.replies,
      order: (tiktok.order as string) === 'top' ? 'platform' : tiktok.order,
      minLikes: tiktok.minLikes,
      ...(tiktok.commentsPerVideo === undefined
        ? {}
        : { commentsPerVideo: tiktok.commentsPerVideo }),
    },
  };
}
