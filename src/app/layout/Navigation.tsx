import { motion } from 'motion/react';
import { navigation } from './navigation.config';
import { SiteLink, useNavigation } from '../navigation';

export function Navigation() {
  const { pathname } = useNavigation();
  return (
    <nav id="site-navigation" className="app-nav" aria-label="Основная навигация">
      {navigation.map(({ id, label, Icon, ...item }) =>
        'href' in item ? (
          <SiteLink
            key={id}
            href={item.href}
            aria-current={pathname === item.href ? 'page' : undefined}
            className="app-nav-item"
            aria-label={label}
            title={label}
          >
            {pathname === item.href && (
              <motion.span
                className="app-nav-active"
                layoutId="app-navigation-active"
                transition={{ type: 'spring', bounce: 0.1, duration: 0.4 }}
              />
            )}
            <Icon size={21} weight="regular" />
            <span>{label}</span>
          </SiteLink>
        ) : (
          <button
            key={id}
            type="button"
            disabled
            className="app-nav-item"
            aria-label={`${label} — раздел в разработке`}
            title={`${label} — раздел в разработке`}
          >
            <Icon size={21} weight="regular" />
            <span>{label}</span>
            <small>Скоро</small>
          </button>
        ),
      )}
    </nav>
  );
}
