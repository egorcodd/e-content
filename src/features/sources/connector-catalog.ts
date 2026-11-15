import { TelegramLogoIcon, TiktokLogoIcon } from '@phosphor-icons/react';
import type { Platform } from './model';

export const connectorCatalog = [
  {
    id: 'telegram',
    title: 'Telegram',
    Icon: TelegramLogoIcon,
    content: 'Каналы и обсуждения',
    types: ['Каналы', 'Публикации'],
    detail: 'Свои каналы и выбранные каналы для поиска тем.',
  },
  {
    id: 'tiktok',
    title: 'TikTok',
    Icon: TiktokLogoIcon,
    content: 'Видео и комментарии',
    types: ['Профили', 'Видео'],
    detail: 'Выбранные профили и отдельные ролики.',
  },
] satisfies {
  id: Platform;
  title: string;
  Icon: typeof TelegramLogoIcon;
  content: string;
  types: string[];
  detail: string;
}[];

export type SourceLayout = 'modules' | 'explorer' | 'steps' | 'classic';
export const sourceLayouts = [
  { id: 'modules', label: 'Модули' },
  { id: 'explorer', label: 'Обозреватель' },
  { id: 'steps', label: 'Шаги' },
  { id: 'classic', label: 'Исходный' },
];
export function readSourceLayout(): SourceLayout {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('e-content-sources-layout');
  } catch {}
  const value = new URLSearchParams(location.search).get('layout') ?? saved;
  return sourceLayouts.some((item) => item.id === value) ? (value as SourceLayout) : 'modules';
}
