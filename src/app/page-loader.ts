export type SitePage = 'home' | 'analytics';
export const pageTitle: Record<SitePage, string> = { home: 'Цех агентов', analytics: 'Аналитика' };
export const pageForPath = (pathname: string): SitePage | null =>
  pathname === '/' ? 'home' : pathname === '/analytics' ? 'analytics' : null;

let home: ReturnType<typeof importHome> | undefined;
let analytics: ReturnType<typeof importAnalytics> | undefined;
const importHome = () => import('../pages/home/HomePage');
const importAnalytics = () => import('../pages/analytics/AnalyticsPage');

export function loadHomePage() {
  return (home ??= importHome().catch((error) => {
    home = undefined;
    throw error;
  }));
}

export function loadAnalyticsPage() {
  return (analytics ??= importAnalytics().catch((error) => {
    analytics = undefined;
    throw error;
  }));
}

export async function preloadPage(page: SitePage) {
  if (page === 'analytics') await loadAnalyticsPage();
  else await (await loadHomePage()).preloadHome();
}
