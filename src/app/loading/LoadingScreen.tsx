import './loading.css';

export function LoadingScreen({
  title,
  failed = false,
  onRetry,
  onCancel,
}: {
  title: string;
  failed?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div
      className="app-loader"
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      aria-label={failed ? 'Не удалось открыть страницу' : `Загрузка: ${title}`}
    >
      <div className="app-loader-content">
        <div className="app-loader-emblem" aria-hidden="true">
          <div className="app-loader-core">
            <i />
            <i />
            <i />
            <i />
            <i />
            <b />
            <b />
            <b />
          </div>
          <div className="app-loader-orbit">
            <i />
          </div>
          <div className="app-loader-orbit">
            <i />
          </div>
          <div className="app-loader-orbit">
            <i />
          </div>
        </div>
        <strong className="app-loader-name">e-content</strong>
        <span className="app-loader-caption">{failed ? 'Не удалось открыть страницу' : title}</span>
        {failed ? (
          <div className="app-loader-actions">
            <button className="ec-button ec-white" onClick={onRetry}>
              Повторить
            </button>
            {onCancel && (
              <button className="ec-button" onClick={onCancel}>
                Вернуться
              </button>
            )}
          </div>
        ) : (
          <div className="app-loader-rail" aria-hidden="true">
            <i />
          </div>
        )}
      </div>
    </div>
  );
}
