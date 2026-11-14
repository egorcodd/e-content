import {
  ChartLineUpIcon,
  ChatsCircleIcon,
  LightbulbIcon,
  MarkdownLogoIcon,
  TelegramLogoIcon,
  TiktokLogoIcon,
  TrayArrowDownIcon,
} from '@phosphor-icons/react';
import type { StatusKind } from '../shared';

export const stations = [
  {
    id: 'telegram',
    name: 'Telegram',
    sub: '4 канала',
    Icon: TelegramLogoIcon,
    tint: 'var(--tg)',
    hex: '#3987e5',
    // screen position on the iso stage: right / down, in world units
    at: [-4.6, -1.35],
    steps: ['Публикации каналов', 'Ответы и обсуждения', 'Проверка повторов', 'telegram.md'],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    sub: '12 роликов',
    Icon: TiktokLogoIcon,
    tint: 'var(--tt)',
    hex: '#d55181',
    at: [-3.6, 1.45],
    steps: ['Список роликов', 'Доступные счётчики', 'Вопросы аудитории', 'tiktok.md'],
  },
  {
    id: 'collector',
    name: 'Сбор',
    sub: 'Входящие материалы',
    Icon: TrayArrowDownIcon,
    tint: undefined,
    hex: undefined,
    at: [-1.3, 0.05],
    steps: ['Чтение источников', 'Нормализация дат', 'Дедупликация', 'inbox.md'],
  },
  {
    id: 'comments',
    name: 'Комментарии',
    sub: '128 сообщений',
    Icon: ChatsCircleIcon,
    tint: undefined,
    hex: undefined,
    at: [0.9, -1.3],
    steps: ['Связи с публикациями', 'Ветки ответов', 'Повторяющиеся вопросы', 'comments.md'],
  },
  {
    id: 'ideas',
    name: 'Темы',
    sub: '18 идей',
    Icon: LightbulbIcon,
    tint: undefined,
    hex: undefined,
    at: [3.3, -0.4],
    steps: ['Выделение вопросов', 'Группировка тем', 'Проверка оснований', 'ideas.md'],
  },
  {
    id: 'materials',
    name: 'Материалы',
    sub: 'Коллекции и Markdown',
    Icon: MarkdownLogoIcon,
    tint: undefined,
    hex: undefined,
    at: [1.0, 1.45],
    steps: ['Отобранные темы', 'Заметки и сценарии', 'Связи и метаданные', 'materials.md'],
  },
  {
    id: 'analytics',
    name: 'Аналитика',
    sub: 'Общая картина',
    Icon: ChartLineUpIcon,
    tint: undefined,
    hex: undefined,
    at: [4.7, 1.25],
    steps: ['Снимки показателей', 'Сравнение периодов', 'Динамика площадок', 'report.md'],
  },
] as const;
export type Station = (typeof stations)[number];

/** What every workshop view needs to draw and drive the stations. */
export type ViewProps = {
  selected: string | null;
  active: string | null;
  running: boolean;
  step: number;
  states: Record<string, StatusKind>;
  /** 0..1 progress of each station within the current run */
  progress: Record<string, number>;
  choose: (id: string) => void;
};
