export type SitePage = 'home' | 'analytics' | 'materials' | 'sources';
export const pageTitle: Record<SitePage, string> = {
  home: 'Цех агентов',
  analytics: 'Аналитика',
  materials: 'Материалы',
  sources: 'Источники',
};
export const pageForPath = (pathname: string): SitePage | null =>
  pathname === '/'
    ? 'home'
    : pathname === '/analytics'
      ? 'analytics'
      : pathname === '/materials'
        ? 'materials'
        : pathname === '/sources'
          ? 'sources'
          : null;

let home: ReturnType<typeof importHome> | undefined;
let analytics: ReturnType<typeof importAnalytics> | undefined;
const importHome = () => import('../pages/home/HomePage');
const importAnalytics = () => import('../pages/analytics/AnalyticsPage');
const importMaterials = () => import('../pages/materials/MaterialsPage');
const importSources = () => import('../pages/sources/SourcesPage');
let sources: ReturnType<typeof importSources> | undefined;
export function loadSourcesPage() {
  return (sources ??= importSources().catch((error) => {
    sources = undefined;
    throw error;
  }));
}
let materials: ReturnType<typeof importMaterials> | undefined;
export function loadMaterialsPage() {
  return (materials ??= importMaterials().catch((error) => {
    materials = undefined;
    throw error;
  }));
}

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
  else if (page === 'materials') await (await loadMaterialsPage()).preloadMaterials();
  else if (page === 'sources') await loadSourcesPage();
  else await (await loadHomePage()).preloadHome();
}
