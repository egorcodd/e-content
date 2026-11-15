import {
  ChartLineUpIcon,
  FolderSimpleIcon,
  GraphIcon,
  PlugsConnectedIcon,
} from '@phosphor-icons/react';

export const navigation = [
  { id: 'home', label: 'Цех агентов', Icon: GraphIcon, href: '/' },
  { id: 'library', label: 'Материалы', Icon: FolderSimpleIcon, href: '/materials' },
  { id: 'analytics', label: 'Аналитика', Icon: ChartLineUpIcon, href: '/analytics' },
  { id: 'sources', label: 'Источники', Icon: PlugsConnectedIcon, href: '/sources' },
] as const;
