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
export type SourceConfiguration = { sources: AnalysisSource[]; settings: CollectionSettings };
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
    settings.maxPublications < 1 ||
    settings.maxPublications > 500
  )
    throw new Error('Лимит публикаций: от 1 до 500.');
  if (
    !Number.isInteger(settings.maxComments) ||
    settings.maxComments < 1 ||
    settings.maxComments > 10000
  )
    throw new Error('Лимит комментариев: от 1 до 10 000.');
  return { ...settings };
}
