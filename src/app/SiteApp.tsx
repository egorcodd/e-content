import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { XIcon } from '@phosphor-icons/react';
import { AppShell } from './layout/AppShell';
import { StatusIcon } from '../shared/ui';
import { useSpotlight } from '../shared/useSpotlight';
import { loadAnalyticsPage, loadHomePage, type SitePage } from './page-loader';
import { useNavigation } from './navigation';

const AnalyticsPage = lazy(loadAnalyticsPage);
const HomePage = lazy(() => loadHomePage().then((module) => ({ default: module.HomePage })));

function PageReady({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(onReady);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [onReady]);
  return null;
}

export function SiteApp({ page = 'home' }: { page?: SitePage }) {
  const { ready } = useNavigation();
  const onReady = useCallback(() => ready(page), [page, ready]);
  const [notice, setNotice] = useState('');
  const reduced = useReducedMotion();
  useSpotlight();
  useEffect(() => {
    document.title = `${page === 'analytics' ? 'Аналитика' : 'Цех агентов'} · e-content`;
  }, [page]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3800);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <MotionConfig reducedMotion="user">
      <AppShell
        layout={page === 'analytics' ? 'document' : 'canvas'}
        sidebarExpandable={page === 'home'}
      >
        <motion.div
          className="app-page"
          key={page}
          initial={reduced ? false : { opacity: 0.7 }}
          animate={{ opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
        >
          <Suspense fallback={null}>
            {page === 'analytics' ? (
              <>
                <AnalyticsPage />
                <PageReady onReady={onReady} />
              </>
            ) : (
              <HomePage notify={setNotice} onReady={onReady} />
            )}
          </Suspense>
        </motion.div>
      </AppShell>
      <AnimatePresence>
        {notice && (
          <motion.div
            className="app-toast"
            role="status"
            initial={reduced ? false : { opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <StatusIcon kind="done" size={16} />
            <span>{notice}</span>
            <button
              className="ec-icon"
              onClick={() => setNotice('')}
              aria-label="Закрыть уведомление"
            >
              <XIcon size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
