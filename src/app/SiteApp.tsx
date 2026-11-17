import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { XIcon } from '@phosphor-icons/react';
import { AppShell } from './layout/AppShell';
import { StatusIcon } from '../shared/ui';
import { useSpotlight } from '../shared/useSpotlight';
import {
  loadAnalyticsPage,
  loadHomePage,
  loadMaterialsPage,
  loadSourcesPage,
  pageTitle,
  type SitePage,
} from './page-loader';
import { useNavigation } from './navigation';

const AnalyticsPage = lazy(loadAnalyticsPage);
const MaterialsPage = lazy(loadMaterialsPage);
const SourcesPage = lazy(loadSourcesPage);
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
  const { ready, navigate } = useNavigation();
  const openMaterial = useCallback(
    (id: string) => navigate(id ? `/materials?material=${encodeURIComponent(id)}` : '/materials'),
    [navigate],
  );
  const onReady = useCallback(() => ready(page), [page, ready]);
  const openAnalytics = useCallback(() => navigate('/analytics?source=tiktok'), [navigate]);
  const openSources = useCallback(
    (platform: 'telegram' | 'tiktok') => navigate(`/sources?platform=${platform}`),
    [navigate],
  );
  const homeReady = useCallback(() => ready('home'), [ready]);
  const [keepHome, setKeepHome] = useState(page === 'home');
  useEffect(() => {
    if (page === 'home') setKeepHome(true);
  }, [page]);
  const [notice, setNotice] = useState<{ message: string; id: number } | null>(null);
  const notify = useCallback(
    (message: string) => setNotice({ message, id: performance.now() }),
    [],
  );
  const reduced = useReducedMotion();
  useSpotlight();
  useEffect(() => {
    document.title = `${pageTitle[page]} · e-content`;
  }, [page]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3800);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <MotionConfig reducedMotion="user">
      <AppShell
        layout={page === 'home' ? 'canvas' : 'document'}
        sidebarExpandable={page === 'home'}
      >
        {(keepHome || page === 'home') && (
          <div className="app-page app-home-layer" hidden={page !== 'home'}>
            <Suspense fallback={null}>
              <HomePage
                notify={notify}
                onReady={homeReady}
                active={page === 'home'}
                openMaterial={openMaterial}
                openSources={openSources}
                openAnalytics={openAnalytics}
              />
            </Suspense>
          </div>
        )}
        {page !== 'home' && (
          <motion.div
            className="app-page"
            key={page}
            initial={reduced ? false : { opacity: 0.7 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          >
            <Suspense fallback={null}>
              {page === 'analytics' ? (
                <AnalyticsPage />
              ) : page === 'sources' ? (
                <SourcesPage notify={notify} />
              ) : (
                <MaterialsPage notify={notify} />
              )}
              <PageReady onReady={onReady} />
            </Suspense>
          </motion.div>
        )}
      </AppShell>
      <div className="app-toast-anchor">
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
              <span>{notice.message}</span>
              <button
                className="ec-icon"
                onClick={() => setNotice(null)}
                aria-label="Закрыть уведомление"
              >
                <XIcon size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
