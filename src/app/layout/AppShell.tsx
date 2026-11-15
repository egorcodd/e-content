import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
  const content = useRef<HTMLElement>(null);
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    if (sidebarExpandable) return;
    const main = content.current;
    if (!main) return;
    const resize = new ResizeObserver(measure);
    function measure() {
      const page = main?.querySelector<HTMLElement>('.app-page:not([hidden]) > :first-child');
      const sidebar = main?.parentElement?.querySelector('.app-sidebar');
      if (page) resize.observe(page);
      const width = parseFloat(
        getComputedStyle(main!.parentElement!).getPropertyValue('--sidebar-expanded-width'),
      );
      setFits(
        innerWidth > 700 &&
          !!page &&
          !!sidebar &&
          page.getBoundingClientRect().left >= sidebar.getBoundingClientRect().left + width + 20,
      );
    }
    const changes = new MutationObserver(measure);
    resize.observe(main);
    changes.observe(main, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    measure();
    return () => {
      resize.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [sidebarExpandable, children]);
  return (
    <div className={`app-shell app-shell-${layout}`}>
      <a className="app-skip" href="#home-content">
        К содержимому
      </a>
      <FloatingSidebar expandable={sidebarExpandable || fits} />
      <main ref={content} id="home-content" className="app-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
