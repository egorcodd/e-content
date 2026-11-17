import { rawVideo, rawComment } from '../../server/tests/tiktok-fixtures.ts';

export function zenTikTokResponse(value) {
  const url = new URL(value);
  const user = {
    user_id_str: '9000000000000000001',
    username: 'fixture_user',
    screen_name: 'Zen Fixture',
  };
  const videos = Array.from({ length: 25 }, (_, i) => ({
    ...rawVideo,
    id: String(BigInt(rawVideo.id) + BigInt(i)),
    createTime: Math.floor(Date.now() / 1000) - 60 - i * 60,
    statsV2: { ...rawVideo.statsV2, commentCount: '1' },
  }));
  const json = (data) => ({ body: JSON.stringify(data), type: 'application/json' });
  const html = (body, data = {}) => ({
    body: `<!doctype html><html><head><title>TikTok fixture</title></head><body>${body}<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: data })}</script></body></html>`,
    type: 'text/html',
  });
  if (url.pathname === '/')
    return html(
      '<h1>Fixture home</h1>' +
        (process.env.ZEN_TEST_CANCELLED === '1'
          ? '<script>void fetch("/api/post/item_list/?cancelled=1").catch(()=>{});</script>'
          : ''),
      { 'webapp.app-context': { user } },
    );
  if (url.pathname.startsWith('/passport/')) return json({ message: 'success', data: user });
  if (url.pathname === '/api/post/item_list/')
    return json({ statusCode: 0, itemList: videos, hasMore: false, cursor: '0' });
  if (url.pathname === '/@fixture_user')
    return html(`<h1>Profile</h1><script>void fetch('/api/post/item_list/');</script>`);
  if (url.pathname === '/api/comment/list/') {
    const id = url.searchParams.get('aweme_id');
    return json({
      status_code: 0,
      comments: [{ ...rawComment(String(BigInt(id) + 2000n)), aweme_id: id }],
      has_more: false,
      cursor: '0',
    });
  }
  if (url.pathname.includes('/video/')) {
    const video = videos.find((v) => v.id === url.pathname.split('/').at(-1));
    const button = `<button data-e2e="comment-icon" onclick="void fetch('/api/comment/list/?aweme_id=${video.id}&cursor=0')">Comments</button>`;
    return html(
      process.env.ZEN_TEST_DELAYED_UI === '1'
        ? `<script>setTimeout(()=>document.body.insertAdjacentHTML('beforeend',${JSON.stringify(button)}),2500);</script>`
        : button,
      { 'webapp.video-detail': { itemInfo: { itemStruct: video } } },
    );
  }
  return html('Fixture');
}

export async function interceptTikTok(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl),
    pending = new Map();
  let id = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const command = (method, params) =>
    new Promise((resolve, reject) => {
      const sequence = ++id,
        timer = setTimeout(() => {
          pending.delete(sequence);
          reject(Error('BiDi timed out: ' + method));
        }, 15000);
      pending.set(sequence, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: sequence, method, params }));
    });
  let error;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const p = pending.get(message.id);
      if (p) {
        pending.delete(message.id);
        clearTimeout(p.timer);
        message.type === 'error' ? p.reject(Error(message.message)) : p.resolve(message.result);
      }
    } else if (message.method === 'network.beforeRequestSent' && message.params.isBlocked) {
      if (new URL(message.params.request.url).searchParams.has('cancelled')) {
        void command('network.failRequest', { request: message.params.request.request }).catch(
          (e) => {
            error = e;
          },
        );
        return;
      }
      const response = zenTikTokResponse(message.params.request.url);
      void command('network.provideResponse', {
        request: message.params.request.request,
        statusCode: 200,
        headers: [{ name: 'content-type', value: { type: 'string', value: response.type } }],
        body: { type: 'string', value: response.body },
      }).catch((e) => {
        error = e;
      });
    }
  });
  await command('session.subscribe', { events: ['network.beforeRequestSent'] });
  await command('network.addIntercept', {
    phases: ['beforeRequestSent'],
    urlPatterns: [{ type: 'pattern', protocol: 'https', hostname: 'www.tiktok.com' }],
  });
  return {
    close: () => socket.close(),
    check: () => {
      if (error) throw error;
    },
  };
}
