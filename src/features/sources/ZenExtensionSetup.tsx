import { useState } from 'react';
import type { TikTokConnectionState } from './tiktok-contracts';

export function ZenExtensionSetup({
  state,
  generate,
  busy,
}: {
  state: TikTokConnectionState;
  generate: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState('');
  const code = state.extension?.pairing?.code;
  const expired =
    state.extension?.pairing && Date.parse(state.extension.pairing.expiresAt) <= Date.now();
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      setCopied('');
    }
  }
  if (state.extension?.paired && !code)
    return (
      <p className="tt-zen-presence" data-online={state.extension.online}>
        <span />
        {state.extension.online
          ? 'Расширение Zen на связи'
          : 'Откройте Zen с установленным расширением'}
      </p>
    );
  return (
    <ol className="tt-zen-setup">
      <li>
        <span className="tt-zen-step">1</span>
        <div>
          <strong>Установите расширение в Zen</strong>
          <a className="ec-button" href="/api/zen/extension.zip" download>
            Скачать расширение
          </a>
          <p>
            Откройте адрес ниже, нажмите «Загрузить временное дополнение» и выберите скачанный ZIP.
          </p>
          <button
            className="tt-zen-copy"
            onClick={() => void copy('about:debugging#/runtime/this-firefox')}
          >
            <code>about:debugging#/runtime/this-firefox</code>
            <span>{copied.startsWith('about:') ? 'Скопировано' : 'Копировать'}</span>
          </button>
          <p>Временную установку нужно повторить после перезапуска Zen.</p>
        </div>
      </li>
      <li>
        <span className="tt-zen-step">2</span>
        <div>
          <strong>Свяжите расширение с цехом</strong>
          <button className="ec-button ec-white" disabled={busy} onClick={generate}>
            {busy
              ? 'Получаем код…'
              : code && !expired
                ? 'Обновить код'
                : 'Получить код подключения'}
          </button>
          {code && !expired ? (
            <>
              <p>Откройте e-content в меню расширений Zen и вставьте код.</p>
              <button
                className="tt-zen-code"
                aria-label="Копировать код подключения Zen"
                onClick={() => void copy(code)}
              >
                <code>{code.match(/.{1,4}/g)?.join(' ')}</code>
                <span>{copied === code ? 'Скопировано' : 'Копировать'}</span>
              </button>
            </>
          ) : (
            <p>
              {expired
                ? 'Код истёк. Получите новый кнопкой ниже.'
                : 'Получите код подключения кнопкой ниже.'}
            </p>
          )}
        </div>
      </li>
    </ol>
  );
}
