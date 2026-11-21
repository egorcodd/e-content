import { PlugsConnectedIcon, ArrowUpRightIcon } from '@phosphor-icons/react';
import { useSources } from './repository';
import type { Platform } from './model';

export function WorkshopSources({ platform, open }: { platform: Platform; open: () => void }) {
  const { sources } = useSources();
  const selected = sources.filter((source) => source.platform === platform && source.enabled);
  const names = selected.slice(0, 3).map(source => source.title).join(', ');
  return (
    <button type="button" className="wg-source-link" onClick={open}
      title="Настроить источники" aria-label={`Настроить источники: ${names || 'источники не выбраны'}`}>
      <PlugsConnectedIcon size={15} aria-hidden="true" />
      <span>Источники · {selected.length}</span>
      <span className="wg-source-names">
        {names || 'Выбрать'}{selected.length > 3 && ` · ещё ${selected.length - 3}`}
      </span>
      <ArrowUpRightIcon size={13} aria-hidden="true" />
    </button>
  );
}
