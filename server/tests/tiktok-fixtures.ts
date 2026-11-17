import { chromium, type Browser } from 'playwright';
import { PublicTikTokReader } from '../tiktok/reader.ts';

export const videoId = '7708022666925559054';
export const videoUrl = `https://www.tiktok.com/@fixture_user/video/${videoId}`;
export const now = Math.floor(Date.now() / 1000) - 10;
export const rawVideo = {
  id: videoId,
  author: { uniqueId: 'fixture_user' },
  desc: 'Проверка стабильности автоматизации',
  createTime: now,
  statsV2: { playCount: '10100', diggCount: '1051', shareCount: '50', commentCount: '3' },
};
export function rawComment(id: string, parent = '0') {
  return {
    cid: id,
    aweme_id: videoId,
    reply_id: parent,
    text: [
      'Почему автотесты падают только на CI?',
      'Как найти причину нестабильных тестов в пайплайне?',
      'Подскажи, как разбирать логи фейлов автотестов при запуске в CI?',
    ][Number(BigInt(id) % 3n)],
    create_time: now,
    digg_count: 5,
    reply_comment_total: 0,
  };
}
export function readerFixture(
  mode: 'success' | 'login' | 'age' | 'captcha' | 'repeat' | 'hang' = 'success',
) {
  const requests: string[] = [];
  let browser: Browser | undefined;
  const launch = async () => {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const original = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await original(options);
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        requests.push(url.pathname + url.search);
        if (url.pathname.includes('/api/comment/')) {
          if (mode === 'hang') return;
          const more = !url.searchParams.get('cursor') || url.searchParams.get('cursor') === '0';
          const root = rawComment(more ? '9000000000000000001' : '9000000000000000003');
          if (more) {
            root.reply_comment_total = 1;
            Object.assign(root, { reply_comment: [rawComment('9000000000000000002', root.cid)] });
          }
          return route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
              status_code: 0,
              comments: [root],
              has_more: mode === 'repeat' || more ? 1 : 0,
              cursor: 20,
            }),
          });
        }
        if (url.pathname.includes('/video/')) {
          const gated =
            mode === 'login'
              ? '<h2>Log in to TikTok</h2>'
              : mode === 'age'
                ? '<h2>When is your birthday?</h2>'
                : mode === 'captcha'
                  ? '<h2>Verify to continue</h2>'
                  : '';
          return route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: rawVideo }, statusCode: 0 } } })}</script><button data-e2e="comment-icon" onclick="openComments()">Comments</button>${gated}<div id="list" style="height:30px;overflow:auto"><div style="height:300px"><div data-e2e="comment-level-1">Fixture comment row</div></div></div><script>
            let cursor=0,busy=false;
            async function load(){if(busy)return;busy=true;await fetch('/api/comment/list/?aweme_id=${videoId}&cursor='+cursor);cursor=20;busy=false;}
            function openComments(){${['login', 'age', 'captcha'].includes(mode) ? 'return;' : 'void load();'}}
            document.getElementById('list').addEventListener('scroll',()=>void load());
          </script></body></html>`,
          });
        }
        return route.fulfill({ status: 404, body: '' });
      });
      return context;
    };
    return browser;
  };
  return {
    reader: new PublicTikTokReader(launch),
    requests,
    get browser() {
      return browser;
    },
  };
}
