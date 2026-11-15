import { PlayIcon } from '@phosphor-icons/react';
import { AnimatedNumber, ArrowSwap, StatusBadge } from '../../shared/ui';
import { stations, type ViewProps } from './stations';

const topics = ['Карьера', 'AI', 'SQL', 'Найм', 'Пет-проекты', 'Собеседования', 'Обучение'];
const bubbles = [72, 48, 84, 56, 66, 40];
const inbox = [
  { title: 'Как говорить об учебном опыте', tint: 'var(--tg)', time: '14:32' },
  { title: 'Первое собеседование в IT', tint: 'var(--tt)', time: '14:18' },
  { title: 'Как говорить об учебном опыте', tint: 'var(--tt)', time: '13:57', duplicate: true },
  { title: 'AI-инструменты для разработчика', tint: 'var(--tt)', time: '13:40' },
  { title: 'Что изменилось в найме', tint: 'var(--tg)', time: '12:05' },
];

/** Small live picture of what a station does; animates only while the station runs. */
function Viz({ id, progress }: { id: string; progress: number }) {
  if (id === 'telegram' || id === 'comments')
    return id === 'telegram' ? (
      <span className="viz-feed">
        <span className="viz-feed-track">
          {[...bubbles, ...bubbles].map((w, i) => (
            <i key={i} style={{ width: `${w}%` }} />
          ))}
        </span>
      </span>
    ) : (
      <span className="viz-thread">
        <span>
          <b />
          <i style={{ width: '78%' }} />
        </span>
        <span className="is-reply">
          <b />
          <i style={{ width: '58%' }} />
        </span>
        <span className="is-reply">
          <b />
          <i className="viz-typing">
            <em />
            <em />
            <em />
          </i>
        </span>
      </span>
    );
  if (id === 'tiktok')
    return (
      <span className="viz-reels">
        <span className="viz-reels-track">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ ['--p' as string]: `${30 + ((i * 37) % 60)}%` }}>
              <PlayIcon size={11} weight="fill" />
            </i>
          ))}
        </span>
      </span>
    );
  if (id === 'collector')
    return (
      <span className="viz-dedup">
        <span className="viz-inbox">
          {inbox.map((row, i) => (
            <span
              key={i}
              className={row.duplicate && progress >= 0.5 ? 'is-duplicate' : ''}
              style={{ ['--tint' as string]: row.tint, animationDelay: `${i * 0.22}s` }}
            >
              <i />
              <b>{row.title}</b>
              <em>{row.duplicate && progress >= 0.5 ? 'повтор' : row.time}</em>
            </span>
          ))}
        </span>
        <span className="viz-dedup-number">
          <AnimatedNumber value={progress > 0 ? Math.round(1800 - 659 * progress) : 1800} />
          <small>{progress >= 1 ? 'уникальных записей' : 'записей во входящих'}</small>
        </span>
        <span className="viz-dedup-bar">
          <i style={{ scale: `${1 - 0.366 * progress} 1` }} />
        </span>
        <span className="viz-dedup-legend">
          <span style={{ ['--tint' as string]: 'var(--tg)' }}>Telegram 1 080</span>
          <span style={{ ['--tint' as string]: 'var(--tt)' }}>TikTok 720</span>
          <span>Повторы {Math.round(659 * progress)}</span>
        </span>
      </span>
    );
  if (id === 'ideas')
    return (
      <span className="viz-chips">
        {topics.map((t, i) => (
          <i key={t} style={{ animationDelay: `${i * 0.18}s` }}>
            {t}
          </i>
        ))}
      </span>
    );
  if (id === 'materials')
    return (
      <span className="viz-docs">
        {['scripts.md', 'ideas.md', 'interview.md'].map((name) => (
          <i key={name}>
            <b>{name}</b>
            <em />
            <em />
            <em />
          </i>
        ))}
      </span>
    );
  return (
    <svg className="viz-spark" viewBox="0 0 200 64" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="wg-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#fff" stopOpacity=".14" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 50C18 48 24 38 40 40S64 28 80 30 104 44 120 34 146 14 160 18 186 10 200 6V64H0Z"
        fill="url(#wg-spark-fill)"
      />
      <path
        className="viz-spark-line"
        d="M0 50C18 48 24 38 40 40S64 28 80 30 104 44 120 34 146 14 160 18 186 10 200 6"
        pathLength="100"
      />
    </svg>
  );
}

export function ConsoleView({ selected, active, states, progress, choose }: ViewProps) {
  return (
    <div className="wg-console">
      {stations.map((s, i) => (
        <button
          type="button"
          key={s.id}
          id={'wg-node-' + s.id}
          className={`wg-tile wg-tile-${s.id} ec-glow is-${states[s.id]} ${selected === s.id ? 'wg-selected' : ''} ${active === s.id ? 'wg-active' : ''}`}
          style={{ ['--tint' as string]: s.tint, gridArea: s.id }}
          aria-label={`Открыть участок ${s.name}`}
          aria-expanded={selected === s.id}
          onClick={() => choose(s.id)}
        >
          <span className="wg-tile-head">
            <span className="wg-tile-icon">
              <s.Icon size={20} weight="duotone" />
            </span>
            <span className="wg-tile-name">
              <strong>{s.name}</strong>
              <small>{s.sub}</small>
            </span>
            <span className="wg-tile-index">{String(i + 1).padStart(2, '0')}</span>
          </span>
          <span className="wg-tile-viz" aria-hidden="true">
            <Viz id={s.id} progress={progress[s.id]} />
          </span>
          <span className="wg-tile-foot">
            <StatusBadge kind={states[s.id]} key={states[s.id]} />
            <span className="wg-tile-file">
              {s.steps.at(-1)}
              <ArrowSwap size={14} />
            </span>
          </span>
          <span className="wg-tile-progress" aria-hidden="true">
            <i style={{ scale: `${progress[s.id]} 1` }} />
          </span>
        </button>
      ))}
    </div>
  );
}
