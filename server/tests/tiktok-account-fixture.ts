import { chromium, type BrowserContext } from 'playwright';
import { rawVideo, rawComment } from './tiktok-fixtures.ts';
import type { TikTokContextFactory } from '../tiktok/account.ts';

export function accountBrowserFixture() {
  const contexts: BrowserContext[] = [],
    directories: string[] = [],
    requests: string[] = [];
  let expire = false,
    block = false;
  const base = 7708022666925559054n;
  const videos = Array.from({ length: 25 }, (_, i) => ({
    ...rawVideo,
    id: String(base + BigInt(i)),
    createTime: rawVideo.createTime - i * 600,
    desc: `Ролик ${i + 1}`,
    statsV2: { ...rawVideo.statsV2, commentCount: '1' },
  }));
  const pinned = {
    ...videos[0],
    id: String(base + 1000n),
    createTime: rawVideo.createTime - 86400000,
    desc: 'Старый закреплённый ролик',
  };
  const factory: TikTokContextFactory = async (directory) => {
    directories.push(directory);
    const context = await chromium.launchPersistentContext(directory, {
      channel: 'msedge',
      headless: true,
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: 'block',
    });
    contexts.push(context);
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      requests.push(url.pathname + url.search);
      const authenticated =
        !expire && (route.request().headers().cookie ?? '').includes('sessionid=fixture-account');
      const identity = {
        user_id_str: '9000000000000000001',
        username: 'fixture_user',
        screen_name: 'Fixture Creator',
      };
      const json = (data: unknown) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      const html = (body: string, data: unknown = {}) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><body>${body}<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></body></html>`,
        });
      if (url.pathname.startsWith('/passport/'))
        return json(
          authenticated
            ? { message: 'success', data: identity }
            : { message: 'error', data: { error_code: 13, name: 'session_expired' } },
        );
      if (url.pathname === '/login') return html('<h1>Fixture login window</h1>');
      if (url.pathname === '/login/qrcode') return html('<h1>Log in with QR code</h1>');
      if (url.pathname === '/')
        return html(block ? 'When is your birthday?' : 'Fixture account', {
          __DEFAULT_SCOPE__: { 'webapp.app-context': { user: authenticated ? identity : {} } },
        });
      if (url.pathname === '/api/post/item_list/') {
        const next = url.searchParams.get('cursor') === '20';
        return json({
          statusCode: 0,
          itemList: next ? [videos[0], ...videos.slice(15)] : [pinned, ...videos.slice(0, 15)],
          hasMore: !next,
          cursor: next ? '40' : '20',
        });
      }
      if (url.pathname === '/@fixture_user')
        return html(
          `<h1>Fixture Creator</h1><div style="height:4000px">Profile</div><script>
        let cursor='0',busy=false,done=false;
        async function load(){if(busy||done)return;busy=true;const r=await fetch('/api/post/item_list/?cursor='+cursor);const d=await r.json();cursor=d.cursor;done=!d.hasMore;busy=false;}
        setTimeout(()=>void load(),30);window.addEventListener('scroll',()=>void load());
      </script>`,
          { __DEFAULT_SCOPE__: { 'webapp.user-detail': { itemList: [] } } },
        );
      if (url.pathname === '/api/comment/list/') {
        const videoId = url.searchParams.get('aweme_id')!;
        const comment = { ...rawComment(String(BigInt(videoId) + 2000n)), aweme_id: videoId };
        return json({ status_code: 0, comments: [comment], has_more: false, cursor: '0' });
      }
      if (url.pathname.includes('/video/')) {
        const video = videos.find((item) => item.id === url.pathname.split('/').at(-1));
        if (!video) return route.fulfill({ status: 404, body: '' });
        return html(
          `<button data-e2e="comment-icon" onclick="void fetch('/api/comment/list/?aweme_id=${video.id}&cursor=0')">Comments</button>`,
          { __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: video } } } },
        );
      }
      return route.fulfill({ status: 404, body: '' });
    });
    return context;
  };
  return {
    factory,
    contexts,
    directories,
    requests,
    videos,
    pinned,
    set expire(value: boolean) {
      expire = value;
    },
    set block(value: boolean) {
      block = value;
    },
    async signIn() {
      const context = contexts.at(-1)!;
      await context.addCookies([
        {
          name: 'sessionid',
          value: 'fixture-account',
          domain: '.tiktok.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
          expires: Math.floor(Date.now() / 1000) + 86400,
        },
      ]);
    },
    async close() {
      for (const context of contexts) await context.close().catch(() => {});
    },
  };
}
