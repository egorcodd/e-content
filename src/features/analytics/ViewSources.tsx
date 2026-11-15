import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChartDonutIcon, TelegramLogoIcon, TiktokLogoIcon } from '@phosphor-icons/react';
import { Segment } from '../../shared/ui';
import { compact, fmt, percent, platformLabel, type Platform } from './chart-model';
import type { AnalyticsFilters } from './model';
import { viewSources, type ViewSourcesResult } from './source-data';

export function ViewSources({ filters }: { filters: AnalyticsFilters }) {
  const [selected, setSelected] = useState<Platform>('telegram');
  const platform = filters.source === 'all' ? selected : filters.source;
  const reduced = useReducedMotion();
  return (
    <section className="ag-card ec-glow ap-sources" aria-labelledby="sources-heading">
      <div className="ap-card-heading">
        <h2 id="sources-heading">Источники просмотров</h2>
        <div className="ap-sources-controls">
          {filters.source === 'all' ? (
            <Segment
              label="Площадка источников просмотров"
              size="sm"
              value={selected}
              onChange={(value) => setSelected(value as Platform)}
              values={[
                { id: 'telegram', label: 'Telegram', icon: <TelegramLogoIcon size={15} /> },
                { id: 'tiktok', label: 'TikTok', icon: <TiktokLogoIcon size={15} /> },
              ]}
            />
          ) : (
            <span className="ap-sources-platform">{platformLabel[platform]}</span>
          )}
        </div>
      </div>
      <div className="ap-sources-stage">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="ap-sources-frame"
            key={`${platform}-${filters.period}`}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
          >
            <SourceBreakdown result={viewSources(platform, filters.period)} platform={platform} />
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

function SourceBreakdown({ result, platform }: { result: ViewSourcesResult; platform: Platform }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const id = useId();
  if (result.status === 'unavailable')
    return (
      <div className="ap-sources-empty" role="status">
        <ChartDonutIcon size={38} weight="light" />
        <strong>Нет данных об источниках</strong>
        <p>Разбивка появится после подключения расширенной статистики TikTok.</p>
      </div>
    );
  if (!result.total)
    return (
      <div className="ap-sources-empty" role="status">
        <ChartDonutIcon size={38} weight="light" />
        <strong>За этот период нет просмотров</strong>
      </div>
    );
  const active = hovered ?? selected;
  const current = result.sources.find((source) => source.id === active);
  const colors = [
    platform === 'telegram' ? '#7b9fbc' : '#b68198',
    '#a4a4a4',
    '#767676',
    '#505050',
    '#333333',
  ];
  const circumference = 2 * Math.PI * 70;
  let offset = 0;
  return (
    <div className="ap-sources-breakdown" data-sources-total={result.total}>
      <div className="ap-sources-ring">
        <svg
          viewBox="0 0 180 180"
          role="img"
          aria-label={`Источники просмотров. Всего ${fmt(result.total)}.`}
        >
          <defs>
            <pattern
              id={id}
              width="4"
              height="4"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(35)"
            >
              <path d="M0 0V4" stroke="#fff" strokeOpacity=".08" />
            </pattern>
          </defs>
          {result.sources.map((source, index) => {
            const length = (source.views / result.total) * circumference;
            const start = offset;
            offset += length;
            return (
              <motion.circle
                key={source.id}
                cx="90"
                cy="90"
                r="70"
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth={current?.id === source.id ? 20 : 16}
                transform="rotate(-90 90 90)"
                strokeDashoffset={-start}
                initial={reduced ? false : { strokeDasharray: `0 ${circumference}` }}
                animate={{
                  strokeDasharray: `${Math.max(0, length - 3)} ${circumference - Math.max(0, length - 3)}`,
                  opacity: active === null || active === source.id ? 1 : 0.35,
                }}
                transition={{ duration: reduced ? 0 : 0.55 }}
                onPointerEnter={() => setHovered(source.id)}
                onPointerLeave={() => setHovered(null)}
              />
            );
          })}
          <circle
            cx="90"
            cy="90"
            r="70"
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth="16"
            pointerEvents="none"
          />
        </svg>
        <div className="ap-sources-center" aria-hidden="true">
          <strong>
            {current ? percent((current.views / result.total) * 100) : compact(result.total)}
          </strong>
          <span>{current?.label ?? 'просмотров'}</span>
        </div>
      </div>
      <div className="ap-sources-list" role="group" aria-label="Распределение просмотров">
        {result.sources.map((source, index) => (
          <button
            key={source.id}
            type="button"
            aria-pressed={selected === source.id}
            data-source-views={source.views}
            data-source-share={(source.views / result.total) * 100}
            onPointerEnter={() => setHovered(source.id)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(source.id)}
            onBlur={() => setHovered(null)}
            onClick={() => setSelected(selected === source.id ? null : source.id)}
            data-highlighted={active === source.id}
          >
            <i style={{ background: colors[index % colors.length] }} />
            <span>{source.label}</span>
            <small>{fmt(source.views)}</small>
            <strong>{percent((source.views / result.total) * 100)}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
