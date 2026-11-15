import { Workshop } from '../../features/workshop/Workshop';
import './home.css';
export { preloadWorkshopScene as preloadHome } from '../../features/workshop/scene-loader';

export function HomePage({
  notify,
  onReady,
}: {
  notify: (text: string) => void;
  onReady?: () => void;
}) {
  return (
    <div className="home-page">
      <Workshop presentation="workspace" notify={notify} onReady={onReady} />
    </div>
  );
}
