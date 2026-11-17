import {
  ChartLineUpIcon,
  ChatsCircleIcon,
  LightbulbIcon,
  MarkdownLogoIcon,
  TelegramLogoIcon,
  TiktokLogoIcon,
  TrayArrowDownIcon,
  CircuitryIcon,
} from '@phosphor-icons/react';
import type { StatusKind } from '../../shared/ui';

export const stations = [
  {
    id: 'telegram',
    name: 'Telegram',
    sub: 'Каналы и обсуждения',
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
    sub: 'Ролики и комментарии',
    Icon: TiktokLogoIcon,
    tint: 'var(--tt)',
    hex: '#d55181',
    at: [-3.6, 1.45],
    steps: ['Список роликов', 'Доступные счётчики', 'Вопросы аудитории', 'tiktok.md'],
  },
  {
    id: 'comments',
    name: 'Комментарии',
    sub: 'Реплики и ветки ответов',
    Icon: ChatsCircleIcon,
    tint: undefined,
    hex: undefined,
    at: [-1.3, 0.05],
    steps: ['Связи с публикациями', 'Ветки ответов', 'Исходные реплики и ссылки', 'comments.md'],
  },
  {
    id: 'collector',
    name: 'Сбор',
    sub: 'Объединение источников',
    Icon: TrayArrowDownIcon,
    tint: undefined,
    hex: undefined,
    at: [0.9, -1.3],
    steps: ['Комментарии и публикации', 'Нормализация дат', 'Удаление повторов', 'inbox.md'],
  },
  {
    id: 'ideas',
    name: 'Темы',
    sub: 'Вопросы и темы',
    Icon: LightbulbIcon,
    tint: undefined,
    hex: undefined,
    at: [3.3, -0.4],
    steps: ['Выделение вопросов', 'Группировка тем', 'Проверка оснований', 'ideas.md'],
  },
  {
    id: 'materials',
    name: 'Материалы',
    sub: 'Библиотека идей',
    Icon: MarkdownLogoIcon,
    tint: undefined,
    hex: undefined,
    at: [1.0, 1.45],
    steps: ['Формат: видео или пост', 'Основания и ссылки', 'Раскладка по папкам', 'materials.md'],
  },
  {
    id: 'analytics',
    name: 'Аналитика',
    sub: 'Общая картина',
    Icon: ChartLineUpIcon,
    tint: undefined,
    hex: undefined,
    at: [4.7, 1.25],
    steps: [
      'Получение счётчиков',
      'Обновление данных роликов',
      'Сохранение замера',
      'История сборов',
    ],
  },
] as const;
export const orchestrator = {
  id: 'orchestrator',
  name: 'Ядро',
  sub: 'Сборка общего результата',
  Icon: CircuitryIcon,
  tint: undefined,
  hex: undefined,
  at: [0, 0],
  steps: ['Приём результатов', 'Связи идей с основаниями', 'Сохранение подборки', 'workspace.md'],
} as const;
const hubPositions: Record<(typeof stations)[number]['id'], readonly [number, number]> = {
  telegram: [-4.5, -1.2],
  tiktok: [-4.2, 1.6],
  comments: [-2.1, -1.9],
  collector: [2.0, -1.85],
  ideas: [4.3, -0.65],
  materials: [4.1, 2.15],
  analytics: [-2.2, 2.15],
};
export const hubStations = [
  ...stations.map((station) => ({ ...station, at: hubPositions[station.id] })),
  orchestrator,
];
export type Station =
  (typeof stations)[number] | typeof orchestrator | (typeof hubStations)[number];

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
