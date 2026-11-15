import {
  ChatCircleTextIcon,
  FileTextIcon,
  PlayIcon,
  TelegramLogoIcon,
  TiktokLogoIcon,
} from '@phosphor-icons/react';
import type { Platform } from './model';

export function ConnectorObject({ platform }: { platform: Platform }) {
  const Icon = platform === 'telegram' ? TelegramLogoIcon : TiktokLogoIcon;
  return (
    <div className={`co-object co-${platform}`} aria-hidden="true">
      <div className="co-shadow" />
      <div className="co-sheet co-sheet-back">
        <FileTextIcon size={25} weight="thin" />
        <span />
        <span />
      </div>
      <div className="co-sheet co-sheet-middle">
        {platform === 'telegram' ? (
          <ChatCircleTextIcon size={27} weight="thin" />
        ) : (
          <PlayIcon size={29} weight="thin" />
        )}
        <span />
        <span />
      </div>
      <div className="co-sheet co-sheet-front">
        <div className="co-object-icon">
          <Icon size={46} weight="light" />
        </div>
        <div className="co-etched-lines">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="co-platform-foot">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
