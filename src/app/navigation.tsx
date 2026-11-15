import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';
import { pageForPath, preloadPage, type SitePage } from './page-loader';
import { NavigationLoading } from './loading/NavigationLoading';

type Pending = { page: SitePage; failed: boolean };
type Request = { id: number; url: URL; page: SitePage; committed: boolean; from: string };
type Navigation = {
  pathname: string | null;
  navigate: (href: string) => void;
  ready: (page: SitePage) => void;
};
const NavigationContext = createContext<Navigation | null>(null);
const normalize = (path: string) => path.replace(/\/+$/, '') || '/';

export function NavigationProvider({ children }: { children: ReactNode }) {
  const initialPath = normalize(window.location.pathname);
  const initialPage = pageForPath(initialPath);
  const [pathname, setPathname] = useState<string | null>(initialPage ? null : initialPath);
  const [pending, setPending] = useState<Pending | null>(
    initialPage ? { page: initialPage, failed: false } : null,
  );
  const current = useRef(pathname);
  const renderedHref = useRef(window.location.href);
  const request = useRef<Request | null>(null);
  const sequence = useRef(0);
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const begin = useCallback(async (href: string, historyMode: 'push' | 'pop') => {
    const url = new URL(href, window.location.href);
    const path = normalize(url.pathname);
    const page = pageForPath(path);
    if (url.origin !== window.location.origin || !page) {
      window.location.assign(url.href);
      return;
    }
    const id = ++sequence.current;
    clearTimeout(deadline.current);
    if (path === current.current) {
      request.current = null;
      setPending(null);
      return;
    }
    request.current = {
      id,
      url,
      page,
      committed: false,
      from: historyMode === 'push' ? window.location.href : renderedHref.current,
    };
    setPending({ page, failed: false });
    deadline.current = setTimeout(() => {
      if (sequence.current === id && request.current) setPending({ page, failed: true });
    }, 20000);
    try {
      await Promise.all([preloadPage(page), document.fonts.ready]);
      if (sequence.current !== id) return;
      if (historyMode === 'push') window.history.pushState(null, '', url);
      request.current!.committed = true;
      current.current = path;
      renderedHref.current = url.href;
      setPathname(path);
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch {
      if (sequence.current === id) setPending({ page, failed: true });
    }
  }, []);

  const navigate = useCallback(
    (href: string) => {
      void begin(href, 'push');
    },
    [begin],
  );
  const ready = useCallback((page: SitePage) => {
    if (request.current?.page !== page || !request.current.committed) return;
    clearTimeout(deadline.current);
    request.current = null;
    setPending(null);
    document.getElementById('home-content')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (pageForPath(normalize(window.location.pathname))) void begin(window.location.href, 'pop');
    const onPop = () => {
      void begin(window.location.href, 'pop');
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      clearTimeout(deadline.current);
      sequence.current++;
    };
  }, [begin]);

  function cancel() {
    const interrupted = request.current;
    const previous = interrupted?.from;
    sequence.current++;
    clearTimeout(deadline.current);
    request.current = null;
    if (interrupted?.committed && previous) {
      window.location.assign(previous);
      return;
    }
    setPending(null);
    if (previous) {
      window.history.replaceState(null, '', previous);
      renderedHref.current = previous;
    }
  }
  const value = useMemo(() => ({ pathname, navigate, ready }), [pathname, navigate, ready]);
  return (
    <NavigationContext.Provider value={value}>
      <div className="app-route-root" inert={!!pending} aria-busy={!!pending}>
        {children}
      </div>
      <NavigationLoading
        pending={pending}
        initial={pathname === null}
        onRetry={() => window.location.assign(request.current?.url.href ?? window.location.href)}
        onCancel={pathname === null ? undefined : cancel}
      />
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('Site navigation requires NavigationProvider');
  return value;
}

export function SiteLink({
  href = '/',
  onClick,
  onPointerEnter,
  onFocus,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useNavigation();
  const preload = () => {
    const url = new URL(href, window.location.href);
    const page =
      url.origin === window.location.origin ? pageForPath(normalize(url.pathname)) : null;
    if (page) void preloadPage(page).catch(() => {});
  };
  return (
    <a
      {...props}
      href={href}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        preload();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        preload();
      }}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          props.download !== undefined ||
          (props.target && props.target !== '_self')
        )
          return;
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin || !pageForPath(normalize(url.pathname))) return;
        event.preventDefault();
        navigate(url.href);
      }}
    />
  );
}
