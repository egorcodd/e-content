import { useEffect, useRef, useState } from 'react';
import { LogoMark } from '../../shared/ui';
import { Navigation } from './Navigation';
import { SiteLink } from '../navigation';

export function FloatingSidebar({ expandable = false }: { expandable?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (expandable) return;
    setHovered(false);
    setFocused(false);
    setPinned(false);
  }, [expandable]);
  const expanded = expandable && (hovered || focused || pinned);
  function collapse() {
    toggle.current?.focus({ preventScroll: true });
    setPinned(false);
    setHovered(false);
    setFocused(false);
  }
  function toggleExpanded() {
    if (pinned) collapse();
    else setPinned(true);
  }
  return (
    <aside
      className="app-sidebar ec-glow"
      data-expanded={expanded}
      data-expandable={expandable}
      aria-label="Навигация сайта"
      onPointerEnter={(event) => {
        if (expandable && event.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => {
        if (expandable) setFocused(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(event) => {
        if (expandable && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          collapse();
        }
      }}
    >
      {expandable ? (
        <button
          type="button"
          ref={toggle}
          className="app-sidebar-brand"
          aria-label={pinned ? 'Свернуть навигацию' : 'Открыть навигацию'}
          aria-expanded={expanded}
          aria-controls="site-navigation"
          onClick={toggleExpanded}
        >
          <LogoMark variant="fold" size={30} />
          <span>e-content</span>
        </button>
      ) : (
        <SiteLink
          className="app-sidebar-brand"
          href="/"
          aria-label="e-content — цех агентов"
          title="Цех агентов"
        >
          <LogoMark variant="fold" size={30} />
          <span>e-content</span>
        </SiteLink>
      )}
      <Navigation />
      <div className="app-sidebar-account" role="group" aria-label="Аккаунт Егора">
        <span className="app-account-avatar" aria-hidden="true">
          Е
        </span>
        <span className="app-account-copy">
          <strong>Егор</strong>
          <small>Аккаунт</small>
        </span>
      </div>
    </aside>
  );
}
