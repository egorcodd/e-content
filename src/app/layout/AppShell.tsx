import type { ReactNode } from 'react';
import { FloatingSidebar } from './FloatingSidebar';
import './layout.css';

export function AppShell({
  children,
  layout = 'canvas',
  sidebarExpandable = false,
}: {
  children: ReactNode;
  layout?: 'canvas' | 'document';
  sidebarExpandable?: boolean;
}) {
  return (
    <div className={`app-shell app-shell-${layout}`}>
      <a className="app-skip" href="#home-content">
        К содержимому
      </a>
      <FloatingSidebar expandable={sidebarExpandable} />
      <main id="home-content" className="app-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
