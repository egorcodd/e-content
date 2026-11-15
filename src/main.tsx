import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/golos-text/wght.css';
import App from './app/App';
import { migrateLegacyUrl } from './app/routes';
import './shared/styles/foundation.css';
import './shared/styles/ui.css';
migrateLegacyUrl();
createRoot(document.getElementById('root')!).render(<App />);
