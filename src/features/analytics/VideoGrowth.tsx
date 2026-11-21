import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CaretDownIcon, PlayIcon } from '@phosphor-icons/react';
import { api } from '../collection/api';
import { day, signedFmt, metricLabel } from './chart-model';
import type { CatalogVideo, TikTokMeasurement } from './contracts';
import { videoGrowthMetrics } from './counters';
import { numericPublicationDate, publicationDate, publicationTime } from './data';

const previewSize = 6;
type GrowthMetric = (typeof videoGrowthMetrics)[number];
const shortLabels: Record<GrowthMetric, string> = {
  views: 'Просм.',
  shares: 'Реп.',
  comments: 'Комм.',
};
function VideoCover({ id }: { id: string }) {
  const [unavailable, setUnavailable] = useState(false);
  return (
    <span className="ap-video-cover" aria-hidden="true">
      {unavailable ? (
        <PlayIcon size={14} />
      ) : (
        <img
          src={`/api/analytics/tiktok/cover?id=${encodeURIComponent(id)}`}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setUnavailable(true)}
        />
      )}
    </span>
  );
}

function VideoRankRow({ video, hidden }: { video: CatalogVideo; hidden: boolean }) {
  return (
    <tr inert={hidden} aria-hidden={hidden || undefined}>
      <th scope="row">
        <div className="ap-video-rank-content">
          <a href={video.url} target="_blank" rel="noreferrer">
            <VideoCover key={video.id} id={video.id} />
            <time dateTime={video.date} title={publicationDate(video.date)}>
              <span className="ap-video-date">{day(video.date)}</span>
              <span className="ap-video-date-short">{numericPublicationDate(video.date)}</span>
              <span className="ap-video-time">
                {publicationTime(video.date)}
                <span className="ap-video-time-zone"> МСК</span>
              </span>
            </time>
          </a>
        </div>
      </th>
      {videoGrowthMetrics.map((metric) => {
        const value = video.counters[metric];
        return (
          <td key={metric}>
            <div className="ap-video-rank-content ap-video-rank-value">
              <span className="ap-video-rank-glyphs">
                {value === undefined ? '—' : signedFmt(value)}
              </span>
            </div>
          </td>
        );
      })}
    </tr>
  );
}

export function VideoGrowth({ points }: { points: TikTokMeasurement[] }) {
  const [sort, setSort] = useState<GrowthMetric>('views');
  const [expanded, setExpanded] = useState(false);
  const [hasExpanded, setHasExpanded] = useState(false);
  const [tableHeight, setTableHeight] = useState<number>();
  const table = useRef<HTMLTableElement>(null);
  const [result, setResult] = useState<{ range: string; videos: CatalogVideo[]; error?: string }>();
  const from = points[0]?.id;
  const to = points.at(-1)?.id;
  const range = from && to && from !== to ? new URLSearchParams({ from, to }).toString() : '';

  useEffect(() => {
    if (!range) return;
    let closed = false;
    void api<{ videos: CatalogVideo[] }>(`/analytics/tiktok/growth?${range}`)
      .then(({ videos }) => {
        if (!closed) setResult({ range, videos });
      })
      .catch(() => {
        if (!closed)
          setResult({ range, videos: [], error: 'Не удалось загрузить прирост роликов.' });
      });
    return () => {
      closed = true;
    };
  }, [range]);

  const current = range && result?.range === range ? result : undefined;
  const updating = !!range && !current;
  const visibleResult = current ?? (updating ? result : undefined);
  const videos = [...(visibleResult?.videos ?? [])].sort(
    (a, b) =>
      (b.counters[sort] ?? -Infinity) - (a.counters[sort] ?? -Infinity) ||
      b.date.localeCompare(a.date) ||
      a.id.localeCompare(b.id),
  );
  const empty = !range
    ? 'Для прироста нужны два замера.'
    : !current
      ? 'Считаем прирост…'
      : (current.error ?? 'За этот интервал прироста по роликам нет.');
  const hasVideos = videos.length > 0;

  useLayoutEffect(() => {
    const element = table.current;
    if (!hasVideos || !element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const lastPreview = element.tBodies[0].rows[previewSize - 1];
      setTableHeight(
        expanded || !lastPreview
          ? bounds.height
          : lastPreview.getBoundingClientRect().bottom - bounds.top,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, hasVideos, sort, videos.length, visibleResult?.range]);

  return (
    <section
      className="ag-card ec-glow ap-video-growth"
      aria-labelledby="video-growth-heading"
      aria-busy={updating}
    >
      <div className="ap-card-heading">
        <h2 id="video-growth-heading">Ролики с приростом</h2>
      </div>
      {videos.length ? (
        <>
          <div className="ap-video-table-viewport" style={{ height: tableHeight }}>
            <table ref={table}>
              <thead>
                <tr>
                  <th scope="col">Ролик</th>
                  {videoGrowthMetrics.map((metric) => (
                    <th
                      key={metric}
                      scope="col"
                      aria-sort={sort === metric ? 'descending' : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => setSort(metric)}
                        aria-label={metricLabel(metric, 'tiktok')}
                        title={`Сортировать по показателю «${metricLabel(metric, 'tiktok')}»`}
                      >
                        <span className="ap-video-metric-label">
                          {metricLabel(metric, 'tiktok')}
                        </span>
                        <span className="ap-video-metric-short">{shortLabels[metric]}</span>
                        <CaretDownIcon aria-hidden="true" size={10} weight="bold" />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {videos.slice(0, hasExpanded ? undefined : previewSize).map((video, index) => (
                  <VideoRankRow
                    key={index}
                    video={video}
                    hidden={!expanded && index >= previewSize}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {videos.length > previewSize && (
            <button
              className="ap-video-growth-more"
              type="button"
              aria-expanded={expanded}
              onClick={() => {
                setHasExpanded(true);
                setExpanded(!expanded);
              }}
            >
              {expanded ? 'Свернуть' : `Все ролики (${videos.length})`}
            </button>
          )}
        </>
      ) : (
        <p className="ap-insight-empty" role="status">
          {empty}
        </p>
      )}
    </section>
  );
}
