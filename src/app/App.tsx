import { lazy, Suspense } from 'react';
import { SiteApp } from './SiteApp';
import { NavigationProvider, SiteLink, useNavigation } from './navigation';
import { LoadingScreen } from './loading/LoadingScreen';
import { pageForPath } from './page-loader';

const DesignSystem = lazy(() => import('../LabApp'));
export default function App() {
  return (
    <NavigationProvider>
      <Routes />
    </NavigationProvider>
  );
}

function Routes() {
  const { pathname } = useNavigation();
  if (pathname === null) return null;
  if (pathname === '/design-system') {
    return (
      <Suspense fallback={<LoadingScreen title="Компоненты" />}>
        <DesignSystem />
      </Suspense>
    );
  }
  const page = pageForPath(pathname);
  if (page) return <SiteApp page={page} />;
  return (
    <main className="app-loading">
      <h1>Страница не найдена</h1>
      <SiteLink className="ec-button" href="/">
        На главную
      </SiteLink>
    </main>
  );
}
