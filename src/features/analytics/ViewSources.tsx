import type { AnalyticsSource } from './model';

export function ViewSources({ source }: { source: AnalyticsSource }) {
  return (
    <section className="ag-card ec-glow ap-sources" aria-labelledby="sources-heading">
      <div className="ap-card-heading">
        <h2 id="sources-heading">Источники просмотров</h2>
      </div>
      <p className="ap-insight-empty">
        {source === 'telegram'
          ? 'Нет данных о том, откуда пришли просмотры.'
          : 'Счётчики TikTok показывают число просмотров. Разбивка по источникам недоступна.'}
      </p>
    </section>
  );
}
