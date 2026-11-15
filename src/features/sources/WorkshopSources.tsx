import { PlugsConnectedIcon, ArrowUpRightIcon } from '@phosphor-icons/react';
import { useSources } from './repository';
import type { Platform } from './model';

export function WorkshopSources({ platform, open }: { platform: Platform; open: () => void }) {
  const { sources } = useSources();
  const selected = sources.filter((source) => source.platform === platform && source.enabled);
  return (
    <div className="wg-configured-sources">
      <div>
        <PlugsConnectedIcon size={15} />
        <span>Источники · {selected.length}</span>
      </div>
      {selected.length ? (
        <ul>
          {selected.slice(0, 3).map((source) => (
            <li key={source.id}>{source.title}</li>
          ))}
          {selected.length > 3 && <li>Ещё {selected.length - 3}</li>}
        </ul>
      ) : (
        <p>Выберите каналы или видео для анализа.</p>
      )}
      <button className="ec-text" onClick={open}>
        Настроить источники
        <ArrowUpRightIcon size={14} />
      </button>
    </div>
  );
}
