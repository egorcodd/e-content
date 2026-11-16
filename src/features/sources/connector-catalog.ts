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
