import { useEffect } from 'react';

export function useSpotlight() {
  useEffect(() => {
    const selector = '.ec-button, .ec-round, .ec-glow';
    const move = (event: PointerEvent) => {
      let element = (event.target as Element | null)?.closest<HTMLElement>(selector) ?? null;
      while (element) {
        const bounds = element.getBoundingClientRect();
        element.style.setProperty('--mx', `${event.clientX - bounds.left}px`);
        element.style.setProperty('--my', `${event.clientY - bounds.top}px`);
        element = element.parentElement?.closest<HTMLElement>(selector) ?? null;
      }
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);
}
