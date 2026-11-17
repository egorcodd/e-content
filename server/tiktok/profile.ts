import type { BrowserContext, Page, Response } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../errors.ts';
import { parseVideo, tiktokId, type TikTokVideo } from './parser.ts';
import type { TikTokIdentity } from '../../src/features/sources/tiktok-contracts.ts';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function parseIdentity(value: unknown): TikTokIdentity | null {
  const user = object(value);
  const rawId = user.user_id_str ?? user.uid ?? user.userId ?? user.id;
  const handle = user.username ?? user.uniqueId ?? user.unique_id;
  if (!rawId || typeof handle !== 'string' || !/^[\w.]{2,24}$/.test(handle)) return null;
  try {
    return {
      id: tiktokId(rawId),
      handle,
      displayName: String(user.screen_name ?? user.nickName ?? user.nickname ?? handle).slice(
        0,
        100,
      ),
    };
  } catch {
    return null;
  }
}
export async function accessGate(page: Page, { login = false }: { login?: boolean } = {}) {
  const body = await page
    .locator('body')
    .innerText({ timeout: 2000 })
    .catch(() => '');
  if (
    login &&
    /Too many attempts|Too many requests|Слишком много попыток|Слишком много запросов/i.test(body)
  )
    throw new AppError(
      429,
      'TIKTOK_RATE_LIMIT',
      'Слишком много попыток входа в TikTok. Повторите позже.',
    );
  if (
    login &&
    /Подтверждение личности|Подтвердите личность|Введите (?:шестизначный |6-значный )?код|(?:Verify|Confirm) your identity|Identity verification|Enter (?:the )?(?:6-digit |six-digit )?(?:verification|confirmation|security) code/i.test(
      body,
    )
  )
    throw new AppError(409, 'TIKTOK_VERIFICATION', 'Завершите подтверждение входа в окне TikTok.');
  if (
    /When is your birthday|Когда у вас день рождения|Enter your date of birth|Укажите дату рождения|Verify to continue|Complete the puzzle|Drag the puzzle|Подтвердите, что вы человек|Перетащите.*пазл/i.test(
      body,
    )
  )
    throw new AppError(
      409,
      'TIKTOK_VERIFICATION',
      'TikTok запросил подтверждение. Завершите его в окне подключения.',
    );
}
export async function probeIdentity(
  context: BrowserContext,
  page: Page,
): Promise<TikTokIdentity | null> {
  const cookies = await context.cookies('https://www.tiktok.com');
  if (
    !cookies.some(
      (cookie) => /^(sessionid(?:_ss)?|sid_tt|sid_guard)$/i.test(cookie.name) && cookie.value,
    )
  )
    return null;
  const response = await page.goto('https://www.tiktok.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });
  if (!response || response.status() >= 400)
    throw new AppError(503, 'TIKTOK_UNAVAILABLE', 'Не удалось проверить аккаунт TikTok.');
  await accessGate(page, { login: true });
  const health = object(
    await page.evaluate(async () => {
      try {
        const response = await fetch(
          '/passport/web/account/info/?aid=1988&app_language=en&app_name=tiktok_web',
          { credentials: 'include' },
        );
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      }
    }),
  );
  const healthData = object(health.data);
  if (health?.message === 'success') {
    const identity = parseIdentity(healthData);
    if (identity) return identity;
  }
  if (healthData.error_code === 13 || healthData.name === 'session_expired') return null;
  const content = await page
    .locator('#__UNIVERSAL_DATA_FOR_REHYDRATION__')
    .textContent({ timeout: 10000 })
    .catch(() => null);
  if (content) {
    try {
      const data = object(JSON.parse(content));
      const user = object(object(data.__DEFAULT_SCOPE__)['webapp.app-context']).user;
      const identity = parseIdentity(user);
      if (identity) return identity;
    } catch {}
  }
  throw new AppError(
    503,
    'TIKTOK_IDENTITY_UNAVAILABLE',
    'TikTok не подтвердил личность аккаунта. Попробуйте проверить подключение ещё раз.',
  );
}

export type VideoDiscovery = { videos: TikTokVideo[]; complete: boolean };
export async function discoverVideos(
  page: Page,
  url: string,
  limit: number,
  signal: AbortSignal,
): Promise<VideoDiscovery> {
  const handle = new URL(url).pathname.split('/')[1]?.replace(/^@/, '');
  if (!/^[\w.]{2,24}$/.test(handle ?? ''))
    throw new AppError(400, 'TIKTOK_PROFILE', 'Не удалось определить профиль TikTok.');
  const found = new Map<string, TikTokVideo>();
  let complete = false,
    queue = Promise.resolve(),
    failure: unknown;
  const add = (raw: unknown) => {
    const item = object(raw),
      author = object(item.author);
    if (
      typeof author.uniqueId === 'string' &&
      author.uniqueId.toLowerCase() !== handle.toLowerCase()
    )
      return;
    const video = parseVideo({
      ...item,
      author: { ...author, uniqueId: author.uniqueId ?? handle },
    });
    found.set(video.id, video);
  };
  const receive = (response: Response) => {
    const location = new URL(response.url());
    if (location.hostname !== 'www.tiktok.com' || location.pathname !== '/api/post/item_list/')
      return;
    queue = queue
      .then(async () => {
        if (!response.ok())
          throw new AppError(
            response.status(),
            'TIKTOK_PROFILE_RESPONSE',
            'TikTok не выдал список роликов профиля.',
          );
        const raw = await response.body();
        if (raw.length > 5000000)
          throw new AppError(
            502,
            'TIKTOK_PROFILE_RESPONSE',
            'Список роликов TikTok превысил допустимый объём.',
          );
        let data: Record<string, unknown>;
        try {
          data = object(JSON.parse(raw.toString('utf8')));
        } catch {
          throw new AppError(
            502,
            'TIKTOK_PROFILE_RESPONSE',
            'TikTok не выдал читаемый список роликов. Попробуйте обновить его позже.',
          );
        }
        const items = data.itemList ?? data.item_list;
        if ((data.statusCode ?? data.status_code ?? 0) !== 0 || !Array.isArray(items))
          throw new AppError(
            502,
            'TIKTOK_PROFILE_RESPONSE',
            'TikTok вернул неподтверждённый список роликов.',
          );
        for (const item of items) add(item);
        if ((data.hasMore ?? data.has_more) === false || (data.hasMore ?? data.has_more) === 0)
          complete = true;
      })
      .catch((error) => {
        failure = error;
      });
  };
  page.on('response', receive);
  const abort = () => void page.close().catch(() => {});
  signal.addEventListener('abort', abort, { once: true });
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (!response?.ok())
      throw new AppError(502, 'TIKTOK_PROFILE_RESPONSE', 'Не удалось открыть профиль TikTok.');
    const content = await page
      .locator('#__UNIVERSAL_DATA_FOR_REHYDRATION__, #SIGI_STATE')
      .first()
      .textContent({ timeout: 10000 })
      .catch(() => null);
    if (content)
      try {
        const data = object(JSON.parse(content)),
          detail = object(object(data.__DEFAULT_SCOPE__)['webapp.user-detail']);
        for (const item of Array.isArray(detail.itemList)
          ? detail.itemList
          : Object.values(object(data.ItemModule)))
          add(item);
      } catch {}
    let previous = -1,
      stagnant = 0;
    for (let i = 0; i < 20; i++) {
      signal.throwIfAborted();
      await accessGate(page);
      await delay(700, undefined, { signal });
      await queue;
      if (failure) throw failure;
      if (complete) break;
      stagnant = previous === found.size ? stagnant + 1 : 0;
      previous = found.size;
      if (stagnant >= 4 || found.size >= Math.max(limit * 2, 30)) break;
      await page.evaluate(() => {
        let element = document.querySelector(
          '[data-e2e="user-post-item-list"], [data-e2e="user-post-item"], #main-content-user',
        )?.parentElement;
        while (element && element !== document.body) {
          if (
            /auto|scroll/.test(getComputedStyle(element).overflowY) &&
            element.scrollHeight > element.clientHeight + 10
          ) {
            element.scrollTop = element.scrollHeight;
            return;
          }
          element = element.parentElement;
        }
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
    }
    await queue;
    if (failure) throw failure;
    const videos = [...found.values()]
      .sort(
        (a, b) =>
          (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || b.id.localeCompare(a.id),
      )
      .slice(0, limit);
    if (!videos.length && !complete)
      throw new AppError(
        502,
        'TIKTOK_PROFILE_EMPTY',
        'TikTok не выдал список роликов. Это не подтверждает, что профиль пуст.',
      );
    return {
      videos,
      complete: complete && [...found.values()].every((video) => !!video.publishedAt),
    };
  } finally {
    signal.removeEventListener('abort', abort);
    page.off('response', receive);
    await queue;
  }
}
