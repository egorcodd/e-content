import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../errors.ts';
import { parseSource, type AnalysisSource } from '../../src/features/sources/model.ts';
import { parseComments, parseVideoPage, type CommentPage, type TikTokVideo } from './parser.ts';
import type { ReadOptions, TikTokReader } from './contracts.ts';
import { discoverVideos } from './profile.ts';

export type TikTokBrowserSession = {
  acquire(source: AnalysisSource): Promise<BrowserContext>;
  verify(context: BrowserContext, page: Page): Promise<void>;
  release(context: BrowserContext): Promise<void>;
  remember?(source: AnalysisSource, discovery: { videos: TikTokVideo[]; complete: boolean }): void;
  reportError?(error: unknown): void;
};

const rootPath = '/api/comment/list/';
const replyPath = '/api/comment/list/reply/';
function allowedPage(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['www.tiktok.com', 'tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(
        url.hostname,
      ) &&
      (!url.port || url.port === '443')
    );
  } catch {
    return false;
  }
}
function localHost(value: string) {
  try {
    const { hostname, protocol } = new URL(value);
    return (
      !['https:', 'http:', 'data:', 'blob:', 'about:'].includes(protocol) ||
      /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$)/i.test(hostname) ||
      /\.local$|\.internal$/i.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return true;
  }
}
export class PublicTikTokReader implements TikTokReader {
  constructor(
    private launch: () => Promise<Browser> = () =>
      chromium.launch({ channel: process.env.TIKTOK_BROWSER_CHANNEL || 'msedge', headless: true }),
    private storage: () => Awaited<ReturnType<BrowserContext['storageState']>> | undefined = () =>
      undefined,
    private session?: TikTokBrowserSession,
  ) {}
  async read(source: AnalysisSource, options: ReadOptions) {
    const parsed = parseSource(source.url, 'tiktok');
    const signal = AbortSignal.any([
      options.signal,
      AbortSignal.timeout(Math.min(600000, 60000 + options.maxVideos * 30000)),
    ]);
    let browser: Browser | undefined, context: BrowserContext | undefined, fatal: unknown;
    let requests = 0;
    const fail = (error: unknown) => {
      fatal ??= error;
      void context?.close().catch(() => {});
    };
    const check = () => {
      if (fatal) throw fatal;
      signal.throwIfAborted();
    };
    const abort = () => void context?.close().catch(() => {});
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (this.session) context = await this.session.acquire(source);
      else
        browser = await this.launch().catch(() => {
          throw new AppError(
            503,
            'TIKTOK_BROWSER',
            'Не удалось открыть браузер сборщика TikTok. Проверьте установку Microsoft Edge.',
          );
        });
      check();
      context ??= await browser!.newContext({
        storageState: this.storage(),
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: false,
        serviceWorkers: 'block',
      });
      const cached = new Map<string, { body: Buffer; headers: Record<string, string> }>();
      let cacheSize = 0;
      context.on('response', (response) => {
        if (
          response.status() !== 200 ||
          !['script', 'stylesheet'].includes(response.request().resourceType())
        )
          return;
        void response
          .body()
          .then((body) => {
            if (body.length > 5000000 || cacheSize + body.length > 32000000) return;
            const headers = { ...response.headers() };
            for (const name of ['set-cookie', 'content-encoding', 'content-length'])
              delete headers[name];
            cached.set(response.url(), { body, headers });
            cacheSize += body.length;
          })
          .catch(() => {});
      });
      await context.route('**/*', async (route) => {
        try {
          check();
          const request = route.request(),
            url = request.url();
          if (
            localHost(url) ||
            (request.isNavigationRequest() &&
              request.frame() === request.frame().page().mainFrame() &&
              !allowedPage(url))
          )
            return await route.abort();
          if (['media', 'image', 'font'].includes(request.resourceType()))
            return await route.abort();
          const saved =
            request.method() === 'GET' && ['script', 'stylesheet'].includes(request.resourceType())
              ? cached.get(url)
              : undefined;
          if (saved) return await route.fulfill({ status: 200, ...saved });
          if (++requests > 1000)
            throw new AppError(
              429,
              'TIKTOK_REQUEST_LIMIT',
              'Достигнут предел сетевых обращений TikTok. Полученные данные сохранены.',
            );
          const pathname = new URL(url).pathname;
          await options.beforeRequest(
            request.isNavigationRequest() || pathname.startsWith('/api/') ? 'data' : 'resource',
          );
          check();
          await route.fallback();
        } catch (error) {
          await route.abort().catch(() => {});
          if (!signal.aborted) fail(error);
        }
      });
      const page = context.pages()[0] ?? (await context.newPage());
      if (this.session) await this.session.verify(context, page);
      const discovery =
        parsed.kind === 'profile'
          ? await discoverVideos(page, parsed.url, options.maxVideos, signal)
          : null;
      if (discovery) this.session?.remember?.(source, discovery);
      check();
      const urls = discovery ? discovery.videos.map((video) => video.url) : [parsed.url];
      if (!urls.length && !discovery?.complete)
        throw new AppError(
          404,
          'TIKTOK_NO_VIDEOS',
          'TikTok не показал доступные публичные ролики этого профиля.',
        );
      let consumed = 0;
      let limited = false;
      const report = options.onProgress;
      const progress: ReadOptions['onProgress'] = (value) => {
        if (value.status === 'limited') limited = true;
        report(value);
      };
      for (const url of urls.slice(0, options.maxVideos)) {
        check();
        const count = await this.video(
          page,
          url,
          {
            ...options,
            onProgress: progress,
            maxComments: Math.max(0, options.maxComments - consumed),
          },
          signal,
          check,
          fail,
        );
        consumed += count;
      }
      if (parsed.kind === 'profile' && (limited || !discovery?.complete))
        report({
          url: parsed.url,
          status: 'limited',
          comments: consumed,
          reason: limited
            ? 'Получена часть доступных комментариев профиля.'
            : 'Обработаны доступные ролики профиля. Полнота списка роликов не подтверждена TikTok.',
        });
      else if (parsed.kind === 'profile')
        report({ url: parsed.url, status: 'completed', comments: consumed });
    } catch (error) {
      if (options.signal.aborted) throw options.signal.reason;
      if (fatal) {
        this.session?.reportError?.(fatal);
        throw fatal;
      }
      if (signal.aborted)
        throw new AppError(
          408,
          'TIKTOK_TIMEOUT',
          'TikTok не завершил выдачу данных за отведённое время. Полученные записи сохранены.',
        );
      if (error instanceof AppError) {
        this.session?.reportError?.(error);
        throw error;
      }
      throw new AppError(
        502,
        'TIKTOK_UNAVAILABLE',
        'Не удалось прочитать публичную страницу TikTok. Полученные записи сохранены.',
      );
    } finally {
      signal.removeEventListener('abort', abort);
      if (context && this.session) await this.session.release(context);
      else await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  }
  private async dismissConsent(page: Page) {
    const decline = page
      .getByRole('button', {
        name: /Decline optional cookies|Reject optional|Отклонить использование дополнительных/i,
      })
      .first();
    if (await decline.isVisible().catch(() => false))
      await decline.click({ timeout: 2000 }).catch(() => {});
    const onboarding = page.getByText(/^(Got it|Понятно)$/).first();
    if (await onboarding.isVisible().catch(() => false))
      await onboarding.click({ timeout: 1500 }).catch(() => {});
  }
  private async gate(page: Page) {
    const body = (
      await page
        .locator('body')
        .innerText({ timeout: 1500 })
        .catch(() => '')
    ).slice(-12000);
    if (
      (await page
        .locator('iframe[src*="captcha"], [id*="captcha-verify"], [class*="captcha_verify"]')
        .count()) ||
      /Verify to continue|Drag the puzzle|Complete the puzzle|Подтвердите, что вы человек|Перетащите.*пазл/i.test(
        body,
      )
    )
      throw new AppError(
        403,
        'TIKTOK_BLOCKED',
        'TikTok запросил проверку доступа. Сбор без входа остановлен.',
      );
    if (
      /When is your birthday|Когда у вас день рождения|Enter your date of birth|Укажите дату рождения/i.test(
        body,
      )
    )
      throw new AppError(
        401,
        'TIKTOK_AGE_REQUIRED',
        'TikTok требует подтвердить возраст для просмотра комментариев. Сбор без входа остановлен.',
      );
    return /Log in to TikTok|Войдите в TikTok|Sign up for TikTok/i.test(body);
  }
  private async navigate(page: Page, url: string, check: () => void) {
    check();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (response?.status() === 429)
      throw new AppError(
        429,
        'TIKTOK_BLOCKED',
        'TikTok ограничил частоту обращений. Полученные данные сохранены.',
      );
    if (response && response.status() >= 400)
      throw new AppError(
        response.status(),
        'TIKTOK_UNAVAILABLE',
        'TikTok не открыл публичную страницу источника.',
      );
    if (!allowedPage(page.url()))
      throw new AppError(400, 'TIKTOK_REDIRECT', 'TikTok перенаправил на неподдерживаемый адрес.');
    await page
      .locator('#__UNIVERSAL_DATA_FOR_REHYDRATION__, #SIGI_STATE')
      .first()
      .waitFor({ state: 'attached', timeout: 15000 })
      .catch(() => {});
    await this.dismissConsent(page);
    check();
  }
  private async video(
    page: Page,
    url: string,
    options: ReadOptions,
    signal: AbortSignal,
    check: () => void,
    fail: (error: unknown) => void,
  ) {
    let video: TikTokVideo | undefined;
    let queue = Promise.resolve(),
      generation = 0,
      consumed = 0,
      rootPage: CommentPage | undefined;
    const replies = new Map<string, CommentPage>(),
      roots = new Map<string, { id: string; replyCount?: number }>(),
      seen = new Set<string>(),
      parents = new Map<string, string | undefined>(),
      cursors = new Map<string, Set<string>>(),
      pages = new Set<string>();
    let truncated = false;
    let progressStatus: 'reading' | 'completed' | 'limited' = 'reading';
    const update = (reason?: string) =>
      options.onProgress({
        url: video?.url ?? url,
        status: progressStatus,
        comments: consumed,
        expectedComments: video?.commentCount,
        cursor: rootPage?.cursor ?? undefined,
        reason,
      });
    const accept = (item: CommentPage['items'][number]) => {
      if (!video || seen.has(item.id) || (!options.replies && item.parentId)) return;
      if (consumed >= options.maxComments) {
        truncated = true;
        return;
      }
      seen.add(item.id);
      parents.set(item.id, item.parentId);
      consumed++;
      options.onComment(item, video);
      if (!item.parentId) roots.set(item.id, item);
    };
    const receive = (response: Response) => {
      const location = new URL(response.url());
      if (
        !location.hostname.endsWith('.tiktok.com') ||
        ![rootPath, replyPath].includes(location.pathname)
      )
        return;
      const requested =
        location.searchParams.get('aweme_id') ?? location.searchParams.get('item_id');
      const requestedVideo = new URL(page.url()).pathname.split('/').at(-1);
      if (requested && requested !== requestedVideo) return;
      queue = queue
        .then(async () => {
          if (!video) return;
          if ([401, 403, 429].includes(response.status()))
            throw new AppError(
              response.status(),
              response.status() === 401 ? 'TIKTOK_LOGIN_REQUIRED' : 'TIKTOK_BLOCKED',
              response.status() === 401
                ? 'TikTok требует вход для чтения комментариев.'
                : 'TikTok ограничил выдачу комментариев. Полученные данные сохранены.',
            );
          if (response.status() !== 200)
            throw new AppError(502, 'TIKTOK_RESPONSE', 'TikTok не выдал страницу комментариев.');
          if (Number(response.headers()['content-length'] ?? 0) > 5000000)
            throw new AppError(
              502,
              'TIKTOK_RESPONSE_SIZE',
              'Ответ TikTok превысил допустимый объём.',
            );
          const raw = await response.body();
          if (raw.length > 5000000)
            throw new AppError(
              502,
              'TIKTOK_RESPONSE_SIZE',
              'Ответ TikTok превысил допустимый объём.',
            );
          let data: unknown;
          try {
            data = JSON.parse(raw.toString('utf8'));
          } catch {
            throw new AppError(
              502,
              'TIKTOK_RESPONSE',
              'TikTok вернул пустой ответ или страницу проверки вместо комментариев.',
            );
          }
          const root =
            location.pathname === replyPath
              ? (location.searchParams.get('comment_id') ?? undefined)
              : undefined;
          const pageKey = `${root ?? 'root'}:${location.searchParams.get('cursor') ?? '0'}`;
          if (pages.has(pageKey)) return;
          pages.add(pageKey);
          const parsed = parseComments(data, video.id, root),
            key = root ?? 'root';
          const history = cursors.get(key) ?? new Set<string>();
          if (parsed.hasMore && parsed.cursor && history.has(parsed.cursor))
            throw new AppError(
              502,
              'TIKTOK_CURSOR',
              'TikTok повторил курсор. Сбор остановлен с сохранением данных.',
            );
          if (parsed.cursor) history.add(parsed.cursor);
          cursors.set(key, history);
          if (root) replies.set(root, parsed);
          else rootPage = parsed;
          for (const item of parsed.items) accept(item);
          if (options.replies) for (const item of parsed.previews) accept(item);
          generation++;
          update();
        })
        .catch(fail);
    };
    page.on('response', receive);
    try {
      await this.navigate(page, url, check);
      const scripts = await page
        .locator('#__UNIVERSAL_DATA_FOR_REHYDRATION__, #SIGI_STATE')
        .allTextContents();
      const id = new URL(page.url()).pathname.split('/').at(-1)!;
      for (const content of scripts) {
        try {
          video = parseVideoPage(JSON.parse(content), id) ?? undefined;
        } catch (error) {
          if (error instanceof AppError) throw error;
        }
        if (video) break;
      }
      if (!video) {
        await this.gate(page);
        throw new AppError(
          502,
          'TIKTOK_METADATA',
          'TikTok не показал проверяемые данные выбранного ролика.',
        );
      }
      options.onVideo(video);
      update();
      if (!options.comments || !options.maxComments) {
        progressStatus = options.comments ? 'limited' : 'completed';
        update(options.comments ? 'Достигнут общий предел комментариев запуска.' : undefined);
        return 0;
      }
      await this.openComments(page, check);
      const wait = async (previous: number, timeout = 7000) => {
        const until = Date.now() + timeout;
        while (generation === previous && Date.now() < until) {
          check();
          await this.gate(page);
          await delay(150, undefined, { signal });
          await queue;
        }
        check();
        return generation > previous;
      };
      await wait(0);
      await queue;
      check();
      if (!rootPage) {
        if (await this.gate(page))
          throw new AppError(
            401,
            'TIKTOK_LOGIN_REQUIRED',
            'TikTok требует вход для просмотра комментариев. Публичные данные ролика сохранены.',
          );
        if (
          video.commentCount === 0 &&
          (await page
            .getByText(/No comments yet|Пока нет комментариев|Комментариев пока нет/i)
            .count())
        ) {
          progressStatus = 'completed';
          update();
          return 0;
        }
        throw new AppError(
          502,
          'TIKTOK_NO_COMMENT_RESPONSE',
          'TikTok не выдал доступную гостю страницу комментариев. Сбор не отмечен успешным.',
        );
      }
      if (!consumed && video.commentCount && video.commentCount > 0)
        throw new AppError(
          502,
          'TIKTOK_EMPTY_COMMENTS',
          'TikTok показывает комментарии в счётчике, но не выдал их тексты гостю.',
        );
      for (
        let pageNumber = 0;
        rootPage.hasMore && consumed < options.maxComments && pageNumber < 100;
        pageNumber++
      ) {
        const before = generation;
        await this.scrollComments(page);
        if (!(await wait(before)))
          throw new AppError(
            502,
            'TIKTOK_PAGINATION',
            'TikTok не открыл следующую страницу комментариев. Полученное сохранено.',
          );
      }
      if (options.replies && consumed < options.maxComments) {
        const buttons = page.getByText(
          /View \d+ (more )?repl|View replies|Посмотреть.*ответ|Показать.*ответ|Ответов?: \d|Смотреть.*ответ/i,
        );
        for (
          let i = 0;
          i < Math.min(await buttons.count(), 100) && consumed < options.maxComments;
          i++
        ) {
          check();
          const before = generation;
          await buttons
            .nth(i)
            .click({ timeout: 2500 })
            .catch(() => {});
          await wait(before, 3500);
        }
      }
      const missingReplies =
        options.replies &&
        [...roots.values()].some((root) => {
          const observed = [...parents.values()].filter((parent) => parent === root.id).length;
          return (root.replyCount ?? 0) > observed || replies.get(root.id)?.hasMore === true;
        });
      if (rootPage.hasMore || truncated || missingReplies) {
        progressStatus = 'limited';
        update(
          consumed >= options.maxComments || truncated
            ? 'Достигнут предел комментариев выбранного источника.'
            : missingReplies
              ? 'TikTok не раскрыл все ветки ответов.'
              : 'Получена часть доступных страниц комментариев.',
        );
      } else {
        progressStatus = 'completed';
        update();
      }
      return consumed;
    } finally {
      page.off('response', receive);
      await queue;
    }
  }
  private async openComments(page: Page, check: () => void) {
    await page
      .locator('[data-e2e="comment-icon"], [data-e2e="browse-comment-count"]')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {});
    let dismissed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      check();
      await this.dismissConsent(page);
      await this.gate(page);
      const skip = page.getByText(/^(Skip|Пропустить)$/).first();
      if (!dismissed && (await skip.isVisible().catch(() => false))) {
        await skip.click({ timeout: 1500 }).catch(() => {});
        dismissed = true;
        await delay(250);
        await this.gate(page);
      }
      const tab = page
        .getByRole('button', { name: /^(Comments|Комментарии)(?:\s*\(\d+\))?$/ })
        .first();
      const target = (await tab.count())
        ? tab
        : page.locator('[data-e2e="comment-icon"], [data-e2e="browse-comment-count"]').first();
      if (await target.count())
        try {
          await target.click({ timeout: 2000 });
          return;
        } catch {}
      await delay(350);
    }
    await delay(1500);
    check();
    if (await this.gate(page))
      throw new AppError(
        401,
        'TIKTOK_LOGIN_REQUIRED',
        'TikTok требует вход для чтения комментариев. Публичные данные ролика сохранены.',
      );
    throw new AppError(502, 'TIKTOK_COMMENTS_UI', 'Не удалось открыть панель комментариев TikTok.');
  }
  private async scrollComments(page: Page) {
    await page.evaluate(() => {
      const comment = document.querySelector(
        '[data-e2e="comment-level-1"], [data-e2e="comment-item"], [data-e2e="comment-list"]',
      );
      let element = comment?.parentElement;
      while (element && element !== document.body) {
        const style = getComputedStyle(element);
        if (
          /auto|scroll/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 10
        ) {
          element.scrollTop = element.scrollHeight;
          return;
        }
        element = element.parentElement;
      }
      window.scrollBy(0, innerHeight);
    });
  }
}
