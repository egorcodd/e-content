import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { pageTitle, type SitePage } from '../page-loader';
import { LoadingScreen } from './LoadingScreen';

export function NavigationLoading({
  pending,
  initial,
  onRetry,
  onCancel,
}: {
  pending: { page: SitePage; failed: boolean } | null;
  initial: boolean;
  onRetry: () => void;
  onCancel?: () => void;
}) {
  const [visible, setVisible] = useState(initial);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return;
    }
    if (initial || pending.failed) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(timer);
  }, [pending, initial]);
  return (
    <AnimatePresence>
      {visible && pending && (
        <motion.div
          className="app-loader-cover"
          key="navigation-loading"
          initial={{ opacity: initial || reduced ? 1 : 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
        >
          <LoadingScreen
            title={pageTitle[pending.page]}
            failed={pending.failed}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
