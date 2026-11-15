import { Workshop } from '../../features/workshop/Workshop';
import './home.css';
export { preloadWorkshopScene as preloadHome } from '../../features/workshop/scene-loader';

export function HomePage({
  notify,
  onReady,
  active = true,
  openMaterial,
  openSources,
}: {
  notify: (text: string) => void;
  onReady?: () => void;
  active?: boolean;
  openMaterial?: (id: string) => void;
  openSources?: (platform: 'telegram' | 'tiktok') => void;
}) {
  return (
    <div className="home-page">
      <Workshop
        presentation="workspace"
        notify={notify}
        onReady={onReady}
        enabled={active}
        openMaterial={openMaterial}
        openSources={openSources}
      />
    </div>
  );
}
